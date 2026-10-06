import { json, fail, text, yesNo, fileName } from "./lib/http.mjs";
import { formatPhone } from "./lib/phone.mjs";
import { resolveSponsorToken, putSponsor, listEvents, putLogo, sponsorLead } from "./lib/store.mjs";
import { formatDate } from "./lib/deadlines.mjs";
import { sendMail, sponsorReviewNeededMail } from "./lib/mail.mjs";
import { siteUrl } from "./lib/site.mjs";

/**
 * The sponsor's own endpoint. No account and no password — the token in their
 * link is the credential, exactly as it is for a presenter.
 *
 *   GET  /api/sponsor?t=<token>          what the form needs to draw itself
 *   POST /api/sponsor?t=<token>          the completed pack
 *   POST /api/sponsor?t=<token>&logo=1   the logo, as raw bytes
 */
const MAX_LOGO = 5 * 1024 * 1024;

/** A file is what its first bytes say it is, not what its header claims. */
function sniff(buffer) {
  const b = new Uint8Array(buffer);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length >= 8 && PNG.every((v, i) => b[i] === v)) return "image/png";
  // An SVG is text, so look for its root element near the start.
  const head = new TextDecoder("utf-8", { fatal: false }).decode(b.slice(0, 512)).trim().toLowerCase();
  if (head.startsWith("<?xml") || head.startsWith("<svg")) return head.includes("<svg") ? "image/svg+xml" : null;
  return null;
}

export default async (req) => {
  const url = new URL(req.url);
  const found = await resolveSponsorToken(url.searchParams.get("t"));
  if (!found) return fail("This link isn't valid. Check it came from ONGIA, or ask us for a new one.", 404);
  const { sponsor } = found;

  if (req.method === "GET") return showForm(sponsor);
  if (req.method === "POST") {
    if (url.searchParams.get("logo")) return takeLogo(req, sponsor);
    return submit(req, sponsor, siteUrl(req));
  }
  return fail("Method not allowed.", 405);
};

async function showForm(sponsor) {
  if (!sponsor.openedAt) {
    sponsor.openedAt = new Date().toISOString();
    await putSponsor(sponsor);
  }
  const events = (await listEvents()).filter((e) => e.sponsorsWelcome);
  const lead = await sponsorLead();
  return json({
    sponsor: {
      company: sponsor.company,
      first: sponsor.first,
      last: sponsor.last,
      email: sponsor.email,
      phone: sponsor.phone,
      status: sponsor.status,
      events: sponsor.events ?? {},
      requirements: sponsor.requirements ?? null,
      logoName: sponsor.logoName ?? "",
      submittedAt: sponsor.submittedAt,
      approvedAt: sponsor.approvedAt,
      returnNote: sponsor.status === "returned" ? sponsor.review?.returnNote : null,
    },
    // Only events that want sponsors, and only the dates a load-in could fall on.
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      city: e.city,
      venue: e.venue ?? "",
      dayOne: e.dayOne,
      lastDay: e.lastDay,
      dayOneLong: formatDate(e.dayOne),
      lastDayLong: formatDate(e.lastDay),
      window: { from: addDays(e.dayOne, -2), to: addDays(e.lastDay, 1) },
    })),
    lead,
  });
}

const addDays = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

async function takeLogo(req, sponsor) {
  if (sponsor.status === "approved") return fail("This sponsorship is signed; contact ONGIA to change the logo.", 409);
  const bytes = await req.arrayBuffer();
  if (!bytes.byteLength) return fail("The file was empty.");
  if (bytes.byteLength > MAX_LOGO) return fail("That file is over 5 MB. Please send a smaller one.", 413);
  const type = sniff(bytes);
  if (!type) return fail("Please send a .png, .jpeg or .svg logo.", 415);

  const name = fileName(req.headers.get("x-file-name"),
    `logo.${type === "image/png" ? "png" : type === "image/jpeg" ? "jpg" : "svg"}`);
  await putLogo(sponsor.id, bytes, { type, name });
  sponsor.logoName = name;
  sponsor.logo = { name, type, size: bytes.byteLength, at: new Date().toISOString() };
  await putSponsor(sponsor);
  return json({ ok: true, logo: sponsor.logo });
}

/** Everything the venue needs, collected once and inherited by every event. */
function cleanRequirements(body) {
  // A box left blank is an unanswered question, not zero — Number("") is 0, so
  // without this an empty "Tables" field would be filed as "they need none".
  const count = (v, max) => {
    if (v === "" || v === null || v === undefined) return null;
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : null;
  };
  return {
    tables: count(body?.tables, 10),
    chairs: count(body?.chairs, 20),
    skirting: yesNo(body?.skirting),
    power: yesNo(body?.power),
    extension: yesNo(body?.extension),
    internet: yesNo(body?.internet),
    banner: yesNo(body?.banner),
    shipping: yesNo(body?.shipping),
    staff: count(body?.staff, 50),
    notes: text(body?.notes, 600),
  };
}

async function submit(req, sponsor, origin) {
  if (sponsor.status === "approved") {
    return fail("This sponsorship has already been approved. Contact ONGIA if something needs changing.", 409);
  }
  const body = await req.json().catch(() => null);
  if (!body) return fail("Expected a JSON body.");

  const problems = [];
  const open = (await listEvents()).filter((e) => e.sponsorsWelcome);
  const byId = new Map(open.map((e) => [e.id, e]));

  // Which events they are coming to, and when they get in and out of each.
  const chosen = Array.isArray(body.events) ? body.events.slice(0, 40) : [];
  const events = {};
  for (const row of chosen) {
    const ev = byId.get(text(row?.id, 80));
    if (!ev) continue;
    const from = addDays(ev.dayOne, -2), to = addDays(ev.lastDay, 1);
    const loadIn = text(row?.loadIn, 10);
    const loadOut = text(row?.loadOut, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(loadIn) || !/^\d{4}-\d{2}-\d{2}$/.test(loadOut)) {
      problems.push(`Tell us your load-in and load-out days for ${ev.title}.`);
      continue;
    }
    if (loadIn < from || loadOut > to || loadOut < loadIn) {
      problems.push(`For ${ev.title}, load-in and load-out need to fall between ${formatDate(from)} and ${formatDate(to)}.`);
      continue;
    }
    events[ev.id] = {
      attending: "yes",
      confirmedAt: new Date().toISOString(),
      loadIn,
      loadOut,
      // Inherited from the pack below until this event's own answers differ.
      requirements: null,
    };
  }
  if (!Object.keys(events).length) problems.push("Choose at least one event you plan to attend.");

  const requirements = cleanRequirements(body.requirements);
  if (requirements.tables === null) problems.push("How many tables do you need? Zero is a fine answer.");
  for (const key of ["power", "internet"]) {
    if (!requirements[key]) problems.push(`Tell us whether you need ${key}.`);
  }
  if (!sponsor.logoName) problems.push("Please add your logo.");

  const signature = text(body.signature, 160);
  if (!signature) problems.push("Please type your name to confirm.");

  if (problems.length) return json({ problems }, 422);

  Object.assign(sponsor, {
    phone: formatPhone(text(body.phone, 60)) || sponsor.phone,
    events,
    requirements,
    signature,
    status: "submitted",
    submittedAt: new Date().toISOString(),
  });
  await putSponsor(sponsor);

  // Tell the sponsorship lead there is something to review — best effort, and
  // never allowed to block the sponsor's submission.
  const lead = await sponsorLead();
  if (lead?.email) {
    const adminUrl = `${origin}/admin.html#sponsor/${encodeURIComponent(sponsor.id)}`;
    const mail = sponsorReviewNeededMail({ sponsor, events: open.filter((e) => events[e.id]), adminUrl, lead });
    sponsor.reviewNotice = await sendMail({ to: lead.email, ...mail })
      .then((r) => ({ ok: !r.skipped, ...r, at: new Date().toISOString() }))
      .catch((e) => ({ ok: false, error: e.message, at: new Date().toISOString() }));
    await putSponsor(sponsor);
  }

  return json({ ok: true, submittedAt: sponsor.submittedAt, notified: sponsor.reviewNotice?.ok ?? false });
}
