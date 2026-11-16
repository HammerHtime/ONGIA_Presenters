import { listPresenters, putPresenter, listVolunteers, putVolunteer, getAttendees, getMeta } from "./store.mjs";
import { appreciationPdf, letterFileName, STANDARD_LETTER, VOLUNTEER_LETTER } from "./appreciation.mjs";
import { letterProblems, eventProblems, renderLetter, attendeeReplyTo } from "./letters.mjs";
import { sendMail } from "./mail.mjs";
import { mcSessions } from "./mcintro.mjs";
import { localNow, zoneOf } from "./surveysend.mjs";
import { pacer, timeLeft } from "./bulk.mjs";

/**
 * The thank-you to each presenter, the morning after the event ends (Andrew 14 Nov 2026: "Goes out the day after the
 * conference or training event ends, and it goes out personally to each one … set it up like we are the welcome
 * emails, where I can edit it"), and the same to each volunteer (Andrew 16 Nov 2026: "a thank you letter to the
 * volunteers, and we'll do it the same way … who I decide to give it to at each event"). Every event has both, in the
 * standard words below, unless switched off on the event's Communications tab; the words can be changed there for that
 * event. They go at 9:00 in the event's own time zone on the day after the last day, and only that day: an event that
 * ended before this was built is not thanked out of the blue. A day missed is sent with Send now.
 *
 * Who: every presenter with an address who hasn't withdrawn, signed or not (Andrew 14 Nov 2026); every volunteer who
 * signed. Anyone can be skipped or added on the card. Each is marked on their own record the moment theirs goes.
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
export const VOLUNTEER_STANDARD = {
  subject: "Thank you for volunteering at {event}",
  body: `Hi {first},

Thank you for volunteering at {event}.

Over {attendees} people came through the doors, and the event ran the way it did because of people like you. You gave up your own time, spent days away from home and family, and took on whatever needed doing.

This event would not have been the success it was without our volunteers. We know that, and we don't take it for granted.

I've attached a letter of appreciation you can share with your supervisor. We'd be glad to see it go on your file.

Thank you again.

With gratitude,`,
};

/** Who each thank-you is for: where its settings are kept on the event, its people, and its standard words. */
export const KINDS = {
  presenters: { key: "presenterThanks", label: "Presenter thank-you", list: listPresenters, put: putPresenter, standard: STANDARD, letter: STANDARD_LETTER, one: "presenter" },
  volunteers: { key: "volunteerThanks", label: "Volunteer thank-you", list: listVolunteers, put: putVolunteer, standard: VOLUNTEER_STANDARD, letter: VOLUNTEER_LETTER, one: "volunteer" },
};
const K = (kind) => KINDS[kind] ?? KINDS.presenters;
export const kindOf = (k) => (KINDS[k] ? k : "presenters");

export const thanksOn = (event, kind = "presenters") => event[K(kind).key]?.off !== true;
/** The letter of appreciation goes with it unless switched off for the event; its words, as saved or the standard. */
export const letterOn = (event, kind = "presenters") => event[K(kind).key]?.letterOff !== true;
export const letterWords = (event, kind = "presenters") => event[K(kind).key]?.letter || K(kind).letter;
export const standardLetter = (kind = "presenters") => K(kind).letter;
/** Andrew's signature image, from the desk's own store (never the public repository). */
export const SIGNATURE_KEY = "letter-signature";
export async function signatureImage() {
  const s = await getMeta(SIGNATURE_KEY).catch(() => null);
  return s?.png ? Buffer.from(s.png, "base64") : null;
}
/** The letter for one person, as an email attachment. */
export async function letterAttachment(event, v, { signature, on, kind = "presenters", body = null } = {}) {
  const content = await appreciationPdf(event, v, { body: body ?? letterWords(event, kind), signature, on });
  return { filename: letterFileName(v, on), content, contentType: "application/pdf" };
}

/** The words: as saved on the event, or the standard. */
export function thanksWords(event, kind = "presenters") {
  const t = event[K(kind).key] ?? {}, std = K(kind).standard;
  return t.body ? { subject: t.subject ?? std.subject, body: t.body } : { ...std };
}
export const thanksLetter = (event, words = thanksWords(event), kind = "presenters") => ({ id: `event-thanks-${kind}`, kind: "thanks", name: K(kind).label, attachAgenda: false, ...words });

const plusDay = (iso) => new Date(Date.parse(`${iso}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
/** The day it goes: the day after the last day. */
export const thanksDay = (event) => { const end = event.lastDay || event.dayOne; return /^\d{4}-\d{2}-\d{2}$/.test(end ?? "") ? plusDay(end) : ""; };
export const THANKS_AT = "09:00";

/** "Over 550": the registrations rounded down to the 50 below (562 is 550; 600 is 550, so "over" stays true). */
export const overFifty = (n) => (n >= 51 ? String(Math.floor((n - 1) / 50) * 50) : n > 0 ? String(n) : "");
export async function attendeesOver(event) {
  const people = ((await getAttendees(event.id)) ?? {}).people ?? [];
  return overFifty(people.filter((p) => (p.status ?? "ATTENDING") === "ATTENDING").length);
}

/** Whether someone is on the list: picked on the card, or else presenters not withdrawn and volunteers who signed. */
export function included(p, kind = "presenters") {
  if (p.status === "withdrawn" || !p.email) return false;
  if (p.thanksPick === "no") return false;
  if (kind === "volunteers") return p.thanksPick === "yes" || p.status === "signed";
  return true;
}

/**
 * Each person as the email sees them: first name, organization, and for a presenter their talk's title (the program's,
 * else the agreement's) and the day they spoke. Withdrawn ones aren't listed.
 */
export function thanksPeople(event, people, kind = "presenters", attendees = "") {
  const sessions = kind === "presenters" ? mcSessions(event, people) : [];
  return people.filter((p) => p.status !== "withdrawn").map((p) => {
    const s = sessions.find((x) => x.people.some((q) => q.id === p.id));
    return {
      id: p.id, first: p.first ?? "", last: p.last ?? "", email: p.email ?? "", status: p.status, organization: String(p.organization ?? "").trim().replace(/[\s,;:./-]+$/, ""),
      // The program's title first (Andrew 15 Nov 2026): the one attendees saw, the same for co-presenters, and right where the
      // agreement's box was filled with something else ("Staff Sergeant"). The agreement's when the talk isn't on the program.
      talk: kind === "presenters" ? String(s?.title || p.submission?.talk || "").trim() : "", talkDay: s?.day || "", attendees,
      in: included(p, kind), pick: p.thanksPick ?? "", sentAt: p.thanked?.at ?? null, why: p.thanked?.why ?? "",
    };
  });
}

/** Due now: on, today is its day in the event's own time, and it's past 9:00 there. */
export function thanksDue(event, now = new Date(), kind = "presenters") {
  if (!thanksOn(event, kind) || event.practice) return false;
  const day = thanksDay(event);
  if (!day) return false;
  const [today, time] = localNow(event, now).split(" ");
  return today === day && time >= THANKS_AT;
}

/** Send to everyone on the list still owed it. `force` is Send now: any day. `only` sends to one person. */
export async function sendThanksRound(event, { deadline = null, pace = pacer(), force = false, now = new Date(), only = null, kind = "presenters" } = {}) {
  if (!force && !thanksDue(event, now, kind)) return { skipped: "not its time" };
  const tag = kind === "presenters" ? "thanks" : `thanks-${kind}`;
  const letter = thanksLetter(event, thanksWords(event, kind), kind);
  const wrong = [...letterProblems(letter), ...eventProblems(letter, event)];
  if (wrong.length) return { event: event.id, title: event.title, kind: tag, blocked: wrong };
  const people = await K(kind).list(event.id);
  const view = thanksPeople(event, people, kind, kind === "volunteers" ? await attendeesOver(event) : "");
  // One that failed waits for Send now rather than being tried every 15 minutes.
  const owed = view.filter((v) => (only ? v.id === only && v.email : v.in && !v.sentAt && (force || !v.why)));
  let sent = 0, failed = 0, left = 0;
  const trouble = [];
  const signature = letterOn(event, kind) && owed.length ? await signatureImage() : null;
  for (const v of owed) {
    if (!timeLeft(deadline)) { left = owed.length - sent - failed; break; }
    await pace();
    const p = people.find((x) => x.id === v.id);
    try {
      const attachments = letterOn(event, kind) ? [await letterAttachment(event, v, { signature, kind })] : [];
      const out = await sendMail({ to: v.email, replyTo: attendeeReplyTo(event), ...renderLetter(letter, event, v), attachments });
      if (out.skipped) throw new Error(out.reason);
      p.thanked = { at: new Date().toISOString() };
      sent++;
    } catch (e) {
      p.thanked = { why: e.message, failedAt: new Date().toISOString() };
      trouble.push({ email: v.email, why: e.message });
      failed++;
    }
    await K(kind).put(p);
  }
  return { event: event.id, title: event.title, kind: tag, sent, failed, left, trouble: trouble.slice(0, 10) };
}

/** Every event's thank-yous that are due, presenters and volunteers. Called by the 15-minute check. */
export async function runThanksRounds(events, opts = {}) {
  const out = [];
  for (const event of events) {
    for (const kind of Object.keys(KINDS)) {
      if (!thanksDue(event, opts.now, kind)) continue;
      try { const r = await sendThanksRound(event, { ...opts, kind }); if (!r.skipped && (r.sent || r.failed || r.left || r.blocked)) out.push(r); }
      catch (e) { out.push({ event: event.id, title: event.title, kind: kind === "presenters" ? "thanks" : `thanks-${kind}`, error: e.message }); }
    }
  }
  return out;
}

/** Whether any event has a thank-you to send right now (cheap: only reads people for an event that's due). */
export async function thanksWorkDue(events, now = new Date()) {
  for (const event of events) {
    for (const kind of Object.keys(KINDS)) {
      if (!thanksDue(event, now, kind)) continue;
      if (thanksPeople(event, await K(kind).list(event.id), kind).some((v) => v.in && !v.sentAt && !v.why)) return true;
    }
  }
  return false;
}

export const thanksZone = zoneOf;
