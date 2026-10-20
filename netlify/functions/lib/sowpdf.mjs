import PDFDocument from "pdfkit";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { formatDate } from "./deadlines.mjs";
import { totals, lineAmount, increase } from "./sow.mjs";

/**
 * The statement of work and the final invoice as PDFs, in the look of ONGIA's own SOW sheet:
 * a navy banner with the logo and the program's name in gold italic, a cream page, a navy
 * table heading with gold lettering, a gold rule above the sums, and a navy TOTAL BALANCE DUE bar.
 *
 * The SOW shows the estimates; the invoice shows the actuals (the typed amount where one was typed).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSET_DIRS = [path.resolve(HERE, "../../../public/assets"), path.resolve(HERE, "../../public/assets"), path.resolve(process.cwd(), "public/assets"), "/var/task/public/assets"];
const ASSETS = ASSET_DIRS.find((d) => existsSync(path.join(d, "ongia-logo.png"))) ?? ASSET_DIRS[0];

const NAVY = "#0b1f3a", NAVY2 = "#163459", GOLD = "#c9a84c", GOLD_TEXT = "#ffc000", GOLD_PALE = "#f0d98a";
const CREAM = "#fdfaf4", SAND = "#f5f0e8", INK = "#2d2d2d", GREY = "#8a8a8a", RED = "#c0392b";
const W = 612, H = 792, M = 36, BODY = W - M * 2;
const AMOUNT_W = 120;

const cad = (n) => `$${Number(n).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (v) => (v ? formatDate(v) : "");

/** `kind` is "sow" or "invoice". Resolves to a Buffer. */
export async function buildSowPdf({ event, sow, kind = "sow" }) {
  const logo = await readFile(path.join(ASSETS, "ongia-logo.png")).catch(() => null);
  const which = kind === "invoice" ? "actual" : "estimate";
  const t = totals(sow, which);
  const amount = new Map(t.lines.map((l) => [l.id, l.amount]));

  const doc = new PDFDocument({ size: "LETTER", margin: 0, info: { Title: `${kind === "invoice" ? "Invoice" : "Statement of Work"} ${sow.invoice?.number ?? ""}`, Author: "ONGIA" } });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  const page = () => doc.rect(0, 0, W, H).fill(CREAM);

  const title = sow.program?.title || event.title;
  const dates = dateRange(event);
  const place = sow.program?.place ?? event.city ?? "";

  page();
  // banner
  doc.rect(0, 22, W, 62).fill(NAVY);
  doc.rect(0, 84, W, 4).fill(GOLD);
  doc.rect(0, 18, W, 4).fill(GOLD);
  if (logo) doc.image(logo, M, 38, { height: 30 });
  doc.font("Times-BoldItalic").fontSize(titleSize(doc, title)).fillColor(GOLD_TEXT).text(title, 224, 38, { width: 216, align: "center", lineBreak: false });
  doc.font("Times-Italic").fontSize(8.5).fillColor(GOLD_PALE).text("ONGIA\nProfessional Event Services", 448, 41, { width: W - 448 - M, align: "center" });

  // who, when, and the numbers
  let y = 104;
  doc.font("Times-Bold").fontSize(12).fillColor(NAVY).text(`${dates}`, M + 6, y, { width: 300 });
  if (place) doc.font("Times-Italic").fontSize(12).fillColor(GREY).text(place, M + 6, y + 18, { width: 300 });
  if (sow.program?.note) doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(RED).text(sow.program.note, M + 6, y + 38, { width: 300 });
  const row = (label, value, ry) => {
    doc.font("Times-Bold").fontSize(11).fillColor(GREY).text(label, 330, ry + 3, { width: 90, align: "right" });
    doc.rect(430, ry, W - M - 430, 18).fill(SAND);
    doc.font("Times-Roman").fontSize(11).fillColor(INK).text(value || "", 436, ry + 3, { width: W - M - 442 });
  };
  row("Invoice #:", sow.invoice?.number ?? "", y - 2);
  row("Date:", kind === "invoice" ? fmt(sow.invoiceDate) : fmt(sow.statusAt?.submitted?.slice(0, 10) ?? sow.sowDate), y + 22);
  row("Due Date:", kind === "invoice" ? fmt(sow.dueDate) : "", y + 46);
  row("Prepared by:", "ONGIA", y + 70);
  doc.font("Times-Bold").fontSize(9).fillColor(GOLD).text(kind === "invoice" ? "INVOICE" : "STATEMENT OF WORK", M + 6, y + 62, { width: 300, characterSpacing: 1.5 });
  y += 100;

  const heading = () => {
    doc.rect(M, y, BODY, 22).fill(NAVY2);
    doc.font("Times-Bold").fontSize(12).fillColor(GOLD_PALE);
    doc.text("PROGRAM DETAILS", M + 8, y + 5, { width: 300 });
    doc.text(kind === "invoice" ? "TOTAL" : "ESTIMATE", W - M - AMOUNT_W - 8, y + 5, { width: AMOUNT_W, align: "right" });
    y += 26;
  };
  heading();

  const room = (h) => {
    if (y + h > H - 60) { doc.addPage(); page(); y = 40; heading(); }
  };
  // "Other" (invoice only): receipts that fit no line of the SOW, with what they were for under it.
  const rows = (sow.lines ?? []).map((l) => ({ id: l.id, name: l.name, description: l.description, fallback: l }));
  if (kind === "invoice" && t.other !== 0) rows.push({ id: "other", name: "Other", description: (sow.otherNotes ?? []).join("; "), fallback: null });
  rows.forEach((l, i) => {
    const descH = l.description ? Math.max(16, doc.font("Helvetica-Oblique").fontSize(8.5).heightOfString(l.description, { width: BODY - 24 }) + 8) : 0;
    room(24 + descH);
    doc.rect(M, y, BODY, 24).fill(i % 2 ? SAND : CREAM);
    doc.rect(M, y, 2.5, 24).fill(GOLD);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text(l.name.toUpperCase(), M + 10, y + 7, { width: BODY - AMOUNT_W - 30 });
    doc.font("Helvetica").fontSize(10).fillColor(INK).text(cad(l.id === "other" ? t.other : (amount.get(l.id) ?? lineAmount(l.fallback, which))), W - M - AMOUNT_W - 8, y + 7, { width: AMOUNT_W, align: "right" });
    y += 24;
    if (l.description) {
      doc.rect(M, y, BODY, descH).fill(SAND);
      doc.font("Helvetica-Oblique").fontSize(8.5).fillColor("#555555").text(l.description, M + 10, y + 4, { width: BODY - 24 });
      y += descH;
    }
  });

  // sums
  const sums = [];
  sums.push(["SUBTOTAL", t.subtotal, "bold"]);
  sums.push(["ONGIA SERVICE FEE", t.fee]);
  if (t.deposit > 0) sums.push(["DEPOSIT PAID", -t.deposit], ["NEW SUBTOTAL", t.newSubtotal, "bold"]);
  for (const x of t.taxes) sums.push([`${x.name} (${x.rate}%)`, x.amount]);
  room(14 + sums.length * 18 + 80);
  doc.rect(M, y + 4, BODY, 8).fill(GOLD);
  y += 16;
  sums.forEach(([label, v, style], i) => {
    doc.rect(M, y, BODY, 18).fill(i % 2 ? CREAM : SAND);
    doc.font(style === "bold" ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(NAVY).text(label, M + 10, y + 5, { width: BODY - AMOUNT_W - 30, align: "right" });
    doc.font(style === "bold" ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(INK).text(v < 0 ? `(${cad(-v)})` : cad(v), W - M - AMOUNT_W - 8, y + 5, { width: AMOUNT_W, align: "right" });
    y += 18;
  });
  y += 6;
  doc.rect(M, y, BODY, 8).fill(GOLD); y += 8;
  doc.rect(M, y, BODY, 34).fill(NAVY);
  doc.font("Times-Bold").fontSize(13).fillColor(GOLD_PALE).text("TOTAL BALANCE DUE", M + 10, y + 11, { width: BODY - AMOUNT_W - 36, align: "right" });
  doc.font("Times-Bold").fontSize(15).fillColor("#c9a84c").text(cad(t.total), W - M - AMOUNT_W - 8, y + 9, { width: AMOUNT_W, align: "right" });
  y += 34;
  doc.rect(M, y, BODY, 8).fill(GOLD); y += 8;
  // An invoice 20% or more over the SOW carries ONGIA's explanation, in bold at the foot of the page.
  const why = String(sow.increaseReason ?? "").trim();
  if (kind === "invoice" && why && increase(sow).over) {
    const h = doc.font("Helvetica-Bold").fontSize(9.5).heightOfString(why, { width: BODY - 20 }) + 34;
    if (y + h > H - 50) { doc.addPage(); page(); y = 40; }
    doc.font("Times-Bold").fontSize(10).fillColor(GOLD).text("RATIONALE FOR THE INCREASE", M + 10, y + 14, { width: BODY - 20 });
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(NAVY).text(why, M + 10, y + 30, { width: BODY - 20 });
    y += h + 6;
  }
  doc.font("Times-Italic").fontSize(8.5).fillColor(GREY).text("* All pricing is in Canadian dollars (CAD)  |  Thank you for your business.", M, y + 12, { width: BODY, align: "center" });
  doc.end();
  return done;
}

function titleSize(doc, title) {
  for (const s of [24, 21, 18, 15, 13]) { doc.font("Times-BoldItalic").fontSize(s); if (doc.widthOfString(title) <= 216) return s; }
  return 11;
}

function dateRange(event) {
  const a = event.dayOne, b = event.lastDay;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a ?? "")) return "";
  const d = (iso) => new Date(Date.parse(iso)).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
  const year = a.slice(0, 4);
  return b && b !== a ? `${year}   |   ${d(a)} - ${d(b)}` : `${year}   |   ${d(a)}`;
}
