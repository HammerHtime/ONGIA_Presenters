import { json, fail, requireAdmin } from "./lib/http.mjs";
import { listSurveys, surveyMonkeyConfigured, surveyMonkeyHost } from "./lib/surveymonkey.mjs";

/**
 * What ONGIA's SurveyMonkey account holds, to match past training surveys to their events (Andrew 1 Nov 2026). Admin
 * only, read only, and in totals: each survey's title, dates and how many responded, never an answer or a respondent.
 *
 *   GET /api/surveymonkey        every survey, newest first, with totals by year
 */
export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  if (req.method !== "GET") return fail("Method not allowed.", 405);
  if (!surveyMonkeyConfigured()) return fail("SurveyMonkey isn't connected: SURVEYMONKEY_TOKEN isn't set in Netlify.", 409);
  let surveys;
  try { surveys = await listSurveys(); }
  catch (e) { return fail(e.message, e.status === 401 || e.status === 403 ? 403 : e.status === 409 ? 409 : 502); }
  surveys.sort((a, b) => String(b.created).localeCompare(String(a.created)));
  const years = {};
  for (const s of surveys) { const y = s.created.slice(0, 4) || "undated"; const Y = (years[y] ??= { surveys: 0, responses: 0 }); Y.surveys++; Y.responses += s.responses ?? 0; }
  return json({ connected: true, dataCentre: surveyMonkeyHost(), surveys: surveys.length, responses: surveys.reduce((n, s) => n + (s.responses ?? 0), 0), years, list: surveys });
};
