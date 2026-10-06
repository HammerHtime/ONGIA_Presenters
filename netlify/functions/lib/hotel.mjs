import { todayIso } from "./deadlines.mjs";
import { getAttendees, putAttendees } from "./store.mjs";
import { writeableTo } from "./attendees.mjs";
import { sendMail, hotelCutoffMail } from "./mail.mjs";
import { pacer, timeLeft } from "./bulk.mjs";

/**
 * Reminding attendees to book a room before the block closes.
 *
 * Counted back from the cut-off, not from the training. A hotel block usually
 * closes three or four weeks out, so "7 days before the event" would land after
 * the rate was already gone — an email telling people to book something they
 * can no longer book.
 */
export const HOTEL_DAYS = [30, 15, 7];

// A round that could not finish on its day — a big list, a failed night — is
// still sent for up to three days after, but never once the next round is due.
export const CATCH_UP_DAYS = 3;
const dayBefore = (iso, n) => new Date(Date.parse(iso) - n * 86400000).toISOString().slice(0, 10);

/** Which reminder, if any, is due for this event today. */
export function hotelDueToday(event, today = todayIso()) {
  const h = event?.hotel;
  if (!h?.cutoff || !h?.link) return null;
  if (today > h.cutoff) return null;                    // the block has closed
  for (let i = 0; i < HOTEL_DAYS.length; i++) {
    const on = dayBefore(h.cutoff, HOTEL_DAYS[i]);
    const next = i + 1 < HOTEL_DAYS.length ? dayBefore(h.cutoff, HOTEL_DAYS[i + 1]) : dayBefore(h.cutoff, -1);
    const until = [dayBefore(on, -CATCH_UP_DAYS), next].sort()[0];
    if (today >= on && today < until) return HOTEL_DAYS[i];
  }
  return null;
}

/**
 * Send one round. Each person is recorded as having had that round, so a
 * re-run, a second deploy or a manual push cannot send it twice — and someone
 * who registers after the 30-day mark still gets the 15 and the 7.
 */
export async function sendHotelRound(event, days, { dry = false, today = todayIso(), deadline = null, pace = pacer() } = {}) {
  const h = event.hotel;
  const stored = (await getAttendees(event.id)) ?? { people: [] };
  const people = writeableTo(stored.people ?? []);
  const round = `hotel${days}`;
  const owed = people.filter((p) => !(p.sent ?? []).includes(round));
  if (!owed.length) return { event: event.id, days, sent: 0, already: people.length, skipped: "everyone already had this one" };
  if (dry) return { event: event.id, days, would: owed.length };

  const daysLeft = Math.round((Date.parse(h.cutoff) - Date.parse(today)) / 86400000);
  let sent = 0, failed = 0, left = 0;
  const problems = [];
  for (const person of owed) {
    if (!timeLeft(deadline)) { left = owed.length - sent - failed; break; }
    await pace();
    const mail = hotelCutoffMail({ event, person, hotel: h, daysLeft });
    try {
      const out = await sendMail({ to: person.email, ...mail });
      if (out.skipped) { problems.push({ email: person.email, why: out.reason ?? "no transport" }); failed++; continue; }
      person.sent = [...(person.sent ?? []), round];
      person.sentAt = { ...(person.sentAt ?? {}), [round]: new Date().toISOString() };
      sent++;
      // Saved at once: a run stopped part-way never sends anyone this round twice.
      await putAttendees(event.id, stored);
    } catch (e) {
      problems.push({ email: person.email, why: e.message });
      failed++;
    }
  }
  await putAttendees(event.id, {
    ...stored,
    people: stored.people,
    hotelRounds: { ...(stored.hotelRounds ?? {}), [round]: { at: new Date().toISOString(), sent, failed, left } },
  });
  return { event: event.id, title: event.title, days, sent, failed, left, problems: problems.slice(0, 10) };
}

/** Every event whose reminder falls today. Called by the nightly job. */
export async function runHotelReminders(events, opts = {}) {
  const today = opts.today ?? todayIso();
  const out = [];
  for (const event of events) {
    const days = hotelDueToday(event, today);
    if (days === null) continue;
    try { out.push(await sendHotelRound(event, days, { ...opts, today })); }
    catch (e) { out.push({ event: event.id, title: event.title, days, error: e.message }); }
  }
  return out;
}
