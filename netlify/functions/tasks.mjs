import { json, fail, requireAdmin, text } from "./lib/http.mjs";
import { getEvent, putEvent, putMeta } from "./lib/store.mjs";
import { taskTemplate, checklistOf } from "./lib/checklist.mjs";
import { token } from "./lib/ids.mjs";

/**
 * The jobs that are ONGIA's rather than a presenter's: book the room, confirm
 * catering, order badges, send the invoices, file the report.
 *
 *   GET    /api/tasks?event=…            this event's list, with dates worked out
 *   POST   /api/tasks?event=…            add one
 *   POST   /api/tasks?event=…&seed=1     pull in the standard list
 *   PUT    /api/tasks?event=…&id=…       rename it, move it, tick it
 *   DELETE /api/tasks?event=…&id=…       remove it
 *   GET    /api/tasks?template=1         the standard list every event starts from
 *   PUT    /api/tasks?template=1         change that standard list
 *
 * A job is stored as "how many days before day one", never as a fixed date, so
 * moving the training moves the whole checklist with it — the same bargain the
 * agreement and materials deadlines already make.
 */

const MAX_TASKS = 60;
const cleanWhat = (v) => text(v, 160);

/**
 * Three answers, not two: null means "no date chosen yet", which is a real
 * state for a job on the list that has not been scheduled. A number is a
 * distance from day one — zero included, meaning day one itself. undefined
 * means the box held something that is not a number, which is a refusal.
 *
 * Blank must not come back as zero: Number("") is 0, and a job silently filed
 * as "due the day the training starts" is worse than a question.
 */
function cleanDays(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Math.round(Number(v));
  // Two years either side covers "book the venue eighteen months out" and
  // "file the report next quarter" without letting a typo set a date in 2140.
  return Number.isFinite(n) && Math.abs(n) <= 730 ? n : undefined;
}

/** Dated jobs furthest-out first; undated ones keep the order they were written. */
function byDue(a, b) {
  const as = Number.isFinite(a.daysBefore), bs = Number.isFinite(b.daysBefore);
  if (as !== bs) return as ? -1 : 1;
  return as ? b.daysBefore - a.daysBefore : 0;
}

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);

  const url = new URL(req.url);
  const body = ["POST", "PUT"].includes(req.method) ? await req.json().catch(() => null) : null;

  if (url.searchParams.get("template")) {
    if (req.method === "GET") return json({ template: await taskTemplate() });
    if (req.method === "PUT") {
      if (!body) return fail("Expected a JSON body.");
      return saveTemplate(body);
    }
    return fail("Method not allowed.", 405);
  }

  const eventId = url.searchParams.get("event");
  if (!eventId) return fail("Which event?");
  const event = await getEvent(eventId);
  if (!event) return fail("No such event.", 404);
  event.tasks ??= [];

  if (req.method === "GET") return json(list(event));
  if (req.method === "POST") {
    if (url.searchParams.get("seed")) return seed(event);
    if (!body) return fail("Expected a JSON body.");
    return add(event, body);
  }
  if (req.method === "PUT") {
    if (!body) return fail("Expected a JSON body.");
    return change(event, url.searchParams.get("id"), body);
  }
  if (req.method === "DELETE") return remove(event, url.searchParams.get("id"));
  return fail("Method not allowed.", 405);
};

async function saveTemplate(body) {
  const rows = (Array.isArray(body.tasks) ? body.tasks : []).slice(0, MAX_TASKS)
    .map((t) => ({ what: cleanWhat(t.what), daysBefore: cleanDays(t.daysBefore), auto: t.auto || undefined }))
    // Wording is required; a date is not. A row with junk where the number
    // should be is dropped rather than stored as a date nobody meant.
    .filter((t) => t.what && t.daysBefore !== undefined)
    .sort(byDue);
  await putMeta("eventtasks", { tasks: rows, updatedAt: new Date().toISOString() });
  return json({ ok: true, template: rows });
}

const list = (event) => checklistOf(event);

async function add(event, body) {
  if (event.tasks.length >= MAX_TASKS) return fail(`That is already ${MAX_TASKS} jobs on one event.`, 409);
  const what = cleanWhat(body.what);
  const daysBefore = cleanDays(body.daysBefore);
  if (!what) return fail("What is the job?");
  if (daysBefore === undefined) return fail("That is not a number of days. Leave it blank if there is no date yet.");
  const task = { id: token(8), what, daysBefore, done: false, doneAt: null, na: false, addedAt: new Date().toISOString() };
  event.tasks.push(task);
  await putEvent(event);
  return json({ ok: true, ...list(event) }, 201);
}

/** Pull in the standard list, skipping anything already on this event. */
async function seed(event) {
  const rows = await taskTemplate();
  const have = new Set(event.tasks.map((t) => t.what.toLowerCase()));
  const room = MAX_TASKS - event.tasks.length;
  const added = rows.filter((r) => !have.has(r.what.toLowerCase())).slice(0, Math.max(room, 0))
    .map((r) => ({ id: token(8), what: r.what, daysBefore: r.daysBefore, auto: r.auto, done: false, doneAt: null, na: false, addedAt: new Date().toISOString() }));
  if (!added.length) return json({ ok: true, added: 0, ...list(event) });
  event.tasks.push(...added);
  await putEvent(event);
  return json({ ok: true, added: added.length, ...list(event) });
}

async function change(event, id, body) {
  const task = event.tasks.find((t) => t.id === id);
  if (!task) return fail("No such job.", 404);
  if (body.what !== undefined) {
    const what = cleanWhat(body.what);
    if (!what) return fail("What is the job?");
    task.what = what;
  }
  if ("daysBefore" in body) {
    const daysBefore = cleanDays(body.daysBefore);
    if (daysBefore === undefined) return fail("That is not a number of days. Leave it blank if there is no date yet.");
    task.daysBefore = daysBefore;
  }
  if (body.done !== undefined) {
    task.done = body.done === true;
    task.doneAt = task.done ? new Date().toISOString() : null;
  }
  // Ruling a job out is not the same as doing it, so the two do not overwrite
  // each other: marking it not applicable clears the tick it never earned.
  if (body.na !== undefined) {
    task.na = body.na === true;
    if (task.na) { task.done = false; task.doneAt = null; }
  }
  await putEvent(event);
  return json({ ok: true, ...list(event) });
}

async function remove(event, id) {
  const before = event.tasks.length;
  event.tasks = event.tasks.filter((t) => t.id !== id);
  if (event.tasks.length === before) return fail("No such job.", 404);
  await putEvent(event);
  return json({ ok: true, ...list(event) });
}
