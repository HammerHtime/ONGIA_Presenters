import { todayIso } from "./deadlines.mjs";
import { getAttendees, putAttendees, getLetter, getEvent, putEvent, getAgenda } from "./store.mjs";
import { writeableTo } from "./attendees.mjs";
import { checklistOf } from "./checklist.mjs";
import { letterProblems, eventProblems, renderLetter, attachmentsFor, attendeeReplyTo } from "./letters.mjs";
import { sendMail } from "./mail.mjs";
import { pacer, timeLeft } from "./bulk.mjs";
import { sendReplyRound, sendReminderRound } from "./reply.mjs";
import { welcomeLetters, splitByGroup } from "./welcome.mjs";
import { primeRoster } from "./signature.mjs";

/** An event whose welcome letter is written on the event itself (the event page's Welcome letter card). */
const ownWelcome = (event, kind) => kind === "welcome" && !!event.welcome?.main?.body;

/**
 * Sending the welcome letter and the survey.
 *
 * When: the date on the event's own checklist job — "Welcome letter sent to
 * attendees", "Survey link sent to attendees". One date, in one place. Move the
 * job and the letter moves; mark it not needed and the letter does not go.
 *
 * Who: everyone still coming, with an address. Each person is marked with the
 * letter they had, so nothing is sent twice, and somebody who registers after
 * the welcome letter went still gets it the next night.
 *
 * Until when: a welcome letter is no use once the training has started, and a
 * survey is stale a fortnight after. A night the job missed is caught up on
 * the next run inside that window rather than lost.
 */
const WINDOW = {
  welcome: (event) => event.dayOne,                                   // up to the morning it starts
  survey: (event, due) => new Date(Date.parse(due) + 14 * 86400000).toISOString().slice(0, 10),
};

/** The checklist job that carries this letter's date, if the event has one. */
function jobFor(event, kind, today) {
  return checklistOf(event, today).tasks.find((t) => t.auto === kind) ?? null;
}

/** Whether this kind of letter is due for an event today, and if not, why not. */
export const MAIL_OFF = "emails to attendees are off for this event";

export function letterDue(event, kind, today = todayIso()) {
  if (event.attendeeMail !== true) return { due: false, why: MAIL_OFF };
  // The event's own welcome letter, written on its page, comes first; otherwise the saved letter it picked.
  const letterId = ownWelcome(event, kind) ? "event-welcome" : event.letters?.[kind];
  if (!letterId) return { due: false, why: "no letter chosen for this event" };
  const job = jobFor(event, kind, today);
  if (!job) return { due: false, why: "the checklist has no job for it" };
  if (job.na) return { due: false, why: "marked not needed on the checklist" };
  if (!job.due) return { due: false, why: "the checklist job has no date" };
  if (today < job.due) return { due: false, why: `not until ${job.due}`, on: job.due };
  const closes = WINDOW[kind](event, job.due);
  if (closes && today >= closes) return { due: false, why: "too late — the window has closed", on: job.due };
  return { due: true, on: job.due, letterId, jobId: job.id };
}

/**
 * One round of one letter for one event. With `dry`, says who would get it and
 * what is wrong, and sends nothing.
 *
 * Each person is saved as having had it the moment their email goes, so a run
 * that is stopped part-way — Netlify stops every function at its time limit —
 * never sends anyone a second copy. Past the `deadline` no new send starts;
 * whoever is left is still owed and goes in the next run.
 */
export async function sendLetterRound(event, kind, { dry = false, today = todayIso(), deadline = null, pace = pacer() } = {}) {
  const due = letterDue(event, kind, today);
  if (!due.due) return { event: event.id, title: event.title, kind, skipped: due.why };

  const own = ownWelcome(event, kind) ? welcomeLetters(event) : null;
  const letter = own ? own.main : await getLetter(due.letterId);
  if (!letter) return { event: event.id, title: event.title, kind, error: "the chosen letter no longer exists" };
  const problems = [...letterProblems(letter), ...eventProblems(letter, event)];
  // A letter with something wrong in it never goes — not to anybody. The
  // problems surface on the desk instead, where they can be fixed.
  if (problems.length) return { event: event.id, title: event.title, kind, blocked: problems };

  const stored = (await getAttendees(event.id)) ?? { people: [] };
  // Once per address: an address that has had it (on any of its rows) is not written to again.
  const had = new Set((stored.people ?? []).filter((p) => (p.sent ?? []).includes(kind)).map((p) => p.email));
  const owed = writeableTo(stored.people ?? []).filter((p) => !had.has(p.email));
  // The second group's own welcome letter (Andrew 27 Oct 2026: the Summit's community partners come November 10 and 11,
  // with a two-day agenda, and get a different letter from the justice partners there all four days). An address
  // whose every registration came from the second Wix event gets it; anyone also on the first gets the main one.
  const batches = [{ letter, people: owed }];
  const groupId = own ? null : kind === "welcome" ? event.letters?.welcomeGroup : null;
  if (own?.group) {
    const wrong = [...letterProblems(own.group), ...eventProblems(own.group, event)];
    if (wrong.length) return { event: event.id, title: event.title, kind, blocked: wrong.map((w) => `${own.group.name}: ${w}`) };
    const split = splitByGroup(stored.people ?? [], owed);
    batches.splice(0, 1, { letter, people: split.main }, { letter: own.group, people: split.group });
  } else if (groupId && groupId !== letter.id) {
    const other = await getLetter(groupId);
    if (!other) return { event: event.id, title: event.title, kind, error: "the second group's welcome letter no longer exists" };
    const wrong = [...letterProblems(other), ...eventProblems(other, event)];
    if (wrong.length) return { event: event.id, title: event.title, kind, blocked: wrong.map((w) => `${other.name}: ${w}`) };
    const rows = (stored.people ?? []).filter((p) => p.status !== "WITHDRAWN");
    const groupOnly = (email) => rows.filter((p) => p.email === email).every((p) => p.group);
    batches.splice(0, 1, { letter, people: owed.filter((p) => !groupOnly(p.email)) }, { letter: other, people: owed.filter((p) => groupOnly(p.email)) });
  }
  const names = batches.filter((b) => b.people.length).map((b) => b.letter.name).join(" + ") || letter.name;
  if (dry) return { event: event.id, title: event.title, kind, would: owed.length, letter: names };
  if (!owed.length) return { event: event.id, title: event.title, kind, sent: 0, skipped: "everyone has had it" };

  // The agenda each letter carries: fetched once per letter for the whole round.
  for (const b of batches) {
    if (!b.people.length) continue;
    b.attachments = await attachmentsFor(b.letter, event, getAgenda);
    if (b.letter.attachAgenda && !b.attachments.length) {
      return { event: event.id, title: event.title, kind, blocked: [`${b.letter.name} attaches an agenda, and the agenda file could not be found. Upload it again.`] };
    }
  }
  let sent = 0, failed = 0, left = 0;
  const trouble = [];
  outer: for (const b of batches) {
    for (const person of b.people) {
      if (!timeLeft(deadline)) { left = owed.length - sent - failed; break outer; }
      await pace();
      const mail = renderLetter(b.letter, event, person);
      try {
        const out = await sendMail({ to: person.email, replyTo: attendeeReplyTo(event), ...mail, attachments: b.attachments });
        if (out.skipped) { trouble.push({ email: person.email, why: out.reason }); failed++; continue; }
        // Everyone at that address has had it: their guests on the same registration too.
        for (const same of (stored.people ?? []).filter((p) => p.email === person.email)) {
          same.sent = [...new Set([...(same.sent ?? []), kind])];
          same.sentAt = { ...(same.sentAt ?? {}), [kind]: new Date().toISOString() };
        }
        sent++;
        await putAttendees(event.id, stored);
      } catch (e) {
        trouble.push({ email: person.email, why: e.message });
        failed++;
      }
    }
  }
  await putAttendees(event.id, {
    ...stored,
    letterRounds: { ...(stored.letterRounds ?? {}), [kind]: { at: new Date().toISOString(), sent, failed, left, letter: names } },
  });

  // The checklist job ticks itself once everyone owed has had it. A round with
  // failures, or people still to go, leaves it open, so it is visibly not done.
  if (sent && !failed && !left) {
    const fresh = await getEvent(event.id);
    const job = (fresh.tasks ?? []).find((t) => t.id === due.jobId);
    if (job && !job.done) {
      job.done = true;
      job.doneAt = new Date().toISOString();
      job.doneBy = "sent automatically";
      await putEvent(fresh);
    }
  }
  return { event: event.id, title: event.title, kind, letter: names, sent, failed, left, trouble: trouble.slice(0, 10) };
}

/** Every event, both letters. Called by the nightly job. */
export async function runLetterRounds(events, opts = {}) {
  const out = [];
  await primeRoster();
  for (const event of events) {
    for (const kind of ["welcome", "survey"]) {
      if (!event.letters?.[kind] && !ownWelcome(event, kind)) continue;
      try { out.push(await sendLetterRound(event, kind, opts)); }
      catch (e) { out.push({ event: event.id, title: event.title, kind, error: e.message }); }
    }
    // The housekeeping questions, once sent from the event page: anyone who registers afterwards gets them the next
    // night, up to the reply-by date. Only while automatic emails to attendees are on.
    if (event.reply?.sentAt && event.attendeeMail === true) {
      let justSent = [];
      try { const r = await sendReplyRound(event, opts); justSent = r.sentTo ?? []; out.push({ event: event.id, title: event.title, kind: "reply", ...r }); }
      catch (e) { out.push({ event: event.id, title: event.title, kind: "reply", error: e.message }); }
      // Then today's reminder, if today is one of its dates, to those who have not answered (not to anyone just emailed).
      try { out.push({ event: event.id, title: event.title, kind: "reply-reminder", ...(await sendReminderRound(event, { ...opts, justSent })) }); }
      catch (e) { out.push({ event: event.id, title: event.title, kind: "reply-reminder", error: e.message }); }
    }
  }
  return out;
}
