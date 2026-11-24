import Anthropic from "@anthropic-ai/sdk";
import { anthropicKey } from "./contract.mjs";
import { getMeta, putMeta, getAttendees, listEvents, listPresenters } from "./store.mjs";
import { writeableTo } from "./attendees.mjs";
import { directory, agencyOf, PROVINCES } from "./agencies.mjs";
import { certIndex } from "./certs.mjs";
import { factsFor, newDoc, PDF_LOOK } from "./reports.mjs";
import { formatLong, todayIso } from "./deadlines.mjs";
import { SECTORS } from "./sectors.mjs";
import { provinceOfEvent } from "./ongiayear.mjs";
import { readFileSync } from "node:fs";
import nodePath from "node:path";

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
/**
 * Two reports for RBH (Andrew 17 Nov 2026), from two signed agreements:
 * - "consulting": the trainings ONGIA runs for RBH under the consulting agreement (RBH ITP, the RBH Organized Crime
 *   symposiums and the like: events marked as RBH events). The year end as it was first built.
 * - "sponsor": the annual KPI report the sponsorship agreement asks for: ONGIA's own events where RBH presented
 *   (Edmonton, Regina and the like), each ticked "RBH presented" on its Edit event page.
 */
export const TRACKS = ["consulting", "sponsor"];
export const trackOf = (t) => (t === "sponsor" ? "sponsor" : "consulting");
const SPONSOR_KINDS = {
  exec: { en: "Sponsorship Report", fr: "Rapport sur la commandite" },
  info: { en: "Sponsorship Infographic", fr: "Infographie de la commandite" },
};
export const kindNames = (track) => (trackOf(track) === "sponsor" ? SPONSOR_KINDS : YE_KINDS);
// Where the year-end PDFs are filed in the SharePoint library; {year} is replaced. RBH_YEAREND_FOLDER changes it.
// The sponsorship report goes in a folder of its own inside it.
export const yearFolder = (year, track = "consulting") => (process.env.RBH_YEAREND_FOLDER || "RBH/Year end {year}").replace("{year}", String(year)) + (trackOf(track) === "sponsor" ? "/Sponsorship" : "");
export const yearFileName = (kind, lang, year, track = "consulting") => `${kindNames(track)[kind][lang]} ${year}.pdf`;

const SPONSOR = "Rothmans, Benson & Hedges";
const pctOf = (a, b) => (b ? Math.round((100 * a) / b) : 0);
export const yearOf = (e) => String(e?.dayOne ?? "").slice(0, 4);
const isRbh = (e) => e?.kind === "rbh" && !e?.practice;
/** An ONGIA event of its own where RBH presented: counted in the sponsorship report. */
export const rbhPresentedAt = (e) => e?.kind !== "rbh" && e?.rbhPresented === true && !e?.rbhCancelled && !e?.practice && !e?.project;
/** An ONGIA event where RBH had a speaking spot but couldn't present: counted, and said so in the report. */
export const rbhSpotCancelled = (e) => e?.kind !== "rbh" && e?.rbhCancelled === true && !e?.practice && !e?.project;
// The sponsorship report counts the events where RBH presented and those where it held a spot but couldn't present
// (Andrew 17 Nov 2026, the National Gang Summit: "I think we include the summit as well"), the latter said plainly.
const inTrack = (track) => (trackOf(track) === "sponsor" ? (e) => rbhPresentedAt(e) || rbhSpotCancelled(e) : isRbh);
// Where an event was held, for the provinces where RBH took part: its province, "Regina, SK", or the city alone
// ("Regina", as ONGIA's own events are typed), from the cities ONGIA trains in (lib/ongiayear.mjs).
const provinceAt = (e) => provinceOfEvent(e);
const daysOf = (e) => {
  const a = Date.parse(e.dayOne), b = Date.parse(e.lastDay || e.dayOne);
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 86400000) + 1 : 1;
};
const cityOf = (e) => String(e.city ?? "").split(",")[0].trim();
// "Montréal" and "Montreal" are one city.
const cityKey = (c) => String(c ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const today = () => todayIso();

/* ---------- The two figures typed in once a year ---------- */

// The sponsorship report's own: its campaigns are those with contraband tobacco awareness messaging, and it has the
// estimated digital reach the agreement lists as a KPI.
const inputsKey = (year, track) => (trackOf(track) === "sponsor" ? `rbh:sponsor:${year}:inputs` : `rbh:yearend:${year}:inputs`);
// No dollar figures anywhere in the sponsorship report (Andrew 17 Nov 2026: "Let's keep the sponsor $$ off").
export const inputsOf = async (year, track = "consulting") => (await getMeta(inputsKey(year, track))) ?? { members: null, campaigns: null, reach: null };
export async function putInputs(year, body, by = "desk", track = "consulting") {
  const n = (v) => (v === "" || v === null || v === undefined ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : null);
  const out = { members: n(body.members), campaigns: n(body.campaigns), ...(trackOf(track) === "sponsor" ? { reach: n(body.reach) } : {}), at: new Date().toISOString(), by };
  await putMeta(inputsKey(year, track), out);
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
  // An event set to count everyone registered as attended (Andrew 17 Nov 2026, Regina 2026: "just take the 178 as
  // checked in") does; otherwise those checked in, where the desk took attendance.
  const tookAttendance = !event.countRegistered && people.some((p) => typeof p.checkedIn === "boolean");
  const came = tookAttendance ? people.filter((p) => p.checkedIn === true) : people;
  const agencies = new Map();
  for (const p of came) {
    const a = agencyOf(p, list);
    if (!a || a.name === SPONSOR) continue;
    const g = agencies.get(a.name) ?? { agency: a.name, province: a.province || "", sector: a.sector || "", count: 0 };
    g.count++; agencies.set(a.name, g);
  }
  const speakers = presenters.filter((p) => p.status !== "withdrawn");
  // RBH's own session (Andrew 17 Nov 2026: what are they getting for their money): the survey session whose presenters
  // include someone from RBH, by the organization on their agreement.
  const fromRbh = speakers.filter((p) => /rothmans|\bRBH\b/i.test(String(p.organization ?? "")));
  const rbhNames = fromRbh.map((p) => `${p.first ?? ""} ${p.last ?? ""}`.trim().toLowerCase()).filter(Boolean);
  const listed = (x) => (Array.isArray(x) ? x : String(x ?? "").split(/,| and | & /)).map((n) => String(n).trim().toLowerCase()).filter(Boolean);
  const rbhSession = rbhNames.length ? (survey?.sessions ?? []).find((s) => listed(s.presenters).some((n) => rbhNames.includes(n))) ?? null : null;
  return {
    id: event.id, title: event.title, city: cityOf(event), province: provinceAt(event), dayOne: event.dayOne || "", lastDay: event.lastDay || event.dayOne || "",
    days: daysOf(event), held: (event.lastDay || event.dayOne || "9") < now,
    registered: people.length, attended: came.length, basis: tookAttendance || event.countRegistered ? "checked in" : "registered",
    agencies: [...agencies.values()],
    survey: survey ? { answered: survey.answered, invited: survey.invited, scoring: survey.scoring, sessions: survey.sessions.slice(0, 5), comments: survey.comments, topics: survey.topics, provinces: survey.provinces } : null,
    certificates: Object.keys(certs ?? {}).length,
    rbhPresenters: fromRbh.length, cancelled: event.rbhCancelled === true,
    rbhSession: rbhSession ? { title: rbhSession.title, titleFr: rbhSession.titleFr, n: rbhSession.n, top2: rbhSession.top2, mean: rbhSession.mean, top1: rbhSession.top1 } : null,
    presenters: speakers.length, presenterOrgs: [...new Set(speakers.map((p) => String(p.organization ?? "").trim()).filter(Boolean))],
  };
}

/* ---------- The year ---------- */

/** Every figure the year-end reports may state, for one calendar year. */
export async function yearFacts(year, { events = null, now = today(), track = "consulting" } = {}) {
  track = trackOf(track);
  const counts = inTrack(track);
  const all = events ?? (await listEvents());
  const list = await directory().catch(() => []);
  const mine = all.filter((e) => counts(e) && yearOf(e) === String(year)).sort((a, b) => (a.dayOne ?? "").localeCompare(b.dayOne ?? ""));
  const rows = await Promise.all(mine.map((e) => trainingFacts(e, list, { now })));
  // Agencies seen at RBH trainings in earlier years, to tell new ones from returning ones.
  const earlierEvents = all.filter((e) => counts(e) && yearOf(e) && yearOf(e) < String(year));
  let earlier = null;
  if (earlierEvents.length) {
    earlier = new Set();
    for (const e of earlierEvents) for (const a of (await trainingFacts(e, list, { now })).agencies) earlier.add(a.agency);
  }
  const next = all.filter((e) => counts(e) && yearOf(e) === String(Number(year) + 1)).sort((a, b) => (a.dayOne ?? "").localeCompare(b.dayOne ?? ""))
    .map((e) => ({ title: e.title, city: cityOf(e), dayOne: e.dayOne }));
  return combineYear(year, rows, { earlier, next, inputs: await inputsOf(year, track), track });
}

/** The year's figures from its trainings' figures (trainingFacts), the agencies seen before, next year's bookings and the typed-in figures. */
export function combineYear(year, rows, { earlier = null, next = [], inputs = { members: null, campaigns: null }, track = "consulting" } = {}) {
  const held = rows.filter((r) => r.held);
  // Where RBH had a spot but couldn't present: counted, and named in the report.
  const cancelled = held.filter((r) => r.cancelled).map((r) => ({ title: r.title, city: r.city, province: r.province, dayOne: r.dayOne, lastDay: r.lastDay }));

  // Agencies and provinces reached, from those who came to trainings that have happened.
  const agencies = new Map();
  for (const r of held) for (const a of r.agencies) {
    const g = agencies.get(a.agency) ?? { agency: a.agency, province: a.province, sector: a.sector || "", count: 0, trainings: 0 };
    g.count += a.count; g.trainings++; agencies.set(a.agency, g);
  }
  const byProvince = new Map();
  for (const a of agencies.values()) if (PROVINCES[a.province]) byProvince.set(a.province, (byProvince.get(a.province) ?? 0) + a.count);
  const provinceCodes = [...byProvince.keys()].sort();
  // Who attended, by sector (Andrew 1 Nov 2026: agencies sorted into sectors), from agencies that have one.
  const bySector = new Map();
  for (const a of agencies.values()) if (a.sector) bySector.set(a.sector, (bySector.get(a.sector) ?? 0) + a.count);
  const inSector = [...bySector.values()].reduce((x, y) => x + y, 0);

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

  // Where the events themselves were held (the sponsorship KPI "cities and provinces where RBH participated").
  const heldIn = [...new Set(held.map((r) => r.province).filter((c) => PROVINCES[c]))].sort();
  // How RBH's own sessions were rated, across the year (the sponsorship report).
  const rated = held.filter((r) => r.rbhSession?.n);
  const rbhN = rated.reduce((a, r) => a + r.rbhSession.n, 0);
  return {
    year: Number(year), track: trackOf(track),
    heldInProvinces: heldIn.map((c) => ({ code: c, en: PROVINCES[c] })),
    ...(trackOf(track) === "sponsor" ? { cancelled, value: { spots: held.length, presentedAt: held.length - cancelled.length, cancelledSpots: cancelled.length,
      rbhSessions: rated.length, rbhSessionAnswers: rbhN, rbhSessionTop2: rbhN ? Math.round(rated.reduce((a, r) => a + r.rbhSession.top2 * r.rbhSession.n, 0) / rbhN) : null } } : {}),
    trainings: rows.length, held: held.length, upcoming: rows.length - held.length,
    attendees, attendeeDays: held.reduce((a, r) => a + r.attended * r.days, 0), trainingDays: held.reduce((a, r) => a + r.days, 0),
    attendanceBasis: held.every((r) => r.basis === "checked in") ? "checked in" : held.every((r) => r.basis === "registered") ? "registered" : "mixed",
    agencyCount: agencies.size, provinceCount: provinceCodes.length, provinces: provinceCodes.map((c) => ({ code: c, en: PROVINCES[c], count: byProvince.get(c) }))
      .sort((a, b) => b.count - a.count || a.en.localeCompare(b.en)),
    cities: [...new Map(held.filter((r) => r.city).map((r) => [cityKey(r.city), r.city])).values()],
    sectors: SECTORS.map((s) => ({ id: s.id, en: s.en, fr: s.fr, count: bySector.get(s.id) ?? 0, pct: pctOf(bySector.get(s.id) ?? 0, inSector) })).filter((s) => s.count).sort((a, b) => b.count - a.count),
    topAgencies: [...agencies.values()].sort((a, b) => b.count - a.count || a.agency.localeCompare(b.agency)).slice(0, 12),
    newAgencies: earlier ? [...agencies.keys()].filter((a) => !earlier.has(a)).length : null,
    returningAgencies: earlier ? [...agencies.keys()].filter((a) => earlier.has(a)).length : null,
    certificates: held.reduce((a, r) => a + r.certificates, 0),
    presenters: held.reduce((a, r) => a + r.presenters, 0),
    presenterOrgs: [...new Set(held.flatMap((r) => r.presenterOrgs))].length,
    survey: { answered, invited, rate: pctOf(answered, invited), quality: q("quality")?.top2 ?? null, practical: q("practical")?.top2 ?? null, confidence: q("confidence")?.top2 ?? null },
    scoring, sessions,
    communications: { members: inputs.members, campaigns: inputs.campaigns, estimatedEmails: inputs.members != null && inputs.campaigns != null ? inputs.members * inputs.campaigns : null,
      ...(trackOf(track) === "sponsor" ? { digitalReach: inputs.reach ?? null } : {}) },
    trainingsList: rows.map((r) => ({ id: r.id, title: r.title, province: r.province, cancelled: !!r.cancelled, agencies: r.held ? r.agencies.length : null,
      rbhSession: r.held ? r.rbhSession ?? null : null, city: r.city, dayOne: r.dayOne, lastDay: r.lastDay, days: r.days, held: r.held, attended: r.held ? r.attended : null,
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
// The sponsorship report says what RBH's money bought (Andrew 17 Nov 2026: "what are they getting for the value of their money?").
const SPONSOR_EXEC = { ...YE_SCHEMAS.exec, required: [...YE_SCHEMAS.exec.required, "value"], properties: { ...YE_SCHEMAS.exec.properties,
  value: LIST("Two short paragraphs on what RBH's sponsorship delivered this year: the speaking spots ONGIA held for RBH and the events where it presented in person, the people and different agencies it was in front of, the cities and provinces, the emails and digital reach, all from the figures given; then how RBH's own session was rated, if that figure was given.") } };
export const schemaFor = (kind, track) => (trackOf(track) === "sponsor" && kind === "exec" ? SPONSOR_EXEC : YE_SCHEMAS[kind]);
const LANG = { en: "English", fr: "Canadian French (as written for senior managers in Québec: natural, formal, not translated word for word)" };
/** The sponsorship report's brief: the KPIs the sponsorship agreement lists, from ONGIA's own events where RBH presented. */
const SPONSOR_SYSTEM = (kind, lang) => `You write the ${kind === "exec" ? "year-end sponsorship report" : "one-page year-end sponsorship infographic"} for Rothmans, Benson & Hedges (RBH), a national sponsor of ONGIA. ONGIA is a Canadian non-profit that trains law enforcement, corrections, border and justice staff on gangs, organized crime and illicit trade. RBH sponsors ONGIA's training program and presents at ONGIA's own training events on contraband tobacco and its links to organized crime. The figures are from the ONGIA events of the calendar year where RBH presented. The readers are RBH's senior leaders, and this is the annual KPI report the sponsorship agreement calls for: the people RBH presented to through ONGIA-led sessions, the cities and provinces where RBH took part, the emails to ONGIA's membership with contraband tobacco awareness messaging, the estimated digital reach, and attendance at each event.

Write in ${LANG[lang]}. Plain, confident, specific. No hype, no filler, no superlatives the figures don't support.

The figures you are given are the only figures that exist. Use them exactly; never compute, round differently, total, or invent one. If a figure is missing or null, leave the point out rather than guess. The attendance figures are everyone who attended those events, so call them the attendees of the events where RBH presented; don't claim each of them sat in RBH's session. The email figure is an estimate (members times campaigns) and must be called an estimate; so is the digital reach. These events are ONGIA's own; never call them RBH trainings or say RBH funded or ran a particular event.

The report must answer RBH's question: what did the sponsorship deliver? Lead with value: how many speaking spots ONGIA held for RBH and how many events RBH presented at, in front of how many people, in how many cities and provinces, how many different agencies (each counted once across the year, however many events it came to), and the estimated emails and digital reach. Being seen in person, in every province, by many different agencies is the point; say so where the figures show it. If RBH's own session was rated, say how. Where RBH had a spot but couldn't present (listed under "cancelled"), its audience is included in the figures: say plainly that ONGIA held a speaking spot for RBH there and RBH was unable to present, and give no reason. Never state, estimate or imply any amount of money, cost, price or value in dollars. Never mention social media. Never name or identify an attendee. For quotes, give only the id of a comment; the desk prints its exact words in the language it was written in.

ONGIA's requests for this document come last. Follow every one of them. They may add sections, change wording or emphasis, or leave things out; they can't change a figure or a quote's words.`;

export const YE_SYSTEM = (kind, lang, track = "consulting") => trackOf(track) === "sponsor" ? SPONSOR_SYSTEM(kind, lang) : `You write the ${kind === "exec" ? "year-end executive summary" : "one-page year-end infographic"} of ONGIA's partnership with Rothmans, Benson & Hedges (RBH). ONGIA is a Canadian non-profit that trains law enforcement, corrections, border and justice staff on organized crime and illicit trade; RBH funds a program of trainings with it. The readers are RBH's senior leaders, and the document shows them what the partnership delivered over the calendar year.

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
    output_config: { effort: "medium", format: { type: "json_schema", schema: schemaFor(kind, facts.track) } },
    system: YE_SYSTEM(kind, lang, facts.track),
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
const reportsKey = (year, track) => (trackOf(track) === "sponsor" ? `reports:yearend-sponsor:${year}` : `reports:yearend:${year}`);
export const yearReportsOf = async (year, track = "consulting") => (await getMeta(reportsKey(year, track))) ?? {};
export const putYearReports = (year, r, track = "consulting") => putMeta(reportsKey(year, track), r);

/** Make one year-end report again (both languages) and keep it as a new version. */
export async function buildYearReport(year, kind, { reason = "asked", ask = "", lang = "both", client = null, facts = null, now = new Date(), track = "consulting" } = {}) {
  track = trackOf(track);
  const all = await yearReportsOf(year, track);
  const r = { ...blank(), ...(all[kind] ?? {}) };
  const f = facts ?? (await yearFacts(year, { track }));
  if (!f.held) throw new Error(track === "sponsor" ? `No ONGIA event in ${year} where RBH presented has taken place yet.` : `No RBH training in ${year} has taken place yet.`);
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
  await putYearReports(year, { ...(await yearReportsOf(year, track)), [kind]: r }, track);
  return version;
}

export async function yearVersionPdf(year, kind, lang, n = null, track = "consulting") {
  const r = (await yearReportsOf(year, track))[kind];
  const v = r?.versions?.find((x) => x.n === (n ?? r.current));
  if (!v) return null;
  return (kind === "exec" ? yearExecPdf : v.facts?.track === "sponsor" ? yearSponsorInfoPdf : yearInfoPdf)(v.content[lang], v.facts, lang, { date: v.at.slice(0, 10) });
}

/** Both languages of the current version, to the year-end folder in the library. */
export async function fileYearReport(year, kind, { file = null, track = "consulting" } = {}) {
  const put = file ?? (await import("./graph.mjs")).fileLibraryDocument;
  const r = (await yearReportsOf(year, track))[kind];
  const out = {};
  for (const lang of ["en", "fr"]) {
    try {
      const bytes = await yearVersionPdf(year, kind, lang, null, track);
      const got = await put({ folder: yearFolder(year, track), name: yearFileName(kind, lang, year, track), bytes, contentType: "application/pdf" });
      out[lang] = got.skipped ? { skipped: got.reason } : { url: got.url, folderUrl: got.folderUrl, at: new Date().toISOString(), version: r.current };
    } catch (e) { out[lang] = { error: e.message }; }
  }
  const now = await yearReportsOf(year, track);
  await putYearReports(year, { ...now, [kind]: { ...now[kind], filed: out } }, track);
  return out;
}

/** Where both year-end reports stand, the shape the event reports use. */
export async function yearState(year, facts = null, track = "consulting") {
  track = trackOf(track);
  const all = await yearReportsOf(year, track);
  const f = facts ?? (await yearFacts(year, { track }));
  const one = (kind) => {
    const r = all[kind] ?? {};
    const cur = r.versions?.find((v) => v.n === r.current);
    return { name: kindNames(track)[kind], made: !!cur, current: r.current ?? 0, final: !!r.final, finalAt: r.finalAt ?? null, building: r.building ?? null, error: r.error ?? null,
      version: cur ? { n: cur.n, at: cur.at, reason: cur.reason, answered: cur.answered, invited: cur.invited } : null,
      versions: (r.versions ?? []).map((v) => ({ n: v.n, at: v.at, reason: v.reason, answered: v.answered })), requests: r.requests ?? [], chat: r.chat ?? [], filed: r.filed ?? null,
      newSince: cur ? Math.max(0, f.survey.answered - cur.answered) : 0 };
  };
  return { year: Number(year), track, answered: f.survey.answered, invited: f.survey.invited, held: f.held, folder: yearFolder(year, track),
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
    colProvince: "Province", colAttendees: "Attendees", topAgencies: "Agencies sending the most people", colAgency: "Agency", whoAttended: "Who attended, by sector", share: "Share",
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
    colProvince: "Province", colAttendees: "Participants", topAgencies: "Principaux organismes", colAgency: "Organisme", whoAttended: "Participants par secteur", share: "Part",
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
// The sponsorship report's own words (Andrew 17 Nov 2026): ONGIA's events where RBH presented, never "RBH trainings",
// and the KPI table the sponsorship agreement lists.
const TS = {
  en: { exec: "Sponsorship Report", partner: (y) => `RBH's sponsorship of ONGIA training · ${y}`, review: (y) => `Sponsorship year in review · ${y}`, kicker: "Sponsorship results",
    trainings: "ONGIA events where RBH presented", colTraining: "Event", toCome: "To come",
    growText: (n, r) => `${n} agencies attended an ONGIA event with RBH presenting for the first time; ${r} had attended one before.`,
    comm: (m, c, e, y) => (m != null && c != null ? `ONGIA sent ${c} email campaigns with contraband tobacco awareness messaging to its ${m} members in ${y}, about ${e} emails (an estimate: members × campaigns).`
      : m != null ? `ONGIA's member database holds ${m} members.` : c != null ? `ONGIA sent ${c} email campaigns with contraband tobacco awareness messaging in ${y}.` : ""),
    booked: (n, y) => `${n} ONGIA event${n === 1 ? "" : "s"} with RBH presenting already booked for ${y}.`,
    tTrainings: "Events", tTraining1: "Event", tTrained: "Attendees", tTrainedSub: (b) => (b === "registered" ? "registered" : "at events with RBH"),
    footExec: (y) => `Sponsorship Report ${y} · ONGIA and RBH`,
    kpis: "KPIs from the sponsorship agreement", kpi: "KPI", result: "Result", notYet: "Not entered yet", seeTable: (n) => `${n} event${n === 1 ? "" : "s"}; see the table below`,
    kPeople: "Individuals RBH presented to through ONGIA-led sessions", kPeopleR: (a, c) => `${a} attendees at the events where RBH presented${c ? " or held a speaking spot" : ""}`,
    kWhere: "Cities and provinces where RBH participated", kWhereR: (c, p, list) => `${c} cit${c === "1" ? "y" : "ies"} in ${p} province${p === "1" ? "" : "s"}${list ? ` (${list})` : ""}`,
    kEmails: "Emails to ONGIA's membership with contraband tobacco awareness messaging", kEmailsR: (e, m, c) => `About ${e} (an estimate: ${m} members × ${c} campaigns)`,
    kReach: "Estimated digital reach and engagement with RBH awareness materials", kReachR: (r) => `About ${r} (an estimate)`,
    kAttend: "Event-specific attendance", tReach: "Digital reach", tReachSub: "estimated",
    valueHead: (y) => `What RBH's sponsorship delivered in ${y}`, measure2: "Measure", figure: "Figure",
    vSpots: "Speaking spots ONGIA held for RBH", vSpotsR: (n, p, c) => `${n} (${p} presented${c !== "0" ? `, ${c} where RBH was unable to present` : ""})`, vEvents: "Events where RBH presented in person", vEventsR: (n, c) => `${n} in ${c} cit${c === "1" ? "y" : "ies"}`,
    vHeldIn: "Provinces where RBH presented", vPeople: "People at those events", vAgencies: "Different agencies in front of RBH (each counted once)", vAgenciesR: (n, k) => (k != null ? `${n} (${k} new this year)` : n),
    vFrom: "Provinces the audience came from", vEmails: "Emails with contraband tobacco awareness messaging", vReach: "Estimated digital reach",
    cancelledNote: (list) => `ONGIA held a speaking spot for RBH at ${list}; RBH was unable to present. Its attendees are included in the figures in this report.`, vSession: "RBH's own session rated 4 or 5",
    vSessionR: (t, n, k) => `${t} (${n} answers, ${k} event${k === "1" ? "" : "s"})`, estimate: "(estimate)",
    colAgencies: "Agencies", colRbh: "RBH session", sessionNote: "RBH session: share who rated RBH's own session 4 or 5 out of 5, where RBH's presenter is on the agenda." },
  fr: { exec: "Rapport sur la commandite", partner: (y) => `La commandite de RBH à la formation de l'ONGIA · ${y}`, review: (y) => `Bilan de la commandite · ${y}`, kicker: "Résultats de la commandite",
    trainings: "Événements de l'ONGIA où RBH a présenté", colTraining: "Événement", toCome: "À venir",
    growText: (n, r) => `${n} organismes ont assisté pour la première fois à un événement de l'ONGIA où RBH a présenté; ${r} y avaient déjà assisté.`,
    comm: (m, c, e, y) => (m != null && c != null ? `L'ONGIA a envoyé ${c} campagnes de courriels de sensibilisation au tabac de contrebande à ses ${m} membres en ${y}, soit environ ${e} courriels (estimation : membres × campagnes).`
      : m != null ? `La base de données de l'ONGIA compte ${m} membres.` : c != null ? `L'ONGIA a envoyé ${c} campagnes de courriels de sensibilisation au tabac de contrebande en ${y}.` : ""),
    booked: (n, y) => `${n} événement${n === 1 ? "" : "s"} de l'ONGIA avec une présentation de RBH déjà prévu${n === 1 ? "" : "s"} en ${y}.`,
    tTrainings: "Événements", tTraining1: "Événement", tTrained: "Participants", tTrainedSub: (b) => (b === "registered" ? "inscrits" : "aux événements avec RBH"),
    footExec: (y) => `Rapport sur la commandite ${y} · ONGIA et RBH`,
    kpis: "Indicateurs de l'entente de commandite", kpi: "Indicateur", result: "Résultat", notYet: "Pas encore saisi", seeTable: (n) => `${n} événement${n === 1 ? "" : "s"}; voir le tableau ci-dessous`,
    kPeople: "Personnes auxquelles RBH a présenté dans le cadre des séances de l'ONGIA", kPeopleR: (a, c) => `${a} participants aux événements où RBH a présenté${c ? " ou avait une place de conférencier" : ""}`,
    kWhere: "Villes et provinces où RBH a participé", kWhereR: (c, p, list) => `${c} ville${c === "1" ? "" : "s"} dans ${p} province${p === "1" ? "" : "s"}${list ? ` (${list})` : ""}`,
    kEmails: "Courriels aux membres de l'ONGIA avec un message de sensibilisation au tabac de contrebande", kEmailsR: (e, m, c) => `Environ ${e} (estimation : ${m} membres × ${c} campagnes)`,
    kReach: "Portée et engagement numériques estimés des documents de sensibilisation de RBH", kReachR: (r) => `Environ ${r} (estimation)`,
    kAttend: "Participation par événement", tReach: "Portée numérique", tReachSub: "estimée",
    valueHead: (y) => `Ce que la commandite de RBH a permis en ${y}`, measure2: "Mesure", figure: "Résultat",
    vSpots: "Places de conférencier réservées à RBH par l'ONGIA", vSpotsR: (n, p, c) => `${n} (${p} présentation${p === "1" ? "" : "s"}${c !== "0" ? `, ${c} où RBH n'a pas pu présenter` : ""})`, vEvents: "Événements où RBH a présenté en personne", vEventsR: (n, c) => `${n} dans ${c} ville${c === "1" ? "" : "s"}`,
    vHeldIn: "Provinces où RBH a présenté", vPeople: "Participants à ces événements", vAgencies: "Organismes différents devant qui RBH a présenté (chacun compté une fois)", vAgenciesR: (n, k) => (k != null ? `${n} (${k} nouveaux cette année)` : n),
    vFrom: "Provinces d'où venaient les participants", vEmails: "Courriels de sensibilisation au tabac de contrebande", vReach: "Portée numérique estimée",
    cancelledNote: (list) => `L'ONGIA a réservé une place de conférencier à RBH à ${list}; RBH n'a pas pu présenter. Ses participants sont inclus dans les chiffres de ce rapport.`, vSession: "Séance de RBH notée 4 ou 5",
    vSessionR: (t, n, k) => `${t} (${n} réponses, ${k} événement${k === "1" ? "" : "s"})`, estimate: "(estimation)",
    colAgencies: "Organismes", colRbh: "Séance RBH", sessionNote: "Séance RBH : part ayant noté la séance de RBH 4 ou 5 sur 5, lorsque le conférencier de RBH figure au programme." },
};
const textOf = (lang, f) => (f?.track === "sponsor" ? { ...T[lang], ...TS[lang] } : T[lang]);

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
  const L = textOf(lang, f);
  const navy = [
    { big: num(f.trainings, lang), label: f.trainings === 1 ? L.tTraining1 : L.tTrainings, sub: L.tCities(new Set(f.trainingsList.map((t) => cityKey(t.city)).filter(Boolean)).size) },
    { big: num(f.attendees, lang), label: L.tTrained, sub: L.tTrainedSub(f.attendanceBasis) },
    { big: num(f.agencyCount, lang), label: f.agencyCount === 1 ? L.tAgency1 : L.tAgencies, sub: L.tAgSub(f.newAgencies) },
    { big: num(f.provinceCount, lang), label: f.provinceCount === 1 ? L.tProv1 : L.tProv, sub: f.provinceCount === 1 ? L.tProvSub1 : L.tProvSub },
  ];
  const c = f.communications;
  const gold = [
    c.estimatedEmails != null ? { big: `~${num(c.estimatedEmails, lang)}`, label: L.tEmails, sub: L.tEmailsSub(num(c.members, lang)) } : null,
    f.track === "sponsor" && c.digitalReach != null ? { big: `~${num(c.digitalReach, lang)}`, label: L.tReach, sub: L.tReachSub } : null,
    f.survey.quality != null ? { big: pc(f.survey.quality, lang), label: L.tQuality, sub: L.tQualitySub } : null,
    f.survey.confidence != null ? { big: pc(f.survey.confidence, lang), label: L.tConf, sub: L.tConfSub } : null,
    f.certificates ? { big: num(f.certificates, lang), label: L.tCerts, sub: L.tCertsSub } : null,
  ].filter(Boolean).slice(0, 4);
  return { navy, gold };
}
function tile(doc, t, x, y, w, h, goldTile, big = 24) {
  doc.rect(x, y, w, h).fill(goldTile ? GOLD : NAVY);
  doc.font("b").fontSize(big).fillColor("#fff").text(t.big, x, y + h * 0.16, { width: w, align: "center", lineBreak: false });
  doc.font("b").fontSize(7).fillColor(goldTile ? "#fff" : "#d9b65a").text(t.label.toUpperCase(), x + 3, y + h * 0.16 + big + 4, { width: w - 6, align: "center", characterSpacing: 1, lineBreak: false });
  if (t.sub) doc.font("r").fontSize(7).fillColor(goldTile ? "#fff3d1" : "#c9d0e0").text(t.sub, x + 3, y + h * 0.16 + big + 14, { width: w - 6, align: "center", lineBreak: false, height: 9, ellipsis: true });
}

export async function yearExecPdf(content, f, lang, { date }) {
  const L = textOf(lang, f), Y = f.year;
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
  if (f.track === "sponsor") {
    const c = f.communications, cities = new Set(f.trainingsList.filter((r) => r.held).map((r) => cityKey(r.city)).filter(Boolean)).size;
    const provs = (f.heldInProvinces ?? []).map((p) => (lang === "fr" ? PROV_FR[p.code] : p.en)).join(", ");
    h2(L.kpis, 150);
    table([{ label: L.kpi, w: 0.5 }, { label: L.result, w: 0.5 }], [
      [L.kPeople, L.kPeopleR(num(f.attendees, lang), f.cancelled?.length)],
      [L.kWhere, L.kWhereR(num(cities, lang), num((f.heldInProvinces ?? []).length, lang), provs)],
      [L.kEmails, c.estimatedEmails != null ? L.kEmailsR(num(c.estimatedEmails, lang), num(c.members, lang), num(c.campaigns, lang)) : L.notYet],
      [L.kReach, c.digitalReach != null ? L.kReachR(num(c.digitalReach, lang)) : L.notYet],
      [L.kAttend, L.seeTable(f.held)],
    ]);
    doc.moveDown(0.3);
    // What RBH's money bought (Andrew 17 Nov 2026).
    const V = f.value ?? {};
    h2(L.valueHead(Y), 160);
    for (const p of content.value ?? []) para(p);
    const est = (t) => `${t} ${L.estimate}`;
    table([{ label: L.measure2, w: 0.6 }, { label: L.figure, w: 0.4, align: "right" }], [
      V.cancelledSpots ? [L.vSpots, L.vSpotsR(num(V.spots, lang), num(V.presentedAt, lang), num(V.cancelledSpots, lang))] : null,
      [L.vEvents, L.vEventsR(num(f.value?.presentedAt ?? f.held, lang), num(new Set(f.trainingsList.filter((r) => r.held && !r.cancelled).map((r) => cityKey(r.city)).filter(Boolean)).size, lang))],
      provs ? [L.vHeldIn, provs] : null,
      [L.vPeople, num(f.attendees, lang)],
      [L.vAgencies, L.vAgenciesR(num(f.agencyCount, lang), f.newAgencies != null ? num(f.newAgencies, lang) : null)],
      f.provinceCount ? [L.vFrom, num(f.provinceCount, lang)] : null,
      c.estimatedEmails != null ? [L.vEmails, est(`~${num(c.estimatedEmails, lang)}`)] : null,
      c.digitalReach != null ? [L.vReach, est(`~${num(c.digitalReach, lang)}`)] : null,
      V.rbhSessionTop2 != null ? [L.vSession, L.vSessionR(pc(V.rbhSessionTop2, lang), num(V.rbhSessionAnswers, lang), num(V.rbhSessions, lang))] : null,
    ].filter(Boolean));
    doc.moveDown(0.3);
  }
  h2(L.trainings, 120);
  const held = f.trainingsList.filter((r) => r.held);
  if (f.track === "sponsor") {
    // Each event: where, how many people, how many agencies, and how RBH's own session was rated.
    const rows = f.trainingsList.map((r) => [r.cancelled ? `${r.title} *` : r.title, r.city, span(r.dayOne, r.lastDay, lang), r.held ? num(r.attended, lang) : L.toCome, r.agencies != null ? num(r.agencies, lang) : "", r.rbhSession?.n ? pc(r.rbhSession.top2, lang) : "", r.quality != null ? pc(r.quality, lang) : ""]);
    rows.push([L.total, "", "", num(f.attendees, lang), num(f.agencyCount, lang), f.value?.rbhSessionTop2 != null ? pc(f.value.rbhSessionTop2, lang) : "", f.survey.quality != null ? pc(f.survey.quality, lang) : ""]);
    table([{ label: L.colTraining, w: 0.29 }, { label: L.colCity, w: 0.12 }, { label: L.colDates, w: 0.12 }, { label: L.colAttended, w: 0.1, align: "right" }, { label: L.colAgencies, w: 0.11, align: "right" }, { label: L.colRbh, w: 0.15, align: "right" }, { label: L.colQuality, w: 0.11, align: "right" }], rows, { bold: rows.length - 1 });
    doc.moveDown(0.3); para(L.sessionNote, { font: "i", size: 8.5, color: MUTED });
    if (f.cancelled?.length) para("* " + L.cancelledNote(f.cancelled.map((e) => `${e.title} (${[e.city, span(e.dayOne, e.lastDay, lang)].filter(Boolean).join(", ")})`).join("; ")));
  } else {
  const rows = f.trainingsList.map((r) => [r.title, r.city, span(r.dayOne, r.lastDay, lang), r.held ? num(r.attended, lang) : L.toCome, r.surveyRate != null ? pc(r.surveyRate, lang) : "", r.quality != null ? pc(r.quality, lang) : ""]);
  rows.push([L.total, "", "", num(held.reduce((a, r) => a + (r.attended ?? 0), 0), lang), f.survey.invited ? pc(f.survey.rate, lang) : "", f.survey.quality != null ? pc(f.survey.quality, lang) : ""]);
  table([{ label: L.colTraining, w: 0.38 }, { label: L.colCity, w: 0.15 }, { label: L.colDates, w: 0.15 }, { label: L.colAttended, w: 0.11, align: "right" }, { label: L.colSurvey, w: 0.1, align: "right" }, { label: L.colQuality, w: 0.11, align: "right" }], rows, { bold: rows.length - 1 });
  doc.moveDown(0.3); para(L.note, { font: "i", size: 8.5, color: MUTED });
  }

  // Page 2: reach, communications, the survey, attendees' words. (The sponsorship report runs on from its events table.)
  if (f.track === "sponsor") room(240); else doc.addPage();
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
  if (f.sectors?.length) {
    doc.moveDown(0.3);
    table([{ label: L.whoAttended, w: 0.7 }, { label: L.colAttendees, w: 0.15, align: "right" }, { label: L.share, w: 0.15, align: "right" }], f.sectors.map((s) => [lang === "fr" ? s.fr : s.en, num(s.count, lang), pc(s.pct, lang)]));
    doc.moveDown(0.4);
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
  const L = textOf(lang, f), Y = f.year;
  const { doc, done } = newDoc(`${L.review(Y)} — ${kindNames(f.track).info[lang]}`);
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
    // The map, as on the event infographics (Andrew 17 Nov 2026: "let's do that with everyone"): where the trainings
    // were held in gold with how many came, where attendees came from in blue.
    ry = provinceMapPdf(doc, { x: rx, y: ry, w: rw, f, bg: "#ffffff", off: "#e7ebf3", light: true }) + 8;
    const maxP = Math.max(1, ...f.provinces.map((p) => p.count));
    for (const p of f.provinces.slice(0, 6)) {
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

/* ---------- The sponsorship infographic (Andrew 17 Nov 2026: "an infographic … that could speak to the stats, shows it in a
   pretty cool display … what are they getting for the value of their money?"): one page, dark navy and gold like the
   event infographics he likes, the return on RBH's money first, a map of where RBH stood in front of people, its events. ---------- */

const IG = {
  en: { kicker: (y) => `Sponsorship year in review · ${y}`, pair: "Rothmans, Benson & Hedges × ONGIA", spots: (n, p, c) => `speaking spot${n === 1 ? "" : "s"} held for RBH${c ? ` · presented at ${p}, unable to present at ${c}` : ""}`, cancelledTag: "Spot held for RBH · unable to present",
    people: "people", agencies: "different agencies", provinces: "provinces", events: "events", province1: "province", event1: "event", agency1: "agency", inCities: (c) => `in ${c} cit${c === 1 ? "y" : "ies"}`,
    peopleSub: "at events where RBH presented or had a spot", agenciesSub: "each counted once", provincesSub: "where RBH presented or had a spot", eventsSub: "RBH presented in person",
    emails: "Emails", emailsSub: "contraband tobacco messaging", reach: "Digital reach", reachSub: "estimated",
    session: "RBH's session", sessionSub: "rated 4 or 5", quality: "Event quality", qualitySub: "rated 4 or 5",
    map: "Where RBH stood in front of people", mapKey1: "RBH presented or had a spot here", mapKey2: "Audience came from here", list: "The events", sectors: "Who RBH reached", ahead: (n, y) => `${n} event${n === 1 ? "" : "s"} with RBH already booked for ${y}`,
    foot: "ONGIA · WWW.ONGIA.CA", prep: (d) => `Prepared by ONGIA · ${d}`, toCome: "To come" },
  fr: { kicker: (y) => `Bilan de la commandite · ${y}`, pair: "Rothmans, Benson & Hedges × ONGIA", spots: (n, p, c) => `place${n === 1 ? "" : "s"} de conférencier réservée${n === 1 ? "" : "s"} à RBH${c ? ` · ${p} présentation${p === 1 ? "" : "s"}, ${c} où RBH n'a pas pu présenter` : ""}`, cancelledTag: "Place réservée · RBH n'a pas pu présenter",
    people: "personnes", agencies: "organismes différents", provinces: "provinces", events: "événements", province1: "province", event1: "événement", agency1: "organisme", inCities: (c) => `dans ${c} ville${c === 1 ? "" : "s"}`,
    peopleSub: "aux événements avec une place pour RBH", agenciesSub: "chacun compté une fois", provincesSub: "où RBH avait une place", eventsSub: "RBH a présenté en personne",
    emails: "Courriels", emailsSub: "sur le tabac de contrebande", reach: "Portée numérique", reachSub: "estimée",
    session: "Séance de RBH", sessionSub: "note de 4 ou 5", quality: "Qualité", qualitySub: "note de 4 ou 5",
    map: "Où RBH s'est présenté devant le public", mapKey1: "RBH a présenté ou avait une place ici", mapKey2: "Provenance du public", list: "Les événements", sectors: "Qui RBH a joint", ahead: (n, y) => `${n} événement${n === 1 ? "" : "s"} avec RBH déjà prévu${n === 1 ? "" : "s"} en ${y}`,
    foot: "ONGIA · WWW.ONGIA.CA", prep: (d) => `Préparé par l'ONGIA · ${d}`, toCome: "À venir" },
};
let CANADA = null;
const canadaMap = () => (CANADA ??= JSON.parse(readFileSync(PDF_LOOK.MAPFILE, "utf8")));
const DARK_LOGO = nodePath.join(nodePath.dirname(PDF_LOOK.LOGO), "ongia-logo-tagline-dark.png");

export async function yearSponsorInfoPdf(content, f, lang, { date }) {
  const L = IG[lang], Y = f.year, V = f.value ?? {}, c = f.communications ?? {};
  const BG = "#020d1c", PANEL = "#082040", RULE = "#5a4a20", G = "#e0b34a", GL = "#f0cd73", SOFT = "#9fb0d1", OFF = "#122a4f", AUD = "#3c5f99";
  const { doc, done } = newDoc(`${L.kicker(Y)} — ${kindNames("sponsor").info[lang]}`);
  const PW = doc.page.width, PH = doc.page.height, X = 34, W = PW - 68;
  doc.page.margins.bottom = 0;
  doc.rect(0, 0, PW, PH).fill(BG);
  // A soft blue glow behind the top, as on the event infographics.
  const glow = doc.radialGradient(PW / 2, 120, 10, PW / 2, 120, 380); glow.stop(0, "#173a6e", 0.55).stop(1, BG, 0);
  doc.rect(0, 0, PW, 320).fill(glow);
  try { doc.image(DARK_LOGO, X, 26, { height: 34 }); } catch { doc.font("b").fontSize(20).fillColor(G).text("ONGIA", X, 30); }
  doc.font("b").fontSize(8).fillColor(G).text(L.kicker(Y).toUpperCase(), X, 32, { width: W, align: "right", characterSpacing: 1.4 });
  doc.font("r").fontSize(7.5).fillColor(SOFT).text(L.pair, X, 45, { width: W, align: "right" });
  doc.font("b").fontSize(24).fillColor("#ffffff").text(content.headline || L.kicker(Y), X, 78, { width: W, lineGap: -3 });
  if (content.tagline) doc.font("i").fontSize(11).fillColor(G).text(content.tagline, X, doc.y + 2, { width: W });
  let y = doc.y + 12;

  // The speaking spots ONGIA held for RBH, then four big figures.
  const cities = new Set(f.trainingsList.filter((r) => r.held).map((r) => cityKey(r.city)).filter(Boolean)).size;
  const heldIn = (f.heldInProvinces ?? []).length;
  if (V.spots) {
    doc.roundedRect(X, y, W, 40, 4).fill(PANEL);
    doc.rect(X, y, 4, 40).fill(G);
    doc.font("b").fontSize(22).fillColor(G).text(num(V.spots, lang), X + 16, y + 9, { lineBreak: false });
    const mw = doc.widthOfString(num(V.spots, lang));
    doc.font("r").fontSize(10).fillColor("#ffffff").text(L.spots(V.spots, V.presentedAt, V.cancelledSpots), X + 26 + mw, y + 15, { lineBreak: false, width: W - 40 - mw, height: 14, ellipsis: true });
    y += 48;
  }
  const big = [
    [num(f.attendees, lang), L.people, L.peopleSub],
    [num(f.agencyCount, lang), f.agencyCount === 1 ? L.agency1 : L.agencies, L.agenciesSub],
    [num(heldIn || f.provinceCount, lang), (heldIn || f.provinceCount) === 1 ? L.province1 : L.provinces, L.provincesSub],
    [num(V.presentedAt ?? f.held, lang), (V.presentedAt ?? f.held) === 1 ? L.event1 : L.events, `${L.eventsSub} · ${L.inCities(new Set(f.trainingsList.filter((r) => r.held && !r.cancelled).map((r) => cityKey(r.city)).filter(Boolean)).size)}`],
  ];
  const gap = 8, bw = (W - gap * 3) / 4;
  big.forEach(([n, l, sub], i) => {
    const bx = X + i * (bw + gap);
    doc.roundedRect(bx, y, bw, 78, 4).lineWidth(0.8).strokeColor(RULE).stroke();
    doc.font("b").fontSize(32).fillColor(G).text(n, bx, y + 8, { width: bw, align: "center", lineBreak: false });
    doc.font("b").fontSize(8).fillColor("#ffffff").text(l.toUpperCase(), bx + 4, y + 46, { width: bw - 8, align: "center", characterSpacing: 1, lineBreak: false });
    doc.font("r").fontSize(7).fillColor(SOFT).text(sub, bx + 4, y + 58, { width: bw - 8, align: "center", height: 18, ellipsis: true });
  });
  y += 86;
  // A second row: emails, reach, cost per person and per agency, RBH's own session; whichever are known, up to five.
  const small = [
    c.estimatedEmails != null ? [`~${num(c.estimatedEmails, lang)}`, L.emails, L.emailsSub] : null,
    c.digitalReach != null ? [`~${num(c.digitalReach, lang)}`, L.reach, L.reachSub] : null,
    f.cities?.length > 1 ? [num(f.cities.length, lang), lang === "fr" ? "Villes" : "Cities", f.cancelled?.length ? (lang === "fr" ? "où RBH avait une place" : "where RBH presented or had a spot") : (lang === "fr" ? "où RBH a présenté" : "where RBH presented")] : null,
    f.provinceCount > 1 ? [num(f.provinceCount, lang), "Provinces", lang === "fr" ? "d'où venait le public" : "the audience came from"] : null,
    f.newAgencies != null ? [num(f.newAgencies, lang), lang === "fr" ? "Nouveaux organismes" : "New agencies", lang === "fr" ? "cette année" : "this year"] : null,
    V.rbhSessionTop2 != null ? [pc(V.rbhSessionTop2, lang), L.session, L.sessionSub] : f.survey?.quality != null ? [pc(f.survey.quality, lang), L.quality, L.qualitySub] : null,
  ].filter(Boolean).slice(0, 5);
  if (small.length) {
    // Never wider than a quarter of the page each, centred, so one or two figures don't stretch across it.
    const sw = Math.min((W - gap * 3) / 4, (W - gap * (small.length - 1)) / small.length), off = (W - (sw * small.length + gap * (small.length - 1))) / 2;
    small.forEach(([n, l, sub], i) => {
      const sx = X + off + i * (sw + gap);
      doc.roundedRect(sx, y, sw, 52, 4).fill(PANEL);
      doc.font("b").fontSize(17).fillColor("#ffffff").text(n, sx, y + 7, { width: sw, align: "center", lineBreak: false });
      doc.font("b").fontSize(7).fillColor(G).text(l.toUpperCase(), sx + 3, y + 29, { width: sw - 6, align: "center", characterSpacing: 0.8, lineBreak: false, height: 9, ellipsis: true });
      if (sub) doc.font("r").fontSize(6.5).fillColor(SOFT).text(sub, sx + 3, y + 39, { width: sw - 6, align: "center", lineBreak: false, height: 9, ellipsis: true });
    });
    y += 62;
  }

  // The map: gold where RBH presented, blue where its audience came from.
  const head = (t, hx, hy, hw) => { doc.font("b").fontSize(9).fillColor(G).text(t.toUpperCase(), hx, hy, { width: hw, characterSpacing: 1.2, lineBreak: false }); doc.moveTo(hx, hy + 13).lineTo(hx + hw, hy + 13).lineWidth(0.6).strokeColor(RULE).stroke(); return hy + 20; };
  const mw = W * 0.56, M = canadaMap(), sc = mw / M.w, mh = M.h * sc;
  let my = head(L.map, X, y, mw);
  const presented = new Set((f.heldInProvinces ?? []).map((p) => p.code)), came = new Set((f.provinces ?? []).map((p) => p.code));
  for (const [code, d] of Object.entries(M.paths)) {
    doc.save(); doc.translate(X, my).scale(sc);
    doc.path(d).lineWidth(1.2 / sc).lineJoin("round").fillAndStroke(presented.has(code) ? G : came.has(code) ? AUD : OFF, BG);
    doc.restore();
  }
  // How many were at the events in each province where RBH presented, on the province.
  const byHeld = new Map();
  for (const r of f.trainingsList.filter((t) => t.held)) if (r.province) byHeld.set(r.province, (byHeld.get(r.province) ?? 0) + (r.attended ?? 0));
  for (const [code, n] of byHeld) {
    const a = M.anchors?.[code]; if (!a) continue;
    // The count sits just off the province on a thin line, so a small one (New Brunswick, PEI) still shows its gold.
    const ax = X + a[0] * sc, ay = my + a[1] * sc, bx = Math.min(X + mw - 12, ax + 22), by = Math.max(my + 12, ay - 24);
    doc.moveTo(ax, ay).lineTo(bx, by).lineWidth(0.8).strokeColor(GL).stroke(); doc.circle(ax, ay, 1.8).fill(GL);
    doc.circle(bx, by, 11).fill(BG); doc.circle(bx, by, 11).lineWidth(1).strokeColor(G).stroke();
    doc.font("b").fontSize(7.5).fillColor("#ffffff").text(num(n, lang), bx - 11, by - 3.5, { width: 22, align: "center", lineBreak: false });
  }
  const ky = my + mh + 6;
  doc.rect(X, ky, 8, 8).fill(G); doc.font("r").fontSize(7).fillColor(SOFT).text(L.mapKey1, X + 12, ky, { lineBreak: false });
  const k2 = X + 12 + doc.widthOfString(L.mapKey1) + 16;
  doc.rect(k2, ky, 8, 8).fill(AUD); doc.text(L.mapKey2, k2 + 12, ky, { lineBreak: false });
  const leftEnd = ky + 14;

  // Beside the map: each event with a bar for its people, then who RBH reached by sector.
  const rx = X + mw + 18, rw = W - mw - 18;
  let ry = head(L.list, rx, y, rw);
  const evs = f.trainingsList.slice(0, 9), maxA = Math.max(1, ...evs.map((r) => r.attended ?? 0));
  for (const r of evs) {
    doc.font("b").fontSize(8).fillColor(r.held ? "#ffffff" : SOFT).text(r.title, rx, ry, { width: rw, lineBreak: false, height: 10, ellipsis: true });
    doc.font(r.cancelled ? "i" : "r").fontSize(7).fillColor(r.cancelled ? GL : SOFT).text(r.cancelled ? L.cancelledTag : `${r.city ? `${r.city} · ` : ""}${span(r.dayOne, r.lastDay, lang)}`, rx, ry + 10, { width: rw * 0.55, lineBreak: false, height: 9, ellipsis: true });
    if (r.held) {
      const bx = rx + rw * 0.55, bwid = rw * 0.33;
      doc.rect(bx, ry + 11, bwid, 6).fill(OFF); doc.rect(bx, ry + 11, Math.max(2, bwid * (r.attended ?? 0) / maxA), 6).fill(G);
      doc.font("b").fontSize(8).fillColor("#ffffff").text(num(r.attended, lang), bx + bwid, ry + 9, { width: rw - rw * 0.55 - bwid, align: "right", lineBreak: false });
    } else doc.font("i").fontSize(7).fillColor(SOFT).text(L.toCome, rx + rw * 0.4, ry + 10, { width: rw * 0.6, align: "right", lineBreak: false, height: 9, ellipsis: true });
    ry += 25;
  }
  if (f.sectors?.length && ry + 30 < leftEnd + 40) {
    ry = head(L.sectors, rx, ry + 4, rw);
    for (const sct of f.sectors.slice(0, 5)) {
      doc.font("r").fontSize(7.5).fillColor("#ffffff").text(lang === "fr" ? sct.fr : sct.en, rx, ry, { width: rw * 0.62, lineBreak: false, height: 9, ellipsis: true });
      doc.rect(rx + rw * 0.64, ry + 1, rw * 0.24, 6).fill(OFF); doc.rect(rx + rw * 0.64, ry + 1, Math.max(2, rw * 0.24 * sct.pct / 100), 6).fill(GL);
      doc.font("b").fontSize(7.5).fillColor("#ffffff").text(pc(sct.pct, lang), rx + rw * 0.88, ry, { width: rw * 0.12, align: "right", lineBreak: false });
      ry += 13;
    }
  }
  y = Math.max(leftEnd, ry) + 12;

  // An attendee's words, then what's booked next year, if they fit.
  const BOTTOM = PH - 44;
  if (content.quote?.text) {
    const qh = Math.min(70, doc.font("b").fontSize(11).heightOfString(`“${content.quote.text}”`, { width: W - 40 }) + 30);
    if (y + qh < BOTTOM - 40) {
      doc.roundedRect(X, y, W, qh, 4).fill(PANEL); doc.rect(X, y, 4, qh).fill(G);
      doc.font("b").fontSize(11).fillColor("#ffffff").text(`“${content.quote.text}”`, X + 18, y + 10, { width: W - 40, height: qh - 26, ellipsis: true });
      doc.font("b").fontSize(7).fillColor(G).text(`— ${String(content.quote.about).toUpperCase()}`, X + 18, y + qh - 14, { width: W - 40, height: 9, ellipsis: true, lineBreak: false, characterSpacing: 1 });
      y += qh + 10;
    }
  }
  if (f.nextYear?.count && y + 26 < BOTTOM) {
    doc.roundedRect(X, y, W, 26, 4).lineWidth(0.8).strokeColor(RULE).stroke();
    doc.font("b").fontSize(9).fillColor("#ffffff").text(L.ahead(f.nextYear.count, Y + 1), X + 14, y + 8.5, { width: W - 80, lineBreak: false });
    doc.font("b").fontSize(9).fillColor(G).text(String(Y + 1), X, y + 8.5, { width: W - 14, align: "right", characterSpacing: 1.2, lineBreak: false });
  }
  const fy = PH - 30;
  doc.moveTo(X, fy - 7).lineTo(X + W, fy - 7).lineWidth(0.5).strokeColor(RULE).stroke();
  doc.font("b").fontSize(8).fillColor(G).text(L.foot, X, fy, { width: W / 2, lineBreak: false, characterSpacing: 1 });
  doc.font("r").fontSize(7).fillColor(SOFT).text(L.prep(monthYear(date, lang)), X + W / 2, fy, { width: W / 2, align: "right", lineBreak: false });
  doc.end();
  return done;
}

/** The province map on a PDF page: held-in provinces gold with their people, audience provinces blue. Returns the bottom. */
function provinceMapPdf(doc, { x, y, w, f, bg, off, light = false }) {
  const M = canadaMap(), sc = w / M.w, h = M.h * sc, G = "#e0b34a", GL = "#f0cd73";
  const held = new Map();
  for (const r of f.trainingsList.filter((t) => t.held)) if (r.province) held.set(r.province, (held.get(r.province) ?? 0) + (r.attended ?? 0));
  const came = new Map((f.provinces ?? []).map((p) => [p.code, p.count])), max = Math.max(1, ...came.values());
  const lo = light ? [0xc3, 0xd0, 0xe6] : [0x1d, 0x3f, 0x72], hi = light ? [0x3c, 0x5f, 0x99] : [0x72, 0x9c, 0xdc];
  const blue = (n) => { const t = Math.sqrt(n / max); return "#" + lo.map((v, i) => Math.round(v + (hi[i] - v) * t).toString(16).padStart(2, "0")).join(""); };
  for (const [code, d] of Object.entries(M.paths)) {
    doc.save(); doc.translate(x, y).scale(sc);
    doc.path(d).lineWidth(1.2 / sc).lineJoin("round").fillAndStroke(held.has(code) ? G : came.get(code) ? blue(came.get(code)) : off, bg);
    doc.restore();
  }
  for (const [code, n] of held) {
    const a = M.anchors?.[code]; if (!a) continue;
    const ax = x + a[0] * sc, ay = y + a[1] * sc, bx = Math.min(x + w - 12, ax + 20), by = Math.max(y + 12, ay - 22);
    doc.moveTo(ax, ay).lineTo(bx, by).lineWidth(0.8).strokeColor(light ? "#b8902f" : GL).stroke(); doc.circle(ax, ay, 1.6).fill(light ? "#b8902f" : GL);
    doc.circle(bx, by, 10).fill(light ? NAVY : bg); doc.circle(bx, by, 10).lineWidth(1).strokeColor(G).stroke();
    doc.font("b").fontSize(7).fillColor("#ffffff").text(num(n, "en"), bx - 10, by - 3.3, { width: 20, align: "center", lineBreak: false });
  }
  return y + h;
}

/* ---------- The list on Admin › RBH reports ---------- */

/** The years that have RBH trainings (practice ones included, so the page can be tried), newest last. */
export function rbhYears(events, now = today()) {
  return [...new Set([...events.filter((e) => e.kind === "rbh" && yearOf(e)).map(yearOf), now.slice(0, 4)])].sort();
}
