/**
 * Deadline arithmetic for ONGIA training events.
 *
 * Every deadline counts back from day one of the training, then steps backwards
 * until it lands on a day people are actually at work: not a weekend, not a
 * statutory holiday, not the day a weekend holiday is observed, and not inside
 * the Christmas–New Year shutdown.
 *
 * Deadlines only ever move EARLIER, never later, so a presenter never loses
 * preparation time to a holiday. A gap can therefore stretch — 60 days becomes
 * 70 if it lands in the shutdown — which is the correct trade.
 *
 * Presenters sit in different provinces, so the holiday list is deliberately
 * generous: a deadline that shifts a day or two early costs nothing, a deadline
 * nobody reads costs a chase.
 */

export const OFFSETS = {
  agreement: 90, // signed agreement back
  draft: 50, // draft materials for review
  final: 30, // final, production-ready materials
};

const SHUTDOWN_FROM = [12, 24]; // inclusive
const SHUTDOWN_TO = [1, 1]; // inclusive

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

/** Parse YYYY-MM-DD as a local date, avoiding the UTC-shift trap. */
export function parseDate(value) {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const [y, m, d] = String(value).split("-").map(Number);
  return new Date(y, m - 1, d);
}

const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Anonymous Gregorian algorithm — the anchor for Good Friday and Easter Monday. */
function easter(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function nthWeekday(year, month, weekday, n) {
  const first = new Date(year, month - 1, 1);
  const shift = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month - 1, 1 + shift + (n - 1) * 7);
}

function lastWeekdayBefore(year, month, day, weekday) {
  let d = new Date(year, month - 1, day - 1);
  while (d.getDay() !== weekday) d = addDays(d, -1);
  return d;
}

/**
 * Holidays observed somewhere material to ONGIA's audience. Wider than the five
 * that are statutory nationwide, because presenters come from every province.
 */
export function holidays(year) {
  const e = easter(year);
  const named = new Map([
    [iso(new Date(year, 0, 1)), "New Year's Day"],
    [iso(nthWeekday(year, 2, 1, 3)), "Family Day"],
    [iso(addDays(e, -2)), "Good Friday"],
    [iso(addDays(e, 1)), "Easter Monday"],
    [iso(lastWeekdayBefore(year, 5, 25, 1)), "Victoria Day"],
    [iso(new Date(year, 6, 1)), "Canada Day"],
    [iso(nthWeekday(year, 8, 1, 1)), "Civic Holiday"],
    [iso(nthWeekday(year, 9, 1, 1)), "Labour Day"],
    [iso(new Date(year, 8, 30)), "Truth and Reconciliation"],
    [iso(nthWeekday(year, 10, 1, 2)), "Thanksgiving"],
    [iso(new Date(year, 10, 11)), "Remembrance Day"],
    [iso(new Date(year, 11, 25)), "Christmas Day"],
    [iso(new Date(year, 11, 26)), "Boxing Day"],
  ]);
  // A holiday falling on a weekend is observed the following Monday.
  for (const [key, name] of [...named]) {
    const d = parseDate(key);
    if (d.getDay() === 0 || d.getDay() === 6) {
      const observed = addDays(d, d.getDay() === 0 ? 1 : 2);
      if (!named.has(iso(observed))) named.set(iso(observed), `${name} (observed)`);
    }
  }
  return named;
}

function inShutdown(d) {
  const md = [d.getMonth() + 1, d.getDate()];
  const after = md[0] > SHUTDOWN_FROM[0] || (md[0] === SHUTDOWN_FROM[0] && md[1] >= SHUTDOWN_FROM[1]);
  const before = md[0] < SHUTDOWN_TO[0] || (md[0] === SHUTDOWN_TO[0] && md[1] <= SHUTDOWN_TO[1]);
  return after || before;
}

/** Why this date isn't a working day, or null if it is one. */
export function whyNotWorking(date) {
  const d = parseDate(date);
  if (d.getDay() === 0 || d.getDay() === 6) return "weekend";
  if (inShutdown(d)) return "Christmas shutdown";
  return holidays(d.getFullYear()).get(iso(d)) ?? null;
}

/** Days before day one, stepped back to a day people are actually working. */
export function deadline(dayOne, daysBefore) {
  let d = addDays(parseDate(dayOne), -daysBefore);
  for (let guard = 0; guard < 40; guard++) {
    if (!whyNotWorking(d)) return iso(d);
    d = addDays(d, -1);
  }
  throw new Error("No working day found within 40 days — check the event date.");
}

/** All three deadlines for an event, derived from day one of the training. */
export function deadlinesFor(dayOne) {
  return {
    agreement: deadline(dayOne, OFFSETS.agreement),
    draft: deadline(dayOne, OFFSETS.draft),
    final: deadline(dayOne, OFFSETS.final),
  };
}

/** "Thu 3 Dec 2026" — how dates read to presenters. */
export function formatDate(value) {
  if (!value) return "";
  const d = parseDate(value);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/** The event plus the human-readable dates the emails and PDF quote. */
export function describeEvent(event) {
  return {
    ...event,
    dayOneReadable: formatDate(event.dayOne),
    lastDayReadable: formatDate(event.lastDay),
    deadlinesReadable: {
      agreement: formatDate(event.deadlines.agreement),
      draft: formatDate(event.deadlines.draft),
      final: formatDate(event.deadlines.final),
    },
  };
}
