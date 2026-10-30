import { json, fail, requireAdmin, adminWho, text } from "./lib/http.mjs";
import { getEvent, putEvent, getAttendees, putMeta, listEvents } from "./lib/store.mjs";
import { mayCost } from "./lib/auth.mjs";
import { siteUrl } from "./lib/site.mjs";
import { directory, agencyOf } from "./lib/agencies.mjs";
import { templatesFor, certSettings, certIndex, certRecord, issue, certificatePdf, certFileName, certDate, designsOf, putDesigns, placeDesign, cleanDesign, putDesignImage, designImage } from "./lib/certs.mjs";
import { randomBytes } from "node:crypto";

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
 *
 * Designs uploaded in the app (Andrew 30 Oct 2026), for one event or as a template for any:
 *   POST /api/certificates?place=1[&event=…]           { image, mediaType, w, h } where Claude would put the words
 *   POST /api/certificates?design=new                  { name, scope: event|any, event, w, h, image, fields, qr, dateStyle }
 *   PUT  /api/certificates?design=<id>                 { name?, scope?, event?, fields?, qr?, dateStyle?, retired? }
 *   GET  /api/certificates?design=<id>&image=1         its page, as a JPEG
 *   GET  /api/certificates?designs=1                   every design, for Admin › Certificate designs
 * A template for any event is for the president and the VP; a design for one event, for them and that event's lead.
 */
const mayCertify = (who, event) => who?.key === true || mayCost(who) ||
  (event?.board ?? []).some((m) => m.lead && String(m.email ?? "").toLowerCase() === String(who?.email ?? "").toLowerCase());

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const url = new URL(req.url);
  const q = (k) => url.searchParams.get(k);
  if (q("place") || q("design") || q("designs")) return designs(req, url, q);
  const event = await getEvent(q("event"));
  if (!event) return fail("No such event.", 404);
  if (!mayCertify(adminWho(req), event)) return fail("Certificates are for the president, the VP and the event's lead.", 403);
  const people = await peopleOf(event);

  if (req.method === "GET" && q("csv")) return csv(event, people, q("csv"));
  const templates = await templatesFor(event);
  if (req.method === "GET" && (q("pdf") || q("preview"))) {
    const settings = certSettings(event, templates);
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
  if (req.method === "GET") return json(await view(event, people, templates));
  if (req.method === "PUT") {
    const body = await req.json().catch(() => ({}));
    const template = text(body.template, 60), date = text(body.date, 10);
    if (template && !templates.some((t) => t.id === template)) return fail("No such design.");
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("Pick a date.");
    event.certs = { ...(event.certs ?? {}), ...(template ? { template } : {}), date, ...(body.course !== undefined ? { course: text(body.course, 200) } : {}) };
    await putEvent(event);
    return json(await view(event, people, templates));
  }
  if (req.method === "POST" && q("revoke")) {
    const code = (await certIndex(event.id))[q("revoke")];
    const rec = await certRecord(code);
    if (!rec) return fail("No certificate has been issued to that person.", 404);
    await putMeta(`certs:code:${code}`, { ...rec, revokedAt: new Date().toISOString(), revokedBy: adminWho(req).email || "desk" });
    return json(await view(event, people, templates));
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

async function view(event, people, templates) {
  const index = await certIndex(event.id);
  const issued = new Map();
  for (const [k, code] of Object.entries(index)) { const r = await certRecord(code); if (r) issued.set(k, r); }
  return {
    settings: certSettings(event, templates),
    lastDay: event.lastDay || event.dayOne || "",
    templates: templates.map(designCard),
    people: people.map((p) => ({ ...p, cert: issued.has(p.key) ? { code: issued.get(p.key).code, revoked: !!issued.get(p.key).revokedAt, issuedAt: issued.get(p.key).issuedAt } : null })),
    counts: { coming: people.filter((p) => p.status === "ATTENDING").length, checkedIn: people.filter((p) => p.checkedIn).length, issued: issued.size },
  };
}

/** The two downloads (Andrew 30 Oct 2026: "export the list for registration as well as … a list in csv to upload to the certificate program"). */
/** A design as the screens show it. An uploaded one's picture needs signing in, so the page fetches it with the key. */
const designCard = (t) => ({ id: t.id, name: t.name, note: t.builtIn ? t.note : (t.scope === "any" ? "Template: any event" : "This event's own design"), builtIn: !!t.builtIn,
  thumb: t.builtIn ? `/assets/${t.image}` : `/api/certificates?design=${encodeURIComponent(t.id)}&image=1`, course: !!(t.fields?.course && !t.fields.course.off), scope: t.scope, event: t.event ?? "", landscape: (t.w ?? 612) > (t.h ?? 792) });

async function designs(req, url, q) {
  const who = adminWho(req);
  const mayFor = async (scope, eventId) => {
    if (scope === "any") return who?.key === true || mayCost(who);
    const ev = await getEvent(eventId);
    return !!ev && mayCertify(who, ev);
  };
  if (req.method === "GET" && q("designs")) {
    const titles = new Map((await listEvents()).map((e) => [e.id, e.title]));
    return json({ designs: (await designsOf()).map((d) => ({ ...designCard(d), retired: !!d.retired, eventTitle: titles.get(d.event) ?? "", createdAt: d.createdAt, createdBy: d.createdBy, w: d.w, h: d.h })),
      events: [...titles].map(([id, title]) => ({ id, title })), mayTemplate: who?.key === true || mayCost(who) });
  }
  if (req.method === "GET" && q("design") && q("image")) {
    const bytes = await designImage(q("design"));
    if (!bytes) return fail("No such design.", 404);
    return new Response(bytes, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" } });
  }
  if (req.method === "GET" && q("design")) {
    const d = (await designsOf()).find((x) => x.id === q("design"));
    return d ? json({ design: d }) : fail("No such design.", 404);
  }
  const body = await req.json().catch(() => ({}));
  const w = Number(body.w) || 612, h = Number(body.h) || 792;
  if (req.method === "POST" && q("place")) {
    if (!(await mayFor(q("event") ? "event" : "any", q("event"))) && !mayCost(who)) return fail("Certificate designs are for the president, the VP and the event's lead.", 403);
    if (!/^[A-Za-z0-9+/=]+$/.test(body.image ?? "") || body.image.length > 5_000_000) return fail("That picture could not be read.");
    try { return json(await placeDesign({ image: body.image, mediaType: body.mediaType === "image/png" ? "image/png" : "image/jpeg", w, h })); }
    catch (e) { return fail(e.message, 503); }
  }
  if (req.method === "POST" && q("design") === "new") {
    const scope = body.scope === "any" ? "any" : "event";
    if (!(await mayFor(scope, body.event))) return fail(scope === "any" ? "Templates for any event are for the president and the VP." : "A design for an event is for the president, the VP and that event's lead.", 403);
    const name = text(body.name, 120);
    if (!name) return fail("Give the design a name.");
    const bytes = Buffer.from(String(body.image ?? ""), "base64");
    if (bytes.length < 1000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return fail("The design's picture did not arrive. Try again.");
    if (bytes.length > 4_500_000) return fail("That design is too large. Save it smaller and try again.");
    const id = `d${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
    await putDesignImage(id, bytes);
    const d = { id, name, scope, event: scope === "event" ? text(body.event, 80) : "", w, h, ...cleanDesign(body, w, h), createdAt: new Date().toISOString(), createdBy: who.email || "desk" };
    await putDesigns([...(await designsOf()), d]);
    return json({ design: d });
  }
  if (req.method === "PUT" && q("design")) {
    const list = await designsOf();
    const d = list.find((x) => x.id === q("design"));
    if (!d) return fail("No such design.", 404);
    const scope = body.scope === undefined ? d.scope : body.scope === "any" ? "any" : "event";
    const eventId = scope === "event" ? (body.event === undefined ? d.event : text(body.event, 80)) : "";
    // Both what it was and what it becomes: a lead may not turn their event's design into a template, or take one over.
    if (!(await mayFor(d.scope, d.event)) || !(await mayFor(scope, eventId))) return fail("Only the president and the VP can change that design.", 403);
    const next = { ...d, scope, event: eventId, ...(body.name !== undefined ? { name: text(body.name, 120) || d.name } : {}),
      ...(body.fields !== undefined || body.qr !== undefined || body.dateStyle !== undefined ? cleanDesign({ fields: body.fields ?? d.fields, qr: body.qr === undefined ? d.qr : body.qr, dateStyle: body.dateStyle ?? d.dateStyle }, d.w, d.h) : {}),
      ...(body.retired !== undefined ? { retired: !!body.retired } : {}), updatedAt: new Date().toISOString() };
    await putDesigns(list.map((x) => (x.id === d.id ? next : x)));
    return json({ design: next });
  }
  return fail("Method not allowed.", 405);
}

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
