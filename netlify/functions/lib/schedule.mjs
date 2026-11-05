import { getAttendees, getReplies, listPresenters } from "./store.mjs";
import { todayIso } from "./deadlines.mjs";
import { welcomeJob, welcomeReach, extrasOf, versionLabel, versionKeys, inTheRoom } from "./welcome.mjs";
import { remindersOf, stillToAnswer } from "./reply.mjs";
import { dailyTimes, owedFor } from "./surveysend.mjs";
import { HOTEL_DAYS } from "./hotel.mjs";
import { writeableTo } from "./attendees.mjs";

/**
 * Every email the desk will send for an event on its own, from today on: the day, what it is, and how many it goes to
 * (Andrew 5 Nov 2026: "include all the scheduled emails date and to how many. That way I can see what's happening").
 * Counted as things stand today: someone who registers or answers before then changes the number. Each one drops off
 * once its day has passed.
 */
const PRESENTER_DAYS = [28, 14, 7, 4, 2, 1, 0];
const before = (iso, n) => new Date(Date.parse(iso) - n * 86400000).toISOString().slice(0, 10);

export async function emailSchedule(event, today = todayIso()) {
  const out = [];
  const off = event.attendeeMail !== true;
  const people = ((await getAttendees(event.id)) ?? {}).people ?? [];
  const writeable = writeableTo(people);
  const offNote = off ? "won't go: emails to attendees are off" : "";

  // The welcome letter, each version, until everyone has it.
  const job = welcomeJob(event, today);
  if (event.welcome?.main?.body && job?.due && !job.na && job.due >= today) {
    const reach = welcomeReach(event, people);
    for (const k of versionKeys(event)) {
      const r = reach[k];
      const owed = Math.max(0, (r?.reaches ?? 0) - (r?.had ?? 0));
      if (!owed) continue;
      const extra = extrasOf(event).some((x) => x.key === k);
      const label = versionKeys(event).length > 1 ? `Welcome letter (${versionLabel(event, k)})` : "Welcome letter";
      out.push({ date: job.due, what: label, to: owed, who: "attendees", note: offNote || (extra && !event.welcomeReady?.[k] ? "waiting for you to mark it ready" : "") });
    }
  }

  // The food-allergy reminders: to everyone in the room who had the email and hasn't answered.
  const r = event.reply;
  if (r?.sentAt && r.open) {
    const dates = remindersOf(r).filter((d) => d >= today && (!r.replyBy || d <= r.replyBy));
    if (dates.length) {
      const answers = (await getReplies(event.id))?.answers ?? [];
      const owed = stillToAnswer(inTheRoom(event, people), answers).length;
      for (const d of dates) out.push({ date: d, what: "Food allergies: reminder", to: owed, who: "attendees", note: offNote });
    }
  }

  // The survey: each day's part, or the one after the event.
  const s = event.survey;
  if (s?.open) {
    const parts = s.mode === "end" ? (s.sendOn ? [{ day: s.sendOn, part: "end", at: "09:00" }] : []) : dailyTimes(event).map((t) => ({ day: t.day, part: t.day, at: t.at }));
    for (const p of parts.filter((x) => x.day >= today)) {
      out.push({ date: p.day, time: p.at, what: s.mode === "end" ? "Survey" : "Survey: today's sessions", to: owedFor(event, p.part, people).length, who: "attendees",
        note: offNote || (!p.at ? "won't go: that day has no end time" : "") });
    }
  }

  // The hotel reminders before the room block closes.
  const h = event.hotel;
  if (h?.cutoff && h?.link) {
    for (const d of HOTEL_DAYS) {
      const on = before(h.cutoff, d);
      if (on < today) continue;
      out.push({ date: on, what: `Hotel reminder (${d} days before the block closes)`, to: writeable.filter((p) => !(p.sent ?? []).includes(`hotel${d}`)).length, who: "attendees", note: offNote });
    }
  }

  // Reminders to presenters who haven't signed, ahead of the agreement date (not on a one-date event like the Summit).
  if (!event.noDeadlines && event.deadlines?.agreement) {
    const presenters = await listPresenters(event.id);
    const owed = presenters.filter((p) => p.mail?.length && !["submitted", "approved", "arranged", "withdrawn"].includes(p.status)).length;
    if (owed) for (const d of PRESENTER_DAYS) {
      const on = before(event.deadlines.agreement, d);
      if (on >= today) out.push({ date: on, what: d ? `Agreement reminder (${d} day${d === 1 ? "" : "s"} before it's due)` : "Agreement reminder (due today)", to: owed, who: "presenters", note: "" });
    }
    // Then, once it's overdue: every 3 days for two weeks, then weekly (lib/reminders.mjs), until the event.
    if (owed) for (let n = 1; n <= 60; n++) {
      const on = before(event.deadlines.agreement, -n);
      if (on < today || (n <= 14 ? n % 3 : n % 7) || (event.dayOne && on >= event.dayOne)) continue;
      out.push({ date: on, what: `Agreement reminder (${n} days overdue)`, to: owed, who: "presenters", note: "" });
    }
  }
  // Done is gone: nothing left to send on that one (today's survey once it has gone, a reminder nobody is owed).
  return out.filter((x) => x.to > 0).sort((a, b) => a.date.localeCompare(b.date) || String(a.time ?? "").localeCompare(String(b.time ?? "")));
}
