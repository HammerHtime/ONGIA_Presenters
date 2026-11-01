import { newDoc, PDF_LOOK } from "./reports.mjs";
import { PROVINCES } from "./agencies.mjs";
import { ONG_KINDS } from "./ongiayear.mjs";
import { readFileSync } from "node:fs";

/**
 * The ONGIA year's PDFs, laid out like the mock-ups Andrew approved on 1 Nov 2026: the navy and gold of ONGIA's other
 * reports, charts in one navy hue (light to dark for "more"), gold for emphasis, every value printed beside its mark so
 * nothing rests on colour alone. Sections with no figures are left out rather than printed empty.
 */

const { NAVY, GOLD, INK, MUTED, LINE, PALE, LOGO, MAPFILE } = PDF_LOOK;
const RAMP = ["#eef1f7", "#cdd6e8", "#97a8cc", "#5a73a6", "#1a2f5e"];
const TRACK = "#eeebe3", SOFT_GOLD = "#e6c875", PALE_NAVY = "#e8ecf5";
// Canada's provinces and territories, projected once (Lambert conformal conic) and simplified: { w, h, paths, anchors }.
let MAP = null;
const canada = () => (MAP ??= JSON.parse(readFileSync(MAPFILE, "utf8")));
// Claude is asked for plain text; a stray **bold** is taken off rather than printed.
const plain = (t) => String(t ?? "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*\*/g, "").replace(/^#+\s*/gm, "");

const T = {
  en: { colon: ": ", prepared: "Prepared for", forWho: "Funders, partners and ONGIA's board", by: "Prepared by", byWho: "ONGIA | Andrew Hammond, President", date: "Date",
    review: (y) => `Year in review · ${y}`, org: "Organization for National Gang Information & Awareness", kicker: "Our year in numbers", page: "Page", of: "of",
    foot: (k, y) => `${k} ${y} · ONGIA`, footInfo: "ONGIA · WWW.ONGIA.ORG", prep: (d) => `Prepared by ONGIA · ${d}`,
    trained: "People trained", events: "Trainings and events", agencies: "Agencies", provinces: "Provinces and territories", contacts: "Contacts", rating: "Average rating",
    days: "Training days", presenters: "Presenters", newAg: "New agencies", cities: "Cities",
    glance: "At a glance", eventsHead: "Trainings and events", who: "Who we trained", said: "What attendees said", highlights: "Highlights of the year", ahead: (y) => `Looking ahead to ${y}`,
    colEvent: "Event", colCity: "City", colDates: "Dates", colPeople: "People", colRating: "Rating", total: "Total", toCome: "To come",
    byProvince: "People trained by province and territory", bySector: "Who we trained, by sector", topics: "Topics we trained on", byMonth: "Trainings and events by month",
    growing: "Growing network", topAgencies: "Agencies sending the most people", colAgency: "Agency", colProvince: "Province or territory", colSector: "Sector",
    reach: "Reach", sectors: "Sectors", growth: "Growth", program: "The program", presentersHead: "Presenters", ratings: "How it was rated", askedNext: "What attendees asked for next",
    recs: "For next year", bestSessions: "Highest-rated sessions", colSession: "Session", colTop2: "Rated 4 or 5", colAnswers: "Answers", measure: "Measure",
    mapLegend: "lighter: fewer · darker: more people trained", provShort: "People trained by province", federalNote: (n) => `${n} people came from federal or national agencies, which have no province, and aren't on the map.`,
    sectorNote: (n, of) => `Sectors cover ${n} of ${of} people: those whose agency is on ONGIA's agency list.`,
    topicNote: "People at the events that covered each topic; one event can cover several.",
    booked: (n, p, y) => `${n} event${n === 1 ? "" : "s"} already on the ${y} calendar${p ? `, in ${p} province${p === 1 ? "" : "s"}` : ""}.`, lookingAhead: "Looking ahead:",
    growText: (n, r) => `${n} agencies came to an ONGIA event for the first time this year; ${r} had come before.`, contactsText: (c) => `ONGIA's contact list holds ${c} people.`,
    presentersText: (p, o) => `${p} presenters from ${o} organizations.`, presenterOrgs: "Presenters by organization", ratingText: (m, t, n) => `Average rating ${m} out of 5; ${t}% rated the training 4 or 5 (${n} answers).`,
    held: (h, u) => (u ? `${h} held, ${u} to come` : `${h} held`), outOf5: "/5", more: (n) => `+ ${n} more`, unknownTopics: "Topics are grouped from the events' session titles.",
    byYear: "People trained each year", provShortCard: "Provinces", trainingsCard: "Trainings", inPerson: "in person", virtual: "virtual", toDate: "to date", registered: "registered, still to come", fewer: "fewer", more2: "more people trained",
    subSplit: (a, b) => `${a} in person · ${b} virtual`, subHeld: (h, u, r) => (u ? `${h} held · ${u} to come${r ? ` (${r} registered)` : ""}` : `all ${h} held`), subNew: (n) => `${n} new this year`, subNetwork: "ONGIA's network", subAnswers: (n) => `${n} survey answers`, subDays: (n) => `${n} attendee-days`, subCities: (c) => c, subOrgs: (n) => `from ${n} organizations` },
  fr: { colon: " : ", prepared: "Préparé pour", forWho: "Bailleurs de fonds, partenaires et conseil d'administration de l'ONGIA", by: "Préparé par", byWho: "ONGIA | Andrew Hammond, président", date: "Date",
    review: (y) => `Bilan de l'année · ${y}`, org: "Organization for National Gang Information & Awareness", kicker: "Notre année en chiffres", page: "Page", of: "de",
    foot: (k, y) => `${k} ${y} · ONGIA`, footInfo: "ONGIA · WWW.ONGIA.ORG", prep: (d) => `Préparé par l'ONGIA · ${d}`,
    trained: "Personnes formées", events: "Formations et événements", agencies: "Organismes", provinces: "Provinces et territoires", contacts: "Contacts", rating: "Note moyenne",
    days: "Jours de formation", presenters: "Conférenciers", newAg: "Nouveaux organismes", cities: "Villes",
    glance: "En un coup d'œil", eventsHead: "Formations et événements", who: "Qui nous avons formé", said: "Ce que disent les participants", highlights: "Faits saillants de l'année", ahead: (y) => `Perspectives pour ${y}`,
    colEvent: "Événement", colCity: "Ville", colDates: "Dates", colPeople: "Personnes", colRating: "Note", total: "Total", toCome: "À venir",
    byProvince: "Personnes formées par province et territoire", bySector: "Qui nous avons formé, par secteur", topics: "Sujets abordés", byMonth: "Formations et événements par mois",
    growing: "Un réseau qui grandit", topAgencies: "Organismes ayant envoyé le plus de personnes", colAgency: "Organisme", colProvince: "Province ou territoire", colSector: "Secteur",
    reach: "Portée", sectors: "Secteurs", growth: "Croissance", program: "Le programme", presentersHead: "Conférenciers", ratings: "Évaluation", askedNext: "Ce que les participants souhaitent ensuite",
    recs: "Pour l'an prochain", bestSessions: "Séances les mieux notées", colSession: "Séance", colTop2: "Note de 4 ou 5", colAnswers: "Réponses", measure: "Mesure",
    mapLegend: "pâle : moins · foncé : plus de personnes", provShort: "Personnes formées par province", federalNote: (n) => `${n} personnes venaient d'organismes fédéraux ou nationaux, sans province, et ne figurent pas sur la carte.`,
    sectorNote: (n, of) => `Les secteurs couvrent ${n} des ${of} personnes : celles dont l'organisme figure sur la liste de l'ONGIA.`,
    topicNote: "Personnes présentes aux événements ayant abordé chaque sujet; un événement peut en aborder plusieurs.",
    booked: (n, p, y) => `${n} événement${n === 1 ? "" : "s"} déjà au calendrier ${y}${p ? `, dans ${p} province${p === 1 ? "" : "s"}` : ""}.`, lookingAhead: "Perspectives :",
    growText: (n, r) => `${n} organismes ont participé à un événement de l'ONGIA pour la première fois cette année; ${r} y avaient déjà participé.`, contactsText: (c) => `La liste de contacts de l'ONGIA compte ${c} personnes.`,
    presentersText: (p, o) => `${p} conférenciers provenant de ${o} organisations.`, presenterOrgs: "Conférenciers par organisation", ratingText: (m, t, n) => `Note moyenne de ${m} sur 5; ${t} % ont noté la formation 4 ou 5 (${n} réponses).`,
    held: (h, u) => (u ? `${h} tenus, ${u} à venir` : `${h} tenus`), outOf5: "/5", more: (n) => `+ ${n} autres`, unknownTopics: "Les sujets sont regroupés à partir des titres des séances.",
    byYear: "Personnes formées chaque année", provShortCard: "Provinces", trainingsCard: "Formations", inPerson: "en personne", virtual: "virtuel", toDate: "à ce jour", registered: "inscrits, à venir", fewer: "moins", more2: "plus de personnes formées",
    subSplit: (a, b) => `${a} en personne · ${b} en virtuel`, subHeld: (h, u, r) => (u ? `${h} tenus · ${u} à venir${r ? ` (${r} inscrits)` : ""}` : `les ${h} tenus`), subNew: (n) => `${n} nouveaux cette année`, subNetwork: "Le réseau de l'ONGIA", subAnswers: (n) => `${n} réponses au sondage`, subDays: (n) => `${n} jours-participants`, subCities: (c) => c, subOrgs: (n) => `de ${n} organisations` },
};
const PROV_FR = { ON: "Ontario", QC: "Québec", MB: "Manitoba", SK: "Saskatchewan", AB: "Alberta", BC: "Colombie-Britannique", NS: "Nouvelle-Écosse", NB: "Nouveau-Brunswick",
  NL: "Terre-Neuve-et-Labrador", PE: "Île-du-Prince-Édouard", YT: "Yukon", NT: "Territoires du Nord-Ouest", NU: "Nunavut" };
const provName = (code, lang) => (lang === "fr" ? PROV_FR[code] : PROVINCES[code]) ?? code;
const num = (n, lang) => (n == null ? "" : Number(n).toLocaleString(lang === "fr" ? "fr-CA" : "en-CA"));
const dec = (n, lang) => (n == null ? "" : lang === "fr" ? String(n).replace(".", ",") : String(n));
const MON = { en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], fr: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."] };
const INITIAL = { en: "JFMAMJJASOND".split(""), fr: "JFMAMJJASOND".split("") };
const monthYear = (iso, lang) => { const [y, m] = String(iso).split("-").map(Number); const M = lang === "fr" ? ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"] : ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]; return `${M[m - 1]} ${y}`; };
function span(a, b, lang) {
  const d = (iso) => { const [, m, day] = String(iso).split("-").map(Number); return { m: m - 1, day }; };
  if (!a) return "";
  const x = d(a), y = d(b || a), M = MON[lang];
  if (lang === "fr") return x.m === y.m ? (x.day === y.day ? `${x.day} ${M[x.m]}` : `${x.day}–${y.day} ${M[x.m]}`) : `${x.day} ${M[x.m]} – ${y.day} ${M[y.m]}`;
  return x.m === y.m ? (x.day === y.day ? `${M[x.m]} ${x.day}` : `${M[x.m]} ${x.day}–${y.day}`) : `${M[x.m]} ${x.day} – ${M[y.m]} ${y.day}`;
}
const lead = (t) => { const m = /^(.{3,90}?[.:])\s+(.+)$/s.exec(String(t)); return m ? [m[1], m[2]] : ["", String(t)]; };
const sectorLabel = (s, lang) => (lang === "fr" ? s.fr : s.en);

/* ---------- The headline cards ---------- */

// Small glyphs drawn in a 14 x 14 box, for the cards.
const ICONS = {
  people: (d, c) => { d.circle(5, 4, 2.4).circle(10, 4.6, 2).fill(c); d.path("M1,13 C1,8.5 9,8.5 9,13 Z").fill(c); d.path("M7.5,13 C7.8,9.6 13.6,9.2 13.6,13 Z").fill(c); },
  calendar: (d, c) => { d.roundedRect(1, 2.5, 12, 10.5, 1.6).lineWidth(1.3).stroke(c); d.rect(1, 2.5, 12, 3).fill(c); d.rect(3.5, 0.8, 1.4, 3).rect(9.1, 0.8, 1.4, 3).fill(c); for (const [a, b] of [[3.5, 7.5], [6.4, 7.5], [9.3, 7.5], [3.5, 10], [6.4, 10]]) d.rect(a, b, 1.6, 1.4).fill(c); },
  building: (d, c) => { d.path("M1,5 L7,1.2 L13,5 Z").fill(c); for (const a of [2.2, 5.6, 9]) d.rect(a, 6, 2, 5.4).fill(c); d.rect(1, 12, 12, 1.6).fill(c); },
  pin: (d, c) => { d.path("M7,13.6 C3,9 2,7 2,5.6 A5,5 0 0 1 12,5.6 C12,7 11,9 7,13.6 Z").fill(c); d.circle(7, 5.6, 1.9).fill("#ffffff"); },
  network: (d, c) => { d.lineWidth(1.1).moveTo(3, 3.5).lineTo(7, 8).lineTo(11.5, 3).moveTo(7, 8).lineTo(7, 12).moveTo(3, 3.5).lineTo(11.5, 3).stroke(c); for (const [a, b, r] of [[3, 3.5, 2], [11.5, 3, 2], [7, 8, 2.3], [7, 12, 1.7]]) d.circle(a, b, r).fill(c); },
  star: (d, c) => { d.polygon(...Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 2.7 : 6.4; return [7 + r * Math.cos(a), 7.4 + r * Math.sin(a)]; })).fill(c); },
  clock: (d, c) => { d.circle(7, 7, 5.8).lineWidth(1.4).stroke(c); d.lineWidth(1.4).moveTo(7, 3.6).lineTo(7, 7.2).lineTo(9.6, 8.8).stroke(c); },
  mic: (d, c) => { d.roundedRect(5, 1, 4, 7.4, 2).fill(c); d.lineWidth(1.2).moveTo(3, 6.4).bezierCurveTo(3, 11.2, 11, 11.2, 11, 6.4).moveTo(7, 10.6).lineTo(7, 13).moveTo(4.6, 13).lineTo(9.4, 13).stroke(c); },
  city: (d, c) => { d.rect(1, 6, 4, 7.6).rect(5.6, 2, 4, 11.6).rect(10.2, 8, 3, 5.6).fill(c); },
  plus: (d, c) => { d.circle(7, 7, 6).fill(c); d.rect(6.1, 3.6, 1.8, 6.8).rect(3.6, 6.1, 6.8, 1.8).fill("#ffffff"); },
};

/** The year's cards: people, trainings, agencies, provinces in navy; contacts and the rating (or training days) in gold. */
function tilesOf(f, lang) {
  const L = T[lang];
  const navy = [
    { big: num(f.attendees, lang), label: L.trained, icon: "people", sub: f.inPerson != null && f.virtual != null && f.virtual ? L.subSplit(num(f.inPerson, lang), num(f.virtual, lang)) : "" },
    { big: num(f.events, lang), label: L.trainingsCard, icon: "calendar", sub: f.events ? L.subHeld(num(f.held, lang), f.upcoming ? num(f.upcoming, lang) : "", "") : "" },
    { big: num(f.agencyCount, lang), label: L.agencies, icon: "building", sub: f.newAgencies != null ? L.subNew(num(f.newAgencies, lang)) : "" },
    { big: num(f.provinceCount, lang), label: L.provShortCard, icon: "pin", sub: (f.provinces ?? []).slice(0, 7).map((p) => p.code).join(" · ") },
  ];
  const gold = [
    f.contacts != null ? { big: num(f.contacts, lang), label: L.contacts, icon: "network", sub: L.subNetwork } : null,
    f.rating ? { big: `${dec(f.rating.mean, lang)}${L.outOf5}`, label: L.rating, icon: "star", sub: L.subAnswers(num(f.rating.n, lang)) } : null,
    f.presenters ? { big: num(f.presenters, lang), label: L.presenters, icon: "mic", sub: f.presenterOrgs ? L.subOrgs(num(f.presenterOrgs, lang)) : "" } : null,
    { big: num(f.trainingDays, lang), label: L.days, icon: "clock", sub: f.attendeeDays ? L.subDays(num(f.attendeeDays, lang)) : "" },
  ].filter(Boolean).map((t) => ({ ...t, accent: "gold" }));
  return { navy, gold };
}
/** One card: white, a thin edge and a faint shadow, a coloured edge on the left, the icon in a soft disc, the number, its label, a supporting line. */
function card(doc, t, x, y, w, h) {
  const band = t.accent === "gold" ? GOLD : NAVY, disc = t.accent === "gold" ? "#f6edd6" : PALE_NAVY;
  doc.save(); doc.fillOpacity(0.07); doc.roundedRect(x + 0.6, y + 1.8, w, h, 8).fill(NAVY); doc.restore();
  doc.roundedRect(x, y, w, h, 8).fillAndStroke("#ffffff", LINE);
  doc.save(); doc.roundedRect(x, y, w, h, 8).clip(); doc.rect(x, y, 4, h).fill(band); doc.restore();
  const r = Math.min(15, h / 2 - 8), cx = x + 12 + r;
  doc.circle(cx, y + h / 2, r).fill(disc);
  doc.save(); doc.translate(cx - r * 0.7, y + h / 2 - r * 0.7).scale((r * 1.4) / 14); ICONS[t.icon ?? "people"]?.(doc, band); doc.restore();
  const tx = cx + r + 10, tw = x + w - tx - 8, big = String(t.big), size = big.length > 6 ? 20 : 23;
  doc.font("b").fontSize(size).fillColor(NAVY).text(big, tx, y + h / 2 - size / 2 - 9, { width: tw, lineBreak: false });
  doc.font("b").fontSize(6.8).fillColor(INK).text(String(t.label).toUpperCase(), tx, y + h / 2 + size / 2 - 7, { width: tw, characterSpacing: 0.7, lineBreak: false, height: 9, ellipsis: true });
  if (t.sub) doc.font("r").fontSize(7.4).fillColor(band === GOLD ? "#8a6a12" : "#3f557f").text(t.sub, tx, y + h / 2 + size / 2 + 3, { width: tw, lineBreak: false, height: 10, ellipsis: true });
}
/** Cards in rows of `per`, each row the full width; returns the y after the last row. */
function tileRow(doc, items, x, y, w, h = 62, { per = 3, gap = 8 } = {}) {
  const cw = (w - gap * (per - 1)) / per;
  items.forEach((t, i) => card(doc, t, x + (i % per) * (cw + gap), y + Math.floor(i / per) * (h + gap), cw, h));
  return y + Math.ceil(items.length / per) * (h + gap) - gap;
}

/* ---------- Charts ---------- */

/** Horizontal bars: the label, a rounded bar on a soft track, the value just past the bar's end; the leading row in gold. */
function hbars(doc, rows, x, y, w, { labelW = 150, rowH = 17, color = NAVY, lang = "en", max = null, size = 8.5, lead = true } = {}) {
  const mx = max ?? Math.max(1, ...rows.map((r) => r.value));
  const barX = x + labelW + 8, barW = w - labelW - 8 - 36, bh = Math.min(8, rowH - 8);
  rows.forEach((r, i) => {
    const len = Math.max(bh, (barW * r.value) / mx), top = lead && rows.length > 1 && r.value === mx && rows.findIndex((q) => q.value === mx) === i;
    doc.font(top ? "b" : "r").fontSize(size).fillColor(INK).text(plain(r.label), x, y + (rowH - size) / 2 - 1, { width: labelW, lineBreak: false, height: size + 3, ellipsis: true });
    doc.roundedRect(barX, y + (rowH - bh) / 2, barW, bh, bh / 2).fill(TRACK);
    doc.roundedRect(barX, y + (rowH - bh) / 2, len, bh, bh / 2).fill(top ? GOLD : color);
    doc.font("b").fontSize(size).fillColor(INK).text(num(r.value, lang), barX + len + 5, y + (rowH - size) / 2 - 1, { width: 40, lineBreak: false });
    y += rowH;
  });
  return y;
}

/** The map of Canada, each province and territory shaded by people trained (light to dark), the number on those with any. */
function tileMap(doc, provinces, x, y, w, lang) {
  const M = canada(), by = new Map(provinces.map((p) => [p.code, p.count]));
  const mx = Math.max(1, ...provinces.map((p) => p.count));
  const step = (v) => (v ? Math.min(4, 1 + Math.floor((Math.log10(v + 1) / Math.log10(mx + 1)) * 3.999)) : 0);
  const s = w / M.w, h = M.h * s;
  for (const [code, d] of Object.entries(M.paths)) { doc.save(); doc.translate(x, y).scale(s); doc.path(d).lineWidth(1.5 / s).lineJoin("round").fillAndStroke(RAMP[step(by.get(code) ?? 0)], "#ffffff"); doc.restore(); }
  // The three small Maritime provinces carry their number on a short leader.
  const OUT = { NB: [-0.035, 0.03], NS: [0.025, 0.034], PE: [0.026, -0.022] };
  for (const [code, [ax, ay]] of Object.entries(M.anchors)) {
    const v = by.get(code); if (!v) continue;
    let px = x + ax * s, py = y + ay * s;
    if (OUT[code]) { const dx = OUT[code][0] * M.w * s * 1.0, dy = OUT[code][1] * M.h * s * 1.0; doc.moveTo(px, py).lineTo(px + dx, py + dy).lineWidth(0.6).stroke(MUTED); doc.circle(px, py, 1.4).fill(NAVY); px += dx; py += dy; }
    const t = num(v, lang), fs = w > 220 ? 8 : 7, tw = doc.font("b").fontSize(fs).widthOfString(t) + 9, light = step(v) >= 3 && !OUT[code];
    doc.roundedRect(px - tw / 2, py - fs + 1, tw, fs + 6, (fs + 6) / 2).fill(light ? "#ffffff" : NAVY);
    doc.font("b").fontSize(fs).fillColor(light ? NAVY : "#ffffff").text(t, px - tw / 2, py - fs + 3.4, { width: tw, align: "center", lineBreak: false });
  }
  const ly = y + h + 5, L = T[lang];
  doc.font("r").fontSize(7).fillColor(MUTED).text(L.fewer, x, ly - 1, { lineBreak: false });
  const lx = x + doc.widthOfString(L.fewer) + 5;
  RAMP.forEach((c, i) => doc.roundedRect(lx + i * 21, ly, 19, 6, 1.5).fill(c));
  doc.font("r").fontSize(7).fillColor(MUTED).text(L.more2, lx + 5 * 21 + 4, ly - 1, { lineBreak: false });
  return ly + 12;
}

/** Twelve months: held in navy, still to come outlined; the count above. */
function monthColumns(doc, months, x, y, w, h, lang) {
  const mx = Math.max(1, ...months.map((m) => m.held + m.upcoming)), cw = w / 12, top = y + 12, base = top + h;
  months.forEach((m, i) => {
    const total = m.held + m.upcoming, bw = cw * 0.56, bx = x + i * cw + (cw - bw) / 2;
    const hh = (h * m.held) / mx, hu = (h * m.upcoming) / mx;
    if (m.held) doc.roundedRect(bx, base - hh, bw, hh, Math.min(3, hh / 2)).fill(NAVY);
    if (m.upcoming) { doc.roundedRect(bx + 0.5, base - hh - hu + 0.5, bw - 1, hu - 1, Math.min(3, hu / 2)).lineWidth(1).dash(2, { space: 1.5 }).stroke(NAVY); doc.undash(); }
    if (total) doc.font("b").fontSize(7.5).fillColor(INK).text(String(total), x + i * cw, base - hh - hu - 10, { width: cw, align: "center", lineBreak: false });
    doc.font("r").fontSize(7.5).fillColor(MUTED).text(INITIAL[lang][i], x + i * cw, base + 3, { width: cw, align: "center", lineBreak: false });
  });
  doc.moveTo(x, base).lineTo(x + w, base).lineWidth(0.7).stroke("#c9c3b4");
  return base + 14;
}
/** "■ held  ⬚ to come" under the month columns, so the two are named, not just drawn differently. */
function monthKey(doc, x, y, lang) {
  doc.rect(x, y + 1, 7, 7).fill(NAVY); doc.font("r").fontSize(7).fillColor(MUTED).text(lang === "fr" ? "tenus" : "held", x + 10, y, { lineBreak: false });
  doc.roundedRect(x + 46, y + 1, 7, 7, 1).lineWidth(0.9).dash(1.5, { space: 1 }).stroke(NAVY); doc.undash();
  doc.font("r").fontSize(7).fillColor(MUTED).text(lang === "fr" ? "à venir" : "to come", x + 56, y, { lineBreak: false });
  return y + 12;
}

/**
 * People trained each year: in person (navy) and virtual (soft gold) stacked, the total above. The current year is "to
 * date", with the people registered for its trainings still to come as an outlined block on top.
 */
function yearColumns(doc, years, x, y, w, h, { lang = "en", current = null } = {}) {
  const L = T[lang];
  const mx = Math.max(1, ...years.map((r) => r.people + (r.toCome ?? 0))) * 1.15, cw = w / years.length, top = y + 14, base = top + h;
  for (let g = 1; g <= 3; g++) { const gy = base - (h * g) / 3.45; doc.moveTo(x, gy).lineTo(x + w, gy).lineWidth(0.4).dash(2, { space: 2 }).stroke(LINE); doc.undash(); }
  years.forEach((r, i) => {
    const bw = Math.min(36, cw * 0.56), bx = x + i * cw + (cw - bw) / 2;
    const ip = r.inPerson ?? r.people, vi = r.virtual ?? 0, hi = (h * ip) / mx, hv = (h * vi) / mx, hc = (h * (r.toCome ?? 0)) / mx;
    if (hi) doc.roundedRect(bx, base - hi, bw, hi, hv || hc ? 0 : Math.min(3, hi / 2)).fill(NAVY);
    if (hv) doc.roundedRect(bx, base - hi - hv, bw, hv, hc ? 0 : Math.min(3, hv / 2)).fill(SOFT_GOLD);
    if (hi && hv) doc.rect(bx, base - hi - 0.6, bw, 1.2).fill("#ffffff");
    if (hc) { doc.roundedRect(bx + 0.5, base - hi - hv - hc + 0.5, bw - 1, hc - 1, Math.min(3, hc / 2)).lineWidth(1).dash(2, { space: 1.5 }).stroke(NAVY); doc.undash(); }
    doc.font("b").fontSize(8.6).fillColor(INK).text(num(r.people, lang), x + i * cw, base - hi - hv - 12, { width: cw, align: "center", lineBreak: false });
    if (hc) doc.font("b").fontSize(7.4).fillColor(NAVY).text(`+${num(r.toCome, lang)}`, x + i * cw, base - hi - hv - hc - 11, { width: cw, align: "center", lineBreak: false });
    const now = String(r.year) === String(current);
    doc.font(now ? "b" : "r").fontSize(8).fillColor(now ? NAVY : MUTED).text(String(r.year), x + i * cw, base + 4, { width: cw, align: "center", lineBreak: false });
    if (now) doc.font("r").fontSize(6.5).fillColor(MUTED).text(L.toDate, x + i * cw, base + 13, { width: cw, align: "center", lineBreak: false });
  });
  doc.moveTo(x, base).lineTo(x + w, base).lineWidth(0.7).stroke("#c9c3b4");
  const ky = base + 25;
  doc.rect(x, ky + 1, 7, 7).fill(NAVY); doc.font("r").fontSize(7).fillColor(MUTED).text(L.inPerson, x + 10, ky, { lineBreak: false });
  let kx = x + 10 + doc.widthOfString(L.inPerson) + 12;
  doc.rect(kx, ky + 1, 7, 7).fill(SOFT_GOLD); doc.font("r").fontSize(7).fillColor(MUTED).text(L.virtual, kx + 10, ky, { lineBreak: false });
  if (years.some((r) => r.toCome)) { kx += 10 + doc.widthOfString(L.virtual) + 12; doc.roundedRect(kx, ky + 1, 7, 7, 1).lineWidth(0.9).dash(1.5, { space: 1 }).stroke(NAVY); doc.undash(); doc.font("r").fontSize(7).fillColor(MUTED).text(L.registered, kx + 10, ky, { lineBreak: false }); }
  return ky + 12;
}

/* ---------- A flowing document: header, headings, paragraphs, tables, quotes, footer ---------- */

function flow(doc, lang, title, year) {
  const L = T[lang], X = 54, W = doc.page.width - 108;
  let first = true;
  const header = () => {
    doc.image(LOGO, X, 22, { height: 30 });
    doc.font("r").fontSize(8).fillColor(MUTED).text(first ? L.org : `${title} · ${year}`, X, 30, { width: W, align: "right" });
    doc.x = X; doc.y = 70; first = false;
  };
  doc.on("pageAdded", header); header();
  const room = (h) => { if (doc.y + h > doc.page.height - 70) doc.addPage(); };
  const h2 = (t, need = 80) => { room(need); doc.moveDown(0.5); doc.font("b").fontSize(15).fillColor(NAVY).text(t, X, doc.y, { width: W }); doc.moveDown(0.25); };
  const h3 = (t, need = 60) => { room(need); doc.moveDown(0.3); doc.font("b").fontSize(9.5).fillColor(NAVY).text(t.toUpperCase(), X, doc.y, { width: W, characterSpacing: 1 }); doc.moveDown(0.35); };
  const para = (t0, opts = {}) => { const t = plain(t0); if (!t) return; room(28); doc.font(opts.font ?? "r").fontSize(opts.size ?? 10.5).fillColor(opts.color ?? INK).text(t, X, doc.y, { width: W, lineGap: 2.5 }); doc.moveDown(0.45); };
  const bullets = (items) => {
    for (const t of items ?? []) {
      room(28); const y = doc.y, [b, rest] = lead(plain(t));
      doc.font("r").fontSize(10.5).fillColor(INK).text("•", X + 4, y);
      if (b) doc.font("b").text(`${b} `, X + 18, y, { width: W - 18, continued: true, lineGap: 2.5 }).font("r").text(rest, { lineGap: 2.5 });
      else doc.text(rest, X + 18, y, { width: W - 18, lineGap: 2.5 });
      doc.moveDown(0.3);
    }
  };
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
    doc.x = X;
    return doc.y;
  };
  const box = (t) => {
    const h = doc.font("r").fontSize(10).heightOfString(t, { width: W - 24, lineGap: 2 }) + 18;
    room(h + 10); const y = doc.y;
    doc.roundedRect(X, y, W, h, 4).fillAndStroke("#fbfaf6", LINE);
    doc.font("r").fontSize(10).fillColor(INK).text(t, X + 12, y + 9, { width: W - 24, lineGap: 2 });
    doc.y = y + h + 8; doc.x = X;
  };
  const quote = (q0) => {
    const q = { ...q0, text: plain(q0.text) };
    const h = doc.font("b").fontSize(11).heightOfString(`“${q.text}”`, { width: W - 32 }) + 30;
    room(h + 8); const y = doc.y;
    doc.rect(X, y, W, h).fill(PALE); doc.rect(X, y, 3.5, h).fill(NAVY);
    doc.font("b").fontSize(11).fillColor(NAVY).text(`“${q.text}”`, X + 16, y + 9, { width: W - 32 });
    doc.font("b").fontSize(7.5).fillColor(MUTED).text(`— ${String(q.about).toUpperCase()}`, X + 16, y + h - 15, { width: W - 32, characterSpacing: 1, lineBreak: false, height: 9, ellipsis: true });
    doc.y = y + h + 6; doc.x = X;
  };
  // A chart drawn at the current position: `draw(x, y, w)` returns where it ends.
  const chart = (need, draw) => { room(need); const end = draw(X, doc.y, W); doc.y = end + 8; doc.x = X; };
  const titleBlock = (date) => {
    doc.font("b").fontSize(27).fillColor(NAVY).text(title, X, doc.y, { width: W });
    doc.font("r").fontSize(15).fillColor(NAVY).text(`ONGIA · ${year}`, { width: W });
    doc.moveDown(0.3);
    doc.font("b").fontSize(9).fillColor(INK).text(`${L.prepared}${L.colon}`, X, doc.y, { continued: true }).font("r").text(`${L.forWho}   |   `, { continued: true })
      .font("b").text(`${L.by}${L.colon}`, { continued: true }).font("r").text(`${L.byWho}   |   `, { continued: true }).font("b").text(`${L.date}${L.colon}`, { continued: true }).font("r").text(monthYear(date, lang));
  };
  const footer = () => {
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      const y = doc.page.height - 40;
      doc.moveTo(X, y - 6).lineTo(X + W, y - 6).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.font("r").fontSize(8).fillColor(MUTED).text(L.foot(title, year), X, y, { width: W * 0.75, lineBreak: false, height: 10 });
      doc.text(`${L.page} ${i + 1} ${L.of} ${range.count}`, X + W * 0.75, y, { width: W * 0.25, align: "right", lineBreak: false, height: 10 });
    }
  };
  return { X, W, room, h2, h3, para, bullets, table, box, quote, chart, titleBlock, footer };
}

/* ---------- Shared sections ---------- */

const provinceRows = (f, lang) => f.provinces.map((p) => ({ label: provName(p.code, lang), value: p.count }));
const sectorRows = (f, lang) => f.sectors.map((s) => ({ label: sectorLabel(s, lang), value: s.count }));
const topicRows = (f, lang) => f.topics.map((t) => ({ label: lang === "fr" ? t.fr : t.en, value: t.people }));
const eventsTable = (F, f, lang) => {
  const L = T[lang];
  const rows = f.eventsList.map((r) => [r.title, r.city, span(r.dayOne, r.lastDay, lang), r.held ? num(r.attended, lang) : L.toCome, r.rating != null ? `${dec(r.rating, lang)}${L.outOf5}` : ""]);
  rows.push([L.total, "", "", num(f.attendees, lang), f.rating ? `${dec(f.rating.mean, lang)}${L.outOf5}` : ""]);
  F.table([{ label: L.colEvent, w: 0.44 }, { label: L.colCity, w: 0.17 }, { label: L.colDates, w: 0.16 }, { label: L.colPeople, w: 0.12, align: "right" }, { label: L.colRating, w: 0.11, align: "right" }], rows, { bold: rows.length - 1 });
};
const federal = (f) => Math.max(0, f.attendees - f.unmatched - f.peopleWithProvince);

/* ---------- Annual Impact Report ---------- */

async function impactPdf(c, f, lang, { date }) {
  const L = T[lang], Y = f.year, title = ONG_KINDS.impact[lang];
  const { doc, done } = newDoc(`${title} ${Y}`);
  const F = flow(doc, lang, title, Y);
  F.titleBlock(date);
  F.h2(L.glance);
  for (const p of c.glance ?? []) F.para(p);
  const { navy, gold } = tilesOf(f, lang);
  F.chart(140, (x, y, w) => tileRow(doc, [...navy, ...gold.slice(0, 2)], x, y + 4, w, 60) + 6);
  if ((f.history ?? []).length > 1) { F.h3(L.byYear, 170); F.chart(160, (x, y, w) => yearColumns(doc, f.history, x, y, w, 110, { lang, current: Y })); }
  F.h2(L.eventsHead, 120);
  eventsTable(F, f, lang);

  F.h2(L.who, 140);
  for (const p of c.who ?? []) F.para(p);
  if (f.sectors.length) { F.h3(L.bySector, 30 + f.sectors.length * 16); F.chart(f.sectors.length * 16, (x, y, w) => hbars(doc, sectorRows(f, lang), x, y, w, { labelW: 200, rowH: 16, lang })); }
  if (f.provinces.length) {
    F.h3(L.byProvince, 150);
    F.chart(230, (x, y, w) => { const end = tileMap(doc, f.provinces, x, y, w * 0.56, lang); hbars(doc, provinceRows(f, lang).slice(0, 9), x + w * 0.6, y + 6, w * 0.4, { labelW: 104, rowH: 17, lang }); return end; });
    if (federal(f)) F.para(L.federalNote(num(federal(f), lang)), { size: 8.5, color: MUTED, font: "i" });
  }
  if (c.quotes?.length) { F.h2(L.said, 70); for (const q of c.quotes) F.quote(q); }
  if (c.highlights?.length) { F.h2(L.highlights, 110); F.bullets(c.highlights); }
  if (f.topics.length) { F.h2(L.topics, 40 + f.topics.length * 16); F.chart(f.topics.length * 16, (x, y, w) => hbars(doc, topicRows(f, lang), x, y, w, { labelW: 220, rowH: 16, lang })); F.para(L.topicNote, { size: 8.5, color: MUTED, font: "i" }); }
  if (f.nextYear.count || c.lookAhead) {
    F.h2(L.ahead(Y + 1));
    if (f.nextYear.count) F.para(L.booked(f.nextYear.count, f.nextYear.provinces, Y + 1), { font: "b", color: NAVY });
    F.para(c.lookAhead);
  }
  F.footer(); doc.end(); return done;
}

/* ---------- Reach and Network Report ---------- */

async function reachPdf(c, f, lang, { date }) {
  const L = T[lang], Y = f.year, title = ONG_KINDS.reach[lang];
  const { doc, done } = newDoc(`${title} ${Y}`);
  const F = flow(doc, lang, title, Y);
  F.titleBlock(date);
  F.h2(L.reach);
  for (const p of c.intro ?? []) F.para(p);
  const { navy: rn } = tilesOf(f, lang);
  const tiles = [rn[0], rn[2], rn[3],
    ...(f.contacts != null ? [{ big: num(f.contacts, lang), label: L.contacts, icon: "network", sub: L.subNetwork, accent: "gold" }] : []),
    ...(f.newAgencies != null ? [{ big: num(f.newAgencies, lang), label: L.newAg, icon: "plus", sub: f.returningAgencies != null ? (lang === "fr" ? `${num(f.returningAgencies, lang)} déjà venus` : `${num(f.returningAgencies, lang)} returning`) : "", accent: "gold" }] : []),
    { big: num(f.cities.length, lang), label: L.cities, icon: "city", sub: f.cities.slice(0, 4).join(" · "), accent: "gold" }];
  F.chart(140, (x, y, w) => tileRow(doc, tiles.slice(0, 6), x, y + 4, w, 60) + 6);
  if (f.provinces.length) {
    F.h3(L.byProvince, 220);
    F.para(c.provinces);
    F.chart(250, (x, y, w) => { const end = tileMap(doc, f.provinces, x, y, w * 0.6, lang); hbars(doc, provinceRows(f, lang), x + w * 0.63, y + 6, w * 0.37, { labelW: 98, rowH: 17, lang }); return end; });
    if (federal(f)) F.para(L.federalNote(num(federal(f), lang)), { size: 8.5, color: MUTED, font: "i" });
  }
  if (f.sectors.length) {
    F.h2(L.sectors, 60 + f.sectors.length * 17);
    F.para(c.sectors);
    F.chart(f.sectors.length * 17, (x, y, w) => hbars(doc, sectorRows(f, lang), x, y, w, { labelW: 220, rowH: 17, lang }));
    F.para(L.sectorNote(num(f.peopleWithSector, lang), num(f.attendees, lang)), { size: 8.5, color: MUTED, font: "i" });
  }
  if (f.topAgencies.length) {
    F.h2(L.topAgencies, 120);
    F.table([{ label: L.colAgency, w: 0.5 }, { label: L.colProvince, w: 0.22 }, { label: L.colSector, w: 0.18 }, { label: L.colPeople, w: 0.1, align: "right" }],
      f.topAgencies.slice(0, 12).map((a) => [a.agency, a.province ? provName(a.province, lang) : "—", a.sector ? sectorLabel(f.sectors.find((s) => s.id === a.sector) ?? { en: a.sector, fr: a.sector }, lang) : "", num(a.count, lang)]));
  }
  if (c.growth || f.newAgencies != null || f.contacts != null) {
    F.h2(L.growth, 70);
    F.para(c.growth);
    if ((f.history ?? []).length > 1) { F.h3(L.byYear, 170); F.chart(160, (x, y, w) => yearColumns(doc, f.history, x, y, w, 110, { lang, current: Y })); }
    const t = [f.newAgencies != null ? L.growText(num(f.newAgencies, lang), num(f.returningAgencies, lang)) : "", f.contacts != null ? L.contactsText(num(f.contacts, lang)) : ""].filter(Boolean).join(" ");
    if (t) F.box(t);
  }
  F.footer(); doc.end(); return done;
}

/* ---------- Training Program Report ---------- */

async function programPdf(c, f, lang, { date }) {
  const L = T[lang], Y = f.year, title = ONG_KINDS.program[lang];
  const { doc, done } = newDoc(`${title} ${Y}`);
  const F = flow(doc, lang, title, Y);
  F.titleBlock(date);
  F.h2(L.program);
  for (const p of c.intro ?? []) F.para(p);
  const { navy: pn, gold: pg } = tilesOf(f, lang);
  const tiles = [pn[1], { ...pg.find((t) => t.icon === "clock"), accent: "navy" }, { big: num(f.cities.length, lang), label: L.cities, icon: "city", sub: f.cities.slice(0, 4).join(" · ") },
    ...(f.presenters ? [{ big: num(f.presenters, lang), label: L.presenters, icon: "mic", sub: f.presenterOrgs ? L.subOrgs(num(f.presenterOrgs, lang)) : "", accent: "gold" }] : []),
    ...(f.rating ? [{ big: `${dec(f.rating.mean, lang)}${L.outOf5}`, label: L.rating, icon: "star", sub: L.subAnswers(num(f.rating.n, lang)), accent: "gold" }] : []),
    pn[0] && { ...pn[0], accent: "gold" }, pn[2] && { ...pn[2], accent: "gold" }, pn[3] && { ...pn[3], accent: "gold" }].filter(Boolean).slice(0, 6);
  F.chart(140, (x, y, w) => tileRow(doc, tiles, x, y + 4, w, 60) + 6);
  if (f.topics.length) {
    F.h3(L.topics, 40 + f.topics.length * 17);
    F.para(c.topics);
    F.chart(f.topics.length * 17, (x, y, w) => hbars(doc, topicRows(f, lang), x, y, w, { labelW: 220, rowH: 17, lang }));
    F.para(L.topicNote, { size: 8.5, color: MUTED, font: "i" });
  }
  F.h3(L.byMonth, 130);
  F.chart(120, (x, y, w) => monthKey(doc, x, monthColumns(doc, f.months, x, y, w, 80, lang) + 2, lang));
  if (f.presenters) {
    F.h2(L.presentersHead, 120);
    F.para(c.presenters);
    F.box(L.presentersText(num(f.presenters, lang), num(f.presenterOrgs, lang)));
    if (f.presenterOrgList?.length) { F.h3(L.presenterOrgs, 30 + Math.min(10, f.presenterOrgList.length) * 15); F.chart(Math.min(10, f.presenterOrgList.length) * 15, (x, y, w) => hbars(doc, f.presenterOrgList.slice(0, 10).map((o) => ({ label: o.org, value: o.count })), x, y, w, { labelW: 260, rowH: 15, lang, color: GOLD })); }
  }
  if (f.rating || f.scoring.length) {
    F.h2(L.ratings, 110);
    F.para(c.ratings);
    if (f.rating) F.para(L.ratingText(dec(f.rating.mean, lang), f.rating.top2, num(f.rating.n, lang)), { font: "b", color: NAVY });
    if (f.scoring.length) F.table([{ label: L.measure, w: 0.6 }, { label: L.colTop2, w: 0.2, align: "right" }, { label: L.colAnswers, w: 0.2, align: "right" }], f.scoring.map((s) => [lang === "fr" ? s.fr : s.en, `${s.top2}${lang === "fr" ? " %" : "%"}`, num(s.n, lang)]));
  }
  if (f.sessions.length) {
    F.h2(L.bestSessions, 110);
    F.table([{ label: L.colSession, w: 0.48 }, { label: L.colEvent, w: 0.3 }, { label: L.colTop2, w: 0.12, align: "right" }, { label: L.colAnswers, w: 0.1, align: "right" }],
      f.sessions.slice(0, 8).map((s) => [lang === "fr" ? s.titleFr || s.title : s.title, s.event, `${s.top2}${lang === "fr" ? " %" : "%"}`, num(s.n, lang)]));
  }
  if (c.askedNext) { F.h2(L.askedNext, 70); F.para(c.askedNext); }
  if (c.recommendations?.length) { F.h2(L.recs, 70); F.bullets(c.recommendations); }
  F.footer(); doc.end(); return done;
}

/* ---------- The year-end infographic (one page, the mock-up's layout) ---------- */

async function infoPdf(c, f, lang, { date }) {
  const L = T[lang], Y = f.year;
  const { doc, done } = newDoc(`${L.review(Y)} — ${ONG_KINDS.info[lang]}`);
  const X = 36, W = doc.page.width - 72, BOTTOM = doc.page.height - 48;
  doc.page.margins.bottom = 0;
  doc.image(LOGO, X, 26, { height: 38 });
  doc.font("b").fontSize(8.5).fillColor(NAVY).text(L.review(Y).toUpperCase(), X, 32, { width: W, align: "right", characterSpacing: 1.2 });
  doc.font("r").fontSize(7.5).fillColor(MUTED).text(L.org, X, 44, { width: W, align: "right" });
  doc.font("b").fontSize(8).fillColor(GOLD).text(L.kicker.toUpperCase(), X, 80, { characterSpacing: 1.5 });
  doc.font("b").fontSize(24).fillColor(NAVY).text(c.headline || L.review(Y), X, 92, { width: W, lineGap: -2 });
  if (c.tagline) doc.font("i").fontSize(10.5).fillColor(MUTED).text(c.tagline, X, doc.y + 1, { width: W });
  const { navy, gold } = tilesOf(f, lang);
  let y = tileRow(doc, [...navy, ...gold.slice(0, 2)], X, doc.y + 10, W, 56) + 16;
  const h3 = (n, t, x, yy, w) => {
    doc.circle(x + 7, yy + 6, 7).fill(GOLD); doc.font("b").fontSize(8).fillColor("#fff").text(String(n), x, yy + 2.6, { width: 14, align: "center", lineBreak: false });
    doc.font("b").fontSize(8.5).fillColor(NAVY).text(t.toUpperCase(), x + 20, yy + 1.8, { width: w - 20, characterSpacing: 1, lineBreak: false, height: 11, ellipsis: true });
    return yy + 22;
  };
  const half = (W - 24) / 2, rx = X + half + 24;
  let n = 1;
  // Row 1: the province map, and sectors (or the agencies sending the most people when sectors aren't in yet).
  let ly = h3(n++, L.provShort, X, y, half);
  ly = tileMap(doc, f.provinces, X, ly, half, lang);
  let ry;
  if (f.sectors.length) { ry = h3(n++, L.bySector, rx, y, half); ry = hbars(doc, sectorRows(f, lang).slice(0, 9), rx, ry, half, { labelW: 152, rowH: 16, lang }); }
  else { ry = h3(n++, L.topAgencies, rx, y, half); ry = hbars(doc, f.topAgencies.slice(0, 9).map((a) => ({ label: a.agency, value: a.count })), rx, ry, half, { labelW: 150, rowH: 16, lang }); }
  y = Math.max(ly, ry) + 16;
  // Row 2: topics (or each event's people), and the months with the growing network under them.
  if (f.topics.length) { ly = h3(n++, L.topics, X, y, half); ly = hbars(doc, topicRows(f, lang).slice(0, 8), X, ly, half, { labelW: 156, rowH: 16, lang }); }
  else { ly = h3(n++, L.eventsHead, X, y, half); ly = hbars(doc, f.eventsList.filter((r) => r.held).slice(0, 8).map((r) => ({ label: r.title, value: r.attended })), X, ly, half, { labelW: 140, rowH: 16, lang }); }
  ry = h3(n++, L.byMonth, rx, y, half);
  ry = monthColumns(doc, f.months, rx, ry, half, 74, lang);
  ry = monthKey(doc, rx, ry, lang) + 8;
  // (The cards above already carry new agencies, cities and training days, so they aren't repeated here.)
  y = Math.max(ly, ry) + 18;
  if (c.quote?.text) {
    const qh = Math.min(76, doc.font("b").fontSize(12.5).heightOfString(`“${c.quote.text}”`, { width: W - 40 }) + 32);
    if (y + qh < BOTTOM - 50) {
      doc.rect(X, y, W, qh).fill(PALE); doc.rect(X, y, 4, qh).fill(NAVY);
      doc.font("b").fontSize(12.5).fillColor(NAVY).text(`“${c.quote.text}”`, X + 18, y + 10, { width: W - 40, height: qh - 28, ellipsis: true });
      doc.font("b").fontSize(7.5).fillColor(MUTED).text(`— ${String(c.quote.about).toUpperCase()}`, X + 18, y + qh - 15, { width: W - 40, height: 9, ellipsis: true, lineBreak: false, characterSpacing: 1 });
      y += qh + 14;
    }
  }
  // Room left (no quote yet, or a short year): the agencies sending the most people, in two columns.
  const roomFor = Math.floor((BOTTOM - (f.nextYear.count ? 50 : 10) - y - 26) / 15);
  if (f.sectors.length && f.topAgencies.length && roomFor >= 3) {
    const rows = f.topAgencies.slice(0, Math.min(10, roomFor * 2)).map((a) => ({ label: a.agency, value: a.count }));
    const yy = h3(n++, L.topAgencies, X, y, W), per = Math.ceil(rows.length / 2), mx = Math.max(...rows.map((r) => r.value));
    const e1 = hbars(doc, rows.slice(0, per), X, yy, half, { labelW: 170, rowH: 15, lang, max: mx });
    const e2 = hbars(doc, rows.slice(per), rx, yy, half, { labelW: 170, rowH: 15, lang, max: mx });
    y = Math.max(e1, e2) + 14;
  }
  if (f.nextYear.count) {
    const bh = 34, by = Math.min(y, BOTTOM - bh - 4);
    doc.roundedRect(X, by, W, bh, 4).fillAndStroke("#fbfaf6", LINE);
    doc.font("b").fontSize(10).fillColor(NAVY).text(`${L.lookingAhead} `, X + 14, by + 12, { continued: true, lineBreak: false }).font("r").fillColor(INK).text(L.booked(f.nextYear.count, f.nextYear.provinces, Y + 1), { lineBreak: false });
    doc.font("b").fontSize(8.5).fillColor(GOLD).text(String(Y + 1), X, by + 13, { width: W - 14, align: "right", characterSpacing: 1.2, lineBreak: false });
  }
  const fy = doc.page.height - 34;
  doc.moveTo(X, fy - 7).lineTo(X + W, fy - 7).lineWidth(0.5).strokeColor(LINE).stroke();
  doc.font("r").fontSize(7).fillColor(MUTED).text(L.footInfo, X, fy, { width: W / 2, lineBreak: false });
  doc.text(L.prep(monthYear(date, lang)), X + W / 2, fy, { width: W / 2, align: "right", lineBreak: false });
  doc.end();
  return done;
}

const MAKERS = { impact: impactPdf, reach: reachPdf, program: programPdf, info: infoPdf };
/** One report's PDF in one language. */
export const ongPdf = (kind, content, facts, lang, opts) => MAKERS[kind](content ?? {}, facts, lang, opts);
