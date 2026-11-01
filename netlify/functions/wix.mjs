import { json, fail, requireAdmin, text, editGuard } from "./lib/http.mjs";
import { getEvent, putEvent, listEvents, getAttendees, putAttendees, getMeta, putMeta } from "./lib/store.mjs";
import { wixConfigured, wixHealth, listAllWixEvents, listWixGuests, wixGuestsByEvent, attendeesOf, wixSites, listWixContacts, archiveSite, listEveryWixEvent } from "./lib/wix.mjs";
import { merge, tally } from "./lib/attendees.mjs";
import { eventId as makeEventId } from "./lib/ids.mjs";
import { deadlinesFor, offsetsOf } from "./lib/deadlines.mjs";
import { starterTasks } from "./lib/checklist.mjs";

/**
 * The bridge to ONGIA's Wix site.
 *
 *   GET  /api/wix                     is it connected, and does the key work
 *   GET  /api/wix?events=1            the Wix events, with any desk event each is linked to
 *   GET  /api/wix?contacts=1[&site=n] what the site's contact list holds, in totals only: no names or addresses
 *   GET  /api/wix?archive=1           the old website's past events, each with how many registered: counts only
 *   PUT  /api/wix?event=…&link=…      point a desk event at a Wix event
 *   PUT  /api/wix?event=…&unlink=1    stop pointing at it
 *   PUT  /api/wix?event=…&link=…&also=1&group=…   also pull a second Wix event into this one, its people labelled with the group
 *                                       (Andrew 26 Oct 2026: the National Gang Summit's community partners register on their own Wix event)
 *   PUT  /api/wix?event=…&unlinkAlso=…  stop pulling that second one
 *   POST /api/wix?event=…&sync=1      pull that event's guests now
 *   POST /api/wix?sweep=1             pull every linked event's guests (what the night job runs)
 *   POST /api/wix?import=…            make a new desk event from a Wix one
 *
 * Linking works in both directions on purpose: the Wix event sometimes exists
 * first, and sometimes it is a job on the checklist still to be done.
 */
export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);

  const url = new URL(req.url);
  if (req.method === "GET") {
    if (url.searchParams.get("count")) return countGuests(text(url.searchParams.get("count"), 80));
    if (url.searchParams.get("events")) return showWixEvents();
    if (url.searchParams.get("contacts")) return contactSummary(text(url.searchParams.get("site"), 2) || "1");
    if (url.searchParams.get("archive")) return archiveSummary();
    return json({ connected: wixConfigured(), sites: wixSites().map((x) => ({ n: x.n, name: x.name })), ...(await wixHealth()) });
  }
  if (req.method === "PUT") {
    const event = await getEvent(url.searchParams.get("event"));
    if (!event) return fail("No such event.", 404);
    const viewOnly = editGuard(req, event); if (viewOnly) return viewOnly;
    if (url.searchParams.get("unlink")) return unlink(event);
    if (url.searchParams.get("unlinkAlso")) return unlinkAlso(event, text(url.searchParams.get("unlinkAlso"), 80));
    if (url.searchParams.get("also")) return linkAlso(event, text(url.searchParams.get("link"), 80), text(url.searchParams.get("group"), 60) || "Community partners");
    return link(event, text(url.searchParams.get("link"), 80));
  }
  if (req.method === "POST") {
    if (url.searchParams.get("sweep")) return sweep();
    if (url.searchParams.get("import")) return importEvent(text(url.searchParams.get("import"), 80));
    const event = await getEvent(url.searchParams.get("event"));
    if (!event) return fail("No such event.", 404);
    const viewOnly = editGuard(req, event); if (viewOnly) return viewOnly;
    return syncOne(event);
  }
  return fail("Method not allowed.", 405);
};

/**
 * How many people are registered for one Wix event, and whether the records
 * carry what a letter needs — without returning anybody's name or address.
 * A count proves the connection; the list itself belongs on the event screen,
 * behind the admin key, not in a diagnostic.
 */
async function countGuests(wixEventId) {
  if (!wixConfigured()) return fail("Wix is not connected on this site.", 409);
  if (!wixEventId) return fail("Which Wix event?");
  const all = await listWixGuests({ eventId: wixEventId, type: null });
  const of = (t) => all.filter((g) => g.guestType === t).length;
  const noEmail = all.filter((g) => !g.email);
  return json({
    eventId: wixEventId,
    total: all.length,
    attending: all.filter((g) => g.status === "ATTENDING").length,
    notAttending: all.filter((g) => g.status === "NOT_ATTENDING").length,
    waitlist: all.filter((g) => g.status === "IN_WAITLIST").length,
    withEmail: all.length - noEmail.length,
    withName: all.filter((g) => g.first || g.last).length,
    // Which kind of record is missing an address, which is what decides
    // whether it is a Wix form setting or a registration that came in bare.
    byType: { RSVP: of("RSVP"), BUYER: of("BUYER"), TICKET_HOLDER: of("TICKET_HOLDER") },
    noEmailByType: {
      RSVP: noEmail.filter((g) => g.guestType === "RSVP").length,
      BUYER: noEmail.filter((g) => g.guestType === "BUYER").length,
      TICKET_HOLDER: noEmail.filter((g) => g.guestType === "TICKET_HOLDER").length,
    },
  });
}

/** Wix's events, each marked with the desk event it already belongs to. */
async function showWixEvents() {
  if (!wixConfigured()) return fail("Wix is not connected on this site. Set WIX_API_KEY and WIX_SITE_ID.", 409);
  const problems = [];
  const [wixEvents, deskEvents] = await Promise.all([listAllWixEvents({ problems }), listEvents()]);
  const linkedTo = new Map(deskEvents.flatMap((e) => linksOf(e).map((l) => [l.eventId, { id: e.id, title: e.title }])));
  return json({ events: wixEvents.map((e) => ({ ...e, linkedTo: linkedTo.get(e.id) ?? null })), problems, sites: wixSites().map((x) => x.name) });
}

async function link(event, wixEventId) {
  if (!wixConfigured()) return fail("Wix is not connected on this site.", 409);
  if (!wixEventId) return fail("Which Wix event?");
  const taken = (await listEvents()).find((e) => e.id !== event.id && linksOf(e).some((l) => l.eventId === wixEventId));
  if (taken) return fail(`That Wix event is already linked to ${taken.title}.`, 409);
  const match = (await listAllWixEvents()).find((e) => e.id === wixEventId);
  if (!match) return fail("That event is not on the Wix site.", 404);

  event.wix = { eventId: match.id, title: match.title, url: match.url, site: match.site, linkedAt: new Date().toISOString() };
  await putEvent(event);
  // Linking is the moment to fetch, so the list is not empty until tomorrow.
  return syncOne(event);
}

/** Every Wix event a desk event pulls from: its own, then any others (community partners), each with its group. */
export const linksOf = (event) => [...(event.wix?.eventId ? [{ ...event.wix, group: "", primary: true }] : []), ...(event.wixMore ?? []).map((l) => ({ ...l, primary: false }))];

async function linkAlso(event, wixEventId, group) {
  if (!wixConfigured()) return fail("Wix is not connected on this site.", 409);
  if (!wixEventId) return fail("Which Wix event?");
  if (!event.wix?.eventId) return fail("Link this event's own Wix event first.", 409);
  if (linksOf(event).some((l) => l.eventId === wixEventId)) return fail("That Wix event is already linked here.", 409);
  const taken = (await listEvents()).find((e) => e.id !== event.id && linksOf(e).some((l) => l.eventId === wixEventId));
  if (taken) return fail(`That Wix event is already linked to ${taken.title}.`, 409);
  const match = (await listAllWixEvents()).find((e) => e.id === wixEventId);
  if (!match) return fail("That event is not on the Wix site.", 404);
  event.wixMore = [...(event.wixMore ?? []), { eventId: match.id, title: match.title, url: match.url, site: match.site, siteName: match.siteName, group,
    // Their own dates: a letter written for this group gives these, not the whole event's.
    dayOne: match.dayOne ?? null, lastDay: match.lastDay ?? null, linkedAt: new Date().toISOString() }];
  await putEvent(event);
  return syncOne(event);
}

async function unlinkAlso(event, wixEventId) {
  event.wixMore = (event.wixMore ?? []).filter((l) => l.eventId !== wixEventId);
  await putEvent(event);
  return json({ ok: true, wixMore: event.wixMore });
}

async function unlink(event) {
  delete event.wix;
  await putEvent(event);
  return json({ ok: true, wix: null });
}

/** Pull one event's guests. The sweep is the same thing, for every linked event. */
async function syncOne(event) {
  if (!event.wix?.eventId) return fail("This event is not linked to a Wix event yet.", 409);
  const total = { read: 0, added: 0, changed: 0, withdrawn: 0 };
  let counts = null;
  for (const l of linksOf(event)) {
    const out = await absorb(event.id, attendeesOf(await listWixGuests({ eventId: l.eventId, type: null, site: l.site })), event, l);
    for (const k of Object.keys(total)) total[k] += out[k];
    counts = out.counts;
  }
  return json({ ok: true, ...total, counts });
}

/**
 * Fold a Wix view of one event into what is stored. Wix is believed about the
 * people it knows: someone it has stopped listing has withdrawn. People added
 * by hand are left alone.
 */
async function absorb(eventId, guests, event = null, l = null) {
  const stored = (await getAttendees(eventId)) ?? { people: [] };
  // Every registration is a row, keyed by its Wix guest (and place in an RSVP), even one with no email of its own.
  const incoming = guests.map((g) => ({
    key: g.key ?? `wix:${g.id}`, first: g.first, last: g.last, email: g.email, phone: g.phone,
    organization: g.organization || "", status: g.status || "ATTENDING", source: "wix", wixGuestId: g.id, ...(g.guestOf ? { guestOf: g.guestOf } : {}),
    ...(l ? { wixEventId: l.eventId, group: l.group || "" } : {}),
  }));
  // Each pull only withdraws people from its own Wix event, so a second one (or one unlinked since) is never mistaken
  // for cancellations. A row saved before rows carried their Wix event belongs to the event's own link.
  const own = event?.wix?.eventId;
  const within = l ? (p) => (p.wixEventId ?? own) === l.eventId : null;
  const out = merge(stored.people ?? [], incoming, { source: "wix", authoritative: true, within });
  const at = new Date().toISOString();
  await putAttendees(eventId, {
    ...stored,
    people: out.people,
    syncedAt: at,
    lastSync: { at, read: guests.length, added: out.added, changed: out.changed, withdrawn: out.withdrawn },
  });
  return { read: guests.length, added: out.added, changed: out.changed, withdrawn: out.withdrawn, counts: tally(out.people) };
}

/**
 * Every linked event in one pass. The guest query covers the whole site, so
 * this is a single call fanned out by each guest's own event id rather than one
 * call per event.
 */
export async function sweepWix() {
  if (!wixConfigured()) return { skipped: true, reason: "Wix is not connected on this site." };
  const events = (await listEvents()).filter((e) => linksOf(e).length);
  if (!events.length) return { skipped: true, reason: "No event is linked to Wix yet." };

  const byWixId = await wixGuestsByEvent({ type: null });
  const done = [];
  for (const event of events) {
    try {
      const out = { read: 0, added: 0, changed: 0, withdrawn: 0 };
      for (const l of linksOf(event)) {
        const one = await absorb(event.id, attendeesOf(byWixId.get(l.eventId) ?? []), event, l);
        for (const k of Object.keys(out)) out[k] += one[k];
        out.counts = one.counts;
      }
      done.push({ event: event.id, title: event.title, ...out });
    } catch (e) {
      done.push({ event: event.id, title: event.title, error: e.message });
    }
  }
  const at = new Date().toISOString();
  await putMeta("wixsweep", { at, events: done.length, failed: done.filter((d) => d.error).length });
  return { at, events: done };
}

const sweep = async () => json(await sweepWix());

/** Make a desk event out of a Wix one, so the dates are typed only once. */
async function importEvent(wixEventId) {
  if (!wixConfigured()) return fail("Wix is not connected on this site.", 409);
  if (!wixEventId) return fail("Which Wix event?");
  const match = (await listAllWixEvents()).find((e) => e.id === wixEventId);
  if (!match) return fail("That event is not on the Wix site.", 404);
  if (!match.dayOne) return fail(`"${match.title}" has no start date on Wix, so there is nothing to build an event from.`);
  const already = (await listEvents()).find((e) => linksOf(e).some((l) => l.eventId === wixEventId));
  if (already) return fail(`That Wix event is already on the desk as ${already.title}.`, 409);

  const offsets = offsetsOf({});
  const event = {
    id: makeEventId(match.dayOne.slice(0, 4), match.city || match.title),
    nextSequence: 1,
    title: match.title,
    city: match.city || "",
    venue: match.venue || "",
    dayOne: match.dayOne,
    lastDay: match.lastDay || match.dayOne,
    sessionMinutes: 70,
    offsets,
    deadlines: deadlinesFor(match.dayOne, offsets),
    // The board is not on Wix, so it stays for Andrew to set — and the desk
    // already refuses to send anything for an event with no lead.
    board: [],
    contact: { name: "", email: "", phone: "" },
    tasks: await starterTasks(match.title),
    attendeeMail: false,  // off until Andrew switches it on at the top of the event
    wix: { eventId: match.id, title: match.title, url: match.url, site: match.site, linkedAt: new Date().toISOString() },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await putEvent(event);
  const guests = attendeesOf(await listWixGuests({ eventId: match.id, type: null, site: match.site }));
  const out = await absorb(event.id, guests);
  return json({ ok: true, event, ...out,
    next: "Open the event and pick a board member as the lead — nothing is sent until there is one." }, 201);
}

/**
 * The contact list in totals (Andrew 1 Nov 2026: working out each contact's province). Proves the key can read contacts
 * and shows what there is to work from: how many have an email, a company, an address with a province, and which email
 * domains are most common. No names, no addresses, no individual records.
 */
const PERSONAL = /^(gmail|hotmail|outlook|live|yahoo|icloud|me|msn|aol|shaw|rogers|bell|sympatico|telus|videotron|cogeco|protonmail)\./i;
async function contactSummary(site) {
  if (!wixConfigured()) return fail("Wix is not connected on this site.", 409);
  let all;
  try { all = await listWixContacts({ site }); }
  catch (e) { return fail(e.status === 401 || e.status === 403 ? "Wix refused to show contacts with this key. In Wix: Account Settings, API Keys, open the key the desk uses, tick Read Contacts for this site, save." : e.message, e.status === 403 || e.status === 401 ? 403 : 502); }
  const tally = (f) => { const m = new Map(); for (const c of all) { const k = f(c); if (k) m.set(k, (m.get(k) ?? 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]); };
  const domains = tally((c) => c.domain);
  return json({
    site, total: all.length,
    withEmail: all.filter((c) => c.email).length,
    personalEmail: all.filter((c) => PERSONAL.test(c.domain)).length,
    withCompany: all.filter((c) => c.company).length,
    withRegion: all.filter((c) => c.region).length,
    withProvinceOfWork: all.filter((c) => c.provinceOfWork).length,
    provinceOfWork: tally((c) => c.provinceOfWork).slice(0, 30),
    regions: tally((c) => c.region).slice(0, 20),
    countries: tally((c) => c.country).slice(0, 10),
    domainCount: domains.length,
    topDomains: domains.filter(([d]) => !PERSONAL.test(d)).slice(0, 40),
    extendedFields: tally((c) => c.extended.join("|")).slice(0, 10).map(([k, n]) => [k.split("|").filter(Boolean), n]),
  });
}

/**
 * What the Archive site holds (Andrew 1 Nov 2026: past events from before the 2025 change-over), in counts only: each
 * event's title, date, city and how many registered, and the totals by year. Proves the key reaches it before anything
 * is built on it. Read only; nothing is linked, copied or written.
 */
async function archiveSummary() {
  const site = archiveSite();
  if (!site) return fail("The Archive site isn't connected: set WIX_SITE_ID_3 in Netlify.", 409);
  let events, guests;
  const byEvent = new Map();
  try {
    events = await listEveryWixEvent({ site: "3" });
    // One event at a time: Wix stops a site-wide guest query at 5,000, and the Archive has more than that.
    guests = 0;
    for (const e of events) { const g = await listWixGuests({ eventId: e.id, type: null, site: "3" }); guests += g.length; byEvent.set(e.id, g); }
  } catch (e) {
    return fail(e.status === 401 || e.status === 403 ? `Wix refused the key for ${site.name}. In Wix: Account Settings, API Keys, open the key the desk uses, tick the Archive site (with Read Events and Read Guest List), save.` : e.message, e.status === 401 || e.status === 403 ? 403 : 502);
  }
  // One row per person, the way an event's registrations are counted: a ticketed event lists each order's buyer and each
  // ticket's holder, and counting both doubled every figure.
  const by = new Map();
  for (const [id, list] of byEvent) {
    const people = attendeesOf(list).filter((p) => p.status === "ATTENDING");
    by.set(id, { attending: people.length, emails: new Set(people.map((p) => p.email).filter(Boolean)) });
  }
  const rows = events.map((e) => { const r = by.get(e.id); return { title: e.title, dayOne: e.dayOne, city: e.city, status: e.status, registered: r?.attending ?? 0, addresses: r?.emails.size ?? 0 }; });
  const years = {};
  for (const r of rows) { const y = (r.dayOne || "").slice(0, 4) || "undated"; const Y = (years[y] ??= { events: 0, registered: 0, cities: new Set() }); Y.events++; Y.registered += r.registered; if (r.city) Y.cities.add(r.city); }
  return json({ site: site.name, events: rows.length, guests, years: Object.fromEntries(Object.entries(years).sort().map(([y, v]) => [y, { events: v.events, registered: v.registered, cities: [...v.cities].sort() }])), rows });
}
