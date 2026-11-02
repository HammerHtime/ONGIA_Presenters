import { json, fail, requireAdmin } from "./lib/http.mjs";
import { listSurveys, surveyMonkeyConfigured, surveyMonkeyHost, surveyDetails, surveyRollups } from "./lib/surveymonkey.mjs";

/**
 * What ONGIA's SurveyMonkey account holds, to match past training surveys to their events (Andrew 1 Nov 2026). Admin
 * only, read only, and in totals: each survey's title, dates and how many responded, never an answer or a respondent.
 *
 *   GET /api/surveymonkey        every survey, newest first, with totals by year
 *   GET /api/surveymonkey?id=…   one survey's questions and its answers added up per choice (counts, no responses or text)
 */
export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  if (req.method !== "GET") return fail("Method not allowed.", 405);
  if (!surveyMonkeyConfigured()) return fail("SurveyMonkey isn't connected: SURVEYMONKEY_TOKEN isn't set in Netlify.", 409);
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    if (!/^\d{1,15}$/.test(id)) return fail("Which survey?");
    try {
      const [details, rollups] = await Promise.all([surveyDetails(id), surveyRollups(id)]);
      // Open-ended rollups can carry sample text: keep only the counts.
      const counts = rollups.map((r) => ({ id: r.id, family: r.family, subtype: r.subtype, summary: (r.summary ?? []).map((s) => ({ answered: s.answered, skipped: s.skipped,
        choices: (s.choices ?? []).map((c) => ({ id: c.id, count: c.count })), rows: (s.rows ?? []).map((w) => ({ id: w.id, choices: (w.choices ?? []).map((c) => ({ id: c.id, count: c.count })), stats: w.stats ?? null })), stats: s.stats ?? null })) }));
      return json({ ...details, rollups: counts });
    } catch (e) { return fail(e.message, e.status === 401 || e.status === 403 ? 403 : 502); }
  }
  let surveys;
  try { surveys = await listSurveys(); }
  catch (e) { return fail(e.message, e.status === 401 || e.status === 403 ? 403 : e.status === 409 ? 409 : 502); }
  surveys.sort((a, b) => String(b.created).localeCompare(String(a.created)));
  const years = {};
  for (const s of surveys) { const y = s.created.slice(0, 4) || "undated"; const Y = (years[y] ??= { surveys: 0, responses: 0 }); Y.surveys++; Y.responses += s.responses ?? 0; }
  return json({ connected: true, dataCentre: surveyMonkeyHost(), surveys: surveys.length, responses: surveys.reduce((n, s) => n + (s.responses ?? 0), 0), years, list: surveys });
};
