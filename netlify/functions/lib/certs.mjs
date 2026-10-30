import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import path from "node:path";
import { existsSync } from "node:fs";
import { randomInt } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getMeta, putMeta } from "./store.mjs";

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

/** The design an event uses unless someone picks another: its own when there is one, otherwise the generic. */
export const defaultTemplate = (event) => (TEMPLATES.find((t) => t.forTitle?.test(event?.title ?? "")) ?? templateOf("generic")).id;

/** The event's certificate settings, with the defaults filled in (Andrew: the date "should always default to the last day of the training event"). */
export function certSettings(event) {
  const c = event?.certs ?? {};
  return {
    template: templateOf(c.template) ? c.template : defaultTemplate(event),
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
 * The certificate for one person, issued the first time it is asked for and kept for good. Its words follow the event's
 * settings and the person's details as they are now, so a corrected name or date shows on the next download and on the
 * verify page; the code never changes.
 */
export async function issue(event, person, { name, agency, settings }) {
  const index = await certIndex(event.id);
  let code = index[person.key];
  const had = code ? await certRecord(code) : null;
  if (!had) {
    do code = newCode(); while (await certRecord(code));
    index[person.key] = code;
    await putMeta(`certs:event:${event.id}`, index);
  }
  const rec = { ...(had ?? {}), code, event: event.id, eventTitle: event.title, key: person.key, email: person.email ?? "", name, agency,
    date: settings.date, course: settings.course, template: settings.template, issuedAt: had?.issuedAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() };
  await putMeta(`certs:code:${code}`, rec);
  return rec;
}

/** The certificate itself: the design, the words, and the QR code that verifies it. */
export async function certificatePdf(rec, { origin = "" } = {}) {
  const tpl = templateOf(rec.template) ?? templateOf("generic");
  const doc = new PDFDocument({ size: [612, 792], margin: 0, info: { Title: `Certificate of Completion: ${rec.name}`, Author: "ONGIA", Subject: rec.course || rec.eventTitle || "" } });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((r) => doc.on("end", r));
  for (const [k, f] of Object.entries(FONTS)) doc.registerFont(k, path.join(ASSETS, "fonts", f));
  doc.image(path.join(ASSETS, tpl.image), 0, 0, { width: 612, height: 792 });
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
  line(tpl.fields.date, certDate(rec.date));
  const c = tpl.fields.course;
  if (c && rec.course) {
    let size = c.size;
    doc.font(c.font).fontSize(size);
    while (doc.heightOfString(rec.course, { width: c.width, lineGap: c.gap }) > (c.lines + 0.5) * doc.currentLineHeight() && size > 10) doc.fontSize(--size);
    doc.fillColor("#111111").text(rec.course, c.x, c.base - (doc._font.ascender / 1000) * size, { width: c.width, lineGap: c.gap });
  }
  if (origin) {
    const png = await QRCode.toBuffer(`${origin}/verify.html?c=${rec.code}`, { margin: 0, width: 600, errorCorrectionLevel: "M", color: { dark: "#1a2f5e", light: "#ffffff" } });
    doc.image(png, tpl.qr.x, tpl.qr.y, { width: tpl.qr.size });
    doc.font("r").fontSize(6).fillColor("#8a90a0").text("Scan to verify", tpl.qr.x - 11, tpl.qr.y + tpl.qr.size + 3, { width: tpl.qr.size + 22, align: "center", lineBreak: false });
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
