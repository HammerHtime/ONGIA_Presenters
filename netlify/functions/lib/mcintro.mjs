import Anthropic from "@anthropic-ai/sdk";
import PDFDocument from "pdfkit";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { anthropicKey } from "./contract.mjs";
import { text } from "./http.mjs";
import { sessionsFrom } from "./survey.mjs";
import { trainingDays } from "./agenda.mjs";
import { formatDate } from "./deadlines.mjs";

/**
 * What the MC says to bring each presenter on (Andrew 12 Nov 2026: "Once all the presenter agreements have been
 * submitted, I would like to be able to summarize bios and summarize presentation outline so this could be used for
 * the MC to introduce the presenters").
 *
 * One introduction per session, in the program's order: Claude drafts it from the bio and outline each presenter sent
 * with their agreement, Andrew reads and changes any of them on the Program tab, and the MC script is a PDF of the lot.
 * Kept on the event as mcIntros: { [sessionId]: { text, check, by: "claude" | "edited", at, from } }. `from` is a
 * fingerprint of what it was drafted from, so an intro whose presenter has since changed their bio shows as out of date.
 */

const NAME = (p) => [p.first, p.last].filter(Boolean).join(" ").trim();
/** Their agreement is in: the bio and outline they sent can be used. */
export const hasSent = (p) => !!p.submission && ["submitted", "approved"].includes(p.status);
/** Somebody on the session sent a bio, so there is something to draft from. */
export const hasBio = (s) => s.people.some((p) => hasSent(p) && p.submission.bio);

/** The sessions in the program's order (the survey's list, with its days, when there is one), each with its presenters. */
export function mcSessions(event, presenters = []) {
  const live = presenters.filter((p) => p.status !== "withdrawn");
  const byName = new Map(live.map((p) => [NAME(p).toLowerCase(), p]));
  const list = event.survey?.sessions?.length ? event.survey.sessions : sessionsFrom(live);
  const days = trainingDays(event);
  const seen = new Set();
  const out = list.map((s) => {
    const people = s.presenters.map((n) => live.find((p) => `p${p.id}`.slice(0, 40) === s.id && NAME(p) === n) ?? byName.get(String(n).toLowerCase()) ?? { name: n });
    people.forEach((p) => p.id && seen.add(p.id));
    return { id: s.id, day: s.day || "", dayN: s.day ? days.indexOf(s.day) + 1 : 0, title: s.title || people.map((p) => p.submission?.talk).find(Boolean) || "", people };
  }).filter((s) => s.people.length);
  // Presenters added since the survey's list was made.
  for (const s of sessionsFrom(live.filter((p) => !seen.has(p.id)))) {
    const people = s.presenters.map((n) => byName.get(n.toLowerCase())).filter(Boolean);
    if (people.length) out.push({ id: s.id, day: "", dayN: 0, title: s.title, people });
  }
  // By day; sessions with no day keep their place at the end.
  return out.map((s, i) => ({ ...s, i })).sort((a, b) => (a.dayN || 99) - (b.dayN || 99) || a.i - b.i).map(({ i, ...s }) => s);
}

/** What Claude is given for one session, and its fingerprint. */
function briefOf(s) {
  return {
    id: s.id, title: s.title,
    presenters: s.people.map((p) => ({
      name: p.name ?? NAME(p), organization: text(p.organization, 160),
      bio: hasSent(p) ? text(p.submission.bio, 3000) : "",
      onFile: hasSent(p) && !p.submission.bio,
    })),
    outline: s.people.map((p) => (hasSent(p) ? text(p.submission.outline, 2000) : "")).filter(Boolean).join("\n\n"),
  };
}
const fingerprint = (b) => createHash("sha256").update(JSON.stringify(b)).digest("hex").slice(0, 16);

/** The list as the Program tab shows it. */
export function mcView(event, presenters) {
  const sessions = mcSessions(event, presenters);
  const kept = event.mcIntros ?? {};
  const people = sessions.flatMap((s) => s.people).filter((p) => p.id);
  return {
    submitted: people.filter(hasSent).length, total: people.length,
    sessions: sessions.map((s) => {
      const b = briefOf(s);
      const k = kept[s.id];
      return {
        id: s.id, day: s.day, dayN: s.dayN, title: s.title,
        presenters: s.people.map((p) => ({ name: p.name ?? NAME(p), organization: p.organization ?? "", sent: p.id ? hasSent(p) : false, bio: !!(hasSent(p) && p.submission.bio) })),
        // Nobody on it sent a bio (Andrew 12 Nov 2026: "If no bio, then on PDF just indicate, no bio"): nothing is drafted.
        noBio: !hasBio(s),
        intro: k ? { text: k.text, check: k.check ?? "", by: k.by, at: k.at, stale: k.by === "claude" && k.from !== fingerprint(b) } : null,
      };
    }),
  };
}

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["intros"],
  properties: { intros: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "text", "check"], properties: { id: { type: "string" }, text: { type: "string" }, check: { type: "string" } } } } },
};

const SYSTEM = `You write the introductions an MC reads aloud to bring each presenter on stage at a training event run by ONGIA, a Canadian non-profit that trains police, corrections, justice and community partners on street gangs, organized crime, extremism and human trafficking. The audience is mostly frontline professionals.

For each session you get its title, its presenters (name, organization, the bio they sent) and the outline they sent. Write one introduction per session:
- text: 70 to 110 words, to be spoken. Short sentences that are easy to say aloud. Open with who they are (role, organization, the two or three most relevant parts of their background), then one or two sentences on what the session covers and why it matters to this audience, then end with "Please welcome" and their name(s). For two or more presenters, introduce each briefly, then the session.
- check: one short line for whoever reviews it, or "" if nothing needs checking. Say what is missing or worth confirming, e.g. "No bio sent: built from name, organization and title only", "Bio lists two ranks: confirm the current one".

Rules:
- Use only what the bio, outline, title and organization say. Never invent awards, years, ranks or numbers.
- Refer to each presenter by name or role. Use a pronoun for them only if their own bio uses it.
- Names: if the bio calls the presenter by a different first name than the name given (e.g. "Sandy" for Sandra), use the bio's name throughout, including "Please welcome". Don't raise it in check.
- General terms only for casework: never name a victim, survivor, suspect, informant or minor, and never give operational details, addresses or file numbers, even if the outline has them. A project name already in the session title may be said.
- No hype ("world-renowned", "needs no introduction"). Warm, plain and professional. Canadian spelling.`;

/** Draft introductions for the sessions given (from mcSessions). Returns { [id]: { text, check, from } }. */
export async function draftIntros(sessions, { client = null } = {}) {
  if (!sessions.length) return {};
  if (!client && !anthropicKey()) throw new Error("The desk has no Anthropic API key, so Claude can't draft the introductions.");
  const api = client ?? new Anthropic({ apiKey: anthropicKey() });
  const briefs = sessions.map(briefOf);
  const message = await api.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: `The sessions:\n${JSON.stringify(briefs.map(({ id, title, presenters, outline }) => ({ id, title, presenters: presenters.map(({ onFile, ...p }) => p), outline })))}` }],
  });
  if (message.stop_reason === "refusal") throw new Error("Claude declined to draft these introductions.");
  if (message.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off. Draft fewer at a time.");
  const raw = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let out;
  try { out = JSON.parse(raw); } catch { throw new Error("Claude's answer could not be read. Try again."); }
  const byId = new Map(briefs.map((b) => [b.id, b]));
  return Object.fromEntries((out.intros ?? []).filter((x) => byId.has(x.id) && String(x.text).trim())
    .map((x) => [x.id, { text: text(x.text, 1500), check: text(x.check, 200), from: fingerprint(byId.get(x.id)) }]));
}

/* ---------- the MC script ---------- */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSET_DIRS = [path.resolve(HERE, "../../../public/assets"), path.resolve(HERE, "../../public/assets"), path.resolve(process.cwd(), "public/assets"), "/var/task/public/assets"];
const ASSETS = ASSET_DIRS.find((d) => existsSync(path.join(d, "ongia-logo.png"))) ?? ASSET_DIRS[0];
const NAVY = "#14264d", DEEP = "#0e1a35", GOLD = "#c9a032", INK = "#14181f", MUTED = "#5d6577", LINE = "#e2ddcf";
const W = 612, H = 792, M = 54, BODY = W - M * 2;

/** The MC script: every session in order, its introduction in large type to read from a lectern. */
export async function mcScriptPdf(event, view) {
  const logo = await readFile(path.join(ASSETS, "ongia-logo-tagline-dark.png")).catch(() => null);
  const short = String(event.title).split(/\s*:\s*/)[0];
  const doc = new PDFDocument({ size: "LETTER", margin: 0, bufferPages: true, autoFirstPage: false, displayTitle: true, info: { Title: `MC script · ${short}`, Author: "ONGIA" } });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  let y = 0;
  const page = () => {
    doc.addPage();
    doc.rect(0, 0, W, 62).fill(DEEP); doc.rect(0, 62, W, 3).fill(GOLD);
    if (logo) doc.image(logo, M, 14, { height: 30 });
    doc.font("Helvetica").fontSize(9.5).fillColor("#e2bf5c").text(`MC script · ${short}`, M + 150, 18, { width: BODY - 150, align: "right", lineBreak: false });
    const d = event.dayOne ? (event.lastDay && event.lastDay !== event.dayOne ? `${formatDate(event.dayOne)} to ${formatDate(event.lastDay)}` : formatDate(event.dayOne)) : "";
    doc.text(d, M + 150, 32, { width: BODY - 150, align: "right", lineBreak: false });
    y = 86;
  };
  page();
  let day = null;
  const list = view.sessions;
  const dated = list.some((s) => s.day);
  if (!list.some((s) => s.intro?.text || s.noBio)) { doc.font("Helvetica").fontSize(12).fillColor(MUTED).text("No introductions drafted yet.", M, y); }
  for (const s of list) {
    // With no bio, the script says so; an intro written by hand is still printed.
    const nobio = s.noBio && s.intro?.by !== "edited";
    const intro = nobio ? "" : s.intro?.text || "";
    const names = s.presenters.map((p) => p.name + (p.bio || s.noBio ? "" : " (no bio)")).join(", ");
    doc.font("Helvetica").fontSize(14);
    const need = 70 + doc.heightOfString(intro || "-", { width: BODY, lineGap: 4 });
    if (s.day !== day && dated) {
      if (y + need + 40 > H - M) page();
      doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY).text(s.day ? `DAY ${s.dayN} · ${formatDate(s.day).toUpperCase()}` : "NO DAY SET YET", M, y, { characterSpacing: 0.6 }); y = doc.y + 3;
      doc.moveTo(M, y).lineTo(M + BODY, y).lineWidth(1).strokeColor(GOLD).stroke(); y += 12;
      day = s.day;
    } else if (y + need > H - M) page();
    doc.font("Helvetica-Bold").fontSize(15).fillColor(NAVY).text(names, M, y, { width: BODY }); y = doc.y + 2;
    doc.font("Helvetica-Oblique").fontSize(10.5).fillColor(MUTED).text(s.title || "", M, y, { width: BODY }); y = doc.y + 8;
    doc.font("Helvetica").fontSize(14).fillColor(intro ? INK : MUTED).text(intro || (nobio ? "No bio." : "No introduction yet."), M, y, { width: BODY, lineGap: 4 }); y = doc.y + 14;
    doc.moveTo(M, y).lineTo(M + BODY, y).lineWidth(0.5).strokeColor(LINE).stroke(); y += 16;
  }
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) { doc.switchToPage(i); doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(`${i + 1} of ${range.count}`, M, H - 30, { width: BODY, align: "right", lineBreak: false }); }
  doc.end();
  return done;
}
