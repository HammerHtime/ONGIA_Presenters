import { getMeta } from "./store.mjs";
import { token } from "./ids.mjs";
import { deadline, whyNotWorking, todayIso, formatDate } from "./deadlines.mjs";
import { fitsTitle } from "./titles.mjs";

/**
 * The jobs that are ONGIA's rather than a presenter's. Every one is stored as
 * days before day one of the training — negative means days after the last
 * day — so moving the training moves the whole checklist with it.
 *
 * This is where a desk starts. Once Andrew edits the list it is saved under
 * meta:eventtasks and his version is what new events get.
 */
export const STARTER = [
  // Andrew's jobs, in the order they get done (6 Oct 2026: "try to put them in
  // order"). The list keeps this order on every event; it is not re-sorted by
  // date. Only the two letters carry a date — the two he named. The rest have
  // none until he sets one: a date nobody chose is a date nobody trusts.
  // Jobs marked RBH appear only on events with RBH in the title.
  { what: "SOW sent to RBH", daysBefore: null, onlyFor: "RBH" },
  { what: "RFP sent out", daysBefore: null },
  { what: "Contract signed", daysBefore: null },
  { what: "Event graphic done", daysBefore: null },                     // before the Wix event
  { what: "Wix event set up", daysBefore: null },
  { what: "Board members attending confirmed", daysBefore: null },
  { what: "Presenter flights booked", daysBefore: null },
  { what: "Board member flights booked", daysBefore: null },
  { what: "VIA Rail train tickets booked", daysBefore: null, onlyFor: "RBH" },
  { what: "Limos booked", daysBefore: null, onlyFor: "RBH" },
  { what: "Car rental booked", daysBefore: null },
  { what: "Dinner reservations", daysBefore: null, onlyFor: "RBH" },
  { what: "Names sent to hotel (presenters, board members, volunteers)", daysBefore: null },
  { what: "Food ordered and arranged", daysBefore: null },
  { what: "AV confirmed and arranged", daysBefore: null },
  { what: "Event certificate completed (before the event)", daysBefore: null },
  { what: "ID cards printed", daysBefore: null },
  { what: "Welcome letter sent to attendees", daysBefore: 7, auto: "welcome" },
  { what: "Survey link sent to attendees", daysBefore: -2, auto: "survey" },
  { what: "Event certificate sent out (after the event)", daysBefore: null },
];

/** Jobs Andrew has renamed: an event's old wording becomes the new one, keeping its tick. */
export const RENAMED = {
  "presenter and hotel guest names given to the hotel": "Names sent to hotel (presenters, board members, volunteers)",
  "wix event set up and ready": "Wix event set up",
  "book via rail train tickets": "VIA Rail train tickets booked",
};

/** The desk's own list, or the starter one until it has saved its own. */
export async function taskTemplate() {
  const saved = await getMeta("eventtasks");
  return Array.isArray(saved?.tasks) && saved.tasks.length ? saved.tasks : STARTER;
}

/** Job wording compared the way a person reads it: case and extra spaces do not count. */
const named = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** One template row as a job on an event. */
const asTask = (t, at) => ({ id: token(8), what: t.what, daysBefore: t.daysBefore, auto: t.auto, done: false, doneAt: null, na: false, addedAt: at });

/**
 * The list a brand-new event starts with: everything on the template that fits
 * its title. A job marked for RBH events only is left off everything else.
 */
export async function starterTasks(title, now = new Date()) {
  const at = now.toISOString();
  return (await taskTemplate()).filter((t) => fitsTitle(t.onlyFor, title)).map((t) => asTask(t, at));
}

/**
 * An event renamed INTO a kind it was not before — "Montreal training" becomes
 * "RBH Montreal" — picks up that kind's own jobs, each slotted in where it sits
 * on the standard list. Only on that change: a job Andrew deleted from an event
 * that was always RBH stays deleted. Changes `event.tasks` in place and returns
 * the jobs it added.
 */
export async function jobsForRename(event, oldTitle, now = new Date()) {
  const template = await taskTemplate();
  const pos = new Map(template.map((t, i) => [named(t.what), i]));
  const have = new Set((event.tasks ?? []).map((t) => named(t.what)));
  const fresh = template
    .filter((t) => t.onlyFor && !fitsTitle(t.onlyFor, oldTitle) && fitsTitle(t.onlyFor, event.title) && !have.has(named(t.what)))
    .map((t) => asTask(t, now.toISOString()));
  event.tasks ??= [];
  for (const job of fresh) {
    const mine = pos.get(named(job.what));
    const at = event.tasks.findIndex((t) => (pos.get(named(t.what)) ?? Infinity) > mine);
    event.tasks.splice(at < 0 ? event.tasks.length : at, 0, job);
  }
  return fresh;
}

const addDays = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

/**
 * A job before the training counts back from day one and moves earlier onto a
 * working day, exactly like the other deadlines.
 *
 * A job after the training counts from the LAST day, not the first. "Survey two
 * days after" a four-day summit means two days after it ends — counted from day
 * one it would land mid-conference. It also moves later onto a working day,
 * never earlier, so it cannot slide back into the event it follows.
 */
export function taskDue(dayOne, daysBefore, lastDay = dayOne) {
  if (daysBefore >= 0) return deadline(dayOne, daysBefore);
  const end = lastDay && lastDay >= dayOne ? lastDay : dayOne;
  let d = addDays(end, -daysBefore);
  for (let guard = 0; guard < 40; guard++) {
    if (!whyNotWorking(d)) return d;
    d = addDays(d, 1);
  }
  return d;
}

/**
 * One stored job, plus everything a screen needs worked out for it.
 *
 * A job with no daysBefore has no date yet — it is on the list but unscheduled,
 * which is a real state and not an error. A job marked not applicable stays on
 * the event so it is visibly ruled out rather than quietly missing, and is
 * never late, never soon, and never counted.
 */
export function dressed(task, dayOne, today = todayIso(), lastDay = dayOne) {
  const scheduled = Number.isFinite(task.daysBefore);
  const due = scheduled && dayOne ? taskDue(dayOne, task.daysBefore, lastDay) : null;
  const days = due ? Math.round((Date.parse(due) - Date.parse(today)) / 86400000) : null;
  const live = !task.na && !task.done;
  return {
    ...task,
    na: task.na === true,
    scheduled,
    due,
    dueReadable: due ? formatDate(due) : "",
    days,
    late: Boolean(due) && live && due < today,
    soon: Boolean(due) && live && days !== null && days >= 0 && days <= 14,
  };
}

/**
 * The order the jobs get done in, as written on the list; the sort is stable,
 * so only not-applicable jobs move, to the bottom, out of the way.
 */
function inOrder(a, b) {
  return a.na === b.na ? 0 : a.na ? 1 : -1;
}

/**
 * Bring an event's checklist up to the standard list without losing anything
 * done on it:
 *  - old wording is renamed, and the tick stays with it;
 *  - jobs it is missing are added;
 *  - a job for another kind of event (an RBH job on an event without RBH in
 *    its title) goes, but only if nothing was done with it: not ticked, not
 *    ruled out, no date set on it;
 *  - the list takes the standard order. Jobs added to this event alone keep
 *    their own order, after the standard ones.
 * Changes `event.tasks` in place and returns what changed, in words.
 */
export async function syncToTemplate(event, now = new Date(), max = 60) {
  const template = await taskTemplate();
  const pos = new Map(template.map((t, i) => [named(t.what), i]));
  const tasks = event.tasks ?? [];
  const changes = { renamed: [], added: [], removed: [] };

  const names = new Set(tasks.map((t) => named(t.what)));
  for (const t of tasks) {
    const to = RENAMED[named(t.what)];
    if (!to || names.has(named(to))) continue;          // the new wording is already there: leave both alone
    changes.renamed.push({ from: t.what, to });
    names.delete(named(t.what));
    names.add(named(to));
    t.what = to;
  }

  const kept = tasks.filter((t) => {
    const std = template[pos.get(named(t.what))];
    if (!std || fitsTitle(std.onlyFor, event.title)) return true;
    const untouched = !t.done && !t.na && (t.daysBefore ?? null) === (std.daysBefore ?? null);
    if (untouched) changes.removed.push(t.what);
    return !untouched;
  });

  const have = new Set(kept.map((t) => named(t.what)));
  for (const t of template) {
    if (kept.length >= max) break;
    if (!fitsTitle(t.onlyFor, event.title) || have.has(named(t.what))) continue;
    kept.push(asTask(t, now.toISOString()));
    changes.added.push(t.what);
  }

  const rank = (t) => pos.get(named(t.what)) ?? template.length;
  event.tasks = kept.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).map(({ t }) => t);
  return changes;
}

/**
 * How far an event's checklist is from the standard list, worked out on a copy
 * so nothing is saved. `reordered` is true when the jobs it already has would
 * move.
 */
export async function behindTemplate(event) {
  const copy = { ...event, tasks: (event.tasks ?? []).map((t) => ({ ...t })) };
  const changes = await syncToTemplate(copy);
  const stays = new Set(copy.tasks.map((t) => t.id));
  const before = (event.tasks ?? []).filter((t) => stays.has(t.id)).map((t) => t.id).join();
  const old = new Set((event.tasks ?? []).map((t) => t.id));
  const after = copy.tasks.filter((t) => old.has(t.id)).map((t) => t.id).join();
  const reordered = before !== after;
  return { ...changes, reordered, any: Boolean(changes.renamed.length || changes.added.length || changes.removed.length || reordered) };
}

/** An event's checklist, in the order the jobs get done, with the tally a dashboard needs. */
export function checklistOf(event, today = todayIso()) {
  const tasks = (event.tasks ?? []).map((t) => dressed(t, event.dayOne, today, event.lastDay)).sort(inOrder);
  // "Not applicable" is a decision, not a job, so it is counted apart and never
  // counts against the total — three of four done should not read as three of five.
  const live = tasks.filter((t) => !t.na);
  return {
    tasks,
    counts: {
      total: live.length,
      done: live.filter((t) => t.done).length,
      late: live.filter((t) => t.late).length,
      soon: live.filter((t) => t.soon).length,
      undated: live.filter((t) => !t.scheduled).length,
      na: tasks.length - live.length,
    },
  };
}
