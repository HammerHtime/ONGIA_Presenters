import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import path from "node:path";
import { existsSync } from "node:fs";
import { randomInt } from "node:crypto";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { getMeta, putMeta, readRaw, writeRaw } from "./store.mjs";
import { anthropicKey } from "./contract.mjs";
import { formatLong } from "./deadlines.mjs";

/**
 * Certificates of completion (Andrew 30 Oct 2026). The desk fills a certificate design with each person's name, their
 * agency under its official name, the date and, on the generic design, the course: one page, no details page, with a
 * small QR code in a corner that opens a page confirming the certificate is genuine. Every certificate issued is kept
 * for good ("keep them forever"), so a code always verifies and any certificate can be downloaded again.
 *
 * The designs are Andrew's, from Virtual Badge, with the name, agency and date lifted off (and on the Summit design the
 * heading made a little shorter; on the generic one "Webinar" and the year taken out). The text is set in Lato, the
 * face Virtual Badge used, at the size and place it printed them.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Locally lib/ is netlify/functions/lib/; in the deployed bundle the assets sit at /var/task/public/assets (see pdf.mjs).
const ASSET_DIRS = [path.resolve(HERE, "../../../public/assets"), path.resolve(HERE, "../../public/assets"), path.resolve(process.cwd(), "public/assets"), "/var/task/public/assets"];
const ASSETS = ASSET_DIRS.find((d) => existsSync(path.join(d, "certs", "ongia-generic.jpg"))) ?? ASSET_DIRS[0];
const FONTS = { b: "Lato-Bold.woff", r: "Lato-Regular.woff", i: "Lato-Italic.woff" };

/**
 * The designs, each with where its words go: x and the baseline in points from the top left of a letter page, the
 * size that matches the original, and the widest a line may run before it is made smaller to fit.
 */
export const TEMPLATES = [
  {
    id: "national-gang-summit", name: "National Gang Summit", note: "The Summit's own design", image: "certs/national-gang-summit.jpg", forTitle: /national gang summit/i,
    fields: {
      name: { font: "b", size: 28.83, x: 40, base: 572.5, max: 370 },
      agency: { font: "i", size: 17.08, x: 38, base: 604, max: 400 },
      date: { font: "r", size: 13.74, x: 36, base: 708.5, max: 115 },
    },
    qr: { x: 538, y: 468, size: 38 },
  },
  {
    id: "generic", name: "Certificate of Completion", note: "Generic: webinars and general training", image: "certs/ongia-generic.jpg",
    fields: {
      name: { font: "b", size: 41.57, x: 41, base: 344, max: 400 },
      agency: { font: "r", size: 18.2, x: 41.4, base: 378.9, max: 420 },
      course: { font: "b", size: 22.02, x: 41.75, base: 499, width: 445, lines: 2, gap: 1.2 },
      date: { font: "r", size: 13.29, x: 45, base: 618.5, max: 140 },
    },
    qr: { x: 538, y: 36, size: 38 },
  },
];
export const templateOf = (id) => TEMPLATES.find((t) => t.id === id) ?? null;

/*
 * Designs uploaded in the app (Andrew 30 Oct 2026: "each event for the most part will have its own certificate created by
 * my designer … upload it right in the app … and the upload feature figures out where the name goes"). Each is either
 * for one event or a template for any event ("I should be prompted is this a template or specific to one event").
 * The page image, with any sample words lifted off, is kept as certdesign:<id>; where the words go is kept with it:
 * a box in points from the top left for each, the face, size, colour and alignment.
 */
export const designsOf = async () => (await getMeta("certs:designs")) ?? [];
export const putDesigns = (list) => putMeta("certs:designs", list);
const builtIn = (t) => ({ ...t, builtIn: true, w: 612, h: 792, scope: "any" });

/** Every design an event can use: the built-in ones, the templates, and its own; retired ones left out. */
export async function templatesFor(event) {
  const up = (await designsOf()).filter((d) => !d.retired && (d.scope === "any" || d.event === event?.id));
  return [...TEMPLATES.map(builtIn), ...up];
}
export async function findTemplate(id) {
  const t = templateOf(id);
  return t ? builtIn(t) : ((await designsOf()).find((d) => d.id === id) ?? null);
}

/** The design an event uses unless someone picks another: its own uploaded one, else its built-in one, else the generic. */
export const defaultTemplate = (event, templates = TEMPLATES.map(builtIn)) =>
  (templates.filter((t) => t.event === event?.id).at(-1) ?? templates.find((t) => t.forTitle?.test(event?.title ?? "")) ?? templateOf("generic")).id;

/** The event's certificate settings, with the defaults filled in (Andrew: the date "should always default to the last day of the training event"). */
export function certSettings(event, templates = TEMPLATES.map(builtIn)) {
  const c = event?.certs ?? {};
  return {
    template: templates.some((t) => t.id === c.template) ? c.template : defaultTemplate(event, templates),
    date: /^\d{4}-\d{2}-\d{2}$/.test(c.date ?? "") ? c.date : (event?.lastDay || event?.dayOne || ""),
    course: String(c.course ?? "").trim() || String(event?.title ?? "").trim(),
    dateSet: !!c.date,
  };
}

/** 2027-05-06 → 06/05/2027, as the certificates have always printed it. */
export const certDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? ""); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };

// Letters that can't be mistaken for one another when read off a printed page.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: 8 }, (_, i) => (i === 4 ? "-" : "") + ALPHABET[randomInt(ALPHABET.length)]).join("");

/** Who on an event has a certificate: person key → code. */
export const certIndex = async (eventId) => (await getMeta(`certs:event:${eventId}`)) ?? {};
export const certRecord = async (code) => (/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code ?? "") ? await getMeta(`certs:code:${code}`) : null);

/**
 * The certificate for one person, issued the first time it is asked for and kept for good. Once issued it stays as it was
 * issued: downloading it again gives the same certificate, even if the event's settings or the person's details have
 * changed since (audit, 30 Oct 2026: a credential that verifies shouldn't quietly change what it says). `correct` puts the
 * details as they are now on it on purpose, keeping its number, with what it said before kept in its history. A withdrawn
 * one, issued again, gets a new number; the old number goes on saying it was withdrawn.
 */
export async function issue(event, person, { name, agency, settings, by = null, correct = false }) {
  const index = await certIndex(event.id);
  const had = index[person.key] ? await certRecord(index[person.key]) : null;
  if (had && !had.revokedAt && !correct) return had;
  const now = new Date().toISOString();
  const words = { name, agency, date: settings.date, course: settings.course, template: settings.template };
  if (had && !had.revokedAt) {
    const before = { at: now, by, name: had.name, agency: had.agency, date: had.date, course: had.course, template: had.template };
    const rec = { ...had, ...words, eventTitle: event.title, updatedAt: now, history: [...(had.history ?? []), before] };
    await putMeta(`certs:code:${had.code}`, rec);
    return rec;
  }
  let code;
  do code = newCode(); while (await certRecord(code));
  index[person.key] = code;
  await putMeta(`certs:event:${event.id}`, index);
  if (had) await putMeta(`certs:code:${had.code}`, { ...had, replacedBy: code });
  const rec = { code, event: event.id, eventTitle: event.title, key: person.key, email: person.email ?? "", ...words, issuedAt: now, updatedAt: now, issuedBy: by,
    ...(had ? { replaces: had.code } : {}), ...(person.checkedIn === false ? { notCheckedIn: true } : {}) };
  await putMeta(`certs:code:${code}`, rec);
  return rec;
}

/**
 * Issue & download all (audit, 30 Oct 2026): everyone given who has no certificate yet gets one, in one go. The index is
 * written once, at the end, so a few hundred names don't each rewrite it. Someone whose certificate was withdrawn is left
 * out: issuing theirs again is a decision for one person at a time.
 */
export async function issueMany(event, people, { settings, by = null }) {
  const index = await certIndex(event.id);
  const todo = people.filter((p) => !index[p.key]);
  if (!todo.length) return 0;
  const codes = new Set();
  const fresh = async () => { for (;;) { const c = newCode(); if (!codes.has(c) && !(await certRecord(c))) { codes.add(c); return c; } } };
  const now = new Date().toISOString();
  for (let i = 0; i < todo.length; i += 25) {
    await Promise.all(todo.slice(i, i + 25).map(async (p) => {
      const code = await fresh();
      await putMeta(`certs:code:${code}`, { code, event: event.id, eventTitle: event.title, key: p.key, email: p.email ?? "", name: p.name, agency: p.agency,
        date: settings.date, course: settings.course, template: settings.template, issuedAt: now, updatedAt: now, issuedBy: by, ...(p.checkedIn === false ? { notCheckedIn: true } : {}) });
      index[p.key] = code;
    }));
  }
  await putMeta(`certs:event:${event.id}`, { ...(await certIndex(event.id)), ...index });
  return todo.length;
}

/** The certificate itself: the design, the words, and the QR code that verifies it. */
export async function certificatePdf(rec, { origin = "" } = {}) {
  const tpl = (await findTemplate(rec.template)) ?? builtIn(templateOf("generic"));
  const W = tpl.w || 612, H = tpl.h || 792;
  const doc = new PDFDocument({ size: [W, H], margin: 0, info: { Title: `Certificate of Completion: ${rec.name}`, Author: "ONGIA", Subject: rec.course || rec.eventTitle || "" } });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((r) => doc.on("end", r));
  for (const [k, f] of Object.entries(FONTS)) doc.registerFont(k, path.join(ASSETS, "fonts", f));
  if (tpl.builtIn) doc.image(path.join(ASSETS, tpl.image), 0, 0, { width: W, height: H });
  else {
    const img = await readRaw(`certdesign:${tpl.id}`);
    if (!img) throw new Error(`The design "${tpl.name}" has lost its picture. Upload it again.`);
    doc.image(img.bytes, 0, 0, { width: W, height: H });
  }
  const date = tpl.dateStyle === "long" ? formatLong(rec.date, "en", { weekday: false }) : certDate(rec.date);
  if (tpl.builtIn) {
    // One line, at the design's size unless it would run past its space; then a point smaller at a time.
    const line = (f, words) => {
      if (!f || !words) return;
      let size = f.size;
      doc.font(f.font).fontSize(size);
      while (doc.widthOfString(words) > f.max && size > 8) doc.fontSize(--size);
      doc.fillColor("#111111").text(words, f.x, f.base - (doc._font.ascender / 1000) * size, { lineBreak: false });
    };
    line(tpl.fields.name, rec.name);
    line(tpl.fields.agency, rec.agency);
    line(tpl.fields.date, date);
    const c = tpl.fields.course;
    if (c && rec.course) {
      let size = c.size;
      doc.font(c.font).fontSize(size);
      while (doc.heightOfString(rec.course, { width: c.width, lineGap: c.gap }) > (c.lines + 0.5) * doc.currentLineHeight() && size > 10) doc.fontSize(--size);
      doc.fillColor("#111111").text(rec.course, c.x, c.base - (doc._font.ascender / 1000) * size, { width: c.width, lineGap: c.gap });
    }
  } else {
    // An uploaded design: each item in its box, centred top to bottom, as the editor showed it.
    const box = (f, words) => {
      if (!f || f.off || !words) return;
      const lines = Math.max(1, f.lines || 1);
      let size = f.size;
      doc.font(f.font || "r").fontSize(size);
      const fits = () => (lines === 1 ? doc.widthOfString(words) <= f.w : doc.heightOfString(words, { width: f.w }) <= lines * doc.currentLineHeight() + 1);
      while (!fits() && size > 7) doc.fontSize(--size);
      const tall = lines === 1 ? doc.currentLineHeight() : doc.heightOfString(words, { width: f.w });
      doc.fillColor(f.color || "#111111").text(words, f.x, f.y + Math.max(0, (f.h - tall) / 2), { width: f.w, align: f.align === "center" ? "center" : "left", lineBreak: lines > 1, height: lines > 1 ? f.h + 2 : undefined });
    };
    box(tpl.fields.name, rec.name);
    box(tpl.fields.agency, rec.agency);
    box(tpl.fields.course, rec.course);
    box(tpl.fields.date, date);
  }
  if (origin && tpl.qr) {
    const png = await QRCode.toBuffer(`${origin}/verify.html?c=${rec.code}`, { margin: 0, width: 600, errorCorrectionLevel: "M", color: { dark: "#1a2f5e", light: "#ffffff" } });
    doc.image(png, tpl.qr.x, tpl.qr.y, { width: tpl.qr.size });
    doc.font("r").fontSize(6).fillColor(tpl.qr.light ? "#ffffff" : "#8a90a0").text("Scan to verify", tpl.qr.x - 11, tpl.qr.y + tpl.qr.size + 3, { width: tpl.qr.size + 22, align: "center", lineBreak: false });
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

/** "Jordan Tremblay certificate.pdf", safe as a file name. */
export const certFileName = (rec) => `${String(rec.name || "Certificate").replace(/[^\p{L}\p{N} .'-]+/gu, "").trim() || "Certificate"} - certificate.pdf`;

/**
 * Add it to LinkedIn (Andrew 30 Oct 2026: "yes to add to linkedin"): LinkedIn's own add-a-certification link, filled in.
 * https://addtoprofile.linkedin.com/
 */
export function linkedInUrl(rec, origin) {
  const d = /^(\d{4})-(\d{2})/.exec(rec.date ?? "");
  const q = new URLSearchParams({ startTask: "CERTIFICATION_NAME", name: rec.course || rec.eventTitle || "Certificate of Completion", organizationName: "ONGIA",
    ...(d ? { issueYear: d[1], issueMonth: String(+d[2]) } : {}), certUrl: `${origin}/verify.html?c=${rec.code}`, certId: rec.code });
  return `https://www.linkedin.com/profile/add?${q}`;
}

/**
 * Where the words go on a design (Andrew 30 Oct 2026: "the upload feature figures out where the name goes, agency etc."):
 * Claude looks at the page and gives a box for each, the face and size that suit it, any sample words to lift off, and a
 * quiet corner for the QR code. Boxes come back as fractions of the page, so they fit whatever size it is drawn at.
 */
const FRAC = { type: "object", additionalProperties: false, required: ["x", "y", "w", "h"], properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } } };
const FIELD = { type: "object", additionalProperties: false, required: ["present", "box", "font", "sizePt", "color", "align"],
  properties: { present: { type: "boolean" }, box: FRAC, font: { type: "string", enum: ["bold", "regular", "italic"] }, sizePt: { type: "number" }, color: { type: "string", enum: ["black", "navy", "white"] }, align: { type: "string", enum: ["left", "center"] } } };
const PLACE = {
  type: "object", additionalProperties: false, required: ["name", "agency", "course", "date", "erase", "qr", "notes"],
  properties: { name: FIELD, agency: FIELD, course: FIELD, date: FIELD,
    erase: { type: "array", items: { type: "object", additionalProperties: false, required: ["box", "text"], properties: { box: FRAC, text: { type: "string" } } } },
    qr: { type: "object", additionalProperties: false, required: ["box", "onDark"], properties: { box: FRAC, onDark: { type: "boolean" } } },
    notes: { type: "string" } },
};
const PLACE_SYSTEM = `You look at a certificate design for ONGIA, a Canadian training non-profit, and say where the desk should print each person's details on it. The page is W points wide and H points tall; give every box as fractions of the page (x and w of the width, y and h of the height, from the top left).

- name: the recipient's name, usually the largest line after a phrase like "Proudly presented to" or "This certifies that", often above a rule. Make the box the full width the name may use, and as tall as one line at the size you choose.
- agency: their organization, usually a smaller line just under the name or its rule.
- course: the training's title, when the design has a place for it (for example after "for their successful completion of the"). present false if the design names the training itself in its artwork.
- date: the date issued, usually above a rule labelled "Date" or "Date Issued".
For each: sizePt is the type size in points that matches the design (a name is often 26 to 40, an agency 14 to 20, a date 11 to 14); font is bold, regular or italic as the design suggests; color is black, navy, or white when it sits on a dark background; align is center when the design is centred around that spot, otherwise left.
- erase: any sample words on the design that stand in for a person's details ("Your Recipient", "Recipient's Organization", "DD/MM/YYYY", "Name", "Jane Doe", a sample date), each with a box that covers it with a little room around it. Never list the design's own words (titles, "Date Issued", signatures, logos).
- qr: a square about 0.06 of the page width in a quiet corner or margin, clear of the artwork's text, logos and signatures; onDark true if that spot is dark.
- notes: one plain sentence for ONGIA's president on anything to check, or empty.`;

export async function placeDesign({ image, mediaType = "image/jpeg", w, h }, { client = null } = {}) {
  if (!client && !anthropicKey()) throw new Error("The desk has no Anthropic API key, so Claude cannot place the words. Place them by hand.");
  const api = client ?? new Anthropic({ apiKey: anthropicKey() });
  const message = await api.messages.create({
    model: "claude-opus-5-5", max_tokens: 4000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: PLACE } },
    system: PLACE_SYSTEM.replace("W points", `${Math.round(w)} points`).replace("H points", `${Math.round(h)} points`),
    messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: image } }, { type: "text", text: "Where do the person's details go on this certificate?" }] }],
  });
  if (message.stop_reason === "refusal") throw new Error("Claude would not read this design. Place the words by hand.");
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let got;
  try { got = JSON.parse(text); } catch { throw new Error("Claude's answer could not be read. Place the words by hand, or try again."); }
  return cleanPlacement(got, w, h);
}

const COLORS = { black: "#111111", navy: "#1a2f5e", white: "#ffffff" };
const FACES = { bold: "b", regular: "r", italic: "i" };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
/** Claude's answer, in points, kept on the page. */
export function cleanPlacement(p, w, h) {
  const box = (b) => { const x = clamp(b?.x, 0, 0.98), y = clamp(b?.y, 0, 0.98); return { x: +(x * w).toFixed(1), y: +(y * h).toFixed(1), w: +(clamp(b?.w, 0.02, 1 - x) * w).toFixed(1), h: +(clamp(b?.h, 0.01, 1 - y) * h).toFixed(1) }; };
  const field = (f, lines = 1) => ({ ...box(f?.box), font: FACES[f?.font] ?? "r", size: +clamp(f?.sizePt, 7, 72).toFixed(1), color: COLORS[f?.color] ?? "#111111", align: f?.align === "center" ? "center" : "left", lines, off: f?.present === false });
  const q = box({ ...p?.qr?.box, h: p?.qr?.box?.w * (w / h) });
  const size = clamp(q.w, 28, 72);
  return {
    fields: { name: field(p?.name), agency: field(p?.agency), course: field(p?.course, 2), date: field(p?.date) },
    erase: (p?.erase ?? []).slice(0, 12).map((e) => ({ ...box(e.box), text: String(e.text ?? "").slice(0, 80) })),
    qr: { x: clamp(q.x, 0, w - size), y: clamp(q.y, 0, h - size - 12), size, light: !!p?.qr?.onDark },
    notes: String(p?.notes ?? "").slice(0, 300),
  };
}

/** A design, as saved from the editor: its fields made safe. */
export function cleanDesign(body, w, h) {
  const f = (x, lines = 1) => x && ({ x: clamp(x.x, 0, w), y: clamp(x.y, 0, h), w: clamp(x.w, 10, w), h: clamp(x.h, 4, h), font: ["b", "r", "i"].includes(x.font) ? x.font : "r", size: clamp(x.size, 6, 96),
    color: /^#[0-9a-f]{6}$/i.test(x.color ?? "") ? x.color : "#111111", align: x.align === "center" ? "center" : "left", lines, off: !!x.off });
  const q = body.qr && !body.qr.off ? { x: clamp(body.qr.x, 0, w), y: clamp(body.qr.y, 0, h), size: clamp(body.qr.size, 24, 96), light: !!body.qr.light } : null;
  return { fields: { name: f(body.fields?.name), agency: f(body.fields?.agency), course: f(body.fields?.course, 2), date: f(body.fields?.date) }, qr: q, dateStyle: body.dateStyle === "long" ? "long" : "dmy" };
}
export const putDesignImage = (id, bytes) => writeRaw(`certdesign:${id}`, bytes, { type: "image/jpeg" });
export const designImage = async (id) => (await readRaw(`certdesign:${id}`))?.bytes ?? null;
