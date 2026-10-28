import { primeRoster } from "./lib/signature.mjs";
import { json, fail, requireAdmin, adminWho, editGuard, isEmail, fileName } from "./lib/http.mjs";
import { getEvent, putEvent, getAttendees, getLetter, getAgenda, listEvents, listLetters, getRoster, putWelcomeFile, getWelcomeFile, deleteWelcomeFile } from "./lib/store.mjs";
import { writeableTo } from "./lib/attendees.mjs";
import { letterProblems, eventProblems, renderLetter, attachmentsFor, attendeeReplyTo, groupDaysOf, attendeeSignOf, filesFor, attachedBytes, ATTACH_LIMIT, firstNameOf } from "./lib/letters.mjs";
import { randomUUID } from "node:crypto";
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
 *
 * PDFs to attach besides the agenda (Andrew 27 Oct 2026), each ticked for the versions it goes with:
 *   POST   /api/welcome?event=…&file=new         the PDF as the body, its name in x-file-name
 *   PUT    /api/welcome?event=…&file=<id>        { main, group } which versions it goes with
 *   GET    /api/welcome?event=…&file=<id>        the PDF, to open
 *   DELETE /api/welcome?event=…&file=<id>        take it off
 */
export default async (req) => {
  await primeRoster();
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const url = new URL(req.url);
  const event = await getEvent(url.searchParams.get("event"));
  if (!event) return fail("No such event.", 404);
  const fileId = url.searchParams.get("file");
  if (req.method === "GET" && fileId) return openFile(event, fileId);
  if (req.method === "GET") return url.searchParams.get("library") ? library(event) : show(event);
  const viewOnly = editGuard(req, event); if (viewOnly) return viewOnly;
  if (fileId) return fileChange(req, event, fileId);
  const body = await req.json().catch(() => ({}));

  if (req.method === "PUT") {
    if (body.sendOn !== undefined) { const problem = setSendDay(event, body.sendOn); if (problem) return fail(problem); }
    // Who signs it: "member:<their roster address>", "board:<address>", or "" for the usual.
    if (body.signature !== undefined) {
      const [kind, address] = String(body.signature ?? "").split(/:(.*)/s);
      const a = String(address ?? "").trim().toLowerCase();
      if (!body.signature) delete event.signature;
      else if (kind === "member" && ((await getRoster()) ?? []).some((m) => String(m.email ?? "").toLowerCase() === a)) event.signature = { member: a };
      else if (kind === "board" && isEmail(a)) event.signature = { email: a };
      else return fail("Pick who signs it from the list.");
    }
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
        attached: [...(letter.attachAgenda ? [(which === "group" ? event.agendaGroupFile : event.agendaFile)?.name] : []), ...filesFor(event, which).map((f) => f.name)].filter(Boolean) });
    }
    const to = testAddresses(body.to || adminWho(req)?.email);
    if (!to.length) return fail("Which address should the test go to?");
    const problems = problemsOf(letter, event);
    if (problems.length) return fail(`Not sending a test with a problem in it: ${problems[0]}`, 422);
    let attachments;
    try { attachments = await attachmentsFor(letter, event, getAgenda, getWelcomeFile); } catch (e) { return fail(e.message, 409); }
    if (attachedBytes(event, which) > ATTACH_LIMIT) return fail(`${groupsOf(event)[which]} carries more than 3 MB of attachments, and an email takes up to 3 MB. Untick or replace one.`, 413);
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
    agenda: event.agendaFile ?? null, attachedBytes: attachedBytes(event, "main"), ...reach.main, problems: problemsOf(letters.main, event) }];
  if (letters.group) versions.push({ key: "group", label: names.group, dates: g ? range(g.dayOne, g.lastDay) : "", ...words.group,
    agenda: event.agendaGroupFile ?? null, attachedBytes: attachedBytes(event, "group"), ...reach.group, problems: problemsOf(letters.group, event) });
  const job = welcomeJob(event);
  const s = event.signature;
  // Who the letter can't greet by name (Andrew 28 Oct 2026: a registration's first name was "D22"): theirs opens "Hello,".
  const noName = writeableTo(people).filter((p) => !firstNameOf(p.first)).map((p) => ({ name: [p.first, p.last].map((v) => String(v ?? "").trim()).filter(Boolean).join(" "), email: p.email }));
  return json({ versions, noName, files: event.welcomeFiles ?? [], attachLimit: ATTACH_LIMIT, signer: attendeeSignOf(event), signature: s?.member ? `member:${s.member}` : s?.email ? `board:${s.email}` : "", sendOn: job?.due ?? null, sendDone: !!job?.done, attendeeMail: event.attendeeMail === true, saved: !!event.welcome?.main,
    round: people.length ? (((await getAttendees(event.id)) ?? {}).letterRounds ?? {}).welcome ?? null : null });
}

const MAX_FILES = 10;
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

/** One attached PDF, to open on the event page. */
async function openFile(event, id) {
  const f = (event.welcomeFiles ?? []).find((x) => x.id === id);
  const doc = f ? await getWelcomeFile(event.id, id) : null;
  if (!doc) return fail("That attachment is not on file.", 404);
  return new Response(doc.bytes, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${f.name.replace(/"/g, "")}"`, "cache-control": "private, no-store" } });
}

/** Add a PDF, change which versions it goes with, or take it off. A version's email may carry 3 MB in all. */
async function fileChange(req, event, id) {
  const names = groupsOf(event);
  const files = event.welcomeFiles ?? [];
  const tooBig = () => ["main", "group"].filter((k) => (k === "main" || names.group) && attachedBytes(event, k) > ATTACH_LIMIT)
    .map((k) => `With it, the ${names.group ? `${names[k]} ` : ""}letter would carry ${mb(attachedBytes(event, k))}, and an email takes up to 3 MB. Untick another file, or save a smaller PDF (in Word: File, Save As, PDF, "Minimum size").`)[0];
  if (req.method === "POST" && id === "new") {
    if (files.length >= MAX_FILES) return fail(`The welcome letter can carry up to ${MAX_FILES} attachments. Remove one first.`, 409);
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.length) return fail("That file was empty.");
    if (bytes.length > ATTACH_LIMIT) return fail(`That file is ${mb(bytes.length)}, and an email takes up to 3 MB. Save a smaller PDF (in Word: File, Save As, PDF, "Minimum size") and upload that.`, 413);
    if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") return fail("That is not a PDF. Save it as a PDF and upload that.", 415);
    // With one version there is nothing to choose, so it goes with the letter; with two, Andrew ticks which.
    const f = { id: randomUUID().slice(0, 12), name: fileName(req.headers.get("x-file-name"), "attachment.pdf"), size: bytes.length, main: !names.group, group: false, uploadedAt: new Date().toISOString() };
    event.welcomeFiles = [...files, f];
    const problem = tooBig();
    if (problem) return fail(problem, 413);
    await putWelcomeFile(event.id, f.id, bytes, { name: f.name, size: f.size });
  } else {
    const f = files.find((x) => x.id === id);
    if (!f) return fail("That attachment is not on file.", 404);
    if (req.method === "DELETE") {
      event.welcomeFiles = files.filter((x) => x.id !== id);
      await deleteWelcomeFile(event.id, id);
    } else if (req.method === "PUT") {
      const body = await req.json().catch(() => ({}));
      if (body.main !== undefined) f.main = body.main === true;
      if (body.group !== undefined) f.group = body.group === true && !!names.group;
      const problem = tooBig();
      if (problem) return fail(problem, 413);
    } else return fail("Method not allowed.", 405);
  }
  event.updatedAt = new Date().toISOString();
  await putEvent(event);
  return show(event);
}
