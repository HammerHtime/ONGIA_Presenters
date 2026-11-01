import Anthropic from "@anthropic-ai/sdk";
import { anthropicKey } from "./contract.mjs";
import { getMeta, putMeta, getAttendees, listEvents, listPresenters } from "./store.mjs";
import { writeableTo } from "./attendees.mjs";
import { directory, agencyOf, PROVINCES } from "./agencies.mjs";
import { certIndex } from "./certs.mjs";
import { factsFor, newDoc, PDF_LOOK } from "./reports.mjs";
import { formatLong } from "./deadlines.mjs";

/**
 * The RBH year end (Andrew 31 Oct 2026): an Executive Summary and a one-page infographic for the whole calendar year,
 * January to December, in English and French, for RBH's senior people. They support the partnership: every RBH training
 * ONGIA put on that year, how many people came, the agencies and provinces reached, what ONGIA's members were told about
 * the trainings, what attendees thought, and what is booked for the year after.
 *
 * As with the event reports, every figure is worked out here and Claude only writes around them. Two figures can't be
 * known from the desk and are typed in once a year: how many members are in ONGIA's database and how many email
 * campaigns went out about RBH events. ONGIA never posts about RBH on social media, so there is nothing about it here.
 */

export const YE_KINDS = {
  exec: { en: "Executive Summary", fr: "Sommaire exécutif" },
  info: { en: "Infographic", fr: "Infographie" },
};
// Where the year-end PDFs are filed in the SharePoint library; {year} is replaced. RBH_YEAREND_FOLDER changes it.
export const yearFolder = (year) => (process.env.RBH_YEAREND_FOLDER || "RBH/Year end {year}").replace("{year}", String(year));
export const yearFileName = (kind, lang, year) => `${YE_KINDS[kind][lang]} ${year}.pdf`;

const SPONSOR = "Rothmans, Benson & Hedges";
const pctOf = (a, b) => (b ? Math.round((100 * a) / b) : 0);
export const yearOf = (e) => String(e?.dayOne ?? "").slice(0, 4);
const isRbh = (e) => e?.kind === "rbh" && !e?.practice;
const daysOf = (e) => {
  const a = Date.parse(e.dayOne), b = Date.parse(e.lastDay || e.dayOne);
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 86400000) + 1 : 1;
};
const cityOf = (e) => String(e.city ?? "").split(",")[0].trim();
// "Montréal" and "Montreal" are one city.
const cityKey = (c) => String(c ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const today = () => new Date().toISOString().slice(0, 10);

/* ---------- The two figures typed in once a year ---------- */

export const inputsOf = async (year) => (await getMeta(`rbh:yearend:${year}:inputs`)) ?? { members: null, campaigns: null };
export async function putInputs(year, body, by = "desk") {
  const n = (v) => (v === "" || v === null || v === undefined ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : null);
  const out = { members: n(body.members), campaigns: n(body.campaigns), at: new Date().toISOString(), by };
  await putMeta(`rbh:yearend:${year}:inputs`, out);
  return out;
}

/* ---------- One training ---------- */

/** What one RBH training contributes to the year: people, agencies, the survey, certificates, presenters. */
export async function trainingFacts(event, list, { now = today() } = {}) {
  const [stored, survey, certs, presenters] = await Promise.all([
    getAttendees(event.id), factsFor(event).catch(() => null), certIndex(event.id).catch(() => ({})), listPresenters(event.id).catch(() => []),
  ]);
  const people = writeableTo(stored?.people ?? []);
  // Checked in where the desk took attendance; otherwise everyone registered as attending.
  const tookAttendance = people.some((p) => typeof p.checkedIn === "boolean");
  const came = tookAttendance ? people.filter((p) => p.checkedIn === true) : people;
  const agencies = new Map();
  for (const p of came) {
    const a = agencyOf(p, list);
    if (!a || a.name === SPONSOR) continue;
    const g = agencies.get(a.name) ?? { agency: a.name, province: a.province || "", count: 0 };
    g.count++; agencies.set(a.name, g);
  }
  const speakers = presenters.filter((p) => p.status !== "withdrawn");
  return {
    id: event.id, title: event.title, city: cityOf(event), province: event.province || "", dayOne: event.dayOne || "", lastDay: event.lastDay || event.dayOne || "",
    days: daysOf(event), held: (event.lastDay || event.dayOne || "9") < now,
    registered: people.length, attended: came.length, basis: tookAttendance ? "checked in" : "registered",
    agencies: [...agencies.values()],
    survey: survey ? { answered: survey.answered, invited: survey.invited, scoring: survey.scoring, sessions: survey.sessions.slice(0, 5), comments: survey.comments, topics: survey.topics, provinces: survey.provinces } : null,
    certificates: Object.keys(certs ?? {}).length,
    presenters: speakers.length, presenterOrgs: [...new Set(speakers.map((p) => String(p.organization ?? "").trim()).filter(Boolean))],
  };
}

/* ---------- The year ---------- */

/** Every figure the year-end reports may state, for one calendar year. */
export async function yearFacts(year, { events = null, now = today() } = {}) {
  const all = events ?? (await listEvents());
  const list = await directory().catch(() => []);
  const mine = all.filter((e) => isRbh(e) && yearOf(e) === String(year)).sort((a, b) => (a.dayOne ?? "").localeCompare(b.dayOne ?? ""));
  const rows = await Promise.all(mine.map((e) => trainingFacts(e, list, { now })));
  // Agencies seen at RBH trainings in earlier years, to tell new ones from returning ones.
  const earlierEvents = all.filter((e) => isRbh(e) && yearOf(e) && yearOf(e) < String(year));
  let earlier = null;
  if (earlierEvents.length) {
    earlier = new Set();
    for (const e of earlierEvents) for (const a of (await trainingFacts(e, list, { now })).agencies) earlier.add(a.agency);
  }
  const next = all.filter((e) => isRbh(e) && yearOf(e) === String(Number(year) + 1)).sort((a, b) => (a.dayOne ?? "").localeCompare(b.dayOne ?? ""))
    .map((e) => ({ title: e.title, city: cityOf(e), dayOne: e.dayOne }));
  return combineYear(year, rows, { earlier, next, inputs: await inputsOf(year) });
}

/** The year's figures from its trainings' figures (trainingFacts), the agencies seen before, next year's bookings and the typed-in figures. */
export function combineYear(year, rows, { earlier = null, next = [], inputs = { members: null, campaigns: null } } = {}) {
  const held = rows.filter((r) => r.held);

  // Agencies and provinces reached, from those who came to trainings that have happened.
  const agencies = new Map();
  for (const r of held) for (const a of r.agencies) {
    const g = agencies.get(a.agency) ?? { agency: a.agency, province: a.province, count: 0, trainings: 0 };
    g.count += a.count; g.trainings++; agencies.set(a.agency, g);
  }
  const byProvince = new Map();
  for (const a of agencies.values()) if (PROVINCES[a.province]) byProvince.set(a.province, (byProvince.get(a.province) ?? 0) + a.count);
  const provinceCodes = [...byProvince.keys()].sort();

  // The survey, weighted by how many answered each question at each training.
  // Only the measures of the training itself: venue, sound, registration and food are the event's, not the partnership's.
  const TRAINING = ["quality", "practical", "confidence", "variety"];
  const byQ = new Map();
  for (const r of held) for (const s of (r.survey?.scoring ?? []).filter((x) => TRAINING.includes(x.id))) {
    const g = byQ.get(s.id) ?? { id: s.id, en: s.en, fr: s.fr, n: 0, top2n: 0, meann: 0 };
    g.n += s.n; g.top2n += (s.top2 ?? 0) * s.n; g.meann += (s.mean ?? 0) * s.n; byQ.set(s.id, g);
  }
  const scoring = [...byQ.values()].filter((g) => g.n).sort((a, b) => TRAINING.indexOf(a.id) - TRAINING.indexOf(b.id)).map((g) => ({ id: g.id, en: g.en, fr: g.fr, n: g.n, top2: Math.round(g.top2n / g.n), mean: Math.round((g.meann / g.n) * 100) / 100 }));
  const answered = held.reduce((a, r) => a + (r.survey?.answered ?? 0), 0);
  const invited = held.reduce((a, r) => a + (r.survey?.invited ?? 0), 0);
  // Attendees' own words from every training, numbered afresh across the year and tagged with the training.
  const comments = [];
  for (const r of held) for (const c of r.survey?.comments ?? []) comments.push({ id: comments.length + 1, text: c.text, about: c.about ? `${c.about} · ${r.title}` : r.title });
  const topics = held.flatMap((r) => r.survey?.topics ?? []).slice(0, 150);
  const sessions = held.flatMap((r) => (r.survey?.sessions ?? []).map((s) => ({ title: s.title, titleFr: s.titleFr, training: r.title, top1: s.top1, top2: s.top2, n: s.n })))
    .sort((a, b) => (b.top1 ?? 0) - (a.top1 ?? 0) || (b.top2 ?? 0) - (a.top2 ?? 0)).slice(0, 8);

  const attendees = held.reduce((a, r) => a + r.attended, 0);
  const q = (id) => scoring.find((s) => s.id === id) ?? null;

  return {
    year: Number(year),
    trainings: rows.length, held: held.length, upcoming: rows.length - held.length,
    attendees, attendeeDays: held.reduce((a, r) => a + r.attended * r.days, 0), trainingDays: held.reduce((a, r) => a + r.days, 0),
    attendanceBasis: held.every((r) => r.basis === "checked in") ? "checked in" : held.every((r) => r.basis === "registered") ? "registered" : "mixed",
    agencyCount: agencies.size, provinceCount: provinceCodes.length, provinces: provinceCodes.map((c) => ({ code: c, en: PROVINCES[c], count: byProvince.get(c) }))
      .sort((a, b) => b.count - a.count || a.en.localeCompare(b.en)),
    cities: [...new Map(held.filter((r) => r.city).map((r) => [cityKey(r.city), r.city])).values()],
    topAgencies: [...agencies.values()].sort((a, b) => b.count - a.count || a.agency.localeCompare(b.agency)).slice(0, 12),
    newAgencies: earlier ? [...agencies.keys()].filter((a) => !earlier.has(a)).length : null,
    returningAgencies: earlier ? [...agencies.keys()].filter((a) => earlier.has(a)).length : null,
    certificates: held.reduce((a, r) => a + r.certificates, 0),
    presenters: held.reduce((a, r) => a + r.presenters, 0),
    presenterOrgs: [...new Set(held.flatMap((r) => r.presenterOrgs))].length,
    survey: { answered, invited, rate: pctOf(answered, invited), quality: q("quality")?.top2 ?? null, practical: q("practical")?.top2 ?? null, confidence: q("confidence")?.top2 ?? null },
    scoring, sessions,
    communications: { members: inputs.members, campaigns: inputs.campaigns, estimatedEmails: inputs.members != null && inputs.campaigns != null ? inputs.members * inputs.campaigns : null },
    trainingsList: rows.map((r) => ({ title: r.title, city: r.city, dayOne: r.dayOne, lastDay: r.lastDay, days: r.days, held: r.held, attended: r.held ? r.attended : null,
      answered: r.survey?.answered ?? 0, surveyRate: r.held && r.survey?.invited ? pctOf(r.survey.answered, r.survey.invited) : null, quality: r.held ? (r.survey?.scoring?.find((s) => s.id === "quality")?.top2 ?? null) : null })),
    nextYear: { count: next.length, trainings: next },
    comments: comments.slice(0, 300), topics,
  };
}

/* ---------- What Claude writes ---------- */

const S = (desc) => ({ type: "string", description: desc });
const LIST = (desc) => ({ type: "array", items: { type: "string" }, description: desc });
const QUOTE = { type: "object", additionalProperties: false, required: ["commentId", "about"], properties: { commentId: { type: "integer" }, about: { type: "string" } } };
export const YE_SCHEMAS = {
  exec: {
    type: "object", additionalProperties: false,
    required: ["glance", "reach", "communications", "quotes", "askedNext", "strengths", "lookAhead", "recommendations", "extra", "reply"],
    properties: {
      glance: LIST("Two short paragraphs: what the partnership delivered this year (the trainings, where, how many people from how many agencies and provinces), then how it was received and what ONGIA's members were told, with the figures given."),
      reach: LIST("One or two short paragraphs on reach: agencies, provinces, cities, new and returning agencies, from the figures given."),
      communications: LIST("Zero to two short sentences adding to the communications figures (which the desk prints itself); empty if no communications figures were given."),
      quotes: { type: "array", items: QUOTE, description: "Two to four attendee comments by id." },
      askedNext: S("One or two sentences on what attendees asked for next across the year, from the topics given; empty if none."),
      strengths: LIST("Three or four bullets, each a short bold lead phrase ending in a full stop, then one sentence resting on a figure given."),
      lookAhead: S("One or two sentences on next year, from the trainings already booked; the desk prints how many are booked and lists them, so don't repeat the count."),
      recommendations: LIST("Two to four recommendations for the partnership, each a short bold lead phrase ending in a full stop, then one sentence."),
      extra: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "paragraphs"], properties: { title: { type: "string" }, paragraphs: { type: "array", items: { type: "string" } } } }, description: "Sections ONGIA asked for that the layout doesn't have; usually empty." },
      reply: S("One or two sentences to ONGIA's president on what you changed this time, or empty when nothing was asked."),
    },
  },
  info: {
    type: "object", additionalProperties: false, required: ["headline", "tagline", "quote", "wantNext", "reply"],
    properties: {
      headline: S("A headline of six to nine words for the year, e.g. 'Training Canada's front line against illicit trade'."),
      tagline: S("One short line in figures, e.g. 'Twelve trainings. Ten provinces. One partnership.'"),
      quote: QUOTE,
      wantNext: LIST("Up to five topics attendees want next, two to four words each, from the topics given."),
      reply: S("One or two sentences on what you changed this time, or empty."),
    },
  },
};
const LANG = { en: "English", fr: "Canadian French (as written for senior managers in Québec: natural, formal, not translated word for word)" };
export const YE_SYSTEM = (kind, lang) => `You write the ${kind === "exec" ? "year-end executive summary" : "one-page year-end infographic"} of ONGIA's partnership with Rothmans, Benson & Hedges (RBH). ONGIA is a Canadian non-profit that trains law enforcement, corrections, border and justice staff on organized crime and illicit trade; RBH funds a program of trainings with it. The readers are RBH's senior leaders, and the document shows them what the partnership delivered over the calendar year.

Write in ${LANG[lang]}. Plain, confident, specific. No hype, no filler, no superlatives the figures don't support.

The figures you are given are the only figures that exist. Use them exactly; never compute, round differently, total, or invent one. If a figure is missing or null, leave the point out rather than guess. The email figure is an estimate (members times campaigns) and must be called an estimate. Never mention social media. Never name or identify an attendee. For quotes, give only the id of a comment; the desk prints its exact words in the language it was written in.

ONGIA's requests for this document come last. Follow every one of them. They may add sections, change wording or emphasis, or leave things out; they can't change a figure or a quote's words.`;

/** One language of one year-end report, from Claude. `client` is for tests. */
export async function writeYearReport(kind, lang, facts, { requests = [], previous = null, ask = "" } = {}, { client = null } = {}) {
  if (!client && !anthropicKey()) throw new Error("The desk has no Anthropic API key, so Claude cannot write the report.");
  const api = client ?? new Anthropic({ apiKey: anthropicKey() });
  const brief = { figures: { ...facts, comments: undefined, topics: undefined }, comments: facts.comments, topicsAskedFor: facts.topics };
  const message = await api.messages.create({
    model: "claude-opus-5-5", max_tokens: 16000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: YE_SCHEMAS[kind] } },
    system: YE_SYSTEM(kind, lang),
    messages: [{ role: "user", content: `${JSON.stringify(brief)}${previous ? `\n\nThe current version, to keep unless the requests or new figures change it:\n${JSON.stringify(previous)}` : ""}${requests.length ? `\n\nONGIA's requests:\n${requests.map((a) => `- ${a}`).join("\n")}` : ""}${ask ? `\n\nJust now ONGIA asked: ${ask}\nSay in reply what you changed.` : ""}` }],
  });
  if (message.stop_reason === "refusal") throw new Error("Claude would not write this report.");
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let out;
  try { out = JSON.parse(text); } catch { throw new Error("Claude's report could not be read. Try again."); }
  return keepHonestYear(kind, out, facts);
}

/** Quotes only from the comments, word for word; nothing about communications unless its figures were given. */
export function keepHonestYear(kind, out, facts) {
  const byId = new Map(facts.comments.map((c) => [c.id, c]));
  const quote = (q) => (byId.has(q?.commentId) ? { text: byId.get(q.commentId).text, about: q.about || byId.get(q.commentId).about } : null);
  if (kind === "exec") {
    return { ...out, quotes: (out.quotes ?? []).map(quote).filter(Boolean).slice(0, 4),
      communications: facts.communications.members == null && facts.communications.campaigns == null ? [] : (out.communications ?? []) };
  }
  return { ...out, quote: quote(out.quote), wantNext: (out.wantNext ?? []).slice(0, 5) };
}

/* ---------- Kept on the desk: versions, requests, the chat ---------- */

const blank = () => ({ versions: [], current: 0, requests: [], chat: [], final: false });
export const yearReportsOf = async (year) => (await getMeta(`reports:yearend:${year}`)) ?? {};
export const putYearReports = (year, r) => putMeta(`reports:yearend:${year}`, r);

/** Make one year-end report again (both languages) and keep it as a new version. */
export async function buildYearReport(year, kind, { reason = "asked", ask = "", lang = "both", client = null, facts = null, now = new Date() } = {}) {
  const all = await yearReportsOf(year);
  const r = { ...blank(), ...(all[kind] ?? {}) };
  const f = facts ?? (await yearFacts(year));
  if (!f.held) throw new Error(`No RBH training in ${year} has taken place yet.`);
  const prev = r.versions.find((v) => v.n === r.current) ?? null;
  const forLang = (l) => r.requests.filter((q) => q.lang === "both" || q.lang === l).map((q) => q.text);
  const redo = (l) => !prev || reason !== "asked-change" || lang === "both" || lang === l;
  const [en, fr] = await Promise.all(["en", "fr"].map((l) => (redo(l)
    ? writeYearReport(kind, l, f, { requests: forLang(l), previous: prev?.content?.[l] ?? null, ask: (lang === "both" || lang === l) ? ask : "" }, { client })
    : Promise.resolve(prev.content[l]))));
  const n = Math.max(0, ...r.versions.map((v) => v.n)) + 1;
  const version = { n, at: now.toISOString(), reason, answered: f.survey.answered, invited: f.survey.invited, facts: f, content: { en, fr } };
  r.versions = [...r.versions, version].slice(-12);
  r.current = n;
  if (ask) r.chat = [...r.chat, { who: "claude", text: (lang === "fr" ? fr.reply : en.reply) || (lang === "fr" ? "C'est fait." : "Done."), at: now.toISOString(), version: n }].slice(-80);
  await putYearReports(year, { ...(await yearReportsOf(year)), [kind]: r });
  return version;
}

export async function yearVersionPdf(year, kind, lang, n = null) {
  const r = (await yearReportsOf(year))[kind];
  const v = r?.versions?.find((x) => x.n === (n ?? r.current));
  if (!v) return null;
  return (kind === "exec" ? yearExecPdf : yearInfoPdf)(v.content[lang], v.facts, lang, { date: v.at.slice(0, 10) });
}

/** Both languages of the current version, to the year-end folder in the library. */
export async function fileYearReport(year, kind, { file = null } = {}) {
  const put = file ?? (await import("./graph.mjs")).fileLibraryDocument;
  const r = (await yearReportsOf(year))[kind];
  const out = {};
  for (const lang of ["en", "fr"]) {
    try {
      const bytes = await yearVersionPdf(year, kind, lang);
      const got = await put({ folder: yearFolder(year), name: yearFileName(kind, lang, year), bytes, contentType: "application/pdf" });
      out[lang] = got.skipped ? { skipped: got.reason } : { url: got.url, folderUrl: got.folderUrl, at: new Date().toISOString(), version: r.current };
    } catch (e) { out[lang] = { error: e.message }; }
  }
  const now = await yearReportsOf(year);
  await putYearReports(year, { ...now, [kind]: { ...now[kind], filed: out } });
  return out;
}

/** Where both year-end reports stand, the shape the event reports use. */
export async function yearState(year, facts = null) {
  const all = await yearReportsOf(year);
  const f = facts ?? (await yearFacts(year));
  const one = (kind) => {
    const r = all[kind] ?? {};
    const cur = r.versions?.find((v) => v.n === r.current);
    return { name: YE_KINDS[kind], made: !!cur, current: r.current ?? 0, final: !!r.final, finalAt: r.finalAt ?? null, building: r.building ?? null, error: r.error ?? null,
      version: cur ? { n: cur.n, at: cur.at, reason: cur.reason, answered: cur.answered, invited: cur.invited } : null,
      versions: (r.versions ?? []).map((v) => ({ n: v.n, at: v.at, reason: v.reason, answered: v.answered })), requests: r.requests ?? [], chat: r.chat ?? [], filed: r.filed ?? null,
      newSince: cur ? Math.max(0, f.survey.answered - cur.answered) : 0 };
  };
  return { year: Number(year), answered: f.survey.answered, invited: f.survey.invited, held: f.held, folder: yearFolder(year),
    reports: Object.fromEntries(Object.keys(YE_KINDS).map((k) => [k, one(k)])) };
}

/* ---------- The PDFs (laid out like the mock-ups Andrew saw on 31 Oct 2026) ---------- */

const { NAVY, GOLD, INK, MUTED, LINE, PALE, LOGO } = PDF_LOOK;
const T = {
  en: { exec: "Year-End Executive Summary", partner: (y) => `The ONGIA and RBH partnership · ${y}`, review: (y) => `Year in review · ${y}`, span: (y) => `ONGIA and Rothmans, Benson & Hedges · January to December ${y}`,
    kicker: "Partnership results", colon: ": ", prepared: "Prepared for", for: "Rothmans, Benson & Hedges (RBH) leadership", by: "Prepared by", byWho: "ONGIA | Andrew Hammond, President", date: "Date",
    glance: "At a glance", trainings: "Trainings delivered", reach: "Reach", byProvince: "Reach by province", comms: "Communications", results: "Survey results", said: "What attendees said",
    askedNext: "What attendees asked for next", strengths: "Strengths of the year", ahead: (y) => `Looking ahead to ${y}`, page: "Page", of: "of",
    colTraining: "Training", colCity: "City", colDates: "Dates", colAttended: "Attended", colSurvey: "Survey", colQuality: "Quality", total: "Total", toCome: "To come",
    note: "Survey: share of those sent the survey who answered. Quality: share who rated the overall quality 4 or 5 out of 5.",
    colProvince: "Province", colAttendees: "Attendees", topAgencies: "Agencies sending the most people", colAgency: "Agency",
    growing: "Growing reach.", growText: (n, r) => `${n} agencies attended an RBH training for the first time; ${r} had attended before.`,
    comm: (m, c, e, y) => [m != null && c != null ? `ONGIA promoted RBH trainings to its ${m} members in ${c} email campaigns, about ${e} emails in ${y} (an estimate: members × campaigns).`
      : m != null ? `ONGIA's member database holds ${m} members.` : c != null ? `ONGIA sent ${c} email campaigns about RBH trainings in ${y}.` : ""].join(""),
    answeredLine: (a, i, r) => (i ? `${a} of ${i} people sent the survey answered it (${r}%). Results across the year's trainings:` : `${a} survey answers. Results across the year's trainings:`),
    measure: "Measure", top2: "Rated 4 or 5", answers: "Answers", booked: (n, y) => `${n} RBH training${n === 1 ? "" : "s"} already booked for ${y}.`,
    tTrainings: "Trainings", tTraining1: "Training", tAgency1: "Agency", tProv1: "Province", tCities: (n) => `in ${n} cit${n === 1 ? "y" : "ies"}`, tTrained: "People trained", tTrainedSub: (b) => (b === "registered" ? "registered" : "front-line staff"), tAgencies: "Agencies",
    tAgSub: (n) => (n != null ? `${n} new this year` : "sent people"), tProv: "Provinces", tProvSub: "reached", tProvSub1: "reached", tEmails: "Emails", tEmailsSub: (m) => `to ${m} members`, tQuality: "Quality", tQualitySub: "rated 4 or 5",
    tConf: "Confidence", tConfSub: "able to apply it", tCerts: "Certificates", tCertsSub: "issued", want: "Attendees want next", wantSub: "From open-ended feedback",
    lookingAhead: "Looking ahead:", footInfo: "ONGIA · WWW.ONGIA.CA", prep: (d) => `Prepared by ONGIA · ${d}`, footExec: (y) => `Year-End Executive Summary ${y} · ONGIA and RBH`, more: (n) => `+ ${n} more` },
  fr: { exec: "Sommaire exécutif de fin d'année", partner: (y) => `Le partenariat ONGIA–RBH · ${y}`, review: (y) => `Bilan de l'année · ${y}`, span: (y) => `ONGIA et Rothmans, Benson & Hedges · janvier à décembre ${y}`,
    kicker: "Résultats du partenariat", colon: " : ", prepared: "Préparé pour", for: "La direction de Rothmans, Benson & Hedges (RBH)", by: "Préparé par", byWho: "ONGIA | Andrew Hammond, président", date: "Date",
    glance: "En un coup d'œil", trainings: "Formations offertes", reach: "Portée", byProvince: "Portée par province", comms: "Communications", results: "Résultats des sondages", said: "Ce que disent les participants",
    askedNext: "Ce que les participants souhaitent ensuite", strengths: "Points forts de l'année", ahead: (y) => `Perspectives pour ${y}`, page: "Page", of: "de",
    colTraining: "Formation", colCity: "Ville", colDates: "Dates", colAttended: "Présents", colSurvey: "Sondage", colQuality: "Qualité", total: "Total", toCome: "À venir",
    note: "Sondage : part des personnes sollicitées ayant répondu. Qualité : part ayant noté la qualité globale 4 ou 5 sur 5.",
    colProvince: "Province", colAttendees: "Participants", topAgencies: "Principaux organismes", colAgency: "Organisme",
    growing: "Une portée qui s'élargit.", growText: (n, r) => `${n} organismes ont participé à une formation RBH pour la première fois; ${r} y avaient déjà participé.`,
    comm: (m, c, e, y) => (m != null && c != null ? `L'ONGIA a fait la promotion des formations RBH auprès de ses ${m} membres dans ${c} campagnes de courriels, soit environ ${e} courriels en ${y} (estimation : membres × campagnes).`
      : m != null ? `La base de données de l'ONGIA compte ${m} membres.` : c != null ? `L'ONGIA a envoyé ${c} campagnes de courriels sur les formations RBH en ${y}.` : ""),
    answeredLine: (a, i, r) => (i ? `${a} des ${i} personnes sollicitées ont répondu au sondage (${r} %). Résultats pour l'ensemble des formations :` : `${a} réponses au sondage. Résultats pour l'ensemble des formations :`),
    measure: "Mesure", top2: "Note de 4 ou 5", answers: "Réponses", booked: (n, y) => `${n} formation${n === 1 ? "" : "s"} RBH déjà prévue${n === 1 ? "" : "s"} en ${y}.`,
    tTrainings: "Formations", tTraining1: "Formation", tAgency1: "Organisme", tProv1: "Province", tCities: (n) => `dans ${n} ville${n === 1 ? "" : "s"}`, tTrained: "Personnes formées", tTrainedSub: (b) => (b === "registered" ? "inscrites" : "personnel de première ligne"), tAgencies: "Organismes",
    tAgSub: (n) => (n != null ? `${n} nouveaux cette année` : "ont envoyé des participants"), tProv: "Provinces", tProvSub: "rejointes", tProvSub1: "rejointe", tEmails: "Courriels", tEmailsSub: (m) => `à ${m} membres`, tQuality: "Qualité", tQualitySub: "note de 4 ou 5",
    tConf: "Confiance", tConfSub: "pour l'appliquer", tCerts: "Certificats", tCertsSub: "délivrés", want: "Les participants souhaitent", wantSub: "Selon les commentaires",
    lookingAhead: "Perspectives :", footInfo: "ONGIA · WWW.ONGIA.CA", prep: (d) => `Préparé par l'ONGIA · ${d}`, footExec: (y) => `Sommaire exécutif de fin d'année ${y} · ONGIA et RBH`, more: (n) => `+ ${n} autres` },
};
// The survey's training measures, in a few words for the table (the questions themselves are long).
const MEASURE = {
  quality: { en: "Overall quality of the training", fr: "Qualité globale de la formation" },
  practical: { en: "Practical strategies to take back", fr: "Stratégies pratiques à rapporter" },
  confidence: { en: "Confident they can apply what they learned", fr: "Confiance pour appliquer ce qu'ils ont appris" },
  variety: { en: "Variety and depth of topics", fr: "Variété et profondeur des sujets" },
};
const PROV_FR = { ON: "Ontario", QC: "Québec", MB: "Manitoba", SK: "Saskatchewan", AB: "Alberta", BC: "Colombie-Britannique", NS: "Nouvelle-Écosse", NB: "Nouveau-Brunswick",
  NL: "Terre-Neuve-et-Labrador", PE: "Île-du-Prince-Édouard", YT: "Yukon", NT: "Territoires du Nord-Ouest", NU: "Nunavut" };
const provName = (p, lang) => (lang === "fr" ? PROV_FR[p.code] : p.en);
const num = (n, lang) => (n == null ? "" : Number(n).toLocaleString(lang === "fr" ? "fr-CA" : "en-CA"));
const pc = (n, lang) => (n == null ? "" : lang === "fr" ? `${n} %` : `${n}%`);
const longDate = (iso, lang) => formatLong(iso, lang, { weekday: false }) || iso;
const MON = { en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], fr: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."] };
/** "Feb 8–12" / "8–12 févr."; across months "Feb 27 – Mar 2". */
function span(a, b, lang) {
  const d = (iso) => { const [, m, day] = String(iso).split("-").map(Number); return { m: m - 1, day }; };
  if (!a) return "";
  const x = d(a), y = d(b || a), M = MON[lang];
  if (lang === "fr") return x.m === y.m ? (x.day === y.day ? `${x.day} ${M[x.m]}` : `${x.day}–${y.day} ${M[x.m]}`) : `${x.day} ${M[x.m]} – ${y.day} ${M[y.m]}`;
  return x.m === y.m ? (x.day === y.day ? `${M[x.m]} ${x.day}` : `${M[x.m]} ${x.day}–${y.day}`) : `${M[x.m]} ${x.day} – ${M[y.m]} ${y.day}`;
}
const monthYear = (iso, lang) => { const [y, m] = String(iso).split("-").map(Number); return lang === "fr" ? `${["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"][m - 1]} ${y}` : `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]} ${y}`; };
/** "Lead phrase. The rest." → the lead in bold. */
const lead = (t) => { const m = /^(.{3,90}?[.:])\s+(.+)$/s.exec(String(t)); return m ? [m[1], m[2]] : ["", String(t)]; };

/** The two rows of infographic tiles (navy, then gold), and the first five for the summary. */
function tilesOf(f, lang) {
  const L = T[lang];
  const navy = [
    { big: num(f.trainings, lang), label: f.trainings === 1 ? L.tTraining1 : L.tTrainings, sub: L.tCities(new Set(f.trainingsList.map((t) => cityKey(t.city)).filter(Boolean)).size) },
    { big: num(f.attendees, lang), label: L.tTrained, sub: L.tTrainedSub(f.attendanceBasis) },
    { big: num(f.agencyCount, lang), label: f.agencyCount === 1 ? L.tAgency1 : L.tAgencies, sub: L.tAgSub(f.newAgencies) },
    { big: num(f.provinceCount, lang), label: f.provinceCount === 1 ? L.tProv1 : L.tProv, sub: f.provinceCount === 1 ? L.tProvSub1 : L.tProvSub },
  ];
  const c = f.communications;
  const gold = [
    c.estimatedEmails != null ? { big: `~${num(c.estimatedEmails, lang)}`, label: L.tEmails, sub: L.tEmailsSub(num(c.members, lang)) } : null,
    f.survey.quality != null ? { big: pc(f.survey.quality, lang), label: L.tQuality, sub: L.tQualitySub } : null,
    f.survey.confidence != null ? { big: pc(f.survey.confidence, lang), label: L.tConf, sub: L.tConfSub } : null,
    f.certificates ? { big: num(f.certificates, lang), label: L.tCerts, sub: L.tCertsSub } : null,
  ].filter(Boolean);
  return { navy, gold };
}
function tile(doc, t, x, y, w, h, goldTile, big = 24) {
  doc.rect(x, y, w, h).fill(goldTile ? GOLD : NAVY);
  doc.font("b").fontSize(big).fillColor("#fff").text(t.big, x, y + h * 0.16, { width: w, align: "center", lineBreak: false });
  doc.font("b").fontSize(7).fillColor(goldTile ? "#fff" : "#d9b65a").text(t.label.toUpperCase(), x + 3, y + h * 0.16 + big + 4, { width: w - 6, align: "center", characterSpacing: 1, lineBreak: false });
  if (t.sub) doc.font("r").fontSize(7).fillColor(goldTile ? "#fff3d1" : "#c9d0e0").text(t.sub, x + 3, y + h * 0.16 + big + 14, { width: w - 6, align: "center", lineBreak: false, height: 9, ellipsis: true });
}

export async function yearExecPdf(content, f, lang, { date }) {
  const L = T[lang], Y = f.year;
  const { doc, done } = newDoc(`${L.exec} ${Y}`);
  const W = doc.page.width - 108, X = 54;
  let first = true;
  const header = () => {
    doc.image(LOGO, X, 22, { height: 30 });
    doc.font("r").fontSize(8).fillColor(MUTED).text(first ? "Organization for National Gang Information & Awareness" : `${L.exec} · ${Y}`, X, 30, { width: W, align: "right" });
    doc.x = X; doc.y = 70; first = false;
  };
  doc.on("pageAdded", header); header();
  const room = (h) => { if (doc.y + h > doc.page.height - 70) doc.addPage(); };
  const h2 = (t, need = 80) => { room(need); doc.moveDown(0.5); doc.font("b").fontSize(15).fillColor(NAVY).text(t, X, doc.y, { width: W }); doc.moveDown(0.25); };
  const para = (t, opts = {}) => { if (!t) return; room(28); doc.font(opts.font ?? "r").fontSize(opts.size ?? 10.5).fillColor(opts.color ?? INK).text(t, X, doc.y, { width: W, lineGap: 2.5 }); doc.moveDown(0.45); };
  const bullets = (items) => {
    for (const t of items) {
      room(28); const y = doc.y, [b, rest] = lead(t);
      doc.font("r").fontSize(10.5).fillColor(INK).text("•", X + 4, y);
      if (b) doc.font("b").text(`${b} `, X + 18, y, { width: W - 18, continued: true, lineGap: 2.5 }).font("r").text(rest, { lineGap: 2.5 });
      else doc.text(rest, X + 18, y, { width: W - 18, lineGap: 2.5 });
      doc.moveDown(0.3);
    }
  };
  // A table at x, w wide; rows that would run off the page carry over with the head repeated. `bold` marks a total row.
  const table = (cols, rows, { x = X, w = W, bold = -1 } = {}) => {
    const widths = cols.map((c) => c.w * w);
    const rowH = (r) => Math.max(...r.map((cell, i) => doc.font(i ? "r" : "b").fontSize(9).heightOfString(String(cell ?? ""), { width: widths[i] - 10 }))) + 9;
    const head = () => { const y = doc.y; doc.rect(x, y, w, 18).fill(NAVY); let xx = x; cols.forEach((c, i) => { doc.font("b").fontSize(8.5).fillColor("#fff").text(c.label, xx + 5, y + 5, { width: widths[i] - 10, align: c.align ?? "left", lineBreak: false }); xx += widths[i]; }); doc.y = y + 18; };
    room(40); head();
    rows.forEach((r, ri) => {
      const h = rowH(r);
      if (doc.y + h > doc.page.height - 70) { doc.addPage(); head(); }
      const y = doc.y; if (ri % 2) doc.rect(x, y, w, h).fill("#f7f5ef");
      let xx = x;
      r.forEach((cell, i) => { doc.font(i === 0 || ri === bold ? "b" : "r").fontSize(9).fillColor(INK).text(String(cell ?? ""), xx + 5, y + 4.5, { width: widths[i] - 10, align: cols[i].align ?? "left" }); xx += widths[i]; });
      doc.moveTo(x, y + h).lineTo(x + w, y + h).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.y = y + h;
    });
    return doc.y;
  };
  const box = (draw, h) => { room(h + 10); const y = doc.y; doc.roundedRect(X, y, W, h, 4).fillAndStroke("#fbfaf6", LINE); draw(y); doc.y = y + h + 8; doc.x = X; };
  const quote = (q) => {
    const h = doc.font("b").fontSize(11).heightOfString(`“${q.text}”`, { width: W - 32 }) + 30;
    room(h + 8); const y = doc.y;
    doc.rect(X, y, W, h).fill(PALE); doc.rect(X, y, 3.5, h).fill(NAVY);
    doc.font("b").fontSize(11).fillColor(NAVY).text(`“${q.text}”`, X + 16, y + 9, { width: W - 32 });
    doc.font("b").fontSize(7.5).fillColor(MUTED).text(`— ${String(q.about).toUpperCase()}`, X + 16, y + h - 15, { width: W - 32, characterSpacing: 1, lineBreak: false, height: 9, ellipsis: true });
    doc.y = y + h + 6; doc.x = X;
  };

  // Page 1: the year at a glance and the trainings.
  doc.font("b").fontSize(28).fillColor(NAVY).text(L.exec, X, doc.y, { width: W });
  doc.font("r").fontSize(15).fillColor(NAVY).text(L.partner(Y), { width: W });
  doc.moveDown(0.3);
  doc.font("b").fontSize(9).fillColor(INK).text(`${L.prepared}${L.colon}`, X, doc.y, { continued: true }).font("r").text(`${L.for}   |   `, { continued: true }).font("b").text(`${L.by}${L.colon}`, { continued: true }).font("r").text(`${L.byWho}   |   `, { continued: true }).font("b").text(`${L.date}${L.colon}`, { continued: true }).font("r").text(monthYear(date, lang));
  h2(L.glance);
  for (const p of content.glance ?? []) para(p);
  const { navy, gold } = tilesOf(f, lang);
  const five = [...navy, ...(f.survey.quality != null ? [gold.find((g) => g.label === L.tQuality)] : [])];
  room(76); { const y = doc.y + 4, gap = 6, tw = (W - gap * (five.length - 1)) / five.length; five.forEach((t, i) => tile(doc, { ...t, sub: t.label === L.tQuality ? t.sub : "" }, X + i * (tw + gap), y, tw, 60, t.label === L.tQuality, 22)); doc.y = y + 68; doc.x = X; }
  h2(L.trainings, 120);
  const held = f.trainingsList.filter((r) => r.held);
  const rows = f.trainingsList.map((r) => [r.title, r.city, span(r.dayOne, r.lastDay, lang), r.held ? num(r.attended, lang) : L.toCome, r.surveyRate != null ? pc(r.surveyRate, lang) : "", r.quality != null ? pc(r.quality, lang) : ""]);
  rows.push([L.total, "", "", num(held.reduce((a, r) => a + (r.attended ?? 0), 0), lang), f.survey.invited ? pc(f.survey.rate, lang) : "", f.survey.quality != null ? pc(f.survey.quality, lang) : ""]);
  table([{ label: L.colTraining, w: 0.38 }, { label: L.colCity, w: 0.15 }, { label: L.colDates, w: 0.15 }, { label: L.colAttended, w: 0.11, align: "right" }, { label: L.colSurvey, w: 0.1, align: "right" }, { label: L.colQuality, w: 0.11, align: "right" }], rows, { bold: rows.length - 1 });
  doc.moveDown(0.3); para(L.note, { font: "i", size: 8.5, color: MUTED });

  // Page 2: reach, communications, the survey, attendees' words.
  doc.addPage();
  h2(L.reach);
  for (const p of content.reach ?? []) para(p);
  if (f.provinces.length || f.topAgencies.length || f.newAgencies != null) {
    const top = doc.y, half = (W - 18) / 2;
    let left = top, right = top;
    if (f.provinces.length) { doc.y = top; left = table([{ label: L.colProvince, w: 0.72 }, { label: L.colAttendees, w: 0.28, align: "right" }], f.provinces.map((p) => [provName(p, lang), num(p.count, lang)]), { x: X, w: half }); }
    doc.y = top;
    if (f.topAgencies.length) right = table([{ label: L.topAgencies, w: 0.78 }, { label: "", w: 0.22, align: "right" }], f.topAgencies.slice(0, 8).map((a) => [a.agency, num(a.count, lang)]), { x: X + half + 18, w: half });
    if (f.newAgencies != null) {
      const t = `${L.growing} ${L.growText(num(f.newAgencies, lang), num(f.returningAgencies, lang))}`;
      const h = doc.font("r").fontSize(9.5).heightOfString(t, { width: half - 20 }) + 16, y = right + 8;
      doc.roundedRect(X + half + 18, y, half, h, 4).fillAndStroke("#fbfaf6", LINE);
      doc.font("b").fontSize(9.5).fillColor(NAVY).text(`${L.growing} `, X + half + 28, y + 8, { width: half - 20, continued: true }).font("r").fillColor(INK).text(L.growText(num(f.newAgencies, lang), num(f.returningAgencies, lang)));
      right = y + h;
    }
    doc.y = Math.max(left, right) + 6; doc.x = X;
  }
  const c = f.communications, commText = L.comm(num(c.members, lang), num(c.campaigns, lang), num(c.estimatedEmails, lang), Y);
  if (commText) {
    h2(L.comms, 70);
    const t = [commText, ...(content.communications ?? [])].join(" ");
    const h = doc.font("r").fontSize(10.5).heightOfString(t, { width: W - 24, lineGap: 2 }) + 18;
    box((y) => doc.font("r").fontSize(10.5).fillColor(INK).text(t, X + 12, y + 9, { width: W - 24, lineGap: 2 }), h);
  }
  if (f.scoring.length) {
    h2(L.results, 110);
    para(L.answeredLine(num(f.survey.answered, lang), num(f.survey.invited, lang), f.survey.rate));
    table([{ label: L.measure, w: 0.6 }, { label: L.top2, w: 0.2, align: "right" }, { label: L.answers, w: 0.2, align: "right" }], f.scoring.map((s) => [MEASURE[s.id]?.[lang] ?? (lang === "fr" ? s.fr : s.en), pc(s.top2, lang), num(s.n, lang)]));
    doc.moveDown(0.4);
  }
  // Attendees' words fill what's left of page 2; one that won't fit is left out rather than stranded on a page of its own.
  if (content.quotes?.length) {
    const fits = (q) => doc.y + doc.font("b").fontSize(11).heightOfString(`“${q.text}”`, { width: W - 32 }) + 40 < doc.page.height - 70;
    const shown = [];
    for (const q of content.quotes) { if (shown.length === 0 || fits(q)) { if (!shown.length) h2(L.said, 70); quote(q); shown.push(q); } else break; }
  }

  // Page 3: what attendees want next, the year's strengths, the year ahead.
  if (content.askedNext || content.strengths?.length || content.lookAhead || content.recommendations?.length || f.nextYear.count || content.extra?.length) {
    doc.addPage();
    if (content.askedNext) { h2(L.askedNext); para(content.askedNext); }
    if (content.strengths?.length) { h2(L.strengths); bullets(content.strengths); }
    for (const e of content.extra ?? []) { h2(e.title); for (const p of e.paragraphs ?? []) para(p); }
    if (f.nextYear.count || content.lookAhead || content.recommendations?.length) {
      h2(L.ahead(Y + 1));
      if (f.nextYear.count) para(L.booked(f.nextYear.count, Y + 1), { font: "b", color: NAVY });
      para(content.lookAhead);
      if (f.nextYear.count) { table([{ label: L.colTraining, w: 0.55 }, { label: L.colCity, w: 0.22 }, { label: L.colDates, w: 0.23 }], f.nextYear.trainings.map((t) => [t.title, t.city, span(t.dayOne, t.dayOne, lang)])); doc.moveDown(0.5); }
      bullets(content.recommendations ?? []);
    }
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - 40;
    doc.moveTo(X, y - 6).lineTo(X + W, y - 6).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.font("r").fontSize(8).fillColor(MUTED).text(L.footExec(Y), X, y, { width: W * 0.75, lineBreak: false, height: 10 });
    doc.text(`${L.page} ${i + 1} ${L.of} ${range.count}`, X + W * 0.75, y, { width: W * 0.25, align: "right", lineBreak: false, height: 10 });
  }
  doc.end();
  return done;
}

export async function yearInfoPdf(content, f, lang, { date }) {
  const L = T[lang], Y = f.year;
  const { doc, done } = newDoc(`${L.review(Y)} — ${YE_KINDS.info[lang]}`);
  const X = 36, W = doc.page.width - 72, BOTTOM = doc.page.height - 50;
  doc.page.margins.bottom = 0;   // one page: the footer sits below the usual margin and must not start another
  doc.image(LOGO, X, 26, { height: 38 });
  doc.font("b").fontSize(8.5).fillColor(NAVY).text(L.review(Y).toUpperCase(), X, 32, { width: W, align: "right", characterSpacing: 1.2 });
  doc.font("r").fontSize(7.5).fillColor(MUTED).text(L.span(Y), X, 44, { width: W, align: "right" });
  doc.font("b").fontSize(8).fillColor(GOLD).text(L.kicker.toUpperCase(), X, 82, { characterSpacing: 1.5 });
  doc.font("b").fontSize(23).fillColor(NAVY).text(content.headline || L.review(Y), X, 94, { width: W, lineGap: -2 });
  if (content.tagline) doc.font("i").fontSize(11).fillColor(MUTED).text(content.tagline, X, doc.y + 1, { width: W });
  // Two rows of tiles.
  const { navy, gold } = tilesOf(f, lang);
  let y = doc.y + 10;
  for (const [row, isGold] of [[navy, false], [gold, true]]) {
    if (!row.length) continue;
    const gap = 7, tw = (W - gap * 3) / 4, off = (W - (tw * row.length + gap * (row.length - 1))) / 2;
    row.forEach((t, i) => tile(doc, t, X + off + i * (tw + gap), y, tw, 66, isGold, 24));
    y += 66 + 8;
  }
  y += 10;
  // Two columns: the trainings, and reach by province.
  const lw = W * 0.54, rx = X + lw + 22, rw = W - lw - 22;
  const h3 = (n, t, x, yy) => {
    doc.circle(x + 7, yy + 6, 7).fill(GOLD); doc.font("b").fontSize(8).fillColor("#fff").text(String(n), x + 4.6, yy + 2.6, { lineBreak: false });
    doc.font("b").fontSize(9.5).fillColor(NAVY).text(t.toUpperCase(), x + 20, yy + 1.5, { characterSpacing: 1.2, lineBreak: false });
    return yy + 22;
  };
  // Every training of the year: those held with a bar for their attendees, those still to come greyed out.
  const all = f.trainingsList, shown = all.slice(0, 14), maxA = Math.max(1, ...shown.map((r) => r.attended ?? 0));
  let ly = h3(1, L.trainings, X, y);
  for (const r of shown) {
    const barX = X + lw - 30 - 80;
    // The name in bold, then city and dates, cut to the room before the bar.
    const room = barX - X - 8, rest = ` · ${r.city ? `${r.city}, ` : ""}${span(r.dayOne, r.lastDay, lang)}`;
    doc.font("b").fontSize(8);
    const tw = Math.min(doc.widthOfString(r.title), room);
    doc.fillColor(r.held ? INK : MUTED).text(r.title, X, ly + 1, { width: tw + 1, lineBreak: false, height: 10, ellipsis: true });
    if (room - tw > 30) doc.font("r").fontSize(8).fillColor(MUTED).text(rest, X + tw, ly + 1, { width: room - tw, lineBreak: false, height: 10, ellipsis: true });
    if (r.held) {
      doc.rect(barX, ly + 1, 80, 9).fill("#e9e6de"); doc.rect(barX, ly + 1, Math.max(2, 80 * (r.attended ?? 0) / maxA), 9).fill(NAVY);
      doc.font("b").fontSize(8).fillColor(INK).text(num(r.attended, lang), X + lw - 28, ly + 1, { width: 28, align: "right", lineBreak: false });
    } else doc.font("i").fontSize(7.5).fillColor(MUTED).text(L.toCome, barX, ly + 1.5, { width: 108, align: "right", lineBreak: false });
    ly += 15;
  }
  if (all.length > shown.length) { doc.font("i").fontSize(7.5).fillColor(MUTED).text(L.more(all.length - shown.length), X, ly + 1); ly += 13; }
  let ry = y;
  if (f.provinces.length) {
    ry = h3(2, L.byProvince, rx, y);
    const maxP = Math.max(1, ...f.provinces.map((p) => p.count));
    for (const p of f.provinces.slice(0, 13)) {
      doc.font("r").fontSize(8).fillColor(INK).text(provName(p, lang), rx, ry + 1, { width: rw - 100, lineBreak: false, height: 10, ellipsis: true });
      doc.rect(rx + rw - 96, ry + 1, 64, 9).fill("#e9e6de"); doc.rect(rx + rw - 96, ry + 1, Math.max(2, 64 * p.count / maxP), 9).fill(GOLD);
      doc.font("b").fontSize(8).fillColor(INK).text(num(p.count, lang), rx + rw - 28, ry + 1, { width: 28, align: "right", lineBreak: false });
      ry += 15;
    }
  }
  y = Math.max(ly, ry) + 14;
  // The quote, what attendees want next, and the year after: each only if it fits.
  if (content.quote?.text) {
    const qh = Math.min(84, doc.font("b").fontSize(12.5).heightOfString(`“${content.quote.text}”`, { width: W - 40 }) + 34);
    if (y + qh < BOTTOM - 80) {
      doc.rect(X, y, W, qh).fill(PALE); doc.rect(X, y, 4, qh).fill(NAVY);
      doc.font("b").fontSize(12.5).fillColor(NAVY).text(`“${content.quote.text}”`, X + 18, y + 11, { width: W - 40, height: qh - 30, ellipsis: true });
      doc.font("b").fontSize(7.5).fillColor(MUTED).text(`— ${String(content.quote.about).toUpperCase()}`, X + 18, y + qh - 16, { width: W - 40, height: 9, ellipsis: true, lineBreak: false, characterSpacing: 1 });
      y += qh + 14;
    }
  }
  if (content.wantNext?.length && y + 40 < BOTTOM - 44) {
    doc.font("b").fontSize(8).fillColor(NAVY).text(L.want.toUpperCase(), X, y + 3, { width: 130, characterSpacing: 1 });
    doc.font("r").fontSize(7).fillColor(MUTED).text(L.wantSub, X, doc.y + 1, { width: 130 });
    const labelEnd = doc.y;
    let cx = X + 150, cy = y;
    content.wantNext.forEach((t, i) => {
      doc.font("b").fontSize(8);
      const w = doc.widthOfString(t) + 20;
      if (cx + w > X + W) { cx = X + 150; cy += 22; }
      doc.roundedRect(cx, cy, w, 17, 8.5).fillAndStroke(i < 2 ? GOLD : "#fff", i < 2 ? GOLD : NAVY);
      doc.fillColor(i < 2 ? "#fff" : NAVY).text(t, cx + 10, cy + 4.5, { lineBreak: false });
      cx += w + 6;
    });
    y = Math.max(cy + 17, labelEnd) + 14;
  }
  if (f.nextYear.count) {
    const bh = 34, by = Math.min(y, BOTTOM - bh - 4);
    doc.roundedRect(X, by, W, bh, 4).fillAndStroke("#fbfaf6", LINE);
    doc.font("b").fontSize(10).fillColor(NAVY).text(`${L.lookingAhead} `, X + 14, by + 12, { continued: true, lineBreak: false }).font("r").fillColor(INK).text(L.booked(f.nextYear.count, Y + 1), { lineBreak: false });
    doc.font("b").fontSize(8.5).fillColor(GOLD).text(String(Y + 1), X, by + 13, { width: W - 14, align: "right", characterSpacing: 1.2, lineBreak: false });
  }
  const fy = doc.page.height - 36;
  doc.moveTo(X, fy - 7).lineTo(X + W, fy - 7).lineWidth(0.5).strokeColor(LINE).stroke();
  doc.font("r").fontSize(7).fillColor(MUTED).text(L.footInfo, X, fy, { width: W / 2, lineBreak: false });
  doc.text(L.prep(monthYear(date, lang)), X + W / 2, fy, { width: W / 2, align: "right", lineBreak: false });
  doc.end();
  return done;
}

/* ---------- The list on Admin › RBH reports ---------- */

/** The years that have RBH trainings (practice ones included, so the page can be tried), newest last. */
export function rbhYears(events, now = today()) {
  return [...new Set([...events.filter((e) => e.kind === "rbh" && yearOf(e)).map(yearOf), now.slice(0, 4)])].sort();
}
