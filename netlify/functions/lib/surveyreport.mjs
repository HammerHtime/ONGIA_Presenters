import PDFDocument from "pdfkit";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { formatDate } from "./deadlines.mjs";
import { xlsx } from "./xlsx.mjs";
import { ABOUT, SESSION, OVERALL, STARS } from "./survey.mjs";
import { PROVINCES } from "./agencies.mjs";

const SECTOR_NAMES = { police: "Police & law enforcement", justice: "Corrections, courts & justice", education: "Education", community: "Community & social services", government: "Government", other: "Other" };

/**
 * The survey's downloads (Andrew 27 Oct 2026): the summary with charts, as a PDF; every answer, one row each, as a
 * spreadsheet; and the people who said they'd like to present, kept apart from the answers.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSET_DIRS = [path.resolve(HERE, "../../../public/assets"), path.resolve(HERE, "../../public/assets"), path.resolve(process.cwd(), "public/assets"), "/var/task/public/assets"];
const ASSETS = ASSET_DIRS.find((d) => existsSync(path.join(d, "ongia-logo.png"))) ?? ASSET_DIRS[0];
const NAVY = "#14264d", DEEP = "#0e1a35", GOLD = "#c9a032", PALE = "#f6f1e4", INK = "#14181f", MUTED = "#5d6577", LINE = "#e2ddcf", RED = "#8c3b30";
const W = 612, H = 792, M = 44, BODY = W - M * 2;

const dates = (e) => (e.dayOne ? (e.lastDay && e.lastDay !== e.dayOne ? `${formatDate(e.dayOne)} to ${formatDate(e.lastDay)}` : formatDate(e.dayOne)) : "");
const out5 = (v) => (v === null || v === undefined ? "–" : `${v.toFixed(1)}/5`);

/** The summary report, with charts. Resolves to a Buffer. */
/** The same answer written the same way counted once, most asked for first. */
const tally = (list) => {
  const m = new Map();
  for (const raw of list) { const t = String(raw).trim(), k = t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); if (!k) continue; const g = m.get(k) ?? [t, 0]; g[1]++; m.set(k, g); }
  return [...m.values()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

export async function surveySummaryPdf(event, R, analysis = null) {
  const logo = await readFile(path.join(ASSETS, "ongia-logo-tagline-dark.png")).catch(() => null);
  const doc = new PDFDocument({ size: "LETTER", margin: 0, bufferPages: true, displayTitle: true, info: { Title: `ONGIA survey results · ${String(event.title).split(/\s*:\s*/)[0]}`, Author: "ONGIA" } });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  let y = 0;
  const newPage = () => { doc.addPage(); y = M; };
  const room = (h) => { if (y + h > H - M) newPage(); };
  const heading = (t) => { room(60); y += 10; doc.font("Helvetica-Bold").fontSize(13).fillColor(NAVY).text(t.toUpperCase(), M, y, { characterSpacing: 0.6 }); y = doc.y + 4;
    doc.moveTo(M, y).lineTo(M + BODY, y).lineWidth(1.2).strokeColor(GOLD).stroke(); y += 10; };
  const para = (t, { size = 10, color = INK, bold = false, indent = 0 } = {}) => { doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(color);
    room(doc.heightOfString(t, { width: BODY - indent }) + 4); doc.text(t, M + indent, y, { width: BODY - indent }); y = doc.y + 4; };
  /** A labelled bar, value out of `max`. */
  const bar = (label, value, max, text, { labelW = 210, color = NAVY } = {}) => {
    doc.font("Helvetica").fontSize(9.5);
    const h = Math.max(14, doc.heightOfString(label, { width: labelW - 8 }));
    room(h + 6);
    doc.fillColor(INK).text(label, M, y + 1, { width: labelW - 8 });
    const bw = BODY - labelW - 70;
    doc.roundedRect(M + labelW, y + 2, bw, 10, 3).fill(LINE);
    if (value > 0) doc.roundedRect(M + labelW, y + 2, Math.max(4, (bw * value) / max), 10, 3).fill(color);
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(NAVY).text(text, M + labelW + bw + 8, y + 1, { width: 62 });
    y += h + 6;
  };

  // Cover band.
  doc.rect(0, 0, W, 118).fill(DEEP);
  doc.rect(0, 118, W, 4).fill(GOLD);
  if (logo) doc.image(logo, M, 14, { height: 36 });
  doc.font("Helvetica-Bold").fontSize(20).fillColor("#ffffff").text("Survey results", M, 62, { width: BODY });
  doc.font("Helvetica").fontSize(10.5).fillColor("#e2bf5c").text(`${event.title}${event.city ? ` · ${event.city}` : ""} · ${dates(event)}`, M, 88, { width: BODY });
  y = 140;

  // The headline tiles.
  const tiles = [
    ["Overall quality", out5(R.headline.avg), `${R.headline.top2}% rated 4 or 5`],
    ["Answers", String(R.responses), `from ${R.respondents} ${R.respondents === 1 ? "person" : "people"}`],
    ["Recommend score", R.overall.nps.score === null ? "–" : `${R.overall.nps.score > 0 ? "+" : ""}${R.overall.nps.score}`, `would recommend ONGIA (${R.overall.nps.n})`],
    ["Pace about right", R.overall.pace.n ? `${R.overall.pace.aboutRightPct}%` : "–", `${R.overall.pace.n} answers`],
  ];
  const tw = (BODY - 30) / 4;
  tiles.forEach(([a, b, c], i) => {
    const x = M + i * (tw + 10);
    doc.roundedRect(x, y, tw, 76, 8).fill(PALE);
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(a.toUpperCase(), x + 10, y + 9, { width: tw - 20, characterSpacing: 0.4 });
    doc.font("Helvetica-Bold").fontSize(22).fillColor(NAVY).text(b, x + 10, y + 24, { width: tw - 20 });
    doc.font("Helvetica").fontSize(8.5).fillColor(INK).text(c, x + 10, y + 54, { width: tw - 20 });
  });
  y += 92;

  if (analysis) {
    heading("Claude's read");
    para(analysis.summary);
    if (analysis.liked?.length) { para("What attendees valued", { bold: true, color: NAVY }); for (const l of analysis.liked) para(`•  ${l.point} (${l.evidence})`, { indent: 8 }); }
    if (analysis.improve?.length) { para("What to look at", { bold: true, color: NAVY }); for (const l of analysis.improve) para(`•  ${l.point} (${l.evidence})`, { indent: 8 }); }
    if (analysis.presenters?.length) { para("Sessions that stood out", { bold: true, color: NAVY }); for (const l of analysis.presenters) para(`•  ${l.session}: ${l.note}`, { indent: 8 }); }
    if (analysis.nextTime?.length) { para("For next time", { bold: true, color: NAVY }); for (const l of analysis.nextTime) para(`•  ${l}`, { indent: 8 }); }
  }

  heading("Sessions");
  para("Average of the six star questions, out of 5. N/A answers and people who skipped a session are left out.", { size: 8.5, color: MUTED });
  const days = [...new Set(R.sessions.map((s) => s.day))].sort();
  for (const d of days) {
    if (d) para(formatDate(d), { bold: true, color: NAVY, size: 10 });
    for (const s of R.sessions.filter((x) => x.day === d)) {
      bar(`${s.title || "Untitled session"} — ${s.presenters.join(", ")}`, s.avg ?? 0, 5, s.n ? `${out5(s.avg)} · ${s.n}` : "no answers");
      if (s.n) para(`${s.top2}% rated 4 or 5 · ${s.rebook.yesPct}% would book again (${s.rebook.yes} yes, ${s.rebook.maybe} maybe, ${s.rebook.no} no)${s.skipped ? ` · ${s.skipped} weren't there` : ""}`, { size: 8.5, color: MUTED, indent: 0 });
    }
  }

  heading("The event overall");
  for (const q of OVERALL.filter((x) => x.kind === "stars")) {
    const s = R.overall[q.id];
    bar(q.en, s?.avg ?? 0, 5, s?.n ? `${out5(s.avg)} · ${s.n}` : "–", { color: GOLD });
  }
  for (const id of ["pace", "length"]) {
    const s = R.overall[id], opts = OVERALL.find((x) => x.id === id).options.en;
    para(`${OVERALL.find((x) => x.id === id).en} ${opts.map((o, i) => `${o} ${s.pcts[i]}%`).join(" · ")} (${s.n} answers)`, { size: 9.5 });
  }
  const nps = R.overall.nps;
  if (nps.n) para(`Recommend ONGIA to a colleague: ${nps.promoters} would (9–10), ${nps.passives} might (7–8), ${nps.detractors} would not (0–6). Score ${nps.score > 0 ? "+" : ""}${nps.score}, from -100 to +100.`, { size: 9.5 });
  if (R.overall.present) para(`${R.overall.present} ${R.overall.present === 1 ? "person would" : "people would"} like to present at a future event. Their details are in the separate download.`, { size: 9.5 });

  // Who came, from the registrations: how many agencies, in which sectors, and which.
  const T = R.trained;
  if (T) {
    heading("Agencies trained");
    para(`${T.people} registered attendees came from ${T.count} different agencies.${T.unplaced ? ` ${T.unplaced} of those names are not yet matched to the agency list (People tab, Who's coming, Agencies), so a few may be the same agency spelled two ways.` : ""}`, { size: 9.5 });
    for (const x of T.sectors) bar(SECTOR_NAMES[x.key], x.count, T.sectors[0].count, `${x.count}`);
    para("Agencies, with how many registered", { bold: true, color: NAVY });
    for (const a of T.agencies) para(`${a.name}: ${a.count}`, { size: 9.5, indent: 8 });
  }

  heading("Who answered");
  if (R.provinces.length) { para("Province or territory", { bold: true, color: NAVY }); for (const p of R.provinces) bar(p.name, p.pct, 100, `${p.pct}% · ${p.count}`); }
  if (R.years.some((x) => x.count)) { para("Years of service", { bold: true, color: NAVY }); for (const p of R.years) bar(p.label, p.pct, 100, `${p.pct}% · ${p.count}`, { color: GOLD }); }
  if (R.agencies.length) {
    para("Agencies", { bold: true, color: NAVY });
    for (const a of R.agencies) para(`${a.agency}: ${a.count}${Object.keys(a.provinces).length > 1 ? ` (${Object.entries(a.provinces).sort((x, z) => z[1] - x[1]).map(([c, n]) => `${c} ${n}`).join(", ")})` : ""}`, { size: 9.5, indent: 8 });
  }
  if (R.overall.where.length) para(`Where they'd like a future event: ${R.overall.where.map((w) => `${w.name} ${w.count}`).join(", ")}.`, { size: 9.5 });
  if (R.overall.topics.length) { para("Topics they'd like next time", { bold: true, color: NAVY }); for (const [t, n] of tally(R.overall.topics)) para(`•  ${t}${n > 1 ? ` (${n})` : ""}`, { size: 9.5, indent: 8 }); }

  if (R.comments.length) {
    heading("Comments");
    let last = null;
    for (const c of R.comments) {
      if (c.about !== last) { para(c.about, { bold: true, color: NAVY, size: 9.5 }); last = c.about; }
      para(`“${c.text}”`, { size: 9.5, indent: 8 });
    }
  }

  // Page numbers.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(`ONGIA · ${String(event.title).split(/\s*:\s*/)[0]} · survey results · ${i + 1} of ${range.count}`, M, H - 28, { width: BODY, align: "center", lineBreak: false });
  }
  doc.end();
  return done;
}

const starOf = (v) => (v === "na" ? "N/A" : typeof v === "number" ? v : "");

/** Every answer, one row per part someone sent: no names, as kept. */
export function surveyResponsesXlsx(event, responses) {
  const sessions = event.survey?.sessions ?? [];
  const stars = SESSION.filter((q) => q.kind === "stars");
  const group = (event.wixMore ?? [])[0] ? (event.wixMore[0].group || "Second group") : "";
  const main = /national gang summit/i.test(event.title ?? "") ? "Justice partners" : "Everyone else";
  const columns = [
    { head: "Sent", width: 17 }, { head: "Part", width: 12 }, { head: "Language", width: 9 },
    // With a second group (the Summit's community partners), a column saying whose answer it is, so they filter apart.
    ...(group ? [{ head: "Who", width: 18 }] : []),
    ...ABOUT.map((q) => ({ head: group && q.id === "agency" ? "Agency or organization" : q.en.replace(/\?$/, ""), width: q.id === "agency" ? 30 : 14 })),
    ...sessions.flatMap((s) => [...stars.map((q) => ({ head: `${s.title || s.presenters.join(", ")}\n${q.en}`, width: 14 })),
      { head: `${s.title || s.presenters.join(", ")}\nRecommend presenter`, width: 13 }, { head: `${s.title || s.presenters.join(", ")}\nComment`, width: 34 }]),
    ...OVERALL.map((q) => ({ head: q.en.replace(/\?$/, ""), width: q.kind === "text" ? 34 : 14 })),
  ];
  const label = (q, v) => (v === undefined || v === null ? "" : q.kind === "stars" ? starOf(v) : q.kind === "choice" ? q.options.en[v] ?? "" : q.kind === "province" ? PROVINCES[v] ?? v : v);
  const rows = responses.map((r) => [
    r.at ? r.at.slice(0, 16).replace("T", " ") : "", r.part === "end" ? "After the event" : r.via === "qr" ? `${r.part} (QR code)` : r.part, r.lang === "fr" ? "French" : "English",
    ...(group ? [r.via === "qr" ? "QR code" : r.partner ? group : main] : []),
    ...ABOUT.map((q) => label(q, r.about?.[q.id])),
    ...sessions.flatMap((s) => { const g = r.sessions?.[s.id]; if (!g) return [...stars.map(() => ""), "", ""]; if (g.skipped) return [...stars.map(() => "Not there"), "", ""];
      return [...stars.map((q) => starOf(g[q.id])), label(SESSION.find((q) => q.id === "rebook"), g.rebook), g.comment ?? ""]; }),
    ...OVERALL.map((q) => label(q, r.overall?.[q.id])),
  ]);
  return xlsx({ title: `${event.title}: survey answers`, subtitle: `${responses.length} answers · stars out of 5 (${STARS.en.join(", ")}) · anonymous`, columns, rows, landscape: true, sheet: "Answers" });
}

/** The people who said they'd like to present: kept apart from the answers. */
export function surveyContactsXlsx(event, contacts) {
  return xlsx({ title: `${event.title}: interested in presenting`, subtitle: `${contacts.length} ${contacts.length === 1 ? "person" : "people"} · from the survey, kept apart from the answers`,
    columns: [{ head: "Name", width: 26 }, { head: "Email", width: 32 }, { head: "What they'd present on", width: 50 }, { head: "When", width: 17 }],
    rows: contacts.map((c) => [c.name, c.email, c.topic, (c.at ?? "").slice(0, 16).replace("T", " ")]), sheet: "Presenters" });
}

/**
 * A QR code for each day of the survey, one page each, to put on screen or print (Andrew 8 Nov 2026: "a QR code for each
 * day that will take attendees to questions for that one day only"). `days` is [{ day, n, url, png }].
 */
export async function surveyQrPdf(event, days) {
  const logo = await readFile(path.join(ASSETS, "ongia-logo-tagline.png")).catch(() => null);
  const doc = new PDFDocument({ size: "LETTER", margin: 0, autoFirstPage: false, info: { Title: `${String(event.title).split(/\s*:\s*/)[0]} · survey QR codes`, Author: "ONGIA" } });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  const long = (iso, lang) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(lang === "fr" ? "fr-CA" : "en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  for (const d of days) {
    doc.addPage();
    let y = 54;
    if (logo) { doc.image(logo, (W - 200) / 2, y, { width: 200 }); y += 78; }
    doc.font("Helvetica").fontSize(13).fillColor(MUTED).text(String(event.title).split(/\s*:\s*/)[0], M, y, { width: BODY, align: "center" }); y = doc.y + 18;
    doc.font("Helvetica-Bold").fontSize(34).fillColor(NAVY).text(`Day ${d.n} · Jour ${d.n}`, M, y, { width: BODY, align: "center" }); y = doc.y + 4;
    const en = long(d.day, "en"), fr = long(d.day, "fr");
    doc.font("Helvetica").fontSize(16).fillColor(INK).text(`${en[0].toUpperCase()}${en.slice(1)}  ·  ${fr[0].toUpperCase()}${fr.slice(1)}`, M, y, { width: BODY, align: "center" }); y = doc.y + 22;
    const size = 300;
    doc.image(d.png, (W - size) / 2, y, { width: size }); y += size + 22;
    doc.font("Helvetica-Bold").fontSize(20).fillColor(NAVY).text("Scan to rate today's sessions", M, y, { width: BODY, align: "center" }); y = doc.y + 4;
    doc.font("Helvetica").fontSize(16).fillColor(NAVY).text("Balayez pour évaluer les séances d'aujourd'hui", M, y, { width: BODY, align: "center" }); y = doc.y + 10;
    doc.font("Helvetica").fontSize(11).fillColor(MUTED).text("Two minutes. Anonymous.  ·  Deux minutes. Anonyme.", M, y, { width: BODY, align: "center" }); y = doc.y + 18;
    doc.moveTo(W / 2 - 60, y).lineTo(W / 2 + 60, y).lineWidth(1.5).strokeColor(GOLD).stroke(); y += 12;
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(d.url, M, y, { width: BODY, align: "center" });
  }
  doc.end();
  return done;
}

/**
 * Feedback on each presenter, one page each (Andrew 9 Nov 2026: "I think it's important for me to look at the presenters
 * individually"): every star question with its average, how the stars fell, would they recommend them, and every
 * comment on the session, word for word. `only` is a session id for one presenter's page; otherwise every session.
 */
export async function surveyPresentersPdf(event, R, analysis = null, { only = "" } = {}) {
  const logo = await readFile(path.join(ASSETS, "ongia-logo-tagline-dark.png")).catch(() => null);
  // Every session rated so far (a day still to come has nothing to show), or the one asked for.
  const list = R.sessions.filter((s) => (only ? s.id === only : s.n > 0)).sort((a, b) => String(a.day).localeCompare(String(b.day)));
  const days = [...new Set(R.sessions.map((s) => s.day).filter(Boolean))].sort();
  const short = String(event.title).split(/\s*:\s*/)[0];
  const doc = new PDFDocument({ size: "LETTER", margin: 0, bufferPages: true, autoFirstPage: false, displayTitle: true,
    info: { Title: `Presenter feedback · ${short}${list.length === 1 ? ` · ${list[0].presenters.join(", ")}` : ""}`, Author: "ONGIA" } });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  let y = 0;
  const band = () => {
    doc.addPage();
    doc.rect(0, 0, W, 70).fill(DEEP); doc.rect(0, 70, W, 3).fill(GOLD);
    if (logo) doc.image(logo, M, 16, { height: 30 });
    doc.font("Helvetica").fontSize(9.5).fillColor("#e2bf5c").text(`Presenter feedback · ${short}`, M + 150, 20, { width: BODY - 150, align: "right", lineBreak: false });
    doc.text(dates(event), M + 150, 34, { width: BODY - 150, align: "right", lineBreak: false });
    y = 92;
  };
  const room = (h) => { if (y + h > H - M) band(); };
  const para = (t, { size = 10, color = INK, bold = false, indent = 0 } = {}) => { doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(color);
    room(doc.heightOfString(t, { width: BODY - indent }) + 4); doc.text(t, M + indent, y, { width: BODY - indent }); y = doc.y + 4; };
  const heading = (t) => { room(40); y += 8; doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY).text(t.toUpperCase(), M, y, { characterSpacing: 0.6 }); y = doc.y + 3;
    doc.moveTo(M, y).lineTo(M + BODY, y).lineWidth(1).strokeColor(GOLD).stroke(); y += 8; };
  const QS = SESSION.filter((q) => q.kind === "stars");
  if (!list.length) { band(); para("No session has been rated yet.", { color: MUTED }); }
  for (const s of list) {
    band();
    const n = days.indexOf(s.day) + 1;
    doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text(`${n ? `DAY ${n} · ` : ""}${s.day ? formatDate(s.day).toUpperCase() : "NO DAY SET"}`, M, y, { characterSpacing: 0.5 }); y = doc.y + 4;
    doc.font("Helvetica-Bold").fontSize(18).fillColor(NAVY).text(s.title || "Untitled session", M, y, { width: BODY }); y = doc.y + 2;
    doc.font("Helvetica-Bold").fontSize(11.5).fillColor("#9a7a1f").text(s.presenters.join(", "), M, y, { width: BODY }); y = doc.y + 2;
    const about = (event.survey?.sessions ?? []).find((x) => x.id === s.id)?.about;
    if (about) { doc.font("Helvetica-Oblique").fontSize(10).fillColor(MUTED).text(about, M, y, { width: BODY }); y = doc.y + 2; }
    y += 10;
    if (!s.n) { para(s.skipped ? `No ratings yet. ${s.skipped} said they weren't there.` : "No ratings yet.", { color: MUTED }); continue; }
    // The headline tiles.
    const tiles = [
      ["Overall", out5(s.avg), `average of the ${QS.length} questions`],
      ["Rated 4 or 5", `${s.top2}%`, "of all their star ratings"],
      ["Would recommend", `${s.rebook.yesPct}%`, `${s.rebook.yes} yes · ${s.rebook.maybe} maybe · ${s.rebook.no} no`],
      ["Rated by", String(s.n), `${s.n === 1 ? "person" : "people"}${s.skipped ? ` · ${s.skipped} weren't there` : ""}`],
    ];
    const tw = (BODY - 30) / 4;
    tiles.forEach(([a, b, c], i) => {
      const x = M + i * (tw + 10);
      doc.roundedRect(x, y, tw, 70, 8).fill(PALE);
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(a.toUpperCase(), x + 10, y + 9, { width: tw - 20, characterSpacing: 0.4 });
      doc.font("Helvetica-Bold").fontSize(20).fillColor(NAVY).text(b, x + 10, y + 22, { width: tw - 20 });
      doc.font("Helvetica").fontSize(8).fillColor(INK).text(c, x + 10, y + 50, { width: tw - 20 });
    });
    y += 84;
    heading("Each question");
    const labelW = 220, bw = BODY - labelW - 150;
    for (const q of QS) {
      const st = s.byQ[q.id] ?? { n: 0, avg: null, top2: 0, dist: [0, 0, 0, 0, 0], na: 0 };
      room(34);
      doc.font("Helvetica").fontSize(9.5).fillColor(INK).text(q.en, M, y + 1, { width: labelW - 8 });
      doc.roundedRect(M + labelW, y + 2, bw, 10, 3).fill(LINE);
      if (st.avg) doc.roundedRect(M + labelW, y + 2, Math.max(4, (bw * st.avg) / 5), 10, 3).fill(st.avg < 3.5 ? RED : NAVY);
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor(NAVY).text(`${out5(st.avg)}  ·  ${st.top2}% 4–5`, M + labelW + bw + 8, y + 1, { width: 142 });
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(`${[5, 4, 3, 2, 1].map((k) => `${STARS.en[k - 1]} ${st.dist[k - 1]}`).join("  ·  ")}${st.na ? `  ·  N/A ${st.na}` : ""}`, M + labelW, y + 15, { width: bw + 150 });
      y += 30;
    }
    const note = (analysis?.presenters ?? []).find((p) => s.title && String(p.session).toLowerCase().includes(String(s.title).toLowerCase().slice(0, 24)));
    if (note) { heading("Claude's note"); para(note.note); }
    heading(`Comments (${s.comments.length})`);
    if (!s.comments.length) para("No comments on this session.", { color: MUTED });
    for (const c of s.comments) para(`“${c}”`, { size: 10, indent: 4 });
  }
  // Page numbers and the note on where the answers come from.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(`Anonymous answers, by email link and QR code. Out of 5. N/A and those who weren't there left out.  ·  Page ${i - range.start + 1} of ${range.count}`, M, H - 30, { width: BODY, align: "center", lineBreak: false });
  }
  doc.end();
  return done;
}
