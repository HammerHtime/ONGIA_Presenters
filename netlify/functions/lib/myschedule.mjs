/**
 * A board member's own work schedule, shown on the year calendar (Andrew 28 Nov 2026: "include my schedule in the top
 * right corner of each day? N for nights, D for days, O for off … I work a 7 on, 7 off schedule"). A rotation that
 * repeats: its letters, one a day (D days, N nights, O off), from a day it starts on. Kept per person in the desk's own
 * store (meta:schedule:<who>), never in this repository, and shown only to that person.
 */
const DAY = 86400000;
const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? "")) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** { pattern: "DDDDDDDOOOOOOONNNNNNNOOOOOOO", start: "2026-11-13" }, or null if it isn't one. */
export function cleanSchedule(v) {
  const pattern = String(v?.pattern ?? "").toUpperCase().replace(/[^DNO]/g, "").slice(0, 120);
  const start = String(v?.start ?? "").trim();
  if (!pattern || !isIso(start)) return null;
  return { pattern, start };
}

/** "D", "N", "O", or "" with no schedule. */
export function shiftOn(sched, iso) {
  if (!sched?.pattern || !isIso(sched.start) || !isIso(iso)) return "";
  const n = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${sched.start}T00:00:00Z`)) / DAY);
  const len = sched.pattern.length;
  return sched.pattern[((n % len) + len) % len];
}

/** "7 days, 7 off, 7 nights, 7 off" for the summary line. */
export function describe(sched) {
  if (!sched?.pattern) return "";
  const runs = sched.pattern.match(/D+|N+|O+/g) ?? [];
  return runs.map((r) => `${r.length} ${({ D: "days", N: "nights", O: "off" })[r[0]]}`).join(", ");
}
