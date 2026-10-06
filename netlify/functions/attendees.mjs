import { json, fail, requireAdmin, text } from "./lib/http.mjs";
import { getEvent, getAttendees, putAttendees, deleteKey, getLetter } from "./lib/store.mjs";
import { readCsv, merge, tally, writeableTo } from "./lib/attendees.mjs";
import { letterDue } from "./lib/sendletters.mjs";
import { letterProblems, eventProblems } from "./lib/letters.mjs";

/**
 * The people coming to a training event.
 *
 *   GET    /api/attendees?event=…           the list, with a tally
 *   POST   /api/attendees?event=…&csv=1     a CSV, as the raw request body
 *   DELETE /api/attendees?event=…&email=…   take one person off
 *   DELETE /api/attendees?event=…&all=1     clear the list
 *
 * Pulling from Wix lives in wix.mjs; this is the list itself, however it was
 * filled. A CSV is the way in when Wix is not connected, when someone
 * registered by phone, or when the key has been revoked the week a letter is
 * due to go out.
 */
const MAX_CSV = 2 * 1024 * 1024;

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);

  const url = new URL(req.url);
  const eventId = url.searchParams.get("event");
  if (!eventId) return fail("Which event?");
  const event = await getEvent(eventId);
  if (!event) return fail("No such event.", 404);

  if (req.method === "GET") return json(await show(event));
  if (req.method === "POST") {
    if (!url.searchParams.get("csv")) return fail("Expected ?csv=1.");
    return takeCsv(req, event);
  }
  if (req.method === "DELETE") {
    if (url.searchParams.get("all")) return clear(event);
    return removeOne(event, url.searchParams.get("email"));
  }
  return fail("Method not allowed.", 405);
};

async function show(event) {
  const stored = (await getAttendees(event.id)) ?? { people: [], syncedAt: null };
  return {
    people: stored.people ?? [],
    counts: tally(stored.people ?? []),
    syncedAt: stored.syncedAt ?? null,
    lastImport: stored.lastImport ?? null,
    wix: event.wix ?? null,
    letters: await letterStatus(event, stored),
  };
}

/**
 * For each automatic letter: which one, when it goes, how many it reaches, and
 * anything that would stop it — so a held-back letter is visible on the event
 * long before the night it would have gone.
 */
async function letterStatus(event, stored) {
  const out = {};
  const people = stored.people ?? [];
  for (const kind of ["welcome", "survey"]) {
    const id = event.letters?.[kind];
    const letter = id ? await getLetter(id) : null;
    const due = letterDue(event, kind);
    out[kind] = {
      chosen: Boolean(letter),
      name: letter?.name ?? null,
      on: due.on ?? null,
      why: due.due ? "due now" : due.why,
      reaches: writeableTo(people).length,
      had: people.filter((p) => (p.sent ?? []).includes(kind)).length,
      problems: letter ? [...letterProblems(letter), ...eventProblems(letter, event)] : [],
    };
  }
  return out;
}

async function takeCsv(req, event) {
  const body = await req.text();
  if (!body.trim()) return fail("That file was empty.");
  if (body.length > MAX_CSV) return fail("That file is over 2 MB. Split it, or send only the columns we need.", 413);

  const { people, skipped, problem } = readCsv(body);
  if (problem) return fail(problem);
  if (!people.length) return fail("No rows in that file had a usable email address.");

  const stored = (await getAttendees(event.id)) ?? { people: [] };
  // A CSV never retires anybody: it is one view of the list, not the whole of it.
  const out = merge(stored.people ?? [], people, { source: "csv" });
  await putAttendees(event.id, {
    ...stored,
    people: out.people,
    lastImport: { at: new Date().toISOString(), read: people.length, added: out.added, changed: out.changed, skipped: skipped.length },
  });
  return json({ ok: true, added: out.added, changed: out.changed, skipped, counts: tally(out.people) });
}

async function removeOne(event, email) {
  const who = text(email, 200).toLowerCase();
  if (!who) return fail("Which person?");
  const stored = (await getAttendees(event.id)) ?? { people: [] };
  const people = (stored.people ?? []).filter((p) => p.email !== who);
  if (people.length === (stored.people ?? []).length) return fail("Nobody on this list has that address.", 404);
  await putAttendees(event.id, { ...stored, people });
  return json({ ok: true, counts: tally(people) });
}

async function clear(event) {
  await deleteKey(`attendees:${event.id}`);
  return json({ ok: true, counts: tally([]) });
}
