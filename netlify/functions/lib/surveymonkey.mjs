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

// What gets pasted is not always just the token: a space or line break either side, "Bearer " in front, quotes.
export const cleanToken = (raw) => String(raw ?? "").trim().replace(/^["']|["']$/g, "").replace(/^bearer\s+/i, "").trim();
// What a refused token looks like, never what it is: enough to tell a Client ID or a masked "•••" copy from a real token.
export function tokenShape(raw) {
  const t = cleanToken(raw);
  const odd = [...t].filter((c) => !/[A-Za-z0-9._\-]/.test(c)).length;
  return `${t.length} characters${odd ? `, ${odd} of them not letters, digits, dots or dashes` : ""}${t.length !== String(raw ?? "").length ? ", after removing spaces or quotes around it" : ""}`;
}
export const surveyMonkeyConfigured = () => Boolean(cleanToken(process.env.SURVEYMONKEY_TOKEN));

async function sm(path) {
  const token = cleanToken(process.env.SURVEYMONKEY_TOKEN);
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
    ? `SurveyMonkey refused the token (${last.why}). The token in Netlify is ${tokenShape(process.env.SURVEYMONKEY_TOKEN)}; a SurveyMonkey access token is a long run of letters, digits and dashes. Copy the Access Token from the app's Settings page (not the Client ID or Secret) and check the app has View Surveys, View Responses and View Response Details.`
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

/** One survey's questions: heading, family and subtype, and the answer choices or rating labels. No answers. */
export async function surveyDetails(id) {
  const d = await sm(`/surveys/${encodeURIComponent(id)}/details`);
  const questions = [];
  for (const page of d.pages ?? []) for (const q of page.questions ?? []) {
    questions.push({ id: q.id, heading: plainHeading(q.headings?.[0]?.heading), family: q.family, subtype: q.subtype,
      rows: (q.answers?.rows ?? []).map((r) => ({ id: r.id, text: plainHeading(r.text) })),
      choices: (q.answers?.choices ?? []).map((c) => ({ id: c.id, text: plainHeading(c.text), weight: c.weight ?? null, position: c.position ?? null })) });
  }
  return { id: d.id, title: d.title ?? "", responses: d.response_count ?? null, questions };
}

/** The survey's answers added up per question and choice (SurveyMonkey's rollups): counts only, never a response. */
export async function surveyRollups(id) {
  const out = [];
  for (let page = 1; page < 20; page++) {
    const got = await sm(`/surveys/${encodeURIComponent(id)}/rollups?per_page=100&page=${page}`);
    out.push(...(got.data ?? []));
    if ((got.data ?? []).length < 100) break;
  }
  return out;
}

export const plainHeading = (h) => String(h ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
