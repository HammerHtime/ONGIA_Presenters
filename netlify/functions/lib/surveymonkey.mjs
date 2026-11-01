/**
 * SurveyMonkey, read only (Andrew 1 Nov 2026: "I can give you access to survey monkey so you can review all the data from
 * previous training events where we sent out surveys"). A private app on ONGIA's paid account, with View Surveys, View
 * Responses and View Response Details; its token is SURVEYMONKEY_TOKEN, a Netlify secret.
 *
 * Accounts live in one of three data centres and a token works only at its own, so the US one is tried first, then
 * Canada's and Europe's, and the one that answers is remembered for the life of the function.
 */
const HOSTS = ["https://api.surveymonkey.com", "https://api.surveymonkey.ca", "https://api.eu.surveymonkey.com"];
let found = null;

export const surveyMonkeyConfigured = () => Boolean(process.env.SURVEYMONKEY_TOKEN);

async function sm(path) {
  const token = process.env.SURVEYMONKEY_TOKEN;
  if (!token) { const e = new Error("SurveyMonkey isn't connected: SURVEYMONKEY_TOKEN isn't set in Netlify."); e.status = 409; throw e; }
  const hosts = found ? [found] : (process.env.SURVEYMONKEY_API ? [process.env.SURVEYMONKEY_API] : HOSTS);
  let last = null;
  for (const host of hosts) {
    const res = await fetch(`${host}/v3${path}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
    const body = await res.json().catch(() => ({}));
    if (res.ok) { found = host; return body; }
    last = { status: res.status, why: body.error?.message || `HTTP ${res.status}` };
    // A token from another data centre is refused as unauthorized; anything else is a real answer from the right one.
    if (res.status !== 401 && res.status !== 403) break;
  }
  const e = new Error(last.status === 401 || last.status === 403
    ? `SurveyMonkey refused the token (${last.why}). Check the app has View Surveys, View Responses and View Response Details, and that the token in Netlify is the app's current one.`
    : `SurveyMonkey: ${last.why}`);
  e.status = last.status;
  throw e;
}

/** Every survey on the account: id, title, created and last changed, and how many responses. */
export async function listSurveys({ max = 2000 } = {}) {
  const out = [];
  for (let page = 1; out.length < max; page++) {
    const got = await sm(`/surveys?per_page=100&page=${page}&include=response_count,date_created,date_modified,question_count`);
    const data = got.data ?? [];
    out.push(...data.map((s) => ({ id: s.id, title: s.title ?? "", created: String(s.date_created ?? "").slice(0, 10), modified: String(s.date_modified ?? "").slice(0, 10), responses: s.response_count ?? null, questions: s.question_count ?? null })));
    if (data.length < 100) break;
  }
  return out;
}

export const surveyMonkeyHost = () => found;
