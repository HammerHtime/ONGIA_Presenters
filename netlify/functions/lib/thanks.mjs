import { listPresenters, putPresenter } from "./store.mjs";
import { letterProblems, eventProblems, renderLetter, attendeeReplyTo } from "./letters.mjs";
import { sendMail } from "./mail.mjs";
import { mcSessions } from "./mcintro.mjs";
import { localNow, zoneOf } from "./surveysend.mjs";
import { pacer, timeLeft } from "./bulk.mjs";

/**
 * The thank-you to each presenter, the morning after the event ends (Andrew 14 Nov 2026: "Goes out the day after the
 * conference or training event ends, and it goes out personally to each one … set it up like we are the welcome
 * emails, where I can edit it"). Every event has it, in the standard words below, unless it is switched off on the
 * event's Communications tab; the words can be changed there for that event. It goes at 9:00 in the event's own time
 * zone on the day after the last day, and only that day: an event that ended before this was built is not thanked
 * out of the blue. A day missed is sent with Send now.
 *
 * Who: every presenter with an address who hasn't withdrawn. Someone only invited (never signed) is left out unless
 * added on the card; anyone can be skipped there. Each is marked on their own record the moment theirs goes.
 */
export const STANDARD = {
  subject: "Thank you for presenting at {event}",
  body: `Hi {first},

On behalf of everyone at ONGIA, thank you for presenting {talk} at {event} on {talkDay}.

We know what it takes to show up for something like this. You made time in an already demanding schedule, you prepared, and you stood in front of a room and shared knowledge that took years to earn. That kind of generosity is what ONGIA runs on. We're volunteer-led, and every session we deliver depends on people like you who are willing to pass on what they know.

The people in that room went back to patrol cars, classrooms, courtrooms, case files and community programs. What you gave them goes with them. Somewhere down the line, a young person gets reached sooner, a victim gets recognized, or a case gets built a little stronger because of something they heard from you.

We'd be honoured to have you back. If there's a topic you've been wanting to dig into, or someone in your network we should be hearing from, just hit reply. We'd love to know.

Thank you again, truly. Our work is better because you're part of it.

With gratitude,`,
};

export const thanksOn = (event) => event.presenterThanks?.off !== true;

/** The words: as saved on the event, or the standard. */
export function thanksWords(event) {
  const t = event.presenterThanks ?? {};
  return t.body ? { subject: t.subject ?? STANDARD.subject, body: t.body } : { ...STANDARD };
}
export const thanksLetter = (event, words = thanksWords(event)) => ({ id: "event-thanks", kind: "thanks", name: "Presenter thank-you", attachAgenda: false, ...words });

const plusDay = (iso) => new Date(Date.parse(`${iso}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
/** The day it goes: the day after the last day. */
export const thanksDay = (event) => { const end = event.lastDay || event.dayOne; return /^\d{4}-\d{2}-\d{2}$/.test(end ?? "") ? plusDay(end) : ""; };
export const THANKS_AT = "09:00";

/** Whether a presenter is on the list: picked on the card, or else by where their agreement stands. */
export function included(p) {
  if (p.status === "withdrawn" || !p.email) return false;
  if (p.thanksPick === "yes") return true;
  if (p.thanksPick === "no") return false;
  return p.status !== "invited";
}

/**
 * Each presenter as the email sees them: first name, their talk's title (from the agreement, else the program) and the
 * day they spoke (from the program or the MC card). Withdrawn ones aren't listed.
 */
export function thanksPeople(event, presenters) {
  const sessions = mcSessions(event, presenters);
  return presenters.filter((p) => p.status !== "withdrawn").map((p) => {
    const s = sessions.find((x) => x.people.some((q) => q.id === p.id));
    return {
      id: p.id, first: p.first ?? "", last: p.last ?? "", email: p.email ?? "", status: p.status,
      talk: String(p.submission?.talk || s?.title || "").trim(), talkDay: s?.day || "",
      in: included(p), pick: p.thanksPick ?? "", sentAt: p.thanked?.at ?? null, why: p.thanked?.why ?? "",
    };
  });
}

/** Due now: on, today is its day in the event's own time, and it's past 9:00 there. */
export function thanksDue(event, now = new Date()) {
  if (!thanksOn(event) || event.practice) return false;
  const day = thanksDay(event);
  if (!day) return false;
  const [today, time] = localNow(event, now).split(" ");
  return today === day && time >= THANKS_AT;
}

/** Send to everyone on the list still owed it. `force` is Send now: any day. `only` sends to one presenter. */
export async function sendThanksRound(event, { deadline = null, pace = pacer(), force = false, now = new Date(), only = null } = {}) {
  if (!force && !thanksDue(event, now)) return { skipped: "not its time" };
  const letter = thanksLetter(event);
  const wrong = [...letterProblems(letter), ...eventProblems(letter, event)];
  if (wrong.length) return { event: event.id, title: event.title, kind: "thanks", blocked: wrong };
  const presenters = await listPresenters(event.id);
  const view = thanksPeople(event, presenters);
  // One that failed waits for Send now rather than being tried every 15 minutes.
  const owed = view.filter((v) => (only ? v.id === only && v.email : v.in && !v.sentAt && (force || !v.why)));
  let sent = 0, failed = 0, left = 0;
  const trouble = [];
  for (const v of owed) {
    if (!timeLeft(deadline)) { left = owed.length - sent - failed; break; }
    await pace();
    const p = presenters.find((x) => x.id === v.id);
    try {
      const out = await sendMail({ to: v.email, replyTo: attendeeReplyTo(event), ...renderLetter(letter, event, v) });
      if (out.skipped) throw new Error(out.reason);
      p.thanked = { at: new Date().toISOString() };
      sent++;
    } catch (e) {
      p.thanked = { why: e.message, failedAt: new Date().toISOString() };
      trouble.push({ email: v.email, why: e.message });
      failed++;
    }
    await putPresenter(p);
  }
  return { event: event.id, title: event.title, kind: "thanks", sent, failed, left, trouble: trouble.slice(0, 10) };
}

/** Every event whose thank-you is due. Called by the 15-minute check. */
export async function runThanksRounds(events, opts = {}) {
  const out = [];
  for (const event of events) {
    if (!thanksDue(event, opts.now)) continue;
    try { const r = await sendThanksRound(event, opts); if (!r.skipped && (r.sent || r.failed || r.left || r.blocked)) out.push(r); }
    catch (e) { out.push({ event: event.id, title: event.title, kind: "thanks", error: e.message }); }
  }
  return out;
}

/** Whether any event has a thank-you to send right now (cheap: only reads presenters for an event that's due). */
export async function thanksWorkDue(events, now = new Date()) {
  for (const event of events) {
    if (!thanksDue(event, now)) continue;
    if (thanksPeople(event, await listPresenters(event.id)).some((v) => v.in && !v.sentAt && !v.why)) return true;
  }
  return false;
}

export const thanksZone = zoneOf;
