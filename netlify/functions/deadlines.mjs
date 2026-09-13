import { json, fail, requireAdmin } from "./lib/http.mjs";
import { deadlinesFor, formatDate, whyNotWorking, parseDate, OFFSETS } from "./lib/deadlines.mjs";

/**
 * Preview the three deadlines for a proposed day one, before the event exists,
 * and say which ones moved off a weekend or holiday and why.
 *
 *   GET /api/deadlines?dayOne=2027-03-03
 */
export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);

  const dayOne = new URL(req.url).searchParams.get("dayOne") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayOne)) return fail("dayOne must be YYYY-MM-DD.");

  const dates = deadlinesFor(dayOne);
  const moved = [];
  for (const [key, days] of Object.entries(OFFSETS)) {
    const raw = parseDate(dayOne);
    raw.setDate(raw.getDate() - days);
    const rawIso = `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, "0")}-${String(raw.getDate()).padStart(2, "0")}`;
    if (rawIso !== dates[key]) {
      const label = { agreement: "Agreement", draft: "Draft materials", final: "Final materials" }[key];
      moved.push(`${label}: ${formatDate(rawIso)} was a ${whyNotWorking(rawIso)}, so it moved to ${formatDate(dates[key])}.`);
    }
  }

  return json({
    dayOne,
    deadlines: dates,
    readable: {
      agreement: formatDate(dates.agreement),
      draft: formatDate(dates.draft),
      final: formatDate(dates.final),
    },
    moved,
  });
};
