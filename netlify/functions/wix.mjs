import { json, fail, requireAdmin, text } from "./lib/http.mjs";
import { getEvent, putEvent, listEvents, getAttendees, putAttendees, getMeta, putMeta } from "./lib/store.mjs";
import { wixConfigured, wixHealth, listWixEvents, listWixGuests, wixGuestsByEvent, attendeesOf } from "./lib/wix.mjs";
import { merge, tally } from "./lib/attendees.mjs";
import { eventId as makeEventId } from "./lib/ids.mjs";
import { deadlinesFor, offsetsOf } from "./lib/deadlines.mjs";
import { starterTasks } from "./lib/checklist.mjs";

/**
 * The bridge to ONGIA's Wix site.
 *
 *   GET  /api/wix                     is it connected, and does the key work
 *   GET  /api/wix?events=1            the Wix events, with any desk event each is linked to
 *   PUT  /api/wix?event=…&link=…      point a desk event at a Wix event
 *   PUT  /api/wix?event=…&unlink=1    stop pointing at it
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
    return json({ connected: wixConfigured(), ...(await wixHealth()) });
  }
  if (req.method === "PUT") {
    const event = await getEvent(url.searchParams.get("event"));
    if (!event) return fail("No such event.", 404);
    if (url.searchParams.get("unlink")) return unlink(event);
    return link(event, text(url.searchParams.get("link"), 80));
  }
  if (req.method === "POST") {
    if (url.searchParams.get("sweep")) return sweep();
    if (url.searchParams.get("import")) return importEvent(text(url.searchParams.get("import"), 80));
    const event = await getEvent(url.searchParams.get("event"));
    if (!event) return fail("No such event.", 404);
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
  const [wixEvents, deskEvents] = await Promise.all([listWixEvents(), listEvents()]);
  const linkedTo = new Map(deskEvents.filter((e) => e.wix?.eventId).map((e) => [e.wix.eventId, { id: e.id, title: e.title }]));
  return json({ events: wixEvents.map((e) => ({ ...e, linkedTo: linkedTo.get(e.id) ?? null })) });
}

async function link(event, wixEventId) {
  if (!wixConfigured()) return fail("Wix is not connected on this site.", 409);
  if (!wixEventId) return fail("Which Wix event?");
  const taken = (await listEvents()).find((e) => e.wix?.eventId === wixEventId && e.id !== event.id);
  if (taken) return fail(`That Wix event is already linked to ${taken.title}.`, 409);
  const match = (await listWixEvents()).find((e) => e.id === wixEventId);
  if (!match) return fail("That event is not on the Wix site.", 404);

  event.wix = { eventId: match.id, title: match.title, url: match.url, linkedAt: new Date().toISOString() };
  await putEvent(event);
  // Linking is the moment to fetch, so the list is not empty until tomorrow.
  return syncOne(event);
}

async function unlink(event) {
  delete event.wix;
  await putEvent(event);
  return json({ ok: true, wix: null });
}

/** Pull one event's guests. The sweep is the same thing, for every linked event. */
async function syncOne(event) {
  if (!event.wix?.eventId) return fail("This event is not linked to a Wix event yet.", 409);
  const guests = attendeesOf(await listWixGuests({ eventId: event.wix.eventId, type: null }));
  return json({ ok: true, ...(await absorb(event.id, guests)) });
}

/**
 * Fold a Wix view of one event into what is stored. Wix is believed about the
 * people it knows: someone it has stopped listing has withdrawn. People added
 * by hand are left alone.
 */
async function absorb(eventId, guests) {
  const stored = (await getAttendees(eventId)) ?? { people: [] };
  const incoming = guests.map((g) => ({
    first: g.first, last: g.last, email: g.email, phone: g.phone,
    organization: "", status: g.status || "ATTENDING", source: "wix", wixGuestId: g.id,
  })).filter((p) => p.email);
  const out = merge(stored.people ?? [], incoming, { source: "wix", authoritative: true });
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
  const events = (await listEvents()).filter((e) => e.wix?.eventId);
  if (!events.length) return { skipped: true, reason: "No event is linked to Wix yet." };

  const byWixId = await wixGuestsByEvent({ type: null });
  const done = [];
  for (const event of events) {
    try {
      const out = await absorb(event.id, attendeesOf(byWixId.get(event.wix.eventId) ?? []));
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
  const match = (await listWixEvents()).find((e) => e.id === wixEventId);
  if (!match) return fail("That event is not on the Wix site.", 404);
  if (!match.dayOne) return fail(`"${match.title}" has no start date on Wix, so there is nothing to build an event from.`);
  const already = (await listEvents()).find((e) => e.wix?.eventId === wixEventId);
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
    attendeeMail: true,   // a new event on the desk: attendee emails allowed
    wix: { eventId: match.id, title: match.title, url: match.url, linkedAt: new Date().toISOString() },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await putEvent(event);
  const guests = attendeesOf(await listWixGuests({ eventId: match.id, type: null }));
  const out = await absorb(event.id, guests);
  return json({ ok: true, event, ...out,
    next: "Open the event and pick a board member as the lead — nothing is sent until there is one." }, 201);
}
