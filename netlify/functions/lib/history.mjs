/**
 * ONGIA's trainings for a year, read from every Wix site and the desk, counted by Andrew's rules (docs/history-rules.md).
 *
 * Andrew, 1 Nov 2026: the 2026 Reach and Network Report said 95 people at four events, because the year reports counted
 * only the events set up in the desk; most of 2026 was only ever on Wix. "What I can't do is have wrong numbers."
 *
 * One training is one row however Wix holds it:
 *   - a conference's in-person, overflow and virtual registrations are one event (same start, same title once the
 *     "VIRTUAL" / "OVERFLOW" / "IN PERSON" words are taken off), and so is an event registered on two sites (Calgary 2025,
 *     on the Archive and the current site);
 *   - the trainings Wix holds as two events on two days are one (TRAININGS below: Regina 2025, Edmundston 2026);
 *   - the lunch buffets are not training;
 *   - Wix's city is corrected where it is wrong (CITIES below).
 * People are counted once per training: one per person Wix lists as attending (attendeesOf: each ticket's holder, not
 * the buyer as well); across a training's parts the same email address counts once (as many times as it appears in any
 * one part, so a group booked under one address isn't cut to one person). Nothing personal is kept: each row holds counts
 * and the agencies people came from.
 */
import { listEveryWixEvent, listWixGuests, attendeesOf, wixConfigured, wixSites, archiveSite } from "./wix.mjs";
import { getMeta, putMeta, listEvents } from "./store.mjs";
import { directory, agencyOf } from "./agencies.mjs";

const SPONSOR = "Rothmans, Benson & Hedges";
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Not training (Andrew's rules): the 2022 conference lunch buffets; a VIP reception. */
export const NOT_TRAINING = [/\blunch buffet\b/i, /\bbuffet\b/i, /\bvip\b/i];
/** Trainings Wix holds as more than one event, by the start of each part's title and the year. */
export const TRAININGS = [
  { year: "2025", parts: ["expert witness workshop", "criminal convergence"], name: "Regina training: Expert Witness Workshop and Criminal Convergence" },
  { year: "2026", parts: ["at the crossroads of organized crime", "introduction aux gangs et trafic humain"], name: "Edmundston training (English and French)" },
];
/** Where Wix's city is wrong: [title start, year, city]. */
export const CITIES = [
  ["crime at the crossroads", "2026", "Winnipeg, MB"],
  ["street gang training symposium montreal", "2025", "Montreal, QC"],
  ["expert witness workshop", "2025", "Regina, SK"],
  ["criminal convergence", "2025", "Regina, SK"],
  ["mapping the threat", "2026", "Regina, SK"],
];
const PART_WORDS = /\b(virtual attendance|virtual|in person|in-person|overflow room|overflow)\b/gi;
export const isVirtualPart = (title, city) => /\bvirtual\b|\bwebinar\b/i.test(title) || !String(city ?? "").trim();
const baseTitle = (t) => norm(String(t).replace(PART_WORDS, " "));
const yearOf = (d) => String(d ?? "").slice(0, 4);
const dayDiff = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;
const daysOf = (a, b) => { const x = Date.parse(a), y = Date.parse(b || a); return Number.isFinite(x) && Number.isFinite(y) && y >= x ? Math.round((y - x) / 86400000) + 1 : 1; };

/** Every Wix site the desk can read: the current site, the community partners' site, the Archive. */
const allSites = () => [...wixSites().map((s) => s.n), ...(archiveSite() ? ["3"] : [])];

/** The events of a year on every site, each tagged with its site, buffets and receptions left out. */
export async function wixEventsOf(year, { list = listEveryWixEvent } = {}) {
  const out = [];
  for (const site of allSites()) {
    let got = [];
    try { got = await list({ site }); } catch (e) { throw new Error(`Couldn't read the events on Wix site ${site}: ${e.message}`); }
    for (const e of got) if (yearOf(e.dayOne) === String(year) && !NOT_TRAINING.some((re) => re.test(e.title))) out.push({ ...e, site });
  }
  return out.sort((a, b) => String(a.dayOne).localeCompare(String(b.dayOne)) || String(a.title).localeCompare(String(b.title)));
}

/**
 * Group a year's Wix events (and the desk's events) into trainings. Returns [{ desk, parts: [wixEvent…] }]; a desk event
 * with no Wix event of its own is a group with no parts.
 */
export function groupTrainings(year, wixEventsIn, deskEvents = []) {
  const wixEvents = wixEventsIn.filter((e) => !NOT_TRAINING.some((re) => re.test(e.title ?? "")));
  const groups = [];
  const byPart = new Map();   // "site:id" -> group
  const key = (site, id) => `${site}:${id}`;
  const join = (g, e) => { if (!byPart.has(key(e.site, e.id))) { g.parts.push(e); byPart.set(key(e.site, e.id), g); } };
  const find = (site, id) => wixEvents.find((e) => e.id === id && String(e.site) === String(site || "1"));
  // 1. A desk event and the Wix events it is linked to (its own, and a second group's such as the Summit's community partners).
  for (const d of deskEvents) {
    if (NOT_TRAINING.some((re) => re.test(d.title ?? ""))) continue;
    const g = { desk: d, parts: [] };
    for (const l of [d.wix, ...(d.wixMore ?? [])].filter((x) => x?.eventId)) { const e = find(l.site, l.eventId); if (e) join(g, e); }
    groups.push(g);
  }
  // 2. The trainings Wix holds as several events (Andrew's list).
  for (const t of TRAININGS.filter((x) => x.year === String(year))) {
    const parts = wixEvents.filter((e) => t.parts.some((p) => norm(e.title).startsWith(p)));
    if (!parts.length) continue;
    const g = parts.map((e) => byPart.get(key(e.site, e.id))).find(Boolean) ?? (groups.push({ desk: null, parts: [], name: t.name }), groups.at(-1));
    g.name = g.name ?? t.name;
    for (const e of parts) join(g, e);
  }
  // 3. Everything else: a conference's parts and an event on two sites join the group with the same title and start.
  for (const e of wixEvents) {
    if (byPart.has(key(e.site, e.id))) continue;
    const b = baseTitle(e.title);
    const g = groups.find((x) => x.parts.some((p) => dayDiff(p.dayOne, e.dayOne) <= 1 && (baseTitle(p.title) === b || (b.length >= 12 && (baseTitle(p.title).startsWith(b) || b.startsWith(baseTitle(p.title)))))));
    if (g) join(g, e); else { groups.push({ desk: null, parts: [] }); join(groups.at(-1), e); }
  }
  return groups;
}

/** The city a part is in, corrected where Wix has it wrong. */
export function cityOfPart(e) {
  const t = norm(e.title), y = yearOf(e.dayOne);
  const fix = CITIES.find(([start, year]) => year === y && t.startsWith(start));
  return fix ? fix[2] : e.city || "";
}

/**
 * Count one training's people from its parts' guest lists: { people, inPerson, virtual, attendeeDays, sample }.
 * `guestsOf(part)` gives the part's attending people. Across parts an address counts as often as it appears in any one part.
 */
export function countPeople(parts, guestsOf) {
  const perEmail = new Map();   // email -> { n, inPersonN, rep: [people…] }
  let noEmailIn = 0, noEmailVirtual = 0, attendeeDays = 0;
  const reps = [];
  for (const p of parts) {
    const people = guestsOf(p), virtual = isVirtualPart(p.title, cityOfPart(p));
    attendeeDays += people.length * daysOf(p.dayOne, p.lastDay);
    const here = new Map();
    for (const g of people) {
      if (!g.email) { if (virtual) noEmailVirtual++; else noEmailIn++; reps.push(g); continue; }
      const a = here.get(g.email) ?? []; a.push(g); here.set(g.email, a);
    }
    for (const [email, list] of here) {
      const c = perEmail.get(email) ?? { n: 0, inPersonN: 0, rep: [] };
      if (list.length > c.n) { c.n = list.length; c.rep = list; }
      if (!virtual) c.inPersonN = Math.max(c.inPersonN, list.length);
      perEmail.set(email, c);
    }
  }
  let people = noEmailIn + noEmailVirtual, inPerson = noEmailIn;
  for (const c of perEmail.values()) { people += c.n; inPerson += Math.min(c.n, c.inPersonN); reps.push(...c.rep); }
  return { people, inPerson, virtual: people - inPerson, attendeeDays, sample: reps };
}

/**
 * Read a year's trainings from Wix and the desk. Slow (every guest list on every site), so it runs in the background and
 * the result is kept: refreshYear() stores it, yearTrainings() reads it back.
 */
export async function readYearTrainings(year, { now = new Date().toISOString().slice(0, 10), events = null, wix = null, list = null } = {}) {
  const desk = (events ?? (await listEvents())).filter((e) => !e.practice && e.kind !== "ext" && yearOf(e.dayOne) === String(year));
  const W = wix ?? { events: (y) => wixEventsOf(y), guests: (p) => listWixGuests({ eventId: p.id, type: null, site: String(p.site) }) };
  const wixEvents = wixConfigured() || wix ? await W.events(year) : [];
  const dir = list ?? (await directory().catch(() => []));
  const groups = groupTrainings(year, wixEvents, desk);
  const rows = [];
  for (const g of groups) {
    const guests = new Map();
    for (const p of g.parts) guests.set(`${p.site}:${p.id}`, attendeesOf(await W.guests(p)).filter((x) => x.status === "ATTENDING"));
    if (!g.parts.length && !g.desk) continue;
    const main = g.parts.filter((p) => !isVirtualPart(p.title, cityOfPart(p)))[0] ?? g.parts[0];
    const first = [...g.parts].sort((a, b) => String(a.dayOne).localeCompare(String(b.dayOne)))[0];
    const last = [...g.parts].sort((a, b) => String(b.lastDay || b.dayOne).localeCompare(String(a.lastDay || a.dayOne)))[0];
    const city = g.desk?.city || (main ? cityOfPart(main) : "");
    const counted = g.parts.length ? countPeople(g.parts, (p) => guests.get(`${p.site}:${p.id}`) ?? []) : null;
    const agencies = new Map();
    let matched = 0;
    for (const person of counted?.sample ?? []) {
      const a = agencyOf(person, dir);
      if (!a || a.name === SPONSOR) continue;
      const x = agencies.get(a.name) ?? { agency: a.name, province: a.province || "", sector: a.sector || "", count: 0 };
      x.count++; matched++; agencies.set(a.name, x);
    }
    // Training days: each part's own days, so Edmundston's 13 and 15 October are two days, not three.
    const days = g.parts.length ? new Set(g.parts.filter((p) => !isVirtualPart(p.title, cityOfPart(p)) || g.parts.every((q) => isVirtualPart(q.title, cityOfPart(q))))
      .flatMap((p) => Array.from({ length: daysOf(p.dayOne, p.lastDay) }, (_, i) => new Date(Date.parse(p.dayOne) + i * 86400000).toISOString().slice(0, 10)))).size || 1 : null;
    const dayOne = g.desk?.dayOne || first?.dayOne || "", lastDay = g.desk?.lastDay || last?.lastDay || last?.dayOne || dayOne;
    rows.push({
      id: g.desk?.id || `wix:${main.site}:${main.id}`, deskId: g.desk?.id || null, kind: g.desk?.kind || "",
      title: g.desk?.title || g.name || main.title.replace(PART_WORDS, "").replace(/\s*[-–:]\s*$/, "").replace(/^\s*[-–:]\s*/, "").trim(),
      city, dayOne, lastDay, days, held: (lastDay || dayOne || "9") < now,
      people: counted ? counted.people : null, inPerson: counted?.inPerson ?? null, virtual: counted?.virtual ?? null, attendeeDays: counted?.attendeeDays ?? null,
      format: !g.parts.length ? (g.desk?.city ? "in person" : "") : counted.inPerson && counted.virtual ? "in person + virtual" : counted.virtual && !counted.inPerson ? "virtual" : "in person",
      agencies: [...agencies.values()], unmatched: counted ? counted.people - matched : 0,
      parts: g.parts.map((p) => ({ site: String(p.site), id: p.id, title: p.title, dayOne: p.dayOne, people: (guests.get(`${p.site}:${p.id}`) ?? []).length, virtual: isVirtualPart(p.title, cityOfPart(p)) })),
    });
  }
  return rows.sort((a, b) => String(a.dayOne).localeCompare(String(b.dayOne)));
}

const KEY = (year) => `ongia:year:${year}:trainings`;
/** The kept reading for a year, or null when it hasn't been read yet. */
export const yearTrainings = async (year) => (await getMeta(KEY(year))) ?? null;
/**
 * Read a year from Wix and the desk and keep it, with next year's trainings (how many, and their cities) and the earlier
 * years' readings where they are missing, so the reports can tell new agencies from returning ones.
 */
export async function refreshYear(year, opts = {}) {
  const rows = await readYearTrainings(year, opts);
  let next = null;
  try {
    const all = opts.events ?? (await listEvents());
    const deskNext = all.filter((e) => !e.practice && e.kind !== "ext" && yearOf(e.dayOne) === String(Number(year) + 1));
    const wixNext = opts.wix ? await opts.wix.events(Number(year) + 1) : wixConfigured() ? await wixEventsOf(Number(year) + 1) : [];
    const groups = groupTrainings(Number(year) + 1, wixNext, deskNext);
    next = { count: groups.length, cities: groups.map((g) => g.desk?.city || (g.parts[0] ? cityOfPart(g.parts[0]) : "")).filter(Boolean) };
  } catch (e) { console.log(`history: next year not read (${e.message})`); }
  const out = { year: Number(year), at: new Date().toISOString(), rows, next };
  await putMeta(KEY(year), out);
  if (opts.earlier !== false) for (let y = 2021; y < Number(year); y++) {
    if (await yearTrainings(y)) continue;
    try { await refreshYear(y, { ...opts, earlier: false }); } catch (e) { console.log(`history: ${y} not read (${e.message})`); }
  }
  return out;
}
