import { getMeta } from "./store.mjs";
import { token } from "./ids.mjs";
import { deadline, whyNotWorking, todayIso, formatDate } from "./deadlines.mjs";

/**
 * The jobs that are ONGIA's rather than a presenter's. Every one is stored as
 * days before day one of the training — negative means after it — so moving
 * the training moves the whole checklist with it.
 *
 * This is where a desk starts. Once Andrew edits the list it is saved under
 * meta:eventtasks and his version is what new events get.
 */
export const STARTER = [
  // Andrew's list, in the order he gave it, with the SOW first because he said
  // it comes first. Only two carry a date — the two he actually named. The rest
  // have none until he sets one, because a date nobody chose is a date nobody
  // trusts. The list re-sorts itself as dates get filled in.
  { what: "SOW sent to RBH", daysBefore: null },
  { what: "RFP sent out", daysBefore: null },
  { what: "Contract signed", daysBefore: null },
  { what: "Wix event set up and ready", daysBefore: null },
  { what: "Car rental booked", daysBefore: null },
  { what: "Presenter and hotel guest names given to the hotel", daysBefore: null },
  { what: "Food ordered and arranged", daysBefore: null },
  { what: "AV confirmed and arranged", daysBefore: null },
  { what: "Board members attending confirmed", daysBefore: null },
  { what: "Welcome letter sent to attendees", daysBefore: 7, auto: "welcome" },
  { what: "Survey link sent to attendees", daysBefore: -2, auto: "survey" },
];

/** The desk's own list, or the starter one until it has saved its own. */
export async function taskTemplate() {
  const saved = await getMeta("eventtasks");
  return Array.isArray(saved?.tasks) && saved.tasks.length ? saved.tasks : STARTER;
}

/** The same list, ready to sit on a brand-new event. */
export async function starterTasks(now = new Date()) {
  const at = now.toISOString();
  return (await taskTemplate()).map((t) => ({
    id: token(8), what: t.what, daysBefore: t.daysBefore, auto: t.auto,
    done: false, doneAt: null, na: false, addedAt: at,
  }));
}

const addDays = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

/**
 * A job before the training moves earlier onto a working day, exactly like the
 * other deadlines. A job after it moves later instead — stepping an after-job
 * backwards could land it before the event it is meant to follow.
 */
export function taskDue(dayOne, daysBefore) {
  if (daysBefore >= 0) return deadline(dayOne, daysBefore);
  let d = addDays(dayOne, -daysBefore);
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
export function dressed(task, dayOne, today = todayIso()) {
  const scheduled = Number.isFinite(task.daysBefore);
  const due = scheduled && dayOne ? taskDue(dayOne, task.daysBefore) : null;
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
 * Dated jobs in date order, then the ones with no date yet in the order they
 * were written down. Not-applicable jobs sink to the bottom of their group.
 */
function inOrder(a, b) {
  if (a.na !== b.na) return a.na ? 1 : -1;
  if (a.scheduled !== b.scheduled) return a.scheduled ? -1 : 1;
  if (!a.scheduled) return 0;
  return b.daysBefore - a.daysBefore;
}

/** An event's checklist, earliest first, with the tally a dashboard needs. */
export function checklistOf(event, today = todayIso()) {
  const tasks = (event.tasks ?? []).map((t) => dressed(t, event.dayOne, today)).sort(inOrder);
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
