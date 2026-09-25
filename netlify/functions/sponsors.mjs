import { json, fail, requireAdmin, text, isEmail } from "./lib/http.mjs";
import { formatPhone } from "./lib/phone.mjs";
import { listSponsors, getSponsor, putSponsor, listEvents, deleteKey, sponsorLead } from "./lib/store.mjs";
import { token } from "./lib/ids.mjs";
import { sendMail, sponsorWelcomeMail, coordinatorOf } from "./lib/mail.mjs";
import { siteUrl } from "./lib/site.mjs";

/**
 * Sponsors.
 *
 *   GET    /api/sponsors                 every sponsor, with the events they attend
 *   GET    /api/sponsors?id=…            one sponsor
 *   POST   /api/sponsors                 add one; thanks them and sends their link
 *   PUT    /api/sponsors?id=…            correct company, contact, email or phone
 *   DELETE /api/sponsors?id=…            remove one that has not been approved
 *
 * A sponsor belongs to ONGIA rather than to one event: they sign a single
 * agreement and then appear on the list of every event they said they would
 * attend. One board member carries sponsorship for all of it.
 */
export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);

  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (req.method === "GET") return id ? showOne(id) : showAll();
  if (req.method === "POST") {
    const body = await req.json().catch(() => null);
    if (!body) return fail("Expected a JSON body.");
    return addSponsor(body, siteUrl(req));
  }
  if (req.method === "PUT") {
    const body = await req.json().catch(() => null);
    if (!body) return fail("Expected a JSON body.");
    return updateSponsor(id, body);
  }
  if (req.method === "DELETE") return removeSponsor(id);
  return fail("Method not allowed.", 405);
};

/** Sponsors plus the events they could be asked about, for the admin list. */
async function showAll() {
  const [sponsors, events, lead] = await Promise.all([listSponsors(), listEvents(), sponsorLead()]);
  return json({
    sponsors,
    lead,
    events: events
      .filter((e) => e.sponsorsWelcome)
      .map((e) => ({ id: e.id, title: e.title, city: e.city, dayOne: e.dayOne, lastDay: e.lastDay })),
  });
}

async function showOne(id) {
  const sponsor = await getSponsor(id);
  if (!sponsor) return fail("No such sponsor.", 404);
  const events = await listEvents();
  return json({ sponsor, lead: await sponsorLead(), events: events.filter((e) => e.sponsorsWelcome) });
}

async function addSponsor(body, origin) {
  const company = text(body.company, 200);
  const first = text(body.first, 80);
  const last = text(body.last, 80);
  const email = text(body.email, 200);
  if (!company) return fail("The sponsor needs a company name.");
  if (!first || !last) return fail("Who is the contact? A first and last name, please.");
  if (!isEmail(email)) return fail(`"${email}" is not an email address.`);

  const existing = (await listSponsors()).find((s) => s.email.toLowerCase() === email.toLowerCase());
  if (existing) return fail(`${existing.company} is already on the list with that address.`, 409);

  const sponsor = {
    id: token(10),
    company,
    first,
    last,
    email,
    phone: formatPhone(text(body.phone, 60)),
    token: token(24),
    status: "invited",
    // Keyed by event id so a sponsor appears on each event's list. The value
    // holds what is true for that event alone: whether they are still coming,
    // when they load in and out, and — only if they have told us something
    // changed — its own requirements. Otherwise the sponsor's set below is
    // what applies, so nobody fills the same sheet in twice.
    events: {},
    requirements: null,
    logoName: "",
    review: null,
    createdAt: new Date().toISOString(),
    submittedAt: null,
    approvedAt: null,
    mail: [],
  };
  await putSponsor(sponsor);

  // Thanking them is the point of adding them, so it goes straight away rather
  // than waiting for a separate "send" click that someone would forget.
  const lead = await sponsorLead();
  const link = `${origin}/s/${sponsor.token}`;
  const mail = sponsorWelcomeMail({ sponsor, link, lead });
  sponsor.delivery = { welcome: await sendMail({ to: sponsor.email, replyTo: lead?.email || undefined, ...mail })
    .then((r) => ({ ok: !r.skipped, ...r, at: new Date().toISOString() }))
    .catch((e) => ({ ok: false, error: e.message, at: new Date().toISOString() })) };
  if (sponsor.delivery.welcome.ok) sponsor.mail.push({ type: "welcome", at: new Date().toISOString(), id: sponsor.delivery.welcome.id });
  await putSponsor(sponsor);

  return json({ ok: true, sponsor, link }, 201);
}

/** Correct a contact without disturbing their link or anything they have sent. */
async function updateSponsor(id, body) {
  const sponsor = await getSponsor(id);
  if (!sponsor) return fail("No such sponsor.", 404);
  const company = text(body.company, 200);
  const first = text(body.first, 80);
  const last = text(body.last, 80);
  const email = text(body.email, 200);
  if (!company) return fail("The sponsor needs a company name.");
  if (!first || !last) return fail("Who is the contact? A first and last name, please.");
  if (!isEmail(email)) return fail(`"${email}" is not an email address.`);

  const before = sponsor.email;
  Object.assign(sponsor, { company, first, last, email, phone: formatPhone(text(body.phone, 60)) });
  if (before !== email) delete sponsor.lastSendError;
  sponsor.updatedAt = new Date().toISOString();
  await putSponsor(sponsor);
  return json({ ok: true, sponsor, emailChanged: before !== email });
}

async function removeSponsor(id) {
  const sponsor = await getSponsor(id);
  if (!sponsor) return fail("No such sponsor.", 404);
  if (sponsor.status === "approved") return fail("This sponsorship is signed and filed; it can't be removed from the desk.", 409);
  await Promise.all([
    deleteKey(`sponsor:${id}`),
    sponsor.token ? deleteKey(`sponsortoken:${sponsor.token}`) : null,
    deleteKey(`logo:${id}`),
  ]);
  return json({ ok: true });
}
