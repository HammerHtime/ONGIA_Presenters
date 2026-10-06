import { todayIso } from "./deadlines.mjs";
import { getAttendees, putAttendees, getLetter, getEvent, putEvent } from "./store.mjs";
import { writeableTo } from "./attendees.mjs";
import { checklistOf } from "./checklist.mjs";
import { letterProblems, eventProblems, renderLetter } from "./letters.mjs";
import { sendMail } from "./mail.mjs";

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
export function letterDue(event, kind, today = todayIso()) {
  const letterId = event.letters?.[kind];
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
 */
export async function sendLetterRound(event, kind, { dry = false, today = todayIso() } = {}) {
  const due = letterDue(event, kind, today);
  if (!due.due) return { event: event.id, title: event.title, kind, skipped: due.why };

  const letter = await getLetter(due.letterId);
  if (!letter) return { event: event.id, title: event.title, kind, error: "the chosen letter no longer exists" };
  const problems = [...letterProblems(letter), ...eventProblems(letter, event)];
  // A letter with something wrong in it never goes — not to anybody. The
  // problems surface on the desk instead, where they can be fixed.
  if (problems.length) return { event: event.id, title: event.title, kind, blocked: problems };

  const stored = (await getAttendees(event.id)) ?? { people: [] };
  const owed = writeableTo(stored.people ?? []).filter((p) => !(p.sent ?? []).includes(kind));
  if (dry) return { event: event.id, title: event.title, kind, would: owed.length, letter: letter.name };
  if (!owed.length) return { event: event.id, title: event.title, kind, sent: 0, skipped: "everyone has had it" };

  let sent = 0, failed = 0;
  const trouble = [];
  for (const person of owed) {
    const mail = renderLetter(letter, event, person);
    try {
      const out = await sendMail({ to: person.email, replyTo: event.contact?.email || undefined, ...mail });
      if (out.skipped) { trouble.push({ email: person.email, why: out.reason }); failed++; continue; }
      person.sent = [...(person.sent ?? []), kind];
      person.sentAt = { ...(person.sentAt ?? {}), [kind]: new Date().toISOString() };
      sent++;
    } catch (e) {
      trouble.push({ email: person.email, why: e.message });
      failed++;
    }
  }
  await putAttendees(event.id, {
    ...stored,
    letterRounds: { ...(stored.letterRounds ?? {}), [kind]: { at: new Date().toISOString(), sent, failed, letter: letter.name } },
  });

  // The checklist job ticks itself once everyone owed has had it. A round with
  // failures leaves it open, so it is still visibly not done.
  if (sent && !failed) {
    const fresh = await getEvent(event.id);
    const job = (fresh.tasks ?? []).find((t) => t.id === due.jobId);
    if (job && !job.done) {
      job.done = true;
      job.doneAt = new Date().toISOString();
      job.doneBy = "sent automatically";
      await putEvent(fresh);
    }
  }
  return { event: event.id, title: event.title, kind, letter: letter.name, sent, failed, trouble: trouble.slice(0, 10) };
}

/** Every event, both letters. Called by the nightly job. */
export async function runLetterRounds(events, opts = {}) {
  const out = [];
  for (const event of events) {
    for (const kind of ["welcome", "survey"]) {
      if (!event.letters?.[kind]) continue;
      try { out.push(await sendLetterRound(event, kind, opts)); }
      catch (e) { out.push({ event: event.id, title: event.title, kind, error: e.message }); }
    }
  }
  return out;
}
