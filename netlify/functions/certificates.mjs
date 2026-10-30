import { json, fail, requireAdmin, adminWho, text } from "./lib/http.mjs";
import { getEvent, putEvent, getAttendees, putMeta } from "./lib/store.mjs";
import { mayCost } from "./lib/auth.mjs";
import { siteUrl } from "./lib/site.mjs";
import { directory, agencyOf } from "./lib/agencies.mjs";
import { TEMPLATES, templateOf, certSettings, certIndex, certRecord, issue, certificatePdf, certFileName, certDate } from "./lib/certs.mjs";

/**
 * Certificates and the attendee downloads, on Who's coming (Andrew 30 Oct 2026). The president, the VP and the event's
 * lead can use it ("the president, VP and event lead can access and see").
 *
 *   GET  /api/certificates?event=…                     the settings, the designs, and everyone with their certificate if issued
 *   PUT  /api/certificates?event=…                     { template, date, course } (date "" goes back to the event's last day)
 *   GET  /api/certificates?event=…&pdf=<person key>    that person's certificate (issued the first time; kept for good)
 *   GET  /api/certificates?event=…&preview=1           the design filled with the first person checked in, or a sample name
 *   POST /api/certificates?event=…&revoke=<key>        a certificate issued in error stops verifying
 *   GET  /api/certificates?event=…&csv=registration    everyone registered, sorted by last name
 *   GET  /api/certificates?event=…&csv=certificate     the people checked in, for a certificate program
 */
const mayCertify = (who, event) => who?.key === true || mayCost(who) ||
  (event?.board ?? []).some((m) => m.lead && String(m.email ?? "").toLowerCase() === String(who?.email ?? "").toLowerCase());

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const url = new URL(req.url);
  const q = (k) => url.searchParams.get(k);
  const event = await getEvent(q("event"));
  if (!event) return fail("No such event.", 404);
  if (!mayCertify(adminWho(req), event)) return fail("Certificates are for the president, the VP and the event's lead.", 403);
  const people = await peopleOf(event);

  if (req.method === "GET" && q("csv")) return csv(event, people, q("csv"));
  if (req.method === "GET" && (q("pdf") || q("preview"))) {
    const settings = certSettings(event);
    const origin = siteUrl(req);
    let rec;
    if (q("pdf")) {
      const p = people.find((x) => x.key === q("pdf"));
      if (!p) return fail("That person is not on this event's list.", 404);
      rec = await issue(event, p, { name: p.name, agency: p.agency, settings });
    } else {
      // A preview is never issued: it carries a sample code that verifies nothing.
      const p = people.find((x) => x.checkedIn) ?? { name: "Your Name", agency: "Toronto Police Service" };
      rec = { code: "SAMP-LE00", name: p.name, agency: p.agency, date: settings.date, course: settings.course, template: settings.template, eventTitle: event.title };
    }
    return new Response(await certificatePdf(rec, { origin }), { headers: { "content-type": "application/pdf",
      "content-disposition": `${q("pdf") ? "attachment" : "inline"}; filename="${encodeURIComponent(certFileName(rec))}"; filename*=UTF-8''${encodeURIComponent(certFileName(rec))}`, "cache-control": "no-store" } });
  }
  if (req.method === "GET") return json(await view(event, people));
  if (req.method === "PUT") {
    const body = await req.json().catch(() => ({}));
    const template = text(body.template, 60), date = text(body.date, 10);
    if (template && !templateOf(template)) return fail("No such design.");
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("Pick a date.");
    event.certs = { ...(event.certs ?? {}), ...(template ? { template } : {}), date, ...(body.course !== undefined ? { course: text(body.course, 200) } : {}) };
    await putEvent(event);
    return json(await view(event, people));
  }
  if (req.method === "POST" && q("revoke")) {
    const code = (await certIndex(event.id))[q("revoke")];
    const rec = await certRecord(code);
    if (!rec) return fail("No certificate has been issued to that person.", 404);
    await putMeta(`certs:code:${code}`, { ...rec, revokedAt: new Date().toISOString(), revokedBy: adminWho(req).email || "desk" });
    return json(await view(event, people));
  }
  return fail("Method not allowed.", 405);
};

/** Everyone on the event's list who is or was coming, with their agency under its official name. */
async function peopleOf(event) {
  const list = await directory().catch(() => []);
  return (((await getAttendees(event.id)) ?? {}).people ?? [])
    .filter((p) => p.status === "ATTENDING" || p.checkedIn)
    .map((p) => ({ key: p.key || p.email, first: p.first ?? "", last: p.last ?? "", email: p.email ?? "", phone: p.phone ?? "", typed: p.organization ?? "",
      agency: agencyOf(p, list)?.name || String(p.organization ?? "").trim(), checkedIn: !!p.checkedIn, status: p.status, group: p.group ?? "", source: p.source ?? "",
      name: [p.first, p.last].filter(Boolean).join(" ").trim() || (p.guestOf ? `Guest of ${p.guestOf}` : p.email) }))
    .sort((a, b) => (a.last || a.name).localeCompare(b.last || b.name) || a.first.localeCompare(b.first));
}

async function view(event, people) {
  const index = await certIndex(event.id);
  const issued = new Map();
  for (const [k, code] of Object.entries(index)) { const r = await certRecord(code); if (r) issued.set(k, r); }
  return {
    settings: certSettings(event),
    lastDay: event.lastDay || event.dayOne || "",
    templates: TEMPLATES.map((t) => ({ id: t.id, name: t.name, note: t.note, thumb: `/assets/${t.image}`, course: !!t.fields.course })),
    people: people.map((p) => ({ ...p, cert: issued.has(p.key) ? { code: issued.get(p.key).code, revoked: !!issued.get(p.key).revokedAt, issuedAt: issued.get(p.key).issuedAt } : null })),
    counts: { coming: people.filter((p) => p.status === "ATTENDING").length, checkedIn: people.filter((p) => p.checkedIn).length, issued: issued.size },
  };
}

/** The two downloads (Andrew 30 Oct 2026: "export the list for registration as well as … a list in csv to upload to the certificate program"). */
function csv(event, people, which) {
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const slug = String(event.title || "event").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  let head, rows, name;
  if (which === "certificate") {
    const s = certSettings(event);
    head = ["First name", "Last name", "Agency", "Email", "Event", "Date"];
    rows = people.filter((p) => p.checkedIn).map((p) => [p.first, p.last, p.agency, p.email, s.course, certDate(s.date)]);
    name = `${slug}-certificates.csv`;
  } else if (which === "registration") {
    head = ["Last name", "First name", "Agency", "Agency as typed", "Email", "Phone", "Status", "Checked in", "Group", "Registered"];
    rows = people.filter((p) => p.status === "ATTENDING").map((p) => [p.last, p.first, p.agency, p.typed, p.email, p.phone, "Coming", p.checkedIn ? "Yes" : "", p.group, p.source === "wix" ? "Wix" : "By hand"]);
    name = `${slug}-registration-list.csv`;
  } else return fail("Which list: registration or certificate?");
  return new Response(`﻿${head.map(cell).join(",")}\n${rows.map((r) => r.map(cell).join(",")).join("\n")}\n`, { headers: { "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
}
