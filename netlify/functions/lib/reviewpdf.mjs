import PDFDocument from "pdfkit";
import { formatDate } from "./deadlines.mjs";

/**
 * A board member's annual review report as a PDF (Andrew 26 Nov 2026: a copy for the one-on-one and for them to keep).
 * The same as the report on the page: their averages against the board's and their own rating, colleagues' comments
 * with no names (only once enough gave them), their self-review, and the committee's record. Marked confidential.
 */
const NAVY = "#14213d", GOLD = "#b8922a", INK = "#1b2333", MUTED = "#6b7280", LINE = "#d9d4c4", TRACK = "#ece9e1", LATE = "#a33a2b";

export function reportPdf(c, R, { floor = 5 } = {}) {
  const doc = new PDFDocument({ size: "LETTER", margins: { top: 54, bottom: 54, left: 54, right: 54 }, info: { Title: `${R.name} · ONGIA annual review ${c.year}` } });
  const chunks = [];
  doc.on("data", (b) => chunks.push(b));
  const done = new Promise((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  const W = doc.page.width - 108, X = 54;
  const room = (h) => { if (doc.y + h > doc.page.height - 60) doc.addPage(); };
  const heading = (t) => { room(40); doc.moveDown(0.6).font("Helvetica-Bold").fontSize(10).fillColor(MUTED).text(t.toUpperCase(), X, doc.y, { characterSpacing: 1 }).moveDown(0.3); };
  const para = (t, o = {}) => doc.font(o.bold ? "Helvetica-Bold" : o.italic ? "Helvetica-Oblique" : "Helvetica").fontSize(o.size ?? 10.5).fillColor(o.color ?? INK).text(t, X + (o.indent ?? 0), doc.y, { width: W - (o.indent ?? 0), lineGap: 2 });

  // Band
  doc.rect(0, 0, doc.page.width, 78).fill(NAVY);
  doc.rect(0, 78, doc.page.width, 3).fill(GOLD);
  doc.font("Helvetica-Bold").fontSize(18).fillColor("#ffffff").text(`ONGIA annual review ${c.year}`, X, 26);
  doc.font("Helvetica").fontSize(10).fillColor("#d6d9e0").text("Confidential: for the board member and the review committee", X, 50);
  doc.y = 104;
  doc.font("Helvetica-Bold").fontSize(16).fillColor(INK).text(R.name, X, doc.y);
  const facts = [R.president ? "President" : "", `${R.raters} colleague${R.raters === 1 ? "" : "s"} rated`, R.released ? `released ${formatDate(String(R.released.at).slice(0, 10))}` : "not released yet"].filter(Boolean).join(" · ");
  para(facts, { color: MUTED, size: 10 });
  const f = R.facts ?? {};
  para(`${f.year ?? ""}: on ${f.on ? `${f.on} event${f.on === 1 ? "" : "s"}` : "no events"}${f.led?.length ? `, led ${f.led.join(", ")}` : ""}${f.meetings ? ` · ${f.meetings} board meetings` : ""}`, { color: MUTED, size: 10 });

  // Ratings
  heading("Ratings, 1 to 5");
  para("Bar: average from colleagues.  Gold line: board average.  Red circle: own rating.", { color: MUTED, size: 9 });
  doc.moveDown(0.4);
  const labelW = 170, barX = X + labelW + 8, barW = W - labelW - 60;
  for (const r of R.rows) {
    room(22);
    const y = doc.y;
    doc.font("Helvetica").fontSize(10.5).fillColor(INK).text(r.title, X, y + 1, { width: labelW });
    if (r.avg === null) {
      doc.font("Helvetica-Oblique").fontSize(9.5).fillColor(MUTED).text(`Too few ratings to show (${r.n} of ${floor})`, barX, y + 2, { width: barW + 50 });
    } else {
      const at = (v) => barX + (barW * (v - 1)) / 4;
      doc.roundedRect(barX, y + 3, barW, 8, 4).fill(TRACK);
      doc.roundedRect(barX, y + 3, Math.max(8, at(r.avg) - barX), 8, 4).fill(NAVY);
      if (r.board) doc.rect(at(r.board) - 1, y, 2, 14).fill(GOLD);
      if (r.self) doc.circle(at(r.self), y + 7, 4).lineWidth(1.5).strokeColor(LATE).fillAndStroke("#ffffff", LATE);
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor(INK).text(r.avg.toFixed(1), barX + barW + 14, y + 1, { width: 40 });
    }
    doc.y = y + 20;
    doc.moveTo(X, doc.y - 4).lineTo(X + W, doc.y - 4).lineWidth(0.5).strokeColor(LINE).stroke();
  }

  // Comments
  for (const cm of R.comments ?? []) {
    heading(cm.text.replace(/^Optional: one thing they/, "One thing they"));
    if (!cm.items.length) { para(`Too few to show: ${cm.n} of ${floor}. Comments are shown once ${floor} colleagues have given one, so nobody can be identified.`, { italic: true, color: MUTED, size: 10 }); continue; }
    para(`${cm.items.length}, in random order, no names`, { italic: true, color: MUTED, size: 9 });
    for (const t of cm.items) { room(30); doc.moveDown(0.25); para(`“${t}”`); }
  }

  // Self-review
  heading("Self-review");
  if (!R.self) para("No self-review submitted.", { italic: true, color: MUTED });
  else for (const q of c.questions.self) {
    const a = R.self.answers?.[q.id];
    if (!a) continue;
    room(40);
    para(q.text, { italic: true, color: MUTED, size: 10 });
    para(a);
    doc.moveDown(0.5);
  }

  // The committee's record
  heading("Commitments, agreed with the review committee");
  if (!R.commitments?.length) para("None recorded yet.", { italic: true, color: MUTED });
  else for (const t of R.commitments) { room(20); para(`•  ${t}`); }

  doc.end();
  return done;
}
