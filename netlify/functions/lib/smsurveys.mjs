/**
 * ONGIA's past training surveys on SurveyMonkey, turned into the same survey figures the desk's own surveys give, so the
 * year reports can state how each training was rated (Andrew 2 Nov 2026: "yes build it").
 *
 * Only SurveyMonkey's rollups are read: each question's answers added up per choice. No response, respondent or comment
 * text is fetched or kept.
 *
 *   summarizeSurvey(details, rollups)  one survey's rating, measures, sessions and wished-for topics
 *   matchSurveys(rows, surveys)        which surveys belong to which training (date, title words, city, day number)
 *   combineSurveys(summaries)          a training's surveys (Regina's day 1 and day 2) as one survey figure
 *   surveySummaries(list)              every survey's summary, kept in the store and fetched again only when it changes
 *
 * Scales: a choice is scored 1 to 5 from its words (Excellent/Good/Average/Poor/Very poor, Very satisfied … Very
 * dissatisfied, Strongly agree … Strongly disagree, Very likely … Unlikely); a star or number rating with no words from its
 * weight. "N/A" and anything unrecognised is not scored, and a question with no scored choices is left out.
 */
import { getMeta, putMeta } from "./store.mjs";
import { surveyDetails, surveyRollups, surveyMonkeyConfigured, listSurveys } from "./surveymonkey.mjs";

const WORDS = [
  [5, /^(excellent|outstanding|very satisfied|extremely satisfied|strongly agree|very likely|extremely likely|extremely (useful|valuable|relevant)|very (useful|valuable|relevant|good)|yes\s*[-–]\s*significant|very effective|very confident|extremely confident)/],
  [4, /^(good|satisfied|agree|likely|useful|valuable|relevant|above average|yes\s*[-–]\s*some|effective|confident)/],
  [3, /^(average|neutral|neither|somewhat likely|fair|okay|ok|somewhat (useful|valuable|relevant|satisfied))/],
  [1, /^(very poor|very dissatisfied|extremely dissatisfied|strongly disagree|very unlikely|extremely unlikely|no value|not at all|very ineffective|not at all confident)/],
  [2, /^(poor|dissatisfied|disagree|unlikely|somewhat unlikely|below average|limited value|ineffective|not (very )?(useful|valuable|relevant|confident))/],
];
export function scoreOfLabel(text) {
  const t = String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!t || /^n\/?a\b|not applicable|did not attend|didn't attend/.test(t)) return null;
  for (const [s, re] of WORDS) if (re.test(t)) return s;
  return null;
}

// What a question measures, from its heading. Order matters: the first that matches wins.
const MEASURES = [
  { id: "quality", re: /overall|experience/i, en: "Overall rating", fr: "Évaluation globale" },
  { id: "return", re: /likely .*attend|attend .*(future|again)|recommend/i, en: "Would come to another ONGIA training", fr: "Reviendraient à une formation de l'ONGIA" },
  { id: "relevance", re: /relevan/i, en: "Relevant to their work", fr: "Pertinent pour leur travail" },
  { id: "expectations", re: /expectation/i, en: "Met their expectations", fr: "Ont répondu à leurs attentes" },
  { id: "presenters", re: /present(er|ation)|speaker|delivery|engaging|knowledgeable/i, en: "Presenters", fr: "Présentateurs" },
  { id: "knowledge", re: /knowledge|understanding|learn/i, en: "Improved their knowledge", fr: "Ont amélioré leurs connaissances" },
  { id: "practical", re: /practical|apply|useful/i, en: "Practical value for their work", fr: "Utilité pratique pour leur travail" },
  { id: "topics", re: /range of topics|topics covered/i, en: "Range of topics", fr: "Éventail des sujets" },
  { id: "venue", re: /venue|event space|location|facilit|hotel|room|food|catering/i, en: "Venue", fr: "Lieu" },
];
const measureOf = (heading) => MEASURES.find((m) => m.re.test(heading)) ?? null;

/** "Rate the presentation by Pat Lee on 'Gangs 101'." → { presenters, title } */
export function sessionOf(heading) {
  const m = String(heading).match(/rate the presentation (?:by|from)\s+(.+?)\s+on\s+['‘’"“”](.+?)['‘’"“”]\s*\.?\s*$/i);
  return m ? { presenters: m[1].trim(), title: m[2].trim() } : null;
}

/** The scored answers of one question (or one matrix row): { n, sum, top2n } over choices with a score. */
function scored(choices, counts) {
  // Labels that are only numbers ("1" to "5") are a number scale: scored by weight, like stars.
  const words = choices.some((c) => String(c.text ?? "").trim() && !/^\d+(\.\d+)?$/.test(String(c.text).trim()));
  let n = 0, sum = 0, top2n = 0;
  for (const c of choices) {
    const k = counts.get(c.id) ?? 0;
    if (!k) continue;
    let s = words ? scoreOfLabel(c.text) : null;
    // A star or number scale with no words: its weight, 1 to 5 (0 is N/A). A 1–10 scale is brought to 5.
    if (!words) { const w = Number(c.weight ?? c.position); const max = Math.max(...choices.map((x) => Number(x.weight ?? x.position) || 0)); if (w > 0 && max >= 3) s = max === 5 ? w : 1 + ((w - 1) * 4) / (max - 1); }
    if (s === null || s === undefined) continue;
    n += k; sum += k * s; if (s >= 4) top2n += k;
  }
  return { n, sum, top2n };
}

/** One survey: its figures in the desk survey's shape, from its questions and rollups. Counts and averages only. */
export function summarizeSurvey(details, rollups) {
  const R = new Map((rollups ?? []).map((r) => [String(r.id), r]));
  const byMeasure = new Map(), sessions = [], asked = [];
  let all = { n: 0, sum: 0, top2n: 0 };
  const add = (m, x) => { if (!m || !x.n) return; const g = byMeasure.get(m.id) ?? { ...m, n: 0, sum: 0, top2n: 0 }; g.n += x.n; g.sum += x.sum; g.top2n += x.top2n; byMeasure.set(m.id, g); };
  for (const q of details.questions ?? []) {
    const r = R.get(String(q.id)), s = r?.summary?.[0];
    if (!s) continue;
    if (q.family === "multiple_choice" && /topic|would you (have )?like|interest/i.test(q.heading)) {
      const counts = new Map((s.choices ?? []).map((c) => [String(c.id), c.count ?? 0]));
      for (const c of q.choices) { const k = counts.get(String(c.id)) ?? 0; if (k && !/^other/i.test(c.text)) asked.push({ text: c.text, count: k }); }
      continue;
    }
    if (q.family !== "single_choice" && q.family !== "matrix") continue;
    const lines = q.family === "matrix" ? (s.rows ?? []).map((w) => ({ row: q.rows.find((x) => String(x.id) === String(w.id)), counts: new Map((w.choices ?? []).map((c) => [String(c.id), c.count ?? 0])) }))
      : [{ row: null, counts: new Map((s.choices ?? []).map((c) => [String(c.id), c.count ?? 0])) }];
    const session = sessionOf(q.heading);
    for (const { row, counts } of lines) {
      const x = scored(q.choices.map((c) => ({ ...c, id: String(c.id) })), counts);
      if (!x.n) continue;
      const heading = row?.text ? `${q.heading} ${row.text}` : q.heading;
      all = { n: all.n + x.n, sum: all.sum + x.sum, top2n: all.top2n + x.top2n };
      add(session ? MEASURES.find((m) => m.id === "presenters") : measureOf(heading), x);
      if (session) sessions.push({ title: session.title, presenters: session.presenters, n: x.n, mean: round1(x.sum / x.n), top2: Math.round((100 * x.top2n) / x.n) });
      // "Rate the following presenters", one row per presenter.
      else if (row?.text && /presenter|speaker/i.test(q.heading)) sessions.push({ title: row.text, presenters: row.text, n: x.n, mean: round1(x.sum / x.n), top2: Math.round((100 * x.top2n) / x.n) });
    }
  }
  const scoring = [...byMeasure.values()].map((g) => ({ id: g.id, en: g.en, fr: g.fr, n: g.n, mean: round1(g.sum / g.n), top2: Math.round((100 * g.top2n) / g.n) }));
  const q = scoring.find((g) => g.id === "quality");
  return {
    id: String(details.id), title: details.title ?? "", responses: details.responses ?? 0,
    // The rating: the survey's overall question where it asked one; otherwise every rated answer on it, averaged.
    quality: q ? { n: q.n, mean: q.mean, top2: q.top2, basis: "overall" } : all.n ? { n: details.responses || all.n, mean: round1(all.sum / all.n), top2: Math.round((100 * all.top2n) / all.n), basis: "all" } : null,
    scoring, sessions, asked,
  };
}
const round1 = (x) => Math.round(x * 10) / 10;

/** A training's surveys as one: responses added, the rating and measures weighted by answers, sessions listed once. */
export function combineSurveys(list) {
  const s = (list ?? []).filter(Boolean);
  if (!s.length) return null;
  const wavg = (items) => { const n = items.reduce((a, x) => a + x.n, 0); return n ? { n, mean: round1(items.reduce((a, x) => a + x.mean * x.n, 0) / n), top2: Math.round(items.reduce((a, x) => a + x.top2 * x.n, 0) / n) } : null; };
  const qs = s.map((x) => x.quality).filter(Boolean);
  const overall = qs.filter((x) => x.basis === "overall");
  const quality = wavg(overall.length ? overall : qs);
  const byId = new Map();
  for (const x of s) for (const g of x.scoring) { const a = byId.get(g.id) ?? { id: g.id, en: g.en, fr: g.fr, items: [] }; a.items.push(g); byId.set(g.id, a); }
  const asked = new Map();
  for (const x of s) for (const a of x.asked) asked.set(a.text, (asked.get(a.text) ?? 0) + a.count);
  return {
    source: "surveymonkey", surveys: s.map((x) => ({ id: x.id, title: x.title, responses: x.responses })),
    // People who answered: the busiest survey's count (the same person may answer day 1 and day 2); responses: all of them.
    answered: Math.max(...s.map((x) => x.responses)), responses: s.reduce((a, x) => a + x.responses, 0), invited: 0,
    quality: quality ? { ...quality, basis: overall.length ? "overall" : "all" } : null,
    scoring: [...byId.values()].map((a) => ({ id: a.id, en: a.en, fr: a.fr, ...wavg(a.items) })),
    sessions: s.flatMap((x) => x.sessions).map((x) => ({ ...x, top1: null })),
    comments: [], topics: [...asked].sort((a, b) => b[1] - a[1]).map(([text, count]) => `${text} (${count})`),
  };
}

/* ---------- Which survey belongs to which training ---------- */

// Not an evaluation of a training: pre/follow-up surveys, presenters' and members' surveys, planning polls.
const NOT_TRAINING = /pre-?training|follow[- ]?up|presenter|^untitled$|\brbh\b|board|member(ship)?|volunteer|retreat|strategic|wants (your opinion|to hear)|hear from you|choice|questions/i;
const STOP = new Set("the and for with from a an of to in on at by de la le et des du ongia training symposium conference day event survey evaluation feedback session 2017 2018 2019 2020 2021 2022 2023 2024 2025 2026 2027".split(" "));
const words = (t) => new Set(String(t ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));
const dayNo = (t) => { const m = String(t).match(/\bday\s*(\d)\b/i); return m ? Number(m[1]) : null; };
const ms = (d) => Date.parse(String(d).slice(0, 10));

/**
 * Each survey goes to the one training it fits best: made from 21 days before the training to 30 days after it, sharing
 * title words or the city, and (for a "Day 3" survey) a training at least that many days long. `rows` are the year's
 * trainings ({ id, title, city, dayOne, lastDay, days }); `surveys` are listSurveys() items. Returns Map(rowId → [survey]).
 */
export function matchSurveys(rows, surveys) {
  const out = new Map();
  for (const s of surveys) {
    // Fewer than three answers is not a rating (a two-person workshop survey once matched a Calgary symposium).
    if (!s.responses || s.responses < 3 || NOT_TRAINING.test(s.title)) continue;
    const sw = words(s.title), n = dayNo(s.title), made = ms(s.created), conf = /conference/i.test(s.title);
    let best = null;
    for (const r of rows) {
      // Surveys are often built weeks ahead (the 2023 conference's a month before it): 45 days before, 30 after; a title
      // that shares three or more words (Turf Wars, built six months ahead) any time that year.
      const strong = [...sw].filter((w) => words(r.title).has(w)).length >= 3;
      const from = ms(r.dayOne) - (strong ? 240 : 45) * 864e5, to = ms(r.lastDay || r.dayOne) + 30 * 864e5;
      if (!(made >= from && made <= to)) continue;
      if (n && (r.days ?? 1) < n) continue;
      // "2022 ONGIA Conference - Day 3": the year's conference, the multi-day training of the season.
      if (conf && (r.days ?? 1) >= 2) { const score = 2 + (r.days ?? 1) / 10 - Math.abs(made - ms(r.dayOne)) / (864e5 * 30); if (!best || score > best.score) best = { r, score }; continue; }
      const rw = words(r.title), city = String(r.city ?? "").split(",")[0].trim().toLowerCase();
      // "ITP Training" and "Illicit Trade Prevention …": a short capitalised name in the training's title spelled out in the survey's.
      const initials = String(s.title).split(/[^A-Za-z]+/).filter((w) => w.length > 2 && !STOP.has(w.toLowerCase())).map((w) => w[0].toLowerCase()).join("");
      const acronym = (String(r.title).match(/\b[A-Z]{2,5}\b/g) ?? []).some((a) => a !== "ONGIA" && initials.includes(a.toLowerCase()));
      const shared = [...sw].filter((w) => rw.has(w)).length + (acronym ? 1 : 0);
      const cityHit = city && String(s.title).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(city.normalize("NFD").replace(/[̀-ͯ]/g, ""));
      if (!shared && !cityHit) continue;
      const score = shared * 3 + (cityHit ? 4 : 0) - Math.abs(made - ms(r.dayOne)) / (864e5 * 30);
      if (!best || score > best.score) best = { r, score };
    }
    if (best) { const a = out.get(best.r.id) ?? []; a.push(s); out.set(best.r.id, a); }
  }
  return out;
}

/* ---------- Reading and keeping ---------- */

/**
 * Every survey's summary, read from SurveyMonkey once and kept (`sm:survey:<id>`); read again only when its response
 * count has changed. At most `budget` surveys are fetched in one run (two calls each), so a first reading stays well
 * inside the app's 500 calls a day; the rest are read on the next run.
 */
export async function surveySummaries(list, { budget = 90, fetchOne = null } = {}) {
  const out = new Map();
  let fetched = 0, skipped = 0;
  for (const s of list) {
    if (!s.responses || NOT_TRAINING.test(s.title)) continue;
    const key = `sm:survey:${s.id}`;
    const kept = await getMeta(key);
    if (kept && kept.responses === s.responses && kept.v === 1) { out.set(String(s.id), kept); continue; }
    if (fetched >= budget) { skipped++; if (kept) out.set(String(s.id), kept); continue; }
    fetched++;
    try {
      const sum = fetchOne ? await fetchOne(s) : summarizeSurvey(...(await Promise.all([surveyDetails(s.id), surveyRollups(s.id)])));
      const keep = { ...sum, responses: s.responses, v: 1, at: new Date().toISOString() };
      await putMeta(key, keep);
      out.set(String(s.id), keep);
    } catch (e) { console.error("SurveyMonkey survey not read", s.id, e?.message); if (kept) out.set(String(s.id), kept); if (e?.status === 429) break; }
  }
  return { summaries: out, fetched, skipped };
}

/** The year's trainings with their SurveyMonkey figures: Map(rowId → combined survey). Nothing if it isn't connected. */
export async function surveysForRows(rows, { list = null, budget = 90, fetchOne = null } = {}) {
  if (!list && !surveyMonkeyConfigured()) return { byRow: new Map(), note: "not connected" };
  const all = list ?? (await listSurveys());
  const matched = matchSurveys(rows, all);
  const wanted = [...matched.values()].flat();
  const { summaries, fetched, skipped } = await surveySummaries(wanted, { budget, fetchOne });
  const byRow = new Map();
  for (const [rowId, ss] of matched) {
    const got = ss.map((s) => summaries.get(String(s.id))).filter(Boolean);
    const c = combineSurveys(got);
    if (c) byRow.set(rowId, c);
  }
  return { byRow, fetched, skipped, note: skipped ? `${skipped} surveys still to read` : "" };
}
