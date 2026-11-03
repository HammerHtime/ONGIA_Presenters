import { listEvents, getEvent, getMeta, getAttendees } from "./store.mjs";
import { letterDue, sendLetterRound } from "./sendletters.mjs";
import { wixConfigured } from "./wix.mjs";
import { todayIso } from "./deadlines.mjs";
import { pacer } from "./bulk.mjs";

/**
 * The welcome letter to whoever registers after it went (Andrew 3 Nov 2026: "when the web app pulls the new list from
 * Wix, realizes there's been 15 new additions, I need Claude to send those out immediately ... I don't want to wait 24
 * hours for the next batch to go out. But I definitely need Claude to track who has not been sent the letter").
 *
 * Every 15 minutes (welcome-tick.mjs), for each event whose welcome letter is due (its day has come, the event has not
 * started, emails to attendees are on, the letter is saved): that event's registrations are pulled from Wix, and anyone
 * who has not had the letter is sent it, in the background. Nobody gets it twice: each address is marked the moment its
 * letter goes, and this never runs while the morning run is sending. No reminders: only the letter, once.
 */
export const NIGHT_LOCK = "night-running";
export const CATCHUP_LOCK = "welcome-catchup";
export const LOCK_MS = 20 * 60 * 1000;
export const held = (lock, now = Date.now()) => !!lock?.at && now - Date.parse(lock.at) < LOCK_MS;

/**
 * The events whose welcome letter is going out now and has had its first run: the catch-up follows the morning run on
 * the letter's day, and never sends the whole list at midnight ahead of it.
 */
export async function welcomeEvents(today = todayIso()) {
  const due = (await listEvents()).filter((e) => !e.practice && letterDue(e, "welcome", today).due);
  const started = await Promise.all(due.map(async (e) => !!((await getAttendees(e.id)) ?? {}).letterRounds?.welcome));
  return due.filter((_, i) => started[i]);
}

/** Pull each such event from Wix, then send the letter to whoever is owed it. `pull` is the Wix pull (wix.mjs). */
export async function catchUpWelcome({ pull, today = todayIso(), deadline = null, pace = pacer() } = {}) {
  if (held(await getMeta(NIGHT_LOCK))) return { skipped: "the morning run is sending" };
  const out = [];
  for (const ev of await welcomeEvents(today)) {
    let pulled = null;
    if (pull && wixConfigured() && (ev.wix?.eventId || ev.wixMore?.length)) {
      try { const p = await pull(ev); pulled = { added: p.added, changed: p.changed, withdrawn: p.withdrawn }; }
      catch (e) { pulled = { error: e.message }; }   // a Wix outage never stops the letters to people already on the list
    }
    const r = await sendLetterRound((await getEvent(ev.id)) ?? ev, "welcome", { today, deadline, pace });
    out.push({ ...r, pulled });
  }
  return { events: out };
}
