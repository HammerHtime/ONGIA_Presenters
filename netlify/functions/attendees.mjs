import { autoOn } from "./lib/autosend.mjs";
import { json, fail, isEmail, requireAdmin, text, editGuard, adminWho } from "./lib/http.mjs";
import { certIndex, certRecord, issue, certSettings, templatesFor } from "./lib/certs.mjs";
import { getEvent, getAttendees, putAttendees, deleteKey, getLetter } from "./lib/store.mjs";
import { readCsv, merge, tally, writeableTo, keyOf, correct } from "./lib/attendees.mjs";
import { letterDue } from "./lib/sendletters.mjs";
import { letterProblems, eventProblems } from "./lib/letters.mjs";
import { directory, agencyOf } from "./lib/agencies.mjs";

/**
 * The people coming to a training event.
 *
 *   GET    /api/attendees?event=…           the list, with a tally
 *   POST   /api/attendees?event=…&csv=1     a CSV, as the raw request body
 *   POST   /api/attendees?event=…&correct=1 a CSV of corrections: names and organizations for people already on the list
 *   PUT    /api/attendees?event=…&key=…     { first, last, organization } one person's correction, kept through every pull
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
  if (req.method !== "GET") { const viewOnly = editGuard(req, event); if (viewOnly) return viewOnly; }

  if (req.method === "GET") return json(await show(event));
  if (req.method === "POST") {
    if (url.searchParams.get("correct")) return takeCorrections(req, event);
    if (!url.searchParams.get("csv")) return fail("Expected ?csv=1.");
    return takeCsv(req, event);
  }
  if (req.method === "PUT") return correctOne(req, event, url.searchParams.get("key"));
  if (req.method === "DELETE") {
    if (url.searchParams.get("all")) return clear(event);
    return removeOne(event, url.searchParams.get("email"), url.searchParams.get("key"));
  }
  return fail("Method not allowed.", 405);
};

async function show(event) {
  const stored = (await getAttendees(event.id)) ?? { people: [], syncedAt: null };
  // Each person's agency under its one official name (Andrew 30 Oct 2026); what they typed stays as they typed it.
  const list = await directory().catch(() => []);
  return {
    people: (stored.people ?? []).map((p) => ({ ...p, agency: agencyOf(p, list)?.name ?? "" })),
    counts: tally(stored.people ?? []),
    syncedAt: stored.syncedAt ?? null,
    lastImport: stored.lastImport ?? null,
    wix: event.wix ?? null,
    wixMore: event.wixMore ?? [],
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
      // The event's own welcome letter and survey (built into the desk) take over from a letter picked here, so the
      // old "none chosen" line is hidden for them (Andrew 8 Nov 2026).
      replaced: kind === "welcome" ? Boolean(event.welcome) : Boolean(event.survey),
      off: !autoOn(event, kind === "welcome" ? "welcome" : "survey"),
      chosen: Boolean(letter),
      name: letter?.name ?? null,
      on: due.on ?? null,
      why: due.due ? "due now" : due.why,
      reaches: writeableTo(people).length,
      had: new Set(people.filter((p) => (p.sent ?? []).includes(kind)).map((p) => p.email)).size,
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

/** Names and organizations from a sheet, for people already on the list; kept through every later pull from Wix. */
async function takeCorrections(req, event) {
  const body = await req.text();
  if (!body.trim()) return fail("That file was empty.");
  if (body.length > MAX_CSV) return fail("That file is over 2 MB.", 413);
  const { people, skipped, problem } = readCsv(body);
  if (problem) return fail(problem);
  if (!people.length) return fail("No rows in that file had a usable email address.");
  const stored = (await getAttendees(event.id)) ?? { people: [] };
  const out = correct(stored.people ?? [], people);
  await putAttendees(event.id, { ...stored, people: out.people,
    lastCorrection: { at: new Date().toISOString(), read: people.length, named: out.named, organizations: out.organizations, notFound: out.notFound.length } });
  return json({ ok: true, read: people.length, named: out.named, organizations: out.organizations, same: out.same, notFound: out.notFound, differs: out.differs, several: out.several, skipped: skipped.length, counts: tally(out.people) });
}

/** One person, corrected on the Guests list (Andrew 3 Nov 2026): name and organization, kept through every pull from Wix. */
async function correctOne(req, event, rowKey) {
  const row = text(rowKey, 200);
  if (!row) return fail("Which person?");
  const body = await req.json().catch(() => ({}));
  const stored = (await getAttendees(event.id)) ?? { people: [] };
  const p = (stored.people ?? []).find((x) => keyOf(x) === row);
  if (!p) return fail("That person isn't on this list.", 404);
  // Their certificate is found by the key it was issued under: their ticket, or the address they had before this.
  const certKey = p.key || p.email;
  const fixed = { ...(p.fixed ?? {}) };
  for (const f of ["first", "last", "organization"]) if (body[f] !== undefined) fixed[f] = text(body[f], 160);
  // A wrong address (Andrew 14 Nov 2026: a certificate bounced, and fixing it in Wix didn't reach the ticket): corrected
  // here, kept through every pull from Wix, and what Wix has is kept beside it.
  if (body.email !== undefined) {
    const e = text(body.email, 200).toLowerCase();
    if (e && !isEmail(e)) return fail("That isn't an email address.");
    fixed.email = e;
  }
  // What Wix has; a correction saved before emails could be corrected kept no email there, and the row's is still Wix's.
  p.asWix = { first: p.first ?? "", last: p.last ?? "", organization: p.organization ?? "", email: p.email ?? "", ...(p.asWix ?? {}) };
  // Put back exactly what Wix has: the correction goes.
  const same = ["first", "last", "organization", "email"].every((f) => (fixed[f] ?? p.asWix[f] ?? "") === (p.asWix[f] ?? ""));
  if (same) { Object.assign(p, p.asWix); delete p.fixed; delete p.asWix; }
  else Object.assign(p, fixed, { fixed, correctedAt: new Date().toISOString() });
  await putAttendees(event.id, { ...stored, people: stored.people });
  const list = await directory().catch(() => []);
  const agency = agencyOf(p, list)?.name || String(p.organization ?? "").trim();
  // A certificate already issued follows the correction (Andrew 17 Nov 2026: "instead of it automatically linking back
  // to the data set that holds the people information"): same number and QR code, what it said before kept in its
  // history, as Correct details on the Certificates tab does. Emailing it again stays a click of his.
  let certificate = null;
  const code = (await certIndex(event.id))[certKey];
  const rec = code ? await certRecord(code) : null;
  if (rec && !rec.revokedAt) {
    const name = [p.first, p.last].filter(Boolean).join(" ").trim() || rec.name;
    if (name !== rec.name || agency !== rec.agency) {
      await issue(event, { key: certKey, email: p.email ?? "" }, { name, agency, settings: certSettings(event, await templatesFor(event)), by: adminWho(req)?.email || "desk", correct: true });
      certificate = { key: certKey, name, agency, email: p.email ?? "", emailedBefore: !!rec.mail?.sentAt };
    }
  }
  return json({ ok: true, person: { ...p, agency }, certificate });
}

async function removeOne(event, email, key) {
  const who = text(email, 200).toLowerCase(), row = text(key, 200);
  if (!who && !row) return fail("Which person?");
  const stored = (await getAttendees(event.id)) ?? { people: [] };
  const people = (stored.people ?? []).filter((p) => (row ? keyOf(p) !== row : p.email !== who));
  if (people.length === (stored.people ?? []).length) return fail("Nobody on this list has that address.", 404);
  await putAttendees(event.id, { ...stored, people });
  return json({ ok: true, counts: tally(people) });
}

async function clear(event) {
  await deleteKey(`attendees:${event.id}`);
  return json({ ok: true, counts: tally([]) });
}
