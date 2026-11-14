import PDFDocument from "pdfkit";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isStipend, hstOf } from "./expenses.mjs";

/**
 * A claim as a PDF, to sit beside the Excel in the member's folder: the same facts as the template (who, when, the
 * sign-offs with their dates, the e-transfer, every line with its HST and category, the total), Claude's check, and
 * then each receipt on a page of its own, so the claim reads and prints as one document.
 *
 *   claimPdf({ claim, signers, lines, checks, receipts }) → Buffer
 *     signers: [{ title, name, date|null, for?, note? }]   (no name: not one of this claim's two; note says why)      receipts: [{ index, line, bytes, type, kind: "receipt"|"shot" }]
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSET_DIRS = [path.resolve(HERE, "../../../public/assets"), path.resolve(HERE, "../../public/assets"), path.resolve(process.cwd(), "public/assets"), "/var/task/public/assets"];
const ASSETS = ASSET_DIRS.find((d) => existsSync(path.join(d, "ongia-logo-tagline-dark.png"))) ?? ASSET_DIRS[0];

const W = 792, H = 612, M = 36;                    // Letter, landscape, in points
const NAVY = "#1b2a4a", BLUE = "#2e5090", PALE = "#ebf0f7", INK = "#12161f", MUTED = "#4a5563", RULE = "#c7ccd6", GREEN = "#2f6b4f", AMBER = "#8a5d0c", GOLD = "#b8922a";
const CATEGORY = ["", "Advertising & Promotion", "Donations", "Insurance", "Memberships", "Officer & General", "Professional Fees", "Training & Development", "Travel", "Interest & Bank Charges", "Stipend"];
const money = (n) => (Number(n) || 0).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
const day = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");

export async function claimPdf({ claim, signers = [], lines = [], checks = null, receipts = [] }) {
  const logo = await readFile(path.join(ASSETS, "ongia-logo-tagline-dark.png")).catch(() => null);
  const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: M, info: { Title: `ONGIA expense claim: ${claim.owner?.name ?? ""}, ${claim.month ?? ""}`, Author: "ONGIA Expenses" } });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((r) => doc.on("end", r));
  // The footer sits below the page's bottom margin, so the margin is lifted while it is drawn (otherwise every
  // footer starts a new, empty page).
  const footer = () => {
    const keep = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED)
      .text(`ONGIA Expenses · ${claim.owner?.name ?? ""} · ${claim.month ?? ""} · claim ${claim.id}${claim.test ? " · TEST CLAIM" : ""}`, M, H - M + 10, { width: W - M * 2, align: "left", lineBreak: false });
    doc.page.margins.bottom = keep;
  };
  const band = (title) => {
    doc.rect(0, 0, W, 54).fill(NAVY);
    doc.font("Helvetica-Bold").fontSize(19).fillColor("#ffffff").text(title, M, 18, { width: W - M * 2 - 180, lineBreak: false });
    if (logo) doc.image(logo, W - M - 160, 10, { fit: [160, 36], align: "right" });
    doc.rect(0, 54, W, 2.5).fill(GOLD);
  };

  /* ---- page 1: the claim ---- */
  band("ONGIA Expense Reimbursement Submission");
  if (claim.test) { doc.rect(M, 66, W - M * 2, 18).fill("#2c3448"); doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff").text("TEST CLAIM: nothing is paid or filed for real. It can be deleted.", M + 8, 71, { lineBreak: false }); }
  let y = claim.test ? 94 : 72;
  const kv = (x, label, value, w = 300) => {
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(MUTED).text(label, x, y, { width: 110, lineBreak: false });
    doc.font("Helvetica").fontSize(10).fillColor(INK).text(value || "—", x + 112, y - 1, { width: w - 112, lineBreak: false, ellipsis: true });
  };
  kv(M, "Submitted by", claim.owner?.name); kv(M + 360, "Date sent", day(claim.submittedAt)); y += 18;
  kv(M, "Claim for", claim.month); kv(M + 360, "Status", { submitted: "Waiting for approval", approved: "Approved, waiting for payment", paid: "Paid", rejected: "Sent back", draft: "Not sent" }[claim.status] ?? claim.status); y += 22;
  // The sign-offs, as on the template: each officer's row, the name that signed, the date.
  doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.6).strokeColor(RULE).stroke(); y += 7;
  for (const s of signers) {
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(MUTED).text(`${s.title} approval`, M, y, { width: 150, lineBreak: false });
    doc.font("Helvetica").fontSize(10).fillColor(INK).text(s.name ? `${s.name}${s.for ? ` for the ${s.for}` : ""}` : s.note || "Not needed for this claim", M + 152, y - 1, { width: 330, lineBreak: false, ellipsis: true });
    doc.font(s.date ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor(s.date ? GREEN : MUTED).text(s.date ? `Approved ${day(s.date)}` : s.name ? "Not yet" : "", M + 500, y - 1, { width: W - M * 2 - 500, lineBreak: false });
    y += 16;
  }
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(MUTED).text("E-transfer", M, y, { width: 150, lineBreak: false });
  doc.font("Helvetica").fontSize(10).fillColor(INK).text(claim.paid ? `${claim.paid.ref}, sent ${day(claim.paid.date)} by ${claim.paid.by?.name ?? ""}${claim.paid.for ? ` for the ${claim.paid.for}` : ""}` : "Not paid yet", M + 152, y - 1, { width: W - M * 2 - 152, lineBreak: false });
  y += 20;

  // The lines, with the template's columns.
  const cols = [["#", 22, "center"], ["Paid to", 118], ["Date", 72], ["Amount", 70, "right"], ["HST (locked)", 62, "right"], ["Cat. #", 38, "center"], ["Category", 108], ["Purpose", 230]];
  const totalW = cols.reduce((n, c) => n + c[1], 0);
  const scale = (W - M * 2) / totalW;
  const xs = []; let cx = M; for (const c of cols) { xs.push(cx); cx += c[1] * scale; }
  const head = () => {
    doc.rect(M, y, W - M * 2, 20).fill(BLUE);
    cols.forEach(([t, w, al], i) => doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#ffffff").text(t, xs[i] + 4, y + 6, { width: w * scale - 8, align: al ?? "left", lineBreak: false }));
    y += 20;
  };
  head();
  let sum = 0;
  lines.forEach((l, i) => {
    const purpose = [l.purpose, l.eventTitle && l.eventTitle !== l.purpose ? `(${l.eventTitle})` : "", l.kind === "mileage" ? `${l.km} km × ${money(l.rate)}${l.from || l.to ? `, ${l.from} to ${l.to}` : ""}` : "", l.kind === "noreceipt" ? (isStipend(l) ? "Stipend: no receipt needed" : "No receipt: reason and card statement attached") : "", l.comment ? `Comment: ${l.comment}` : ""].filter(Boolean).join(" · ");
    doc.font("Helvetica").fontSize(8.5);
    const rh = Math.max(22, doc.heightOfString(purpose, { width: cols[7][1] * scale - 8 }) + 10, doc.heightOfString(l.paidTo ?? "", { width: cols[1][1] * scale - 8 }) + 10);
    if (y + rh > H - M - 40) { footer(); doc.addPage(); band("ONGIA Expense Reimbursement Submission (continued)"); y = 72; head(); }
    if (i % 2 === 0) doc.rect(M, y, W - M * 2, rh).fill(PALE);
    const amount = Number(l.amount) || 0; sum += amount;
    const cells = [String(i + 1), l.paidTo ?? "", day(l.date), money(amount), money(hstOf(l)), String(l.category ?? ""), CATEGORY[Number(l.category)] ?? "", purpose];
    cells.forEach((t, j) => doc.font("Helvetica").fontSize(8.5).fillColor(INK).text(t, xs[j] + 4, y + 5, { width: cols[j][1] * scale - 8, align: cols[j][2] ?? "left" }));
    doc.moveTo(M, y + rh).lineTo(W - M, y + rh).lineWidth(0.4).strokeColor(RULE).stroke();
    y += rh;
  });
  doc.rect(M, y, W - M * 2, 24).fill("#f0f0f0");
  doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("TOTAL", xs[2] + 4, y + 7, { width: cols[2][1] * scale - 8, lineBreak: false })
    .text(money(sum), xs[3] + 4, y + 7, { width: cols[3][1] * scale - 8, align: "right", lineBreak: false });
  y += 34;

  // Claude's check, as the people approving saw it.
  if (checks) {
    const text = checks.ok ? `Everything checks out. ${(checks.summary ?? []).map((s) => `${s}.`).join(" ")} Nothing is claimed twice.`
      : `${(checks.summary ?? []).map((s) => `${s}.`).join(" ")} To look at: ${checks.notes.join(" ")}`;
    doc.font("Helvetica").fontSize(8.5);
    const hh = doc.heightOfString(text, { width: W - M * 2 - 20 }) + 22;
    if (y + hh > H - M - 10) { footer(); doc.addPage(); band("ONGIA Expense Reimbursement Submission (continued)"); y = 72; }
    doc.roundedRect(M, y, W - M * 2, hh, 6).fill(checks.ok ? "#e2efe7" : "#f8ecd5");
    doc.font("Helvetica-Bold").fontSize(9).fillColor(checks.ok ? GREEN : AMBER).text("Checked by Claude against the receipts", M + 10, y + 7, { lineBreak: false });
    doc.font("Helvetica").fontSize(8.5).fillColor(INK).text(text, M + 10, y + 19, { width: W - M * 2 - 20 });
  }
  footer();

  /* ---- a page for each receipt and card statement ---- */
  for (const r of receipts) {
    doc.addPage();
    band(r.kind === "shot" ? `Line ${r.index}: card statement` : `Line ${r.index}: receipt`);
    const l = r.line ?? {};
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(`${l.paidTo ?? ""} · ${day(l.date)} · ${money(l.amount)}`, M, 68, { width: W - M * 2, lineBreak: false });
    let top = 88;
    if (r.kind === "shot" && l.statement) {
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`Why there's no receipt: ${l.statement}`, M, top, { width: W - M * 2 });
      top = doc.y + 8;
    }
    if (/^image\/(jpeg|png)$/.test(r.type)) {
      try { doc.image(Buffer.from(r.bytes), M, top, { fit: [W - M * 2, H - top - M - 8], align: "center", valign: "top" }); }
      catch { doc.font("Helvetica").fontSize(10).fillColor(MUTED).text("This picture couldn't be placed in the PDF. It is in the Receipts folder beside this claim.", M, top); }
    } else {
      doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(`This ${r.type === "application/pdf" ? "receipt is a PDF" : "file"} and is in the Receipts folder beside this claim${r.name ? `: ${r.name}` : ""}.`, M, top, { width: W - M * 2 });
    }
    footer();
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}
