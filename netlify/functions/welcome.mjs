import { json, fail, requireAdmin, adminWho, editGuard } from "./lib/http.mjs";
import { getEvent, putEvent, getAttendees, getLetter, getAgenda, listEvents, listLetters } from "./lib/store.mjs";
import { writeableTo } from "./lib/attendees.mjs";
import { letterProblems, eventProblems, renderLetter, attachmentsFor, attendeeReplyTo, groupDaysOf } from "./lib/letters.mjs";
import { formatDate } from "./lib/deadlines.mjs";
import { sendMail } from "./lib/mail.mjs";
import { groupsOf, welcomeOf, welcomeLetters, cleanWelcome, splitByGroup, welcomeReach, welcomeJob, setSendDay, testAddresses } from "./lib/welcome.mjs";

/**
 * An event's welcome letter, all in one place on the event page (Andrew 27 Oct 2026): the words for each group, their
 * agendas, the day it goes. Turning attendee emails on is the switch above it.
 *
 *   GET  /api/welcome?event=…                    both versions, who each reaches, the day it goes, anything wrong
 *   GET  /api/welcome?event=…&library=1          welcome letters to start from: the saved ones, and other events' own
 *   PUT  /api/welcome?event=…                    { main: {subject, body}, group: {subject, body}, sendOn } save
 *   POST /api/welcome?event=…&preview=main|group the email as it would go, from the words on screen (saved or not)
 *   POST /api/welcome?event=…&test=main|group    { to, main/group words } a real email marked TEST, up to five addresses
 */
export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const url = new URL(req.url);
  const event = await getEvent(url.searchParams.get("event"));
  if (!event) return fail("No such event.", 404);
  if (req.method === "GET") return url.searchParams.get("library") ? library(event) : show(event);
  const viewOnly = editGuard(req, event); if (viewOnly) return viewOnly;
  const body = await req.json().catch(() => ({}));

  if (req.method === "PUT") {
    if (body.sendOn !== undefined) { const problem = setSendDay(event, body.sendOn); if (problem) return fail(problem); }
    event.welcome = cleanWelcome(body, welcomeOf(event, await chosenLetter(event)));
    event.updatedAt = new Date().toISOString();
    await putEvent(event);
    return show(event);
  }
  if (req.method === "POST") {
    const which = url.searchParams.get("preview") || url.searchParams.get("test");
    if (which !== "main" && which !== "group") return fail("Which version: main or group?");
    const words = cleanWelcome(body, welcomeOf(event, await chosenLetter(event)));
    const letter = welcomeLetters(event, words)[which];
    if (!letter) return fail("This event has no second group.", 409);
    const sample = await sampleFor(event, which);
    if (url.searchParams.get("preview")) {
      const mail = renderLetter(letter, event, sample);
      return json({ subject: mail.subject, html: mail.html, text: mail.text, problems: problemsOf(letter, event), sample: [sample.first, sample.last].filter(Boolean).join(" ") || "a sample person",
        attached: letter.attachAgenda ? [(which === "group" ? event.agendaGroupFile : event.agendaFile)?.name].filter(Boolean) : [] });
    }
    const to = testAddresses(body.to || adminWho(req)?.email);
    if (!to.length) return fail("Which address should the test go to?");
    const problems = problemsOf(letter, event);
    if (problems.length) return fail(`Not sending a test with a problem in it: ${problems[0]}`, 422);
    const attachments = await attachmentsFor(letter, event, getAgenda);
    for (const address of to) {
      const mail = renderLetter(letter, event, sample);
      const out = await sendMail({ to: address, replyTo: attendeeReplyTo(event), ...mail, subject: `TEST: ${mail.subject}`, attachments });
      if (out.skipped) return fail(`The test did not send: ${out.reason}`, 502);
    }
    return json({ ok: true, to: to.join(", ") });
  }
  return fail("Method not allowed.", 405);
};

/**
 * Welcome letters to start from (Andrew 27 Oct 2026: "a list of emails that have been used in the past for other
 * events … select this welcome letter for this event, make a few changes to it, and save it"): the saved ones from
 * the Letters screen, then every other event's own, newest event first.
 */
async function library(event) {
  const saved = (await listLetters()).filter((l) => l.kind !== "survey" && l.body)
    .map((l) => ({ id: `letter:${l.id}`, name: l.name || "Saved letter", from: "Saved letters", subject: l.subject ?? "", body: l.body }));
  const events = (await listEvents()).filter((e) => e.id !== event.id && e.welcome?.main?.body)
    .sort((a, b) => String(b.dayOne ?? "").localeCompare(String(a.dayOne ?? "")))
    .flatMap((e) => {
      const names = groupsOf(e);
      const when = e.dayOne ? ` (${formatDate(e.dayOne)})` : "";
      return [{ id: `event:${e.id}:main`, name: `${e.title}${when}${names.group ? `: ${names.main}` : ""}`, from: "Other events", ...e.welcome.main },
        ...(names.group && e.welcome.group?.body ? [{ id: `event:${e.id}:group`, name: `${e.title}${when}: ${names.group}`, from: "Other events", ...e.welcome.group }] : [])];
    });
  return json({ letters: [...saved, ...events] });
}

/** The saved letter the event picked before it had its own words: where its words start from. */
const chosenLetter = async (event) => (event.letters?.welcome ? await getLetter(event.letters.welcome).catch(() => null) : null);

const problemsOf = (letter, event) => [...new Set([...letterProblems(letter), ...eventProblems(letter, event)])];

/** Who a preview or test is made out to: a real person from that group if there is one. */
async function sampleFor(event, which) {
  const people = ((await getAttendees(event.id)) ?? {}).people ?? [];
  const all = writeableTo(people);
  const split = groupsOf(event).group ? splitByGroup(people, all) : { main: all, group: [] };
  return split[which][0] ?? { first: "Dana", last: "Sample", email: "dana@example.ca" };
}

const range = (a, b) => (a === b || !b ? formatDate(a) : `${formatDate(a)} to ${formatDate(b)}`);

async function show(event) {
  const people = ((await getAttendees(event.id)) ?? {}).people ?? [];
  const words = welcomeOf(event, await chosenLetter(event));
  const letters = welcomeLetters(event, words);
  const names = groupsOf(event);
  const reach = welcomeReach(event, people);
  const g = groupDaysOf(event);
  const versions = [{ key: "main", label: names.main, dates: event.dayOne ? range(event.dayOne, event.lastDay || event.dayOne) : "", ...words.main,
    agenda: event.agendaFile ?? null, ...reach.main, problems: problemsOf(letters.main, event) }];
  if (letters.group) versions.push({ key: "group", label: names.group, dates: g ? range(g.dayOne, g.lastDay) : "", ...words.group,
    agenda: event.agendaGroupFile ?? null, ...reach.group, problems: problemsOf(letters.group, event) });
  const job = welcomeJob(event);
  return json({ versions, sendOn: job?.due ?? null, sendDone: !!job?.done, attendeeMail: event.attendeeMail === true, saved: !!event.welcome?.main,
    round: people.length ? (((await getAttendees(event.id)) ?? {}).letterRounds ?? {}).welcome ?? null : null });
}
