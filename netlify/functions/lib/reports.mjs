import Anthropic from "@anthropic-ai/sdk";
import PDFDocument from "pdfkit";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { anthropicKey } from "./contract.mjs";
import { getMeta, putMeta, getAttendees, getSurveyResponses, listEvents } from "./store.mjs";
import { OVERALL } from "./survey.mjs";
import { surveyResults } from "./surveyresults.mjs";
import { directory } from "./agencies.mjs";
import { formatLong } from "./deadlines.mjs";

/**
 * The survey's reports for RBH events (Andrew 30 Oct 2026): an Executive Summary of several pages and a one-page
 * infographic, each in English and in French ("there should always be an English and a French version … the bosses …
 * are bilingual, but primarily French"), laid out like the Montréal ones he sent.
 *
 * Made the night half of the people sent the survey have answered, or when Andrew asks. Each night after that, while
 * more answers come in, they are made again with every answer, until he marks them final or the survey closes. He
 * changes them by asking Claude in plain words; each request is kept and applied again on every rebuild ("will the new
 * template or outline update nightly"), and a request can be kept for every RBH report from then on.
 *
 * The figures and the attendees' own words always come from the survey: Claude writes around them and may choose,
 * order or leave them out, but a quote is kept only if it is word for word one of the comments.
 */

export const KINDS = {
  exec: { en: "Executive Summary", fr: "Sommaire exécutif" },
  info: { en: "Infographic", fr: "Infographie" },
};
export const SURVEY_FOLDER = "Survey";
export const fileNameOf = (kind, lang) => `${KINDS[kind][lang]}.pdf`;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSET_DIRS = [path.resolve(HERE, "../../../public/assets"), path.resolve(HERE, "../../public/assets"), path.resolve(process.cwd(), "public/assets"), "/var/task/public/assets"];
const ASSETS = ASSET_DIRS.find((d) => existsSync(path.join(d, "fonts", "Lato-Bold.woff"))) ?? ASSET_DIRS[0];
// ONGIA's logo with its tagline, navy leaf and gold letters, for white pages (Andrew 30 Oct 2026: "This logo needs to be on
// all infographics and executive summaries in place of the ONGIA in the top left corner").
const LOGO = path.join(ASSETS, "ongia-logo-tagline.png");

/* ---------- What the survey says, in figures ---------- */

const pctOf = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const top1 = (s) => (s?.n ? pctOf(s.dist?.[4] ?? 0, s.n) : null);

/** Everything a report states as a figure, worked out here and never by Claude. */
export function reportFacts(event, R, { invited = 0, responses = [] } = {}) {
  const fr = (id) => OVERALL.find((x) => x.id === id);
  const scoring = OVERALL.filter((x) => x.kind === "stars").map((x) => ({ id: x.id, en: x.en, fr: x.fr, ...R.overall[x.id] }))
    .filter((x) => x.n).map((x) => ({ id: x.id, en: x.en, fr: x.fr, n: x.n, mean: x.avg, top2: x.top2, top1: top1(x) }));
  const sessions = R.sessions.filter((s) => s.n).map((s) => {
    const dist = [0, 0, 0, 0, 0];
    for (const q of Object.values(s.byQ ?? {})) (q.dist ?? []).forEach((v, i) => { dist[i] += v; });
    const n = dist.reduce((a, b) => a + b, 0);
    return { id: s.id, title: s.title, titleFr: s.titleFr || s.title, presenters: s.presenters ?? "", n: s.n, mean: s.avg, top2: s.top2, top1: pctOf(dist[4], n), rebook: s.rebook?.yesPct ?? null };
  }).sort((a, b) => (b.top1 ?? 0) - (a.top1 ?? 0) || (b.mean ?? 0) - (a.mean ?? 0));
  const at = responses.map((r) => r.at).filter(Boolean).sort();
  const answered = R.respondents || R.responses;
  const tile = (key, pct, en, fr, subEn, subFr) => (pct === null || pct === undefined ? null : { key, pct, en, fr, subEn, subFr });
  const ov = R.overall ?? {};
  const kpis = [
    tile("quality", ov.quality?.n ? ov.quality.top2 : R.headline?.top2, "Overall quality", "Qualité globale", "rated 4 or 5", "note de 4 ou 5"),
    tile("practical", ov.practical?.n ? ov.practical.top2 : null, "Practical value", "Valeur pratique", "rated 4 or 5", "note de 4 ou 5"),
    tile("confidence", ov.confidence?.n ? ov.confidence.top2 : null, "Confidence", "Confiance", "able to apply it", "pour l'appliquer"),
    tile("again", R.again?.n ? R.again.pcts?.[0] : null, "Would return", "Reviendraient", "considering it", "l'envisagent"),
    tile("sessions", R.sessionStars?.n ? R.sessionStars.top2 : null, "Sessions", "Séances", "rated 4 or 5", "note de 4 ou 5"),
  ].filter(Boolean).slice(0, 5);
  return {
    event: { title: event.title, city: event.city ?? "", venue: event.venue ?? "", dayOne: event.dayOne ?? "", lastDay: event.lastDay || event.dayOne || "" },
    answered, invited, rate: pctOf(answered, invited), first: at[0]?.slice(0, 10) ?? "", last: at.at(-1)?.slice(0, 10) ?? "",
    languages: R.languages, nps: ov.nps?.n ? ov.nps : null,
    pace: ov.pace?.n ? { aboutRight: ov.pace.aboutRightPct } : null, length: ov.length?.n ? { aboutRight: ov.length.aboutRightPct } : null,
    again: R.again?.n ? R.again.pcts?.[0] : null, before: R.before?.n ? R.before.pcts?.[0] : null,
    kpis, scoring, sessions,
    agencies: (R.agencies ?? []).slice(0, 12).map((a) => ({ agency: a.agency, count: a.count })),
    provinces: (R.provinces ?? []).map((p) => ({ name: p.name, count: p.count })),
    comments: (R.comments ?? []).map((c, i) => ({ id: i + 1, text: c.text, about: c.about })).slice(0, 300),
    topics: (R.overall?.topics ?? []).slice(0, 120),
  };
}

/** How many people the survey went to: everyone on the list it was sent to, once each. */
export function invitedOf(people = []) {
  return new Set(people.filter((p) => (p.sent ?? []).some((k) => String(k).startsWith("survey:"))).map((p) => p.email || p.key)).size;
}

/* ---------- What Claude writes ---------- */

const S = (desc) => ({ type: "string", description: desc });
const LIST = (desc) => ({ type: "array", items: { type: "string" }, description: desc });
const QUOTES = { type: "array", items: { type: "object", additionalProperties: false, required: ["commentId", "about"], properties: { commentId: { type: "integer" }, about: { type: "string" } } } };
const SCHEMAS = {
  exec: {
    type: "object", additionalProperties: false,
    required: ["glance", "context", "notes", "strengths", "quotes", "areas", "topicsIntro", "topics", "recommendations", "extra", "reply"],
    properties: {
      glance: LIST("Two short paragraphs: what the training was, then how it was received, with the headline figures given."),
      context: LIST("Two to four short bullets on who answered and when, from the figures given."),
      notes: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "note"], properties: { id: { type: "string" }, note: S("At most five words") } } },
      strengths: LIST("Three to five bullets, each a bolded-lead sentence then why, resting on a figure or the comments."),
      quotes: QUOTES,
      areas: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "text"], properties: { title: { type: "string" }, text: { type: "string" } } } },
      topicsIntro: S("One sentence on what attendees asked for next."),
      topics: LIST("Up to six topics attendees asked for, as short phrases."),
      recommendations: LIST("Four to seven recommendations, each a lead phrase then one sentence."),
      extra: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "paragraphs"], properties: { title: { type: "string" }, paragraphs: { type: "array", items: { type: "string" } } } }, description: "Sections ONGIA asked for that the layout doesn't have; usually empty." },
      reply: S("One or two sentences to ONGIA's president on what you changed this time, or empty when nothing was asked."),
    },
  },
  info: {
    type: "object", additionalProperties: false, required: ["tagline", "lockIn", "buildNext", "quote", "wantNext", "reply"],
    properties: {
      tagline: S("Five to eight words that sum up the result, e.g. 'A unanimous result. A clear path forward.'"),
      lockIn: { type: "array", items: { type: "object", additionalProperties: false, required: ["head", "text"], properties: { head: { type: "string" }, text: { type: "string" } } }, description: "Up to four things to keep, each a short bold head and one short sentence." },
      buildNext: { type: "array", items: { type: "object", additionalProperties: false, required: ["head", "text"], properties: { head: { type: "string" }, text: { type: "string" } } }, description: "Up to four things to add or fix next, the same way." },
      quote: { type: "object", additionalProperties: false, required: ["commentId", "about"], properties: { commentId: { type: "integer" }, about: { type: "string" } } },
      wantNext: LIST("Up to five topics attendees want next, two to four words each."),
      reply: S("One or two sentences on what you changed this time, or empty."),
    },
  },
};

const LANG = { en: "English", fr: "Canadian French (as written for senior managers in Québec: natural, formal, not translated word for word)" };
const SYSTEM = (kind, lang) => `You write the ${kind === "exec" ? "executive summary" : "one-page infographic"} of a post-training survey for ONGIA, a Canadian non-profit that trains law enforcement, corrections, border and justice staff on organized crime and illicit trade, in partnership with Rothmans, Benson & Hedges (RBH). Its readers are RBH's managers and ONGIA's leadership.

Write in ${LANG[lang]}. Plain, confident, specific. No hype, no filler.

The figures you are given are the only figures that exist. Use them exactly; never compute, round differently or invent one. If the answers are too few to say something, say so. Never name or identify an attendee. For quotes, give only the id of a comment; the desk prints its exact words in the language it was written in.

Earlier RBH trainings' findings, when given, let you note a pattern ("this matches the gap seen at …"); never invent one.

ONGIA's standing requests for every RBH ${kind === "exec" ? "executive summary" : "infographic"}, and its requests for this one, come last. Follow every one of them. They may add sections, change wording or emphasis, or leave things out; they can't change a figure or a quote's words.`;

/** One language of one report, from Claude. `client` is for tests. */
export async function writeReport(kind, lang, facts, { standing = [], requests = [], earlier = [], previous = null, ask = "" } = {}, { client = null } = {}) {
  if (!client && !anthropicKey()) throw new Error("The desk has no Anthropic API key, so Claude cannot write the report.");
  const api = client ?? new Anthropic({ apiKey: anthropicKey() });
  const brief = { figures: { ...facts, comments: undefined, topics: undefined }, comments: facts.comments, topicsAskedFor: facts.topics, earlierRbhFindings: earlier };
  const asks = [...standing.map((t) => `(every RBH report) ${t}`), ...requests.map((t) => `(this report) ${t}`)];
  const message = await api.messages.create({
    model: "claude-opus-5-5", max_tokens: 16000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMAS[kind] } },
    system: SYSTEM(kind, lang),
    messages: [{ role: "user", content: `${JSON.stringify(brief)}${previous ? `\n\nThe current version, to keep unless the requests or new answers change it:\n${JSON.stringify(previous)}` : ""}${asks.length ? `\n\nONGIA's requests:\n${asks.map((a) => `- ${a}`).join("\n")}` : ""}${ask ? `\n\nJust now ONGIA asked: ${ask}\nSay in reply what you changed.` : ""}` }],
  });
  if (message.stop_reason === "refusal") throw new Error("Claude would not write this report.");
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let out;
  try { out = JSON.parse(text); } catch { throw new Error("Claude's report could not be read. Try again."); }
  return keepHonest(kind, out, facts);
}

/** Quotes only from the comments, word for word; notes only for questions asked. */
function keepHonest(kind, out, facts) {
  const byId = new Map(facts.comments.map((c) => [c.id, c]));
  const quote = (q) => (byId.has(q?.commentId) ? { text: byId.get(q.commentId).text, about: q.about || byId.get(q.commentId).about } : null);
  if (kind === "exec") {
    const ids = new Set(facts.scoring.map((s) => s.id));
    return { ...out, quotes: (out.quotes ?? []).map(quote).filter(Boolean).slice(0, 8), notes: (out.notes ?? []).filter((n) => ids.has(n.id)) };
  }
  return { ...out, quote: quote(out.quote), lockIn: (out.lockIn ?? []).slice(0, 4), buildNext: (out.buildNext ?? []).slice(0, 4), wantNext: (out.wantNext ?? []).slice(0, 5) };
}

/* ---------- The PDFs ---------- */

const NAVY = "#1a2f5e", GOLD = "#b8922a", INK = "#1e2533", MUTED = "#5b6475", LINE = "#d9d4c6", PALE = "#eef1f6";
const L = {
  en: { prepared: "Prepared for", for: "Rothmans, Benson & Hedges (RBH) and ONGIA Leadership", by: "Prepared by", byWho: "ONGIA | Andrew Hammond, President", date: "Date", glance: "At a Glance",
    context: "Response Context", scoring: "Detailed Scoring", metric: "Metric", mean: "Mean / 5", top2: "Top-2 Box", top1: "Top-1 Box", note: "Note", ranking: "Session Component Ranking",
    rankIntro: "Sessions are ranked by Top-1 Box, the share of attendees who gave the maximum rating. Top-2 Box is included for context.", component: "Session", strengths: "Key Strengths",
    verbatim: "Verbatim Highlights", areas: "Areas to Watch", topics: "Requested Future Topics", recs: "Recommendations", page: "Page", of: "of",
    top2Def: "Top-2 Box is the share who rated the item 4 or 5 out of 5.", answered: (a, i) => (i ? `${a} of ${i} surveys returned` : `${a} surveys returned`), snapshot: "EXECUTIVE SNAPSHOT", results: "POST-TRAINING RESULTS",
    rankHead: "SESSION RANKING BY TOP RATING", rankSub: "Share of attendees giving each session the maximum rating (Top-1 Box).", lock: "LOCK IN", build: "BUILD NEXT", want: "ATTENDEES WANT NEXT", wantSub: "FROM OPEN-ENDED FEEDBACK",
    nps: "Net Promoter Score", prepShort: (d) => `Prepared by ONGIA · ${d}`, title: "Executive Summary" },
  fr: { prepared: "Préparé pour", for: "Rothmans, Benson & Hedges (RBH) et la direction de l'ONGIA", by: "Préparé par", byWho: "ONGIA | Andrew Hammond, président", date: "Date", glance: "En un coup d'œil",
    context: "Contexte des réponses", scoring: "Résultats détaillés", metric: "Indicateur", mean: "Moyenne / 5", top2: "Top-2", top1: "Top-1", note: "Remarque", ranking: "Classement des séances",
    rankIntro: "Les séances sont classées selon le Top-1, la part des participants ayant donné la note maximale. Le Top-2 est indiqué à titre de contexte.", component: "Séance", strengths: "Points forts",
    verbatim: "Commentaires des participants", areas: "Points à surveiller", topics: "Sujets demandés pour l'avenir", recs: "Recommandations", page: "Page", of: "de",
    top2Def: "Le Top-2 est la part des répondants ayant donné une note de 4 ou 5 sur 5.", answered: (a, i) => (i ? `${a} sondages reçus sur ${i}` : `${a} sondages reçus`), snapshot: "APERÇU EXÉCUTIF", results: "RÉSULTATS APRÈS LA FORMATION",
    rankHead: "CLASSEMENT DES SÉANCES SELON LA NOTE MAXIMALE", rankSub: "Part des participants ayant donné la note maximale à chaque séance (Top-1).", lock: "À CONSERVER", build: "À DÉVELOPPER", want: "LES PARTICIPANTS SOUHAITENT", wantSub: "SELON LES COMMENTAIRES",
    nps: "Indice de recommandation (NPS)", prepShort: (d) => `Préparé par l'ONGIA · ${d}`, title: "Sommaire exécutif" },
};
/** The look the year-end reports share with these. */
export const PDF_LOOK = { NAVY, GOLD, INK, MUTED, LINE, PALE, LOGO };
const longDate = (iso, lang) => formatLong(iso, lang, { weekday: false }) || iso;
const whenText = (f, lang) => (f.event.dayOne && f.event.lastDay && f.event.dayOne !== f.event.lastDay ? `${longDate(f.event.dayOne, lang)} – ${longDate(f.event.lastDay, lang)}` : longDate(f.event.dayOne, lang));

export function newDoc(title) {
  const doc = new PDFDocument({ size: "LETTER", margins: { top: 64, bottom: 60, left: 54, right: 54 }, bufferPages: true, info: { Title: title, Author: "ONGIA" } });
  doc.registerFont("r", path.join(ASSETS, "fonts", "Lato-Regular.woff"));
  doc.registerFont("b", path.join(ASSETS, "fonts", "Lato-Bold.woff"));
  doc.registerFont("i", path.join(ASSETS, "fonts", "Lato-Italic.woff"));
  const chunks = []; doc.on("data", (c) => chunks.push(c));
  const done = new Promise((r) => doc.on("end", () => r(Buffer.concat(chunks))));
  return { doc, done };
}

/** The Executive Summary, laid out like the Montréal one. */
export async function execPdf(content, facts, lang, { date }) {
  const T = L[lang];
  const title = `${facts.event.title} — ${T.title}`;
  const { doc, done } = newDoc(title);
  const W = doc.page.width - 108, X = 54;
  const header = () => {
    doc.image(LOGO, X, 20, { height: 26 });
    doc.font("r").fontSize(8).fillColor(MUTED).text("Organization for National Gang Information & Awareness", X, 34, { width: W, align: "right" });
    doc.moveTo(X, 52).lineTo(X + W, 52).lineWidth(1).strokeColor(GOLD).stroke();
    doc.x = X; doc.y = 66;
  };
  doc.on("pageAdded", header); header();
  const room = (h) => { if (doc.y + h > doc.page.height - 70) doc.addPage(); };
  // A heading never sits alone at the foot of a page: it needs room for what follows it.
  const h2 = (t, need = 90) => { room(need); doc.moveDown(0.6); doc.font("b").fontSize(14).fillColor(NAVY).text(t, X); const y = doc.y + 2; doc.moveTo(X, y).lineTo(X + W, y).lineWidth(0.8).strokeColor(GOLD).stroke(); doc.y = y + 8; };
  const para = (t) => { room(30); doc.font("r").fontSize(10.5).fillColor(INK).text(t, X, doc.y, { width: W, lineGap: 2.5 }); doc.moveDown(0.5); };
  const bullets = (items) => { for (const t of items) { room(26); const y = doc.y; doc.font("r").fontSize(10.5).fillColor(INK).text("•", X + 6, y).text(t, X + 20, y, { width: W - 20, lineGap: 2.5 }); doc.moveDown(0.35); } };
  // Title block.
  doc.font("b").fontSize(24).fillColor(NAVY).text(T.title, X, doc.y);
  doc.font("r").fontSize(13).fillColor(NAVY).text(facts.event.title);
  doc.font("i").fontSize(10.5).fillColor(MUTED).text(`${[facts.event.city, whenText(facts, lang)].filter(Boolean).join(", ")}`);
  doc.moveDown(0.3);
  doc.font("b").fontSize(9).fillColor(INK).text(`${T.prepared}: `, { continued: true }).font("r").text(`${T.for}   |   `, { continued: true }).font("b").text(`${T.by}: `, { continued: true }).font("r").text(`${T.byWho}   |   `, { continued: true }).font("b").text(`${T.date}: `, { continued: true }).font("r").text(longDate(date, lang));
  h2(T.glance);
  for (const p of content.glance ?? []) para(p);
  // The headline tiles.
  if (facts.kpis.length) {
    room(70);
    const n = facts.kpis.length, tw = W / n, y = doc.y + 4;
    doc.rect(X, y, W, 56).fillAndStroke(PALE, LINE);
    facts.kpis.forEach((k, i) => {
      const x = X + i * tw;
      if (i) doc.moveTo(x, y).lineTo(x, y + 56).strokeColor(LINE).stroke();
      doc.font("b").fontSize(19).fillColor(NAVY).text(`${k.pct}%`, x, y + 8, { width: tw, align: "center" });
      doc.font("b").fontSize(8.5).fillColor(NAVY).text(lang === "fr" ? k.fr : k.en, x, y + 32, { width: tw, align: "center" });
      doc.font("r").fontSize(7.5).fillColor(MUTED).text(lang === "fr" ? k.subFr : k.subEn, x, y + 43, { width: tw, align: "center" });
    });
    doc.y = y + 68; doc.x = X;
  }
  h2(T.context);
  bullets([T.answered(facts.answered, facts.invited) + (facts.invited ? ` (${facts.rate}%).` : "."), ...(content.context ?? [])]);
  // Scoring table: the figures from the survey, the note from Claude.
  const table = (cols, rows) => {
    const x0 = X, widths = cols.map((c) => c.w * W);
    const rowH = (r) => Math.max(...r.map((cell, i) => doc.font(i ? "r" : "b").fontSize(9).heightOfString(String(cell ?? ""), { width: widths[i] - 10 }))) + 10;
    const head = () => { room(26); const y = doc.y; doc.rect(x0, y, W, 20).fill(NAVY); let x = x0; cols.forEach((c, i) => { doc.font("b").fontSize(8.5).fillColor("#fff").text(c.label, x + 5, y + 6, { width: widths[i] - 10, align: c.align ?? "left" }); x += widths[i]; }); doc.y = y + 20; };
    head();
    rows.forEach((r, ri) => {
      const h = rowH(r);
      if (doc.y + h > doc.page.height - 70) { doc.addPage(); head(); }
      const y = doc.y; if (ri % 2) doc.rect(x0, y, W, h).fill("#f6f4ee");
      let x = x0;
      r.forEach((cell, i) => { doc.font(i ? "r" : "b").fontSize(9).fillColor(INK).text(String(cell ?? ""), x + 5, y + 5, { width: widths[i] - 10, align: cols[i].align ?? "left" }); x += widths[i]; });
      doc.moveTo(x0, y + h).lineTo(x0 + W, y + h).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.y = y + h;
    });
    doc.x = X; doc.moveDown(0.6);
  };
  if (facts.scoring.length) {
    h2(T.scoring, 130);
    const note = new Map((content.notes ?? []).map((n) => [n.id, n.note]));
    table([{ label: T.metric, w: 0.46 }, { label: T.mean, w: 0.13, align: "center" }, { label: T.top2, w: 0.13, align: "center" }, { label: T.note, w: 0.28 }],
      facts.scoring.map((s) => [lang === "fr" ? s.fr : s.en, s.mean?.toFixed?.(2) ?? "", `${s.top2}%`, note.get(s.id) ?? ""]));
    if (facts.nps) para(`${T.nps}: ${facts.nps.score > 0 ? "+" : ""}${facts.nps.score} (${facts.nps.n}).`);
    doc.font("i").fontSize(9).fillColor(MUTED).text(T.top2Def, X, doc.y, { width: W }); doc.moveDown(0.4);
  }
  if (facts.sessions.length) {
    h2(T.ranking, 150);
    para(T.rankIntro);
    table([{ label: "#", w: 0.06, align: "center" }, { label: T.component, w: 0.62 }, { label: T.top1, w: 0.16, align: "center" }, { label: T.top2, w: 0.16, align: "center" }],
      facts.sessions.map((s, i) => [String(i + 1), lang === "fr" ? s.titleFr : s.title, `${s.top1}%`, `${s.top2}%`]));
  }
  if (content.strengths?.length) { h2(T.strengths); bullets(content.strengths); }
  if (content.quotes?.length) {
    h2(T.verbatim);
    for (const q of content.quotes) { room(40); doc.font("i").fontSize(10.5).fillColor(INK).text(`“${q.text}”`, X + 14, doc.y, { width: W - 28, lineGap: 2 }); doc.font("r").fontSize(8.5).fillColor(MUTED).text(`— ${q.about}`, X + 14, doc.y, { width: W - 28 }); doc.moveDown(0.5); }
  }
  if (content.areas?.length) { h2(T.areas); for (const a of content.areas) { room(40); doc.font("b").fontSize(11).fillColor(NAVY).text(a.title, X, doc.y, { width: W }); para(a.text); } }
  if (content.topics?.length) { h2(T.topics); if (content.topicsIntro) para(content.topicsIntro); bullets(content.topics); }
  for (const e of content.extra ?? []) { h2(e.title); for (const p of e.paragraphs ?? []) para(p); }
  if (content.recommendations?.length) { h2(T.recs); bullets(content.recommendations); }
  // Footers, now the pages are known.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - 44;
    doc.moveTo(X, y - 6).lineTo(X + W, y - 6).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.font("r").fontSize(8).fillColor(MUTED).text(`${facts.event.title} — ${T.title}`, X, y, { width: W * 0.75, lineBreak: false, height: 10 });
    doc.text(`${T.page} ${i + 1} ${T.of} ${range.count}`, X + W * 0.75, y, { width: W * 0.25, align: "right", lineBreak: false, height: 10 });
  }
  doc.end();
  return done;
}

/** The one-page infographic, laid out like the Montréal "Executive Snapshot". */
export async function infoPdf(content, facts, lang, { date }) {
  const T = L[lang];
  const { doc, done } = newDoc(`${facts.event.title} — ${KINDS.info[lang]}`);
  const X = 40, W = doc.page.width - 80;
  doc.image(LOGO, X, 24, { height: 36 });
  doc.font("b").fontSize(7.5).fillColor(NAVY).text(T.snapshot, X, 34, { width: W, align: "right", characterSpacing: 0.8 });
  doc.font("r").fontSize(7.5).fillColor(MUTED).text(`${whenText(facts, lang).toUpperCase()}${facts.event.city ? ` · ${facts.event.city.toUpperCase()}` : ""}`, X, 45, { width: W, align: "right", characterSpacing: 0.6 });
  doc.moveTo(X, 72).lineTo(X + W, 72).lineWidth(0.6).strokeColor(LINE).stroke();
  doc.font("b").fontSize(8).fillColor(GOLD).text(T.results, X, 86, { characterSpacing: 1.5 });
  doc.font("b").fontSize(26).fillColor(NAVY).text(facts.event.title, X, 100, { width: W, lineGap: -2 });
  doc.font("i").fontSize(11).fillColor(MUTED).text(content.tagline ?? "", X, doc.y + 2, { width: W });
  // Tiles.
  let y = doc.y + 12;
  const n = Math.max(1, facts.kpis.length), gap = 8, tw = (W - gap * (n - 1)) / n;
  facts.kpis.forEach((k, i) => {
    const x = X + i * (tw + gap);
    doc.rect(x, y, tw, 62).fill(NAVY); doc.rect(x, y, tw, 3).fill(GOLD);
    doc.font("b").fontSize(20).fillColor("#fff").text(`${k.pct}%`, x, y + 12, { width: tw, align: "center" });
    doc.font("b").fontSize(7).fillColor(GOLD).text((lang === "fr" ? k.fr : k.en).toUpperCase(), x, y + 38, { width: tw, align: "center", characterSpacing: 0.8 });
    doc.font("r").fontSize(6.5).fillColor("#c9d1e3").text(lang === "fr" ? k.subFr : k.subEn, x, y + 48, { width: tw, align: "center" });
  });
  y += 78;
  // Ranking bars.
  doc.circle(X + 7, y + 6, 7).fill(GOLD); doc.font("b").fontSize(8).fillColor("#fff").text("1", X + 4.5, y + 2.5);
  doc.font("b").fontSize(10).fillColor(NAVY).text(T.rankHead, X + 20, y + 1, { characterSpacing: 1 });
  doc.font("i").fontSize(7.5).fillColor(MUTED).text(T.rankSub, X, y + 18);
  y += 32;
  const rows = facts.sessions.slice(0, 8), barX = X + 200, barW = W - 200 - 38;
  rows.forEach((s, i) => {
    doc.font("b").fontSize(8).fillColor(GOLD).text(String(i + 1).padStart(2, "0"), X, y + 3);
    doc.font("b").fontSize(8).fillColor(NAVY).text(lang === "fr" ? s.titleFr : s.title, X + 18, y + 3, { width: 178, height: 11, ellipsis: true, lineBreak: false });
    doc.rect(barX, y, barW, 14).fill("#e7ebf2");
    doc.rect(barX, y, Math.max(2, barW * (s.top1 || 0) / 100), 14).fill(i < 3 ? GOLD : NAVY);
    doc.font("b").fontSize(8.5).fillColor(NAVY).text(`${s.top1}%`, barX + barW + 4, y + 3, { width: 34, align: "right" });
    y += 20;
  });
  y += 8;
  // Lock in / build next.
  const col = (title, items, x, w) => {
    doc.font("b").fontSize(9).fillColor(NAVY).text(title, x, y, { characterSpacing: 1.2 });
    doc.moveTo(x, y + 14).lineTo(x + w, y + 14).lineWidth(0.8).strokeColor(GOLD).stroke();
    let yy = y + 22;
    for (const it of items) { doc.polygon([x, yy + 2], [x + 6, yy + 5.5], [x, yy + 9]).fill(GOLD); doc.font("b").fontSize(8.5).fillColor(INK).text(`${it.head} `, x + 12, yy, { width: w - 12, continued: true }).font("r").fillColor(INK).text(it.text, { lineGap: 1 }); yy = doc.y + 6; }
    return yy;
  };
  const half = (W - 24) / 2;
  const yEnd = Math.max(col(T.lock, content.lockIn ?? [], X, half), col(T.build, content.buildNext ?? [], X + half + 24, half));
  y = yEnd + 10;
  if (content.quote?.text) {
    const qh = Math.min(90, doc.font("b").fontSize(12).heightOfString(`“${content.quote.text}”`, { width: W - 40 }) + 34);
    doc.rect(X, y, W, qh).fill("#e9edf4"); doc.rect(X, y, 3, qh).fill(NAVY);
    doc.font("b").fontSize(12).fillColor(NAVY).text(`“${content.quote.text}”`, X + 18, y + 12, { width: W - 40, height: qh - 30, ellipsis: true });
    doc.font("r").fontSize(7.5).fillColor(MUTED).text(`— ${String(content.quote.about).toUpperCase()}`, X + 18, y + qh - 16, { characterSpacing: 0.8 });
    y += qh + 14;
  }
  if (content.wantNext?.length) {
    doc.font("b").fontSize(8).fillColor(NAVY).text(T.want, X, y + 4, { width: 110, characterSpacing: 1 });
    doc.font("r").fontSize(6.5).fillColor(MUTED).text(T.wantSub, X, doc.y + 1, { width: 110 });
    let cx = X + 125, cy = y;
    content.wantNext.forEach((t, i) => {
      doc.font("b").fontSize(8);
      const w = doc.widthOfString(t) + 20;
      if (cx + w > X + W) { cx = X + 125; cy += 24; }
      doc.roundedRect(cx, cy, w, 18, 9).fillAndStroke(i < 2 ? GOLD : "#fff", i < 2 ? GOLD : NAVY);
      doc.fillColor(i < 2 ? "#fff" : NAVY).text(t, cx + 10, cy + 5, { lineBreak: false });
      cx += w + 8;
    });
  }
  const fy = doc.page.height - 40;
  doc.moveTo(X, fy - 8).lineTo(X + W, fy - 8).lineWidth(0.6).strokeColor(NAVY).stroke();
  doc.font("b").fontSize(7).fillColor(NAVY).text("ONGIA · WWW.ONGIA.CA", X, fy, { characterSpacing: 1, width: W / 2, height: 10 });
  doc.font("i").fontSize(7).fillColor(MUTED).text(T.prepShort(longDate(date, lang)), X + W / 2, fy, { width: W / 2, align: "right", height: 10 });
  doc.end();
  return done;
}
export const reportPdf = (kind, content, facts, lang, opts) => (kind === "exec" ? execPdf : infoPdf)(content, facts, lang, opts);

/* ---------- Kept on the desk: versions, requests, the chat ---------- */

export const reportsOf = async (eventId) => (await getMeta(`reports:${eventId}`)) ?? {};
export const putReports = (eventId, r) => putMeta(`reports:${eventId}`, r);
export const standingOf = async (kind) => (await getMeta(`reports:standing:${kind}`)) ?? [];
export const putStanding = (kind, list) => putMeta(`reports:standing:${kind}`, list);
const blank = () => ({ versions: [], current: 0, requests: [], chat: [], final: false });

/** What the last RBH reports found, to compare with ("this aligns with the gap signal seen in the April … training"). */
async function earlierFindings(event) {
  const out = [];
  for (const e of (await listEvents()).filter((x) => x.kind === "rbh" && x.id !== event.id && (x.lastDay || x.dayOne || "") < (event.dayOne || "9")).sort((a, b) => (b.dayOne ?? "").localeCompare(a.dayOne ?? "")).slice(0, 3)) {
    const r = (await reportsOf(e.id)).exec;
    const v = r?.versions?.find((x) => x.n === r.current);
    if (v?.content?.en) out.push({ training: e.title, when: e.dayOne, areasToWatch: (v.content.en.areas ?? []).map((a) => a.title), strengths: (v.content.en.strengths ?? []).slice(0, 3) });
  }
  return out;
}

/** The survey's figures for an event as they stand now. */
export async function factsFor(event) {
  const [responses, list, stored] = await Promise.all([getSurveyResponses(event.id), directory().catch(() => []), getAttendees(event.id)]);
  const people = stored?.people ?? [];
  const R = surveyResults(event, responses, list, people);
  return reportFacts(event, R, { invited: invitedOf(people), responses });
}

/**
 * Make one report again (both languages) and keep it as a new version. `ask` is what Andrew just typed in the chat,
 * already saved among the requests; Claude says what it changed.
 */
export async function buildReport(event, kind, { reason = "asked", ask = "", lang = "both", client = null, facts = null, now = new Date() } = {}) {
  const all = await reportsOf(event.id);
  const r = { ...blank(), ...(all[kind] ?? {}) };
  const f = facts ?? (await factsFor(event));
  if (!f.answered) throw new Error("No one has answered the survey yet.");
  const standing = (await standingOf(kind)).map((s) => s.text);
  const prev = r.versions.find((v) => v.n === r.current) ?? null;
  const earlier = kind === "exec" ? await earlierFindings(event) : [];
  const forLang = (l) => r.requests.filter((q) => q.lang === "both" || q.lang === l).map((q) => q.text);
  // A change asked for one language leaves the other as it was, unless new answers came in.
  const redo = (l) => !prev || reason !== "asked-change" || lang === "both" || lang === l;
  const [en, fr] = await Promise.all(["en", "fr"].map((l) => (redo(l)
    ? writeReport(kind, l, f, { standing, requests: forLang(l), earlier, previous: prev?.content?.[l] ?? null, ask: (lang === "both" || lang === l) ? ask : "" }, { client })
    : Promise.resolve(prev.content[l]))));
  const n = Math.max(0, ...r.versions.map((v) => v.n)) + 1;
  const version = { n, at: now.toISOString(), reason, answered: f.answered, invited: f.invited, facts: f, content: { en, fr } };
  r.versions = [...r.versions, version].slice(-12);
  r.current = n;
  if (ask) r.chat = [...r.chat, { who: "claude", text: (lang === "fr" ? fr.reply : en.reply) || (lang === "fr" ? "C'est fait." : "Done."), at: now.toISOString(), version: n }].slice(-80);
  await putReports(event.id, { ...(await reportsOf(event.id)), [kind]: r });
  return version;
}

/** The PDF of a version (the current one unless another is asked for). */
export async function versionPdf(event, kind, lang, n = null) {
  const r = (await reportsOf(event.id))[kind];
  const v = r?.versions?.find((x) => x.n === (n ?? r.current));
  if (!v) return null;
  return reportPdf(kind, v.content[lang], v.facts, lang, { date: v.at.slice(0, 10) });
}

/** Half of those sent the survey have answered (Andrew 30 Oct 2026: "once 50% of the surveys return"). */
export const halfBack = (f) => f.invited > 0 && f.answered * 2 >= f.invited;

/* ---------- Filed to OneDrive, and made each night ---------- */

/** Both languages of the current version, to the event's folder under Survey, by their plain names (Andrew 30 Oct 2026). */
export async function fileReport(event, kind, { file = null } = {}) {
  const put = file ?? (await import("./graph.mjs")).fileEventDocument;
  const all = await reportsOf(event.id);
  const r = all[kind];
  const out = {};
  for (const lang of ["en", "fr"]) {
    try {
      const bytes = await versionPdf(event, kind, lang);
      const got = await put({ event, folder: SURVEY_FOLDER, name: fileNameOf(kind, lang), bytes, contentType: "application/pdf" });
      out[lang] = got.skipped ? { skipped: got.reason } : { url: got.url, folderUrl: got.folderUrl, at: new Date().toISOString(), version: r.current };
    } catch (e) { out[lang] = { error: e.message }; }
  }
  const now = await reportsOf(event.id);
  await putReports(event.id, { ...now, [kind]: { ...now[kind], filed: out } });
  return out;
}

/**
 * The nightly look at every RBH event's survey: the reports are made the night half the survey's people have answered,
 * then made again on any night more answers have come in, until each is marked final or the survey closes.
 */
export async function runReports({ client = null, file = null, events = null } = {}) {
  const out = [];
  for (const event of (events ?? (await listEvents())).filter((e) => e.kind === "rbh" && e.survey)) {
    try {
      const f = await factsFor(event);
      const all = await reportsOf(event.id);
      for (const kind of Object.keys(KINDS)) {
        const r = all[kind];
        const cur = r?.versions?.find((v) => v.n === r.current);
        if (r?.final) continue;
        if (!cur && !halfBack(f)) continue;
        if (cur && (!event.survey.open || f.answered <= cur.answered)) continue;
        await buildReport(event, kind, { reason: cur ? "more" : "half", client, facts: f });
        await fileReport(event, kind, { file });
        out.push({ event: event.id, kind, answered: f.answered, invited: f.invited, reason: cur ? "more" : "half" });
      }
    } catch (e) { out.push({ event: event.id, error: e.message }); }
  }
  return out;
}
