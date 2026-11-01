import { newDoc, PDF_LOOK } from "./reports.mjs";
import { PROVINCES } from "./agencies.mjs";
import { ONG_KINDS } from "./ongiayear.mjs";

/**
 * The ONGIA year's PDFs, laid out like the mock-ups Andrew approved on 1 Nov 2026: the navy and gold of ONGIA's other
 * reports, charts in one navy hue (light to dark for "more"), gold for emphasis, every value printed beside its mark so
 * nothing rests on colour alone. Sections with no figures are left out rather than printed empty.
 */

const { NAVY, GOLD, INK, MUTED, LINE, PALE, LOGO } = PDF_LOOK;
const RAMP = ["#eef1f7", "#cdd6e8", "#97a8cc", "#5a73a6", "#1a2f5e"];
const TRACK = "#eceae3";

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
    held: (h, u) => (u ? `${h} held, ${u} to come` : `${h} held`), outOf5: "/5", more: (n) => `+ ${n} more`, unknownTopics: "Topics are grouped from the events' session titles." },
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
    held: (h, u) => (u ? `${h} tenus, ${u} à venir` : `${h} tenus`), outOf5: "/5", more: (n) => `+ ${n} autres`, unknownTopics: "Les sujets sont regroupés à partir des titres des séances." },
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

/* ---------- The headline tiles ---------- */

/** The year's tiles: four navy (people, events, agencies, provinces), then gold for whichever of contacts, rating, presenters, days exist. */
function tilesOf(f, lang) {
  const L = T[lang];
  const navy = [
    { big: num(f.attendees, lang), label: L.trained },
    { big: num(f.events, lang), label: L.events },
    { big: num(f.agencyCount, lang), label: L.agencies },
    { big: num(f.provinceCount, lang), label: L.provinces },
  ];
  const gold = [
    f.contacts != null ? { big: num(f.contacts, lang), label: L.contacts } : null,
    f.rating ? { big: `${dec(f.rating.mean, lang)}${L.outOf5}`, label: L.rating } : null,
    f.presenters ? { big: num(f.presenters, lang), label: L.presenters } : null,
    { big: num(f.trainingDays, lang), label: L.days },
  ].filter(Boolean);
  return { navy, gold };
}
function tile(doc, t, x, y, w, h, gold, big = 22) {
  doc.rect(x, y, w, h).fill(gold ? GOLD : NAVY);
  doc.font("b").fontSize(big).fillColor("#fff").text(t.big, x, y + h * 0.18, { width: w, align: "center", lineBreak: false });
  doc.font("b").fontSize(6.6).fillColor(gold ? "#fff" : "#e6c875").text(t.label.toUpperCase(), x + 3, y + h * 0.18 + big + 3, { width: w - 6, align: "center", characterSpacing: 0.8, height: 18 });
}
function tileRow(doc, items, x, y, w, h, { goldFrom = 99, big = 22, gap = 6 } = {}) {
  const tw = (w - gap * (items.length - 1)) / items.length;
  items.forEach((t, i) => tile(doc, t, x + i * (tw + gap), y, tw, h, i >= goldFrom, big));
  return y + h;
}

/* ---------- Charts ---------- */

/** Horizontal bars, one hue, the value printed at the end. Returns the y after the last row. */
function hbars(doc, rows, x, y, w, { labelW = 150, rowH = 15, color = NAVY, lang = "en", max = null, size = 8.5 } = {}) {
  const mx = max ?? Math.max(1, ...rows.map((r) => r.value));
  const valW = 38, barX = x + labelW + 6, barW = w - labelW - 6 - valW - 4;
  for (const r of rows) {
    doc.font("r").fontSize(size).fillColor(INK).text(r.label, x, y + 1, { width: labelW, lineBreak: false, height: size + 3, ellipsis: true });
    doc.rect(barX, y + 1.5, barW, rowH - 6).fill(TRACK);
    doc.rect(barX, y + 1.5, Math.max(1.5, (barW * r.value) / mx), rowH - 6).fill(color);
    doc.font("b").fontSize(size).fillColor(INK).text(num(r.value, lang), x + w - valW, y + 1, { width: valW, align: "right", lineBreak: false });
    y += rowH;
  }
  return y;
}

// Canada as tiles, roughly where each province and territory sits: [code, column, row].
const GRID = [["YT", 1, 0], ["NT", 2, 0], ["NU", 3, 0], ["NL", 7, 0], ["BC", 0, 1], ["AB", 1, 1], ["SK", 2, 1], ["MB", 3, 1], ["ON", 4, 1], ["QC", 5, 1], ["PE", 7, 1], ["NB", 6, 2], ["NS", 7, 2]];
/** The province tile map, shaded light to dark by people trained (log scale), each tile with its code and count. */
function tileMap(doc, provinces, x, y, w, lang) {
  const by = new Map(provinces.map((p) => [p.code, p.count]));
  const mx = Math.max(1, ...provinces.map((p) => p.count));
  const step = (v) => (v ? Math.min(4, 1 + Math.floor((Math.log10(v + 1) / Math.log10(mx + 1)) * 3.999)) : 0);
  const gap = 3, t = (w - gap * 7) / 8;
  for (const [code, c, r] of GRID) {
    const v = by.get(code) ?? 0, i = step(v), tx = x + c * (t + gap), ty = y + r * (t + gap);
    doc.roundedRect(tx, ty, t, t, 3).fill(RAMP[i]);
    const ink = i >= 3 ? "#ffffff" : INK;
    doc.font("b").fontSize(t > 40 ? 10 : 8.5).fillColor(ink).text(code, tx, ty + t * 0.22, { width: t, align: "center", lineBreak: false });
    doc.font("r").fontSize(t > 40 ? 8.5 : 7.5).fillColor(i ? ink : MUTED).text(v ? num(v, lang) : "–", tx, ty + t * 0.56, { width: t, align: "center", lineBreak: false });
  }
  const ly = y + 3 * (t + gap) + 6;
  RAMP.forEach((c, i) => doc.roundedRect(x + i * 24, ly, 22, 7, 1.5).fill(c));
  doc.font("r").fontSize(7).fillColor(MUTED).text(T[lang].mapLegend, x + 5 * 24 + 6, ly - 0.5, { lineBreak: false });
  return ly + 12;
}

/** Columns for the twelve months: held in navy, still to come in pale navy, the count above. */
function monthColumns(doc, months, x, y, w, h, lang) {
  const mx = Math.max(1, ...months.map((m) => m.held + m.upcoming));
  const cw = w / 12, top = y + 12, base = top + h;
  months.forEach((m, i) => {
    const total = m.held + m.upcoming, cx = x + i * cw + cw * 0.18, bw = cw * 0.64;
    const hh = (h * m.held) / mx, hu = (h * m.upcoming) / mx;
    if (!total) doc.rect(cx, base - 1, bw, 1).fill(LINE);
    if (m.held) doc.roundedRect(cx, base - hh, bw, hh, Math.min(2.5, hh / 2)).fill(NAVY);
    if (m.upcoming) doc.roundedRect(cx, base - hh - hu, bw, hu, Math.min(2.5, hu / 2)).fill(RAMP[2]);
    if (total) doc.font("b").fontSize(7.5).fillColor(INK).text(String(total), x + i * cw, base - hh - hu - 10, { width: cw, align: "center", lineBreak: false });
    doc.font("r").fontSize(7.5).fillColor(MUTED).text(INITIAL[lang][i], x + i * cw, base + 3, { width: cw, align: "center", lineBreak: false });
  });
  return base + 14;
}
/** "■ held  ■ to come" under the month columns, so the two shades are named, not just coloured. */
function monthKey(doc, x, y, lang) {
  doc.rect(x, y + 1, 7, 7).fill(NAVY); doc.font("r").fontSize(7).fillColor(MUTED).text(lang === "fr" ? "tenus" : "held", x + 10, y, { lineBreak: false });
  doc.rect(x + 46, y + 1, 7, 7).fill(RAMP[2]); doc.text(lang === "fr" ? "à venir" : "to come", x + 56, y, { lineBreak: false });
  return y + 12;
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
  const para = (t, opts = {}) => { if (!t) return; room(28); doc.font(opts.font ?? "r").fontSize(opts.size ?? 10.5).fillColor(opts.color ?? INK).text(t, X, doc.y, { width: W, lineGap: 2.5 }); doc.moveDown(0.45); };
  const bullets = (items) => {
    for (const t of items ?? []) {
      room(28); const y = doc.y, [b, rest] = lead(t);
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
  const quote = (q) => {
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
  F.chart(70, (x, y, w) => tileRow(doc, [...navy, ...gold.slice(0, 2)], x, y + 2, w, 58, { goldFrom: 4, big: 18 }) + 4);
  F.h2(L.eventsHead, 120);
  eventsTable(F, f, lang);

  F.h2(L.who, 140);
  for (const p of c.who ?? []) F.para(p);
  if (f.sectors.length) { F.h3(L.bySector, 30 + f.sectors.length * 16); F.chart(f.sectors.length * 16, (x, y, w) => hbars(doc, sectorRows(f, lang), x, y, w, { labelW: 200, rowH: 16, lang })); }
  if (f.provinces.length) {
    F.h3(L.byProvince, 150);
    F.chart(140, (x, y, w) => { const end = tileMap(doc, f.provinces, x, y, w * 0.55, lang); hbars(doc, provinceRows(f, lang).slice(0, 8), x + w * 0.6, y, w * 0.4, { labelW: 110, rowH: 15, lang, color: GOLD }); return end; });
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
  const tiles = [{ big: num(f.attendees, lang), label: L.trained }, { big: num(f.agencyCount, lang), label: L.agencies }, { big: num(f.provinceCount, lang), label: L.provinces },
    ...(f.contacts != null ? [{ big: num(f.contacts, lang), label: L.contacts }] : []), ...(f.newAgencies != null ? [{ big: num(f.newAgencies, lang), label: L.newAg }] : [])];
  F.chart(70, (x, y, w) => tileRow(doc, tiles, x, y + 2, w, 58, { goldFrom: 3, big: 19 }) + 4);
  if (f.provinces.length) {
    F.h3(L.byProvince, 220);
    F.para(c.provinces);
    F.chart(190, (x, y, w) => { const end = tileMap(doc, f.provinces, x, y, w * 0.6, lang); hbars(doc, provinceRows(f, lang), x + w * 0.64, y, w * 0.36, { labelW: 100, rowH: 15, lang, color: GOLD }); return end; });
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
  const tiles = [{ big: num(f.events, lang), label: L.events }, { big: num(f.trainingDays, lang), label: L.days }, { big: num(f.presenters, lang), label: L.presenters },
    ...(f.rating ? [{ big: `${dec(f.rating.mean, lang)}${L.outOf5}`, label: L.rating }] : []), { big: num(f.cities.length, lang), label: L.cities }];
  F.chart(70, (x, y, w) => tileRow(doc, tiles, x, y + 2, w, 58, { goldFrom: 3, big: 19 }) + 4);
  if (f.topics.length) {
    F.h3(L.topics, 40 + f.topics.length * 17);
    F.para(c.topics);
    F.chart(f.topics.length * 17, (x, y, w) => hbars(doc, topicRows(f, lang), x, y, w, { labelW: 220, rowH: 17, lang }));
    F.para(L.topicNote, { size: 8.5, color: MUTED, font: "i" });
  }
  F.h3(L.byMonth, 130);
  F.chart(110, (x, y, w) => monthKey(doc, x, monthColumns(doc, f.months, x, y, w, 80, lang), lang));
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
  let y = tileRow(doc, [...navy, ...gold.slice(0, 2)], X, doc.y + 10, W, 62, { goldFrom: 4, big: 20, gap: 5 }) + 18;
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
  ry = h3(n++, L.growing, rx, ry, half);
  // A figure of nought says nothing here (a year mostly still ahead), so only those with something to show.
  const grow = [f.newAgencies ? [num(f.newAgencies, lang), L.newAg] : null, f.presenters ? [num(f.presenters, lang), L.presenters] : null, f.cities.length ? [num(f.cities.length, lang), L.cities] : null, [num(f.trainingDays, lang), L.days]].filter(Boolean).slice(0, 3);
  const gw = (half - 6 * (grow.length - 1)) / grow.length;
  grow.forEach(([big, label], i) => {
    const gx = rx + i * (gw + 6);
    doc.roundedRect(gx, ry, gw, 40, 3).fill("#f6f3ea");
    doc.font("b").fontSize(15).fillColor(NAVY).text(big, gx, ry + 6, { width: gw, align: "center", lineBreak: false });
    doc.font("r").fontSize(7.5).fillColor(MUTED).text(label, gx + 2, ry + 25, { width: gw - 4, align: "center", lineBreak: false, height: 10, ellipsis: true });
  });
  ry += 40;
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
