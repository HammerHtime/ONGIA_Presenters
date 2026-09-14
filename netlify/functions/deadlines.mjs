import { json, fail, requireAdmin } from "./lib/http.mjs";
import { deadlinesFor, formatDate, whyNotWorking, parseDate, OFFSETS, offsetsOf, offsetsProblem } from "./lib/deadlines.mjs";

/**
 * Preview the three deadlines for a proposed day one, before the event exists,
 * and say which ones moved off a weekend or holiday and why.
 *
 *   GET /api/deadlines?dayOne=2027-03-03&agreement=60&draft=35&final=21
 *
 * The three offsets are optional; each falls back to ONGIA's default.
 */
export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);

  const q = new URL(req.url).searchParams;
  const dayOne = q.get("dayOne") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayOne)) return fail("dayOne must be YYYY-MM-DD.");

  const asked = {};
  for (const k of ["agreement", "draft", "final"]) {
    const v = q.get(k);
    if (v !== null && v !== "") asked[k] = Math.round(Number(v));
  }
  const offsets = offsetsOf({ offsets: { ...OFFSETS, ...asked } });
  const trouble = offsetsProblem({ ...offsets, ...asked });
  if (trouble) return fail(trouble);

  const dates = deadlinesFor(dayOne, offsets);
  const moved = [];
  for (const [key, days] of Object.entries(offsets)) {
    const raw = parseDate(dayOne);
    raw.setDate(raw.getDate() - days);
    const rawIso = `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, "0")}-${String(raw.getDate()).padStart(2, "0")}`;
    if (rawIso !== dates[key]) {
      const label = { agreement: "Agreement", draft: "Draft materials", final: "Final materials" }[key];
      const why = whyNotWorking(rawIso);
      const on = why === "weekend" ? "fell on a weekend" : why === "Christmas shutdown" ? "fell in the Christmas shutdown" : `fell on ${why}`;
      moved.push(`${label}: ${formatDate(rawIso)} ${on}, so it moved to ${formatDate(dates[key])}.`);
    }
  }

  return json({
    dayOne,
    offsets,
    deadlines: dates,
    readable: {
      agreement: formatDate(dates.agreement),
      draft: formatDate(dates.draft),
      final: formatDate(dates.final),
    },
    moved,
  });
};
