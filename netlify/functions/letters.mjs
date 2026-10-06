import { json, fail, requireAdmin, text, isEmail } from "./lib/http.mjs";
import { getLetter, putLetter, listLetters, deleteKey, getEvent, getAttendees, listEvents, getAgenda } from "./lib/store.mjs";
import { BLANKS, STARTER_LETTERS, letterProblems, eventProblems, renderLetter, attachmentsFor } from "./lib/letters.mjs";
import { letterDue } from "./lib/sendletters.mjs";
import { writeableTo } from "./lib/attendees.mjs";
import { sendMail } from "./lib/mail.mjs";
import { token } from "./lib/ids.mjs";

/**
 * Saved letters.
 *
 *   GET    /api/letters                    every letter, plus the blanks they may use
 *   GET    /api/letters?id=…               one
 *   POST   /api/letters                    save a new one
 *   PUT    /api/letters?id=…               change one
 *   DELETE /api/letters?id=…               remove one no event is using
 *   POST   /api/letters?preview=1          render a letter against an event, unsaved text allowed
 *   POST   /api/letters?test=1             send that rendering to one address, marked TEST
 *
 * A preview and a test use whatever text is in the editor, saved or not, so
 * Andrew can see the real email before he commits to it.
 */
export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const body = ["POST", "PUT"].includes(req.method) ? await req.json().catch(() => null) : null;

  if (req.method === "GET") return id ? one(id) : all();
  if (req.method === "POST") {
    if (!body) return fail("Expected a JSON body.");
    if (url.searchParams.get("preview")) return preview(body);
    if (url.searchParams.get("test")) return testSend(body);
    return save(null, body);
  }
  if (req.method === "PUT") {
    if (!body) return fail("Expected a JSON body.");
    return save(id, body);
  }
  if (req.method === "DELETE") return remove(id);
  return fail("Method not allowed.", 405);
};

const blanks = () => Object.entries(BLANKS).map(([name, b]) => ({ name, means: b.means }));

/** The first visit seeds the two drafts, so there is something to edit rather than a blank page. */
async function all() {
  let letters = await listLetters();
  if (!letters.length) {
    for (const draft of STARTER_LETTERS) {
      await putLetter({ ...draft, id: token(10), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
    letters = await listLetters();
  }
  const events = await listEvents();
  return json({
    letters: letters.map((l) => ({ ...l, problems: letterProblems(l),
      usedBy: events.filter((e) => Object.values(e.letters ?? {}).includes(l.id)).map((e) => ({ id: e.id, title: e.title })) })),
    blanks: blanks(),
  });
}

async function one(id) {
  const letter = await getLetter(id);
  if (!letter) return fail("No such letter.", 404);
  return json({ letter: { ...letter, problems: letterProblems(letter) }, blanks: blanks() });
}

function clean(body) {
  return {
    kind: body.kind === "survey" ? "survey" : "welcome",
    name: text(body.name, 120),
    subject: text(body.subject, 200),
    body: String(body.body ?? "").replace(/\r/g, "").slice(0, 8000),
    buttonLabel: text(body.buttonLabel, 60),
    buttonLink: text(body.buttonLink, 800),
    onlyFor: text(body.onlyFor, 80),
    // The welcome letter can carry the event's agenda (uploaded on the event page).
    attachAgenda: body.attachAgenda === true,
  };
}

/**
 * Saving is allowed with problems in it — a draft is a draft. What a problem
 * stops is the SEND, and the reply says what is still wrong.
 */
async function save(id, body) {
  const fields = clean(body);
  if (!fields.name) return fail("Give the letter a name, so you can pick it on an event.");
  const had = id ? await getLetter(id) : null;
  if (id && !had) return fail("No such letter.", 404);
  const letter = { ...(had ?? { id: token(10), createdAt: new Date().toISOString() }), ...fields, updatedAt: new Date().toISOString() };
  await putLetter(letter);
  return json({ ok: true, letter: { ...letter, problems: letterProblems(letter) } }, id ? 200 : 201);
}

async function remove(id) {
  const letter = await getLetter(id);
  if (!letter) return fail("No such letter.", 404);
  const using = (await listEvents()).filter((e) => Object.values(e.letters ?? {}).includes(id));
  if (using.length) return fail(`${using.map((e) => e.title).join(", ")} ${using.length === 1 ? "uses" : "use"} this letter. Pick another one there first.`, 409);
  await deleteKey(`letter:${id}`);
  return json({ ok: true });
}

/** Who a preview is addressed to: a real attendee if there is one, else a stand-in. */
async function sampleFor(event) {
  const people = writeableTo(((await getAttendees(event.id)) ?? {}).people ?? []);
  return { person: people[0] ?? { first: "Dana", last: "Sample", email: "dana@example.ca" }, count: people.length, real: people.length > 0 };
}

async function preview(body) {
  const letter = clean(body.letter ?? {});
  const event = body.eventId ? await getEvent(body.eventId) : null;
  if (!event) {
    // Without an event, show the blanks as themselves so the shape can be judged.
    return json({ problems: letterProblems(letter), html: null, note: "Pick an event to see it filled in." });
  }
  const { person, count, real } = await sampleFor(event);
  const kind = letter.kind;
  const due = letterDue({ ...event, letters: { ...(event.letters ?? {}), [kind]: event.letters?.[kind] || "preview" } }, kind);
  const mail = renderLetter(letter, event, person);
  return json({
    problems: [...letterProblems(letter), ...eventProblems(letter, event)],
    subject: mail.subject, html: mail.html, text: mail.text,
    to: { count, sample: real ? `${person.first || ""} ${person.last || ""}`.trim() || "the first attendee" : "a sample person" },
    when: due.on ?? null, whenNote: due.due ? "due now" : due.why,
    attached: letter.attachAgenda && event.agendaFile ? [{ name: event.agendaFile.name, size: event.agendaFile.size }] : [],
    off: event.attendeeMail !== true,
  });
}

/** One real email to one address, so the letter can be seen in an actual inbox. */
async function testSend(body) {
  const to = text(body.to, 200);
  if (!isEmail(to)) return fail("Which address should the test go to?");
  const letter = clean(body.letter ?? {});
  const event = body.eventId ? await getEvent(body.eventId) : null;
  if (!event) return fail("Pick an event to fill the letter in from.");
  const problems = [...letterProblems(letter), ...eventProblems(letter, event)];
  if (problems.length) return fail(`Not sending a test with problems in it: ${problems[0]}`, 422);
  const { person } = await sampleFor(event);
  const mail = renderLetter(letter, event, person);
  const attachments = await attachmentsFor(letter, event, getAgenda);
  const out = await sendMail({ to, ...mail, subject: `[TEST] ${mail.subject}`, attachments });
  if (out.skipped) return fail(`The test could not be sent: ${out.reason}`, 503);
  return json({ ok: true, to, id: out.id ?? null });
}
