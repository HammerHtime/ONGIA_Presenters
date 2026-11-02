import Anthropic from "@anthropic-ai/sdk";
import { anthropicKey } from "./contract.mjs";
import { getMeta, putMeta, getAttendees, listEvents, listPresenters } from "./store.mjs";
import { writeableTo } from "./attendees.mjs";
import { directory, agencyOf, PROVINCES } from "./agencies.mjs";
import { SECTORS, sortAgencies } from "./sectors.mjs";
import { factsFor } from "./reports.mjs";
import { yearTrainings, refreshYear } from "./history.mjs";

/**
 * ONGIA's year (Andrew 1 Nov 2026: "Add 3 different reports you think would be good for ONGIA to create each year as a
 * summary. Stats that would be important for us to sell ourselves … number of people trained, number of contacts,
 * contacts by province, breakdown by agencies, topics trained on … Also a year end infographic"). Three reports and a
 * one-page infographic, each in English and French, for one calendar year:
 *   - the Annual Impact Report, for funders, sponsors and the board;
 *   - the Reach and Network Report: provinces, sectors, agencies, growth;
 *   - the Training Program Report: topics, presenters, ratings, the months, what attendees asked for next;
 *   - the year-end infographic.
 * Every figure is worked out here; Claude writes around them. Contacts (the size of ONGIA's contact list) can't be known
 * from the desk and is typed in once a year. Topics come from the year's events: their titles and session titles,
 * grouped by Claude. Each agency's sector comes from lib/sectors.mjs.
 */

export const ONG_KINDS = {
  impact: { en: "Annual Impact Report", fr: "Rapport d'impact annuel" },
  reach: { en: "Reach and Network Report", fr: "Rapport sur la portée et le réseau" },
  program: { en: "Training Program Report", fr: "Rapport sur le programme de formation" },
  info: { en: "Year-end infographic", fr: "Infographie de fin d'année" },
};
export const ongFolder = (year) => (process.env.ONGIA_YEAREND_FOLDER || "ONGIA/Year end {year}").replace("{year}", String(year));
export const ongFileName = (kind, lang, year) => `${ONG_KINDS[kind][lang]} ${year}.pdf`;

const SPONSOR = "Rothmans, Benson & Hedges";
const pctOf = (a, b) => (b ? Math.round((100 * a) / b) : 0);
export const yearOf = (e) => String(e?.dayOne ?? "").slice(0, 4);
const counts = (e) => !e?.practice && e?.kind !== "ext";
const today = () => new Date().toISOString().slice(0, 10);
const daysOf = (e) => {
  const a = Date.parse(e.dayOne), b = Date.parse(e.lastDay || e.dayOne);
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 86400000) + 1 : 1;
};
const cityOf = (e) => String(e.city ?? "").split(",")[0].trim();
const cityKey = (c) => String(c ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();

// An event has a city, not a province: "Montreal, QC" says so; otherwise the cities ONGIA trains in.
const CITY_PROVINCE = {
  toronto: "ON", ottawa: "ON", mississauga: "ON", brampton: "ON", hamilton: "ON", london: "ON", windsor: "ON", "niagara falls": "ON", kingston: "ON", cornwall: "ON",
  barrie: "ON", sudbury: "ON", peterborough: "ON", aurora: "ON", belleville: "ON", "north bay": "ON", "thunder bay": "ON", oshawa: "ON", kitchener: "ON", waterloo: "ON", guelph: "ON", markham: "ON", vaughan: "ON", "sault ste marie": "ON",
  montreal: "QC", "quebec city": "QC", quebec: "QC", laval: "QC", gatineau: "QC", sherbrooke: "QC", "trois rivieres": "QC", longueuil: "QC",
  vancouver: "BC", victoria: "BC", surrey: "BC", kelowna: "BC", burnaby: "BC", richmond: "BC", "prince george": "BC", kamloops: "BC", nanaimo: "BC",
  calgary: "AB", edmonton: "AB", "red deer": "AB", lethbridge: "AB", banff: "AB", winnipeg: "MB", brandon: "MB", regina: "SK", saskatoon: "SK",
  halifax: "NS", sydney: "NS", dartmouth: "NS", moncton: "NB", fredericton: "NB", "saint john": "NB", edmundston: "NB", bathurst: "NB",
  "st johns": "NL", "st john s": "NL", charlottetown: "PE", whitehorse: "YT", yellowknife: "NT", iqaluit: "NU",
};
export function provinceOfEvent(e) {
  if (PROVINCES[e?.province]) return e.province;
  const tail = /,\s*([A-Z]{2})\b/.exec(String(e?.city ?? ""))?.[1];
  if (tail && PROVINCES[tail]) return tail;
  return CITY_PROVINCE[cityKey(cityOf(e ?? {}))] ?? "";
}

/* ---------- Contacts, typed in once a year ---------- */

export const ongInputsOf = async (year) => (await getMeta(`ongia:year:${year}:inputs`)) ?? { contacts: null };
export async function putOngInputs(year, body, by = "desk") {
  const v = body?.contacts;
  const contacts = v === "" || v === null || v === undefined ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : null;
  const out = { contacts, at: new Date().toISOString(), by };
  await putMeta(`ongia:year:${year}:inputs`, out);
  return out;
}

/* ---------- One event ---------- */

/** What one event contributes to the year: who came, from which agencies, its survey, its presenters, its sessions. */
export async function eventFacts(event, list, { now = today() } = {}) {
  const [stored, survey, presenters] = await Promise.all([getAttendees(event.id), event.survey ? factsFor(event).catch(() => null) : null, listPresenters(event.id).catch(() => [])]);
  const people = writeableTo(stored?.people ?? []);
  const tookAttendance = people.some((p) => typeof p.checkedIn === "boolean");
  const came = tookAttendance ? people.filter((p) => p.checkedIn === true) : people;
  const agencies = new Map();
  for (const p of came) {
    const a = agencyOf(p, list);
    if (!a || a.name === SPONSOR) continue;
    const g = agencies.get(a.name) ?? { agency: a.name, province: a.province || "", sector: a.sector || "", count: 0 };
    g.count++; agencies.set(a.name, g);
  }
  const speakers = presenters.filter((p) => p.status !== "withdrawn");
  const quality = survey?.scoring?.find((s) => s.id === "quality") ?? null;
  // Session titles: the survey's sessions and the presenters' talks, once each.
  const titles = [...new Set([...(event.survey?.sessions ?? []).map((s) => s.title), ...speakers.map((p) => p.submission?.talk)]
    .map((t) => String(t ?? "").trim()).filter(Boolean))].slice(0, 60);
  return {
    id: event.id, title: event.title, kind: event.kind || "", city: cityOf(event), province: provinceOfEvent(event),
    dayOne: event.dayOne || "", lastDay: event.lastDay || event.dayOne || "", days: daysOf(event), held: (event.lastDay || event.dayOne || "9") < now,
    registered: people.length, attended: came.length, basis: tookAttendance ? "checked in" : "registered",
    agencies: [...agencies.values()], unmatched: came.length - [...agencies.values()].reduce((a, g) => a + g.count, 0),
    survey: survey && survey.answered ? { answered: survey.answered, invited: survey.invited, quality: quality ? { n: quality.n, mean: quality.mean, top2: quality.top2 } : null,
      scoring: survey.scoring, sessions: survey.sessions.slice(0, 6), comments: survey.comments, topics: survey.topics } : null,
    presenters: speakers.map((p) => ({ key: String(p.email || `${p.first} ${p.last}`).trim().toLowerCase(), org: String(p.organization ?? "").trim() })),
    sessionTitles: titles,
  };
}

/* ---------- Topics: the year's sessions, grouped ---------- */

export const topicsOf = async (year) => (await getMeta(`ongia:year:${year}:topics`)) ?? null;
const TOPIC_SCHEMA = {
  type: "object", additionalProperties: false, required: ["topics"],
  properties: { topics: { type: "array", items: { type: "object", additionalProperties: false, required: ["en", "fr", "events"],
    properties: { en: { type: "string" }, fr: { type: "string" }, events: { type: "array", items: { type: "string" } } } } } },
};
const TOPIC_SYSTEM = `ONGIA trains Canadian police, corrections, educators, social workers and community partners on street gangs, youth violence, organized crime and human trafficking. You are given a year's events, each with its title and the titles of its sessions. Group what was taught into six to eight topics, each named in two to five plain words in English and in Canadian French (for example "Street gangs and recruitment" / "Gangs de rue et recrutement"). For each topic, list the ids of the events that covered it; an event can be in several topics. Use only the events given, and only topics their titles support.`;

/** A best guess from the words in the titles, where Claude isn't available. */
const TOPIC_RULES = [
  ["Street gangs and recruitment", "Gangs de rue et recrutement", /\bgangs?\b|recruit/i],
  ["Organized crime and illicit trade", "Crime organisé et commerce illicite", /organi[sz]ed crime|illicit|contraband|tobacco|money laundering|cartel|biker|mafia|crime organis/i],
  ["Human trafficking and exploitation", "Traite de personnes et exploitation", /traffick|exploitation|sextortion|traite/i],
  ["Youth violence and prevention", "Violence chez les jeunes et prévention", /youth|young|prevent|school|jeune/i],
  ["Drugs and the opioid trade", "Drogues et opioïdes", /drug|opioid|fentanyl|narcot|cannabis|drogue/i],
  ["Firearms and violence", "Armes à feu et violence", /firearm|gun|weapon|shooting|arme/i],
  ["Online crime and technology", "Criminalité en ligne et technologie", /online|cyber|digital|social media|internet|dark web|osint|technolog/i],
  ["Intelligence and investigations", "Renseignement et enquêtes", /intelligence|investigat|informant|surveillance|wiretap|enquête|renseignement/i],
  ["Courts and prosecution", "Tribunaux et poursuites", /court|crown|prosecut|testimony|legal|law|tribunal|poursuite/i],
];
export function guessTopics(rows) {
  const out = [];
  for (const [en, fr, re] of TOPIC_RULES) {
    const events = rows.filter((r) => re.test([r.title, ...r.sessionTitles].join(" | "))).map((r) => r.id);
    if (events.length) out.push({ en, fr, events });
  }
  return out.slice(0, 8);
}

/** Group the year's held events' sessions into topics and keep the grouping for the year. */
export async function groupTopics(year, rows, { client = null } = {}) {
  const held = rows.filter((r) => r.held);
  if (!held.length) return null;
  let topics = null, by = "guess";
  if (client || anthropicKey()) {
    try {
      const api = client ?? new Anthropic({ apiKey: anthropicKey() });
      const message = await api.messages.create({
        model: "claude-opus-5-5", max_tokens: 8000,
        output_config: { effort: "low", format: { type: "json_schema", schema: TOPIC_SCHEMA } },
        system: TOPIC_SYSTEM,
        messages: [{ role: "user", content: JSON.stringify(held.map((r) => ({ id: r.id, title: r.title, sessions: r.sessionTitles }))) }],
      });
      const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      const ids = new Set(held.map((r) => r.id));
      topics = (JSON.parse(text).topics ?? []).map((t) => ({ en: String(t.en).slice(0, 60), fr: String(t.fr).slice(0, 70), events: (t.events ?? []).filter((id) => ids.has(id)) }))
        .filter((t) => t.en && t.events.length).slice(0, 8);
      by = "claude";
    } catch (e) { console.log(`topics: Claude couldn't group them (${e.message}); using the best guess from the titles`); topics = null; }
  }
  if (!topics?.length) { topics = guessTopics(held); by = "guess"; }
  const out = { topics, by, at: new Date().toISOString(), events: held.map((r) => r.id) };
  await putMeta(`ongia:year:${year}:topics`, out);
  return out;
}

/* ---------- The year ---------- */

/**
 * The year's rows: every training on Wix and in the desk, counted by Andrew's rules (lib/history.mjs, read in the
 * background and kept), with the desk's survey, presenters and sessions for the trainings that have them. Until a year
 * has been read from Wix the rows come from the desk alone, and the figures say so (source "desk").
 */
export async function yearRows(year, { events = null, now = today(), list = null } = {}) {
  const all = events ?? (await listEvents());
  const dir = list ?? (await directory().catch(() => []));
  const kept = await yearTrainings(year);
  if (!kept) {
    const mine = all.filter((e) => counts(e) && yearOf(e) === String(year)).sort((a, b) => (a.dayOne ?? "").localeCompare(b.dayOne ?? ""));
    return { rows: await Promise.all(mine.map((e) => eventFacts(e, dir, { now }))), source: "desk", readAt: null, next: null };
  }
  const byId = new Map(all.map((e) => [e.id, e]));
  const rows = await Promise.all(kept.rows.map(async (r) => {
    const desk = r.deskId ? byId.get(r.deskId) : null;
    const ef = desk ? await eventFacts(desk, dir, { now }) : null;
    const lastDay = r.lastDay || r.dayOne;
    const fromWix = r.people !== null && r.people !== undefined;
    return {
      id: r.id, title: r.title, kind: r.kind || ef?.kind || "", city: String(r.city ?? "").split(",")[0].trim(), province: provinceOfEvent({ city: r.city }),
      dayOne: r.dayOne, lastDay, days: r.days ?? ef?.days ?? 1, held: (lastDay || r.dayOne || "9") < now,
      registered: fromWix ? r.people : ef?.registered ?? 0, attended: fromWix ? r.people : ef?.attended ?? 0, basis: fromWix ? "registered" : ef?.basis ?? "registered",
      agencies: fromWix ? r.agencies : ef?.agencies ?? [], unmatched: fromWix ? r.unmatched : ef?.unmatched ?? 0,
      inPerson: fromWix ? r.inPerson : null, virtual: fromWix ? r.virtual : null, attendeeDays: fromWix ? r.attendeeDays : null, format: r.format || "",
      // The desk's own survey where the event had one; otherwise its SurveyMonkey surveys, measured against the people trained.
      survey: ef?.survey?.answered ? ef.survey : r.survey ? { ...r.survey, invited: fromWix ? r.people : ef?.attended ?? 0 } : ef?.survey ?? null, presenters: ef?.presenters ?? [], sessionTitles: ef?.sessionTitles ?? [], parts: r.parts ?? [],
    };
  }));
  return { rows, source: "wix", readAt: kept.at, next: kept.next ?? null };
}

/** Every figure the ONGIA year reports may state, for one calendar year. */
export async function ongiaYearFacts(year, { events = null, now = today() } = {}) {
  const all = events ?? (await listEvents());
  const list = await directory().catch(() => []);
  const { rows, source, readAt, next: keptNext } = await yearRows(year, { events: all, now, list });
  // Agencies seen in earlier years, to tell the new ones from the returning: the kept readings of those years.
  let earlier = null;
  const firstYear = 2021;
  for (let y = firstYear; y < Number(year); y++) {
    const k = await yearTrainings(y);
    if (!k) continue;
    earlier ??= new Set();
    for (const r of k.rows) for (const a of r.agencies ?? []) earlier.add(a.agency);
  }
  if (!earlier && source === "desk") {
    const earlierEvents = all.filter((e) => counts(e) && yearOf(e) && yearOf(e) < String(year));
    if (earlierEvents.length) { earlier = new Set(); for (const e of earlierEvents) for (const a of (await eventFacts(e, list, { now })).agencies) earlier.add(a.agency); }
  }
  const next = all.filter((e) => counts(e) && yearOf(e) === String(Number(year) + 1));
  const out = combineOngia(year, rows, { earlier, next, inputs: await ongInputsOf(year), topics: await topicsOf(year) });
  if (keptNext) out.nextYear = { count: keptNext.count, provinces: new Set((keptNext.cities ?? []).map((c) => provinceOfEvent({ city: c })).filter(Boolean)).size };
  // People trained each year since 2021, from the kept readings: for this year, those at trainings held so far, and apart
  // from them the people registered for the trainings still to come.
  const history = [];
  for (let y = 2021; y <= Number(year); y++) {
    const k = await yearTrainings(y);
    if (!k) continue;
    const done = k.rows.filter((r) => (r.lastDay || r.dayOne || "9") < now), ahead = k.rows.filter((r) => !((r.lastDay || r.dayOne || "9") < now));
    const sum = (rows, key) => rows.reduce((a, r) => a + (r[key] ?? 0), 0);
    // The year's rating: each training's, weighted by the people who answered (SurveyMonkey, kept with the reading).
    const rated = done.filter((r) => r.survey?.quality?.n);
    const qn = rated.reduce((a, r) => a + r.survey.quality.n, 0);
    const rating = qn ? Math.round((rated.reduce((a, r) => a + r.survey.quality.mean * r.survey.quality.n, 0) / qn) * 10) / 10 : null;
    history.push({ year: y, people: sum(done, "people"), inPerson: sum(done, "inPerson"), virtual: sum(done, "virtual"), events: done.length, toCome: y === Number(year) ? sum(ahead, "people") : 0,
      rating, answered: done.reduce((a, r) => a + (r.survey?.answered ?? 0), 0), rated: rated.length });
  }
  out.history = history;
  return { ...out, source, readAt };
}

/** The year from its events' figures (eventFacts), the agencies seen before, next year's events, contacts and topics. */
export function combineOngia(year, rows, { earlier = null, next = [], inputs = { contacts: null }, topics = null } = {}) {
  const held = rows.filter((r) => r.held);
  const agencies = new Map();
  for (const r of held) for (const a of r.agencies) {
    const g = agencies.get(a.agency) ?? { agency: a.agency, province: a.province, sector: a.sector, count: 0, events: 0 };
    g.count += a.count; g.events++; agencies.set(a.agency, g);
  }
  const attendees = held.reduce((a, r) => a + r.attended, 0);
  // People by province: those whose agency has one (federal agencies such as the RCMP and the CBSA have none).
  const byProvince = new Map();
  for (const a of agencies.values()) if (PROVINCES[a.province]) byProvince.set(a.province, (byProvince.get(a.province) ?? 0) + a.count);
  // People by sector: those whose agency has been sorted.
  const bySector = new Map();
  for (const a of agencies.values()) if (a.sector) bySector.set(a.sector, (bySector.get(a.sector) ?? 0) + a.count);
  const inSector = [...bySector.values()].reduce((a, b) => a + b, 0);
  // The average rating: each event's overall-quality mean, weighted by how many answered it.
  let qn = 0, qsum = 0, top2n = 0;
  for (const r of held) if (r.survey?.quality?.n) { qn += r.survey.quality.n; qsum += r.survey.quality.mean * r.survey.quality.n; top2n += (r.survey.quality.top2 ?? 0) * r.survey.quality.n; }
  const answered = held.reduce((a, r) => a + (r.survey?.answered ?? 0), 0), invited = held.reduce((a, r) => a + (r.survey?.invited ?? 0), 0);
  const presenters = new Map();
  for (const r of held) for (const p of r.presenters) if (!presenters.has(p.key)) presenters.set(p.key, p.org);
  const comments = [];
  for (const r of held) for (const c of r.survey?.comments ?? []) comments.push({ id: comments.length + 1, text: c.text, about: c.about ? `${c.about} · ${r.title}` : r.title });
  const sessions = held.flatMap((r) => (r.survey?.sessions ?? []).map((s) => ({ title: s.title, titleFr: s.titleFr, event: r.title, presenters: s.presenters, top1: s.top1, top2: s.top2, n: s.n })))
    .filter((s) => s.n >= 3).sort((a, b) => (b.top2 ?? 0) - (a.top2 ?? 0) || (b.n ?? 0) - (a.n ?? 0)).slice(0, 10);
  // Measures across the year's surveys, weighted by answers.
  const byQ = new Map();
  for (const r of held) for (const s of r.survey?.scoring ?? []) {
    const g = byQ.get(s.id) ?? { id: s.id, en: s.en, fr: s.fr, n: 0, top2n: 0 };
    g.n += s.n; g.top2n += (s.top2 ?? 0) * s.n; byQ.set(s.id, g);
  }
  const scoring = [...byQ.values()].filter((g) => g.n).map((g) => ({ id: g.id, en: g.en, fr: g.fr, n: g.n, top2: Math.round(g.top2n / g.n) }));
  // Months: every event of the year by the month it starts, held or still to come.
  const months = Array.from({ length: 12 }, () => ({ held: 0, upcoming: 0 }));
  for (const r of rows) { const m = Number(String(r.dayOne).slice(5, 7)) - 1; if (m >= 0 && m < 12) months[m][r.held ? "held" : "upcoming"]++; }
  // Topics: the stored grouping, with the people who came to the events that covered each.
  const byId = new Map(held.map((r) => [r.id, r]));
  const topicRows = (topics?.topics ?? []).map((t) => ({ en: t.en, fr: t.fr, events: t.events.filter((id) => byId.has(id)).length,
    people: t.events.reduce((a, id) => a + (byId.get(id)?.attended ?? 0), 0) })).filter((t) => t.events).sort((a, b) => b.people - a.people);
  const nextProvinces = new Set(next.map(provinceOfEvent).filter(Boolean));
  return {
    year: Number(year),
    events: rows.length, held: held.length, upcoming: rows.length - held.length,
    attendees, registered: held.reduce((a, r) => a + r.registered, 0),
    registeredToCome: rows.filter((r) => !r.held).reduce((a, r) => a + (r.registered ?? 0), 0),
    attendanceBasis: held.length && held.every((r) => r.basis === "checked in") ? "checked in" : held.every((r) => r.basis === "registered") ? "registered" : "mixed",
    trainingDays: held.reduce((a, r) => a + r.days, 0), attendeeDays: held.reduce((a, r) => a + (r.attendeeDays ?? r.attended * r.days), 0),
    inPerson: held.every((r) => r.inPerson !== null && r.inPerson !== undefined) ? held.reduce((a, r) => a + r.inPerson, 0) : null,
    virtual: held.every((r) => r.virtual !== null && r.virtual !== undefined) ? held.reduce((a, r) => a + r.virtual, 0) : null,
    contacts: inputs.contacts ?? null,
    agencyCount: agencies.size, unmatched: held.reduce((a, r) => a + r.unmatched, 0),
    provinceCount: byProvince.size,
    provinces: [...byProvince.entries()].map(([code, count]) => ({ code, en: PROVINCES[code], count })).sort((a, b) => b.count - a.count),
    peopleWithProvince: [...byProvince.values()].reduce((a, b) => a + b, 0),
    sectors: SECTORS.map((s) => ({ id: s.id, en: s.en, fr: s.fr, count: bySector.get(s.id) ?? 0 })).filter((s) => s.count).sort((a, b) => b.count - a.count),
    peopleWithSector: inSector,
    topAgencies: [...agencies.values()].sort((a, b) => b.count - a.count || a.agency.localeCompare(b.agency)).slice(0, 15),
    newAgencies: earlier ? [...agencies.keys()].filter((a) => !earlier.has(a)).length : null,
    returningAgencies: earlier ? [...agencies.keys()].filter((a) => earlier.has(a)).length : null,
    cities: [...new Map(held.filter((r) => r.city).map((r) => [cityKey(r.city), r.city])).values()],
    eventProvinces: [...new Set(held.map((r) => r.province).filter(Boolean))],
    // trainings: how many were rated; fromStatements: of those, how many asked no overall question, so their rating is
    // the average of every rated statement on the survey (Regina's and Edmundston's 2026 surveys).
    rating: qn ? { mean: Math.round((qsum / qn) * 10) / 10, top2: Math.round(top2n / qn), n: qn, trainings: held.filter((r) => r.survey?.quality?.n).length,
      fromStatements: held.filter((r) => r.survey?.quality?.basis === "all").length } : null,
    survey: { answered, invited, rate: pctOf(answered, invited) },
    scoring, sessions,
    presenters: presenters.size, presenterOrgs: new Set([...presenters.values()].filter(Boolean)).size,
    presenterOrgList: [...[...presenters.values()].filter(Boolean).reduce((m, o) => m.set(o, (m.get(o) ?? 0) + 1), new Map())].map(([org, count]) => ({ org, count }))
      .sort((a, b) => b.count - a.count || a.org.localeCompare(b.org)).slice(0, 12),
    months,
    topics: topicRows, topicsBy: topics?.by ?? null,
    eventsList: rows.map((r) => ({ id: r.id, title: r.title, city: r.city, province: r.province, dayOne: r.dayOne, lastDay: r.lastDay, days: r.days, held: r.held,
      attended: r.held ? r.attended : null, registered: r.registered, rating: r.held && r.survey?.quality ? r.survey.quality.mean : null, kind: r.kind,
      format: r.format ?? "", inPerson: r.inPerson ?? null, virtual: r.virtual ?? null })),
    nextYear: { count: next.length, provinces: nextProvinces.size },
    comments: comments.slice(0, 300), asked: held.flatMap((r) => r.survey?.topics ?? []).slice(0, 150),
  };
}

/* ---------- What Claude writes ---------- */

const S = (desc) => ({ type: "string", description: desc });
const LIST = (desc) => ({ type: "array", items: { type: "string" }, description: desc });
const QUOTE = { type: "object", additionalProperties: false, required: ["commentId", "about"], properties: { commentId: { type: "integer" }, about: { type: "string" } } };
const REPLY = S("One or two sentences to ONGIA's president on what you changed this time, or empty when nothing was asked.");
export const ONG_SCHEMAS = {
  impact: { type: "object", additionalProperties: false, required: ["glance", "who", "quotes", "highlights", "lookAhead", "reply"], properties: {
    glance: LIST("Two short paragraphs: what ONGIA delivered this year (events, people trained, agencies, provinces, contacts), then how it was received, with the figures given."),
    who: LIST("One or two short paragraphs on who ONGIA trained: sectors, provinces and the agencies sending the most people."),
    quotes: { type: "array", items: QUOTE, description: "Two to four attendee comments by id; empty if no comments were given." },
    highlights: LIST("Three to five bullets, each a short bold lead phrase ending in a full stop, then one sentence resting on a figure given."),
    lookAhead: S("One or two sentences on next year, from the events already booked."), reply: REPLY } },
  reach: { type: "object", additionalProperties: false, required: ["intro", "provinces", "sectors", "growth", "reply"], properties: {
    intro: LIST("One or two short paragraphs on how far ONGIA's work reached this year."),
    provinces: S("One or two sentences on reach by province and territory, from the figures given."),
    sectors: S("One or two sentences on the sectors trained; empty if no sector figures were given."),
    growth: S("One or two sentences on growth: new and returning agencies, contacts; empty if those figures are missing."), reply: REPLY } },
  program: { type: "object", additionalProperties: false, required: ["intro", "topics", "presenters", "ratings", "askedNext", "recommendations", "reply"], properties: {
    intro: LIST("One or two short paragraphs on the year's training program: how many events, training days, where."),
    topics: S("One or two sentences on the topics trained on, from the topics given."),
    presenters: S("One or two sentences on the presenters and their organizations, from the figures given."),
    ratings: S("One or two sentences on how the training was rated; empty if no survey figures were given."),
    askedNext: S("One or two sentences on what attendees asked to learn next; empty if none were given."),
    recommendations: LIST("Two to four recommendations for next year's program, each a short bold lead phrase ending in a full stop, then one sentence."), reply: REPLY } },
  info: { type: "object", additionalProperties: false, required: ["headline", "tagline", "quote", "reply"], properties: {
    headline: S("A headline of three to seven words for the year, e.g. 'Equipping Canada's front line'."),
    tagline: S("One short line on what ONGIA does, e.g. 'Gangs, organized crime, youth violence and human trafficking: training for the people who respond.'"),
    quote: { ...QUOTE, description: "One attendee comment by id, or commentId 0 if no comments were given." }, reply: REPLY } },
};
const LANG = { en: "English", fr: "Canadian French (natural and formal, not translated word for word)" };
const WHAT = { impact: "Annual Impact Report", reach: "Reach and Network Report", program: "Training Program Report", info: "one-page year-end infographic" };
export const ONG_SYSTEM = (kind, lang) => `You write ONGIA's ${WHAT[kind]} for one calendar year. ONGIA (Organization for National Gang Information & Awareness) is Canada's non-profit for training and education on street gangs, youth violence, organized crime and human trafficking. It trains law enforcement, corrections, educators, social workers, community partners, parents and youth. The readers are funders, sponsors, partners and ONGIA's board, and the document shows them what ONGIA achieved.

Write in ${LANG[lang]}. Plain, confident, specific. No hype, no filler, no superlatives the figures don't support. Plain text only: no markdown, no asterisks, no headings inside the text.

The figures you are given are the only figures that exist. Use them exactly; never compute, round differently, total, or invent one. If a figure is missing or null, leave the point out rather than guess. "People trained" counts those who came to events that have taken place. Ratings come from attendee surveys (ONGIA's own, or SurveyMonkey for past years): "rating.n" is how many answered, "survey.rate" the share of people trained who answered, and "rating.fromStatements" how many of the rated trainings asked agree/disagree statements instead of one overall question. "history" gives each year's people and rating; you may compare years from it. Never name or identify an attendee. For quotes, give only the id of a comment; the desk prints its exact words in the language it was written in.

ONGIA's requests for this document come last. Follow every one of them. They may add sections, change wording or emphasis, or leave things out; they can't change a figure or a quote's words.`;

/** One language of one report, from Claude. `client` is for tests. */
export async function writeOngReport(kind, lang, facts, { requests = [], previous = null, ask = "" } = {}, { client = null } = {}) {
  if (!client && !anthropicKey()) throw new Error("The desk has no Anthropic API key, so Claude cannot write the report.");
  const api = client ?? new Anthropic({ apiKey: anthropicKey() });
  const brief = { figures: { ...facts, comments: undefined, asked: undefined }, comments: facts.comments, topicsAskedFor: facts.asked };
  const message = await api.messages.create({
    model: "claude-opus-5-5", max_tokens: 16000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: ONG_SCHEMAS[kind] } },
    system: ONG_SYSTEM(kind, lang),
    messages: [{ role: "user", content: `${JSON.stringify(brief)}${previous ? `\n\nThe current version, to keep unless the requests or new figures change it:\n${JSON.stringify(previous)}` : ""}${requests.length ? `\n\nONGIA's requests:\n${requests.map((a) => `- ${a}`).join("\n")}` : ""}${ask ? `\n\nJust now ONGIA asked: ${ask}\nSay in reply what you changed.` : ""}` }],
  });
  if (message.stop_reason === "refusal") throw new Error("Claude would not write this report.");
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let out;
  try { out = JSON.parse(text); } catch { throw new Error("Claude's report could not be read. Try again."); }
  return keepHonestOng(kind, out, facts);
}

/** Quotes only from the comments, word for word; sections about missing figures left empty. */
export function keepHonestOng(kind, out, facts) {
  const byId = new Map(facts.comments.map((c) => [c.id, c]));
  const quote = (q) => (byId.has(q?.commentId) ? { text: byId.get(q.commentId).text, about: q.about || byId.get(q.commentId).about } : null);
  if (kind === "impact") return { ...out, quotes: (out.quotes ?? []).map(quote).filter(Boolean).slice(0, 4) };
  if (kind === "reach") return { ...out, sectors: facts.sectors.length ? out.sectors : "", growth: facts.newAgencies == null && facts.contacts == null ? "" : out.growth };
  if (kind === "program") return { ...out, ratings: facts.rating || facts.scoring.length ? out.ratings : "", askedNext: facts.asked.length ? out.askedNext : "" };
  return { ...out, quote: quote(out.quote) };
}

/* ---------- Kept on the desk: versions, requests, the chat ---------- */

const blank = () => ({ versions: [], current: 0, requests: [], chat: [], final: false });
export const ongReportsOf = async (year) => (await getMeta(`reports:ongia:${year}`)) ?? {};
export const putOngReports = (year, r) => putMeta(`reports:ongia:${year}`, r);

/**
 * Make one report again (both languages) and keep it as a new version. Before the first of a batch, the agencies are
 * sorted into sectors and the year's topics grouped again (pass `refresh`), so the figures are the latest.
 */
export async function buildOngReport(year, kind, { reason = "asked", ask = "", lang = "both", client = null, facts = null, refresh = false, now = new Date() } = {}) {
  if (refresh) {
    await sortAgencies({ client }).catch((e) => console.log(`sectors: ${e.message}`));
    await refreshYear(year).catch((e) => console.log(`history: couldn't read ${year} from Wix (${e.message}); using the last reading`));
    const { rows } = await yearRows(year);
    await groupTopics(year, rows, { client }).catch((e) => console.log(`topics: ${e.message}`));
  }
  const reports = await ongReportsOf(year);
  const r = { ...blank(), ...(reports[kind] ?? {}) };
  const f = facts ?? (await ongiaYearFacts(year));
  if (!f.held) throw new Error(`No ONGIA event in ${year} has taken place yet.`);
  const prev = r.versions.find((v) => v.n === r.current) ?? null;
  const forLang = (l) => r.requests.filter((q) => q.lang === "both" || q.lang === l).map((q) => q.text);
  const redo = (l) => !prev || reason !== "asked-change" || lang === "both" || lang === l;
  const [en, fr] = await Promise.all(["en", "fr"].map((l) => (redo(l)
    ? writeOngReport(kind, l, f, { requests: forLang(l), previous: prev?.content?.[l] ?? null, ask: (lang === "both" || lang === l) ? ask : "" }, { client })
    : Promise.resolve(prev.content[l]))));
  const n = Math.max(0, ...r.versions.map((v) => v.n)) + 1;
  const version = { n, at: now.toISOString(), reason, attendees: f.attendees, answered: f.survey.answered, facts: f, content: { en, fr } };
  r.versions = [...r.versions, version].slice(-12);
  r.current = n;
  if (ask) r.chat = [...r.chat, { who: "claude", text: (lang === "fr" ? fr.reply : en.reply) || (lang === "fr" ? "C'est fait." : "Done."), at: now.toISOString(), version: n }].slice(-80);
  await putOngReports(year, { ...(await ongReportsOf(year)), [kind]: r });
  return version;
}

export async function ongVersionPdf(year, kind, lang, n = null) {
  const r = (await ongReportsOf(year))[kind];
  const v = r?.versions?.find((x) => x.n === (n ?? r.current));
  if (!v) return null;
  const { ongPdf } = await import("./ongiapdf.mjs");
  return ongPdf(kind, v.content[lang], v.facts, lang, { date: v.at.slice(0, 10) });
}

/** Both languages of the current version, to ONGIA's year-end folder in the library. */
export async function fileOngReport(year, kind, { file = null } = {}) {
  const put = file ?? (await import("./graph.mjs")).fileLibraryDocument;
  const r = (await ongReportsOf(year))[kind];
  const out = {};
  for (const lang of ["en", "fr"]) {
    try {
      const bytes = await ongVersionPdf(year, kind, lang);
      const got = await put({ folder: ongFolder(year), name: ongFileName(kind, lang, year), bytes, contentType: "application/pdf" });
      out[lang] = got.skipped ? { skipped: got.reason } : { url: got.url, folderUrl: got.folderUrl, at: new Date().toISOString(), version: r.current };
    } catch (e) { out[lang] = { error: e.message }; }
  }
  const now = await ongReportsOf(year);
  await putOngReports(year, { ...now, [kind]: { ...now[kind], filed: out } });
  return out;
}

/** Where the four reports stand, the shape the RBH year end uses. */
export async function ongState(year, facts = null) {
  const all = await ongReportsOf(year);
  const f = facts ?? (await ongiaYearFacts(year));
  const one = (kind) => {
    const r = all[kind] ?? {};
    const cur = r.versions?.find((v) => v.n === r.current);
    return { name: ONG_KINDS[kind], made: !!cur, current: r.current ?? 0, final: !!r.final, finalAt: r.finalAt ?? null, building: r.building ?? null, error: r.error ?? null,
      version: cur ? { n: cur.n, at: cur.at, reason: cur.reason, attendees: cur.attendees, answered: cur.answered } : null,
      versions: (r.versions ?? []).map((v) => ({ n: v.n, at: v.at, reason: v.reason, answered: v.answered })), requests: r.requests ?? [], chat: r.chat ?? [], filed: r.filed ?? null,
      newSince: cur ? Math.max(0, f.survey.answered - (cur.answered ?? 0)) : 0 };
  };
  return { year: Number(year), held: f.held, folder: ongFolder(year), reports: Object.fromEntries(Object.keys(ONG_KINDS).map((k) => [k, one(k)])) };
}

/** The years with events, and this year, oldest first. */
export function ongYears(events, now = today()) {
  return [...new Set([...events.filter((e) => counts(e) && yearOf(e)).map(yearOf), now.slice(0, 4)])].sort();
}
