import { listEvents, getAttendees, putAttendees, putMeta } from "./store.mjs";
import { wixConfigured, listWixGuests, wixGuestsByEvent, attendeesOf } from "./wix.mjs";
import { merge, tally } from "./attendees.mjs";

/*
 * Pulling registrations from Wix into an event's list: the Pull button, the welcome letter's catch-up every 15 minutes
 * and the nightly sweep. Moved here from the wix endpoint (audit 24 Nov 2026), so the nightly run and the catch-up no
 * longer load the whole endpoint to reach them.
 */
/** Every Wix event a desk event pulls from: its own, then any others (community partners), each with its group. */
export const linksOf = (event) => [...(event.wix?.eventId ? [{ ...event.wix, group: "", primary: true }] : []), ...(event.wixMore ?? []).map((l) => ({ ...l, primary: false }))];

/**
 * One event's registrations from Wix, folded into its list: the pull button's, and the welcome letter's catch-up every
 * 15 minutes (Andrew 3 Nov 2026). New or changed people get their agencies matched in the background.
 */
export async function pullEvent(event) {
  const total = { read: 0, added: 0, changed: 0, withdrawn: 0 };
  let counts = null;
  for (const l of linksOf(event)) {
    const out = await absorb(event.id, attendeesOf(await listWixGuests({ eventId: l.eventId, type: null, site: l.site })), event, l);
    for (const k of Object.keys(total)) total[k] += out[k];
    counts = out.counts;
  }
  // New people or changed details: their agencies are matched now, not at the next morning's run (Andrew 3 Nov 2026:
  // "when do the names from Wix match up with the correct agency?"). In the background; a pull never waits on it.
  let matching = false;
  const origin = process.env.APP_URL || process.env.URL;
  if ((total.added || total.changed) && origin && process.env.ADMIN_KEY) {
    try { matching = (await fetch(`${origin}/api/agencies-settle-background`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY } })).status === 202; }
    catch (e) { console.log(`agency matching not started after the pull: ${e.message}`); }
  }
  return { ...total, counts, matching };
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
    key: g.key ?? `wix:${g.id}`, first: g.first, last: g.last, email: g.email, phone: g.phone, orderNumber: g.orderNumber || "",
    organization: g.organization || "", status: g.status || "ATTENDING", source: "wix", wixGuestId: g.id,
    // Always said, so a row that was someone's guest stops being one when Wix's record shows whose ticket it is.
    guestOf: g.guestOf ?? "",
    // Scanned in at the door: once seen, it stays (a later pull never takes a check-in back, nor one from a sheet).
    ...(g.checkedIn ? { checkedIn: true, checkInDays: g.checkInDays ?? [] } : {}),
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

