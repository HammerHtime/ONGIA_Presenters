import { readZip, makeZip } from "./zip.mjs";

/**
 * A claim on ONGIA's own expense claim template (public/assets/expense-claim-template.xlsx, made from the template
 * the board fills in by hand, with nobody's figures left in it): the same title, approval block, columns, formulas,
 * category table and print setup, so the Treasurer's folder looks as it always has.
 *
 *   claimWorkbook(templateBytes, {
 *     submittedBy, submitted,                       "John Healy", "2026-11-05"
 *     signers: { president, vp, treasurer },        each { label: "A. Hammond" | "P. Artinian for R. Jaswal", date|null }
 *     txn, paidDate,                                the e-transfer reference and its date, once paid
 *     lines: [{ paidTo, date, amount, category, purpose }],
 *   }) → Buffer
 *
 * The template has eight line rows (12–19). A longer claim gets more, in the same alternating blue and white, and
 * everything below them (the total, the category table, the instructions) moves down with every reference to it.
 * The category name stays the template's own formula; HST is the tax inside the amount, ROUND(E×13/113, 2), and 0 on
 * mileage and a speaker stipend (a line given `noHst`), Andrew's choice on 3 Nov 2026 over the template's E×0.13. The
 * results are filled in too, so a viewer that doesn't recalculate still shows them.
 */
const FIRST = 12, TEMPLATE_ROWS = 8, TOTAL_ROW = 20;
const COLS = "ABCDEFGHI";
// Styles of the line rows, read off the template: the first row, then white and blue in turn, and the last row.
const STYLE = {
  first: { A: 6, B: 59, C: 60, D: 51, E: 7, F: 26, G: 8, H: 27, I: 19 },
  white: { A: 10, B: 61, C: 62, D: 11, E: 12, F: 28, G: 13, H: 29, I: 24 },
  blue: { A: 20, B: 65, C: 66, D: 21, E: 22, F: 30, G: 23, H: 27, I: 9 },
  lastWhite: { A: 10, B: 67, C: 68, D: 11, E: 12, F: 28, G: 13, H: 29, I: 24 },
};
const CATEGORY = ["", "Advertising & Promotion", "Donations", "Insurance", "Memberships", "Officer & General", "Professional Fees", "Training & Development", "Travel", "Interest & Bank Charges", "Stipend"];

const x = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
/** Excel's day number for a YYYY-MM-DD date. */
export const serial = (iso) => { const [y, m, d] = String(iso).split("-").map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400e3; };
const str = (ref, s, text) => `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${x(text)}</t></is></c>`;
const num = (ref, s, n) => `<c r="${ref}" s="${s}"><v>${n}</v></c>`;
const blank = (ref, s) => `<c r="${ref}" s="${s}"/>`;
const fml = (ref, s, f, v, text = false) => `<c r="${ref}" s="${s}"${text ? ' t="str"' : ""}><f>${x(f)}</f>${v === "" || v === null || v === undefined ? "" : `<v>${text ? x(v) : v}</v>`}</c>`;

/** Replace one cell, keeping its style. A missing cell is left alone. */
function setCell(xml, ref, make) {
  const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>.*?</c>)`, "s");
  const m = xml.match(re);
  if (!m) return xml;
  const s = (m[1].match(/\ss="(\d+)"/) ?? [])[1] ?? "0";
  return xml.replace(re, make(s));
}

/**
 * One row of the sheet at a time, whether written out (<row …>…</row>) or empty and short (<row …/>; the template has
 * hundreds). The short form is tried first, so an empty row can never swallow the one after it.
 */
const ROW = /<row\b(?:[^>/]|\/(?!>))*\/>|<row\b[^>]*>.*?<\/row>/gs;
const rowNo = (tok) => Number((tok.match(/^<row r="(\d+)"/) ?? [])[1]);
/** Move every row at or below `from` down by `k`: the row numbers and the references of the cells in them. */
function shiftRows(xml, from, k) {
  if (!k) return xml;
  return xml.replace(ROW, (tok) => {
    const n = rowNo(tok);
    if (!(n >= from)) return tok;
    const to = n + k;
    return tok.replace(/^<row r="\d+"/, `<row r="${to}"`).replace(/<c r="([A-Z]+)\d+"/g, (_, c) => `<c r="${c}${to}"`);
  });
}
const shiftRef = (ref, from, k) => ref.replace(/(\$?[A-Z]+\$?)(\d+)/g, (_, c, n) => `${c}${Number(n) >= from ? Number(n) + k : n}`);

export function claimWorkbook(template, d) {
  const files = readZip(Buffer.from(template));
  const get = (name) => files.find((f) => f.name === name);
  const sheet = get("xl/worksheets/sheet1.xml"), book = get("xl/workbook.xml");
  let xml = sheet.data.toString("utf8");
  const lines = d.lines ?? [];
  const rows = Math.max(TEMPLATE_ROWS, lines.length);
  const k = rows - TEMPLATE_ROWS;
  const last = FIRST + rows - 1, total = TOTAL_ROW + k, tableFrom = 24 + k, tableTo = 33 + k;

  // The header: who, when, the two (or three) sign-offs, the payment.
  xml = setCell(xml, "C3", (s) => str("C3", s, d.submittedBy));
  if (d.submitted) xml = setCell(xml, "G3", (s) => num("G3", s, serial(d.submitted)));
  for (const [role, row] of [["president", 4], ["vp", 5], ["treasurer", 6]]) {
    const g = d.signers?.[role];
    if (g?.label) xml = setCell(xml, `C${row}`, (s) => str(`C${row}`, s, g.label));
    if (g?.date) xml = setCell(xml, `G${row}`, (s) => num(`G${row}`, s, serial(g.date)));
  }
  if (d.txn) xml = setCell(xml, "C7", (s) => str("C7", s, d.txn));
  if (d.paidDate) xml = setCell(xml, "G7", (s) => num("G7", s, serial(d.paidDate)));

  // Everything below the line rows moves down first, then the line rows are written afresh.
  xml = shiftRows(xml, TOTAL_ROW, k);
  const rowOpen = (xml.match(new RegExp(`<row r="${FIRST}"([^>]*)>`)) ?? [])[1] ?? ' spans="1:26" s="42" customFormat="1"';
  const pad = Array.from({ length: 17 }, (_, i) => String.fromCharCode(74 + i)); // J … Z
  const built = [];
  let sum = 0;
  for (let i = 0; i < rows; i++) {
    const r = FIRST + i, l = lines[i];
    const st = i === 0 ? STYLE.first : i === rows - 1 && i % 2 === 1 ? STYLE.lastWhite : i % 2 === 1 ? STYLE.white : STYLE.blue;
    const amount = l && Number.isFinite(Number(l.amount)) ? Math.round(Number(l.amount) * 100) / 100 : null;
    if (amount !== null) sum += amount;
    // Tall enough for what's in it: the purpose column wraps at about 45 characters, the paid-to column at about 30.
    const linesTall = l ? Math.max(1, Math.ceil(String(l.purpose ?? "").length / 45), Math.ceil(String(l.paidTo ?? "").length / 30)) : 1;
    const ht = Math.max(32.25, 14 * linesTall + 8);
    const cells = [
      fml(`A${r}`, st.A, `ROW()-ROW($A$${FIRST})+1`, i + 1),
      l?.paidTo ? str(`B${r}`, st.B, l.paidTo) : blank(`B${r}`, st.B),
      blank(`C${r}`, st.C),
      l?.date ? num(`D${r}`, st.D, serial(l.date)) : blank(`D${r}`, st.D),
      amount !== null ? num(`E${r}`, st.E, amount) : blank(`E${r}`, st.E),
      l?.noHst ? num(`F${r}`, st.F, 0)
        : fml(`F${r}`, st.F, `IF(E${r}="","",ROUND(E${r}*13/113,2))`, amount !== null ? Math.round(amount * 13 / 113 * 100) / 100 : ""),
      l?.category ? num(`G${r}`, st.G, Number(l.category)) : blank(`G${r}`, st.G),
      fml(`H${r}`, st.H, `IFERROR(VLOOKUP(G${r},$A$${tableFrom}:$B$${tableTo},2,FALSE),"")`, l?.category ? CATEGORY[Number(l.category)] ?? "" : "", true),
      l?.purpose ? str(`I${r}`, st.I, l.purpose) : blank(`I${r}`, st.I),
      ...pad.map((c) => blank(`${c}${r}`, 41)),
    ];
    const attrs = rowOpen.replace(/\s(ht|customHeight|x14ac:dyDescent)="[^"]*"/g, "");
    built.push(`<row r="${r}"${attrs} ht="${ht}" customHeight="1">${cells.join("")}</row>`);
  }
  xml = xml.replace(ROW, (tok) => (rowNo(tok) >= FIRST && rowNo(tok) <= FIRST + TEMPLATE_ROWS - 1 ? "" : tok));
  const at = xml.indexOf(`<row r="${total}"`);
  xml = xml.slice(0, at) + built.join("") + xml.slice(at);
  xml = setCell(xml, `E${total}`, (s) => fml(`E${total}`, s, `SUM(E${FIRST}:E${last})`, Math.round(sum * 100) / 100));

  // The instructions say where things are on this sheet, and who fills in the payment now (the VP, Andrew 3 Nov 2026).
  const say = (row, text) => { xml = setCell(xml, `A${row + k}`, (s) => str(`A${row + k}`, s, text)); };
  say(39, "3. Transaction # (C7) and Date (G7): Filled in by the VP at time of payment.");
  say(40, `4. Expense line items (rows ${FIRST}-${last}):`);
  say(43, `5. Total (E${total}) auto-sums all amounts.`);
  say(44, `6. Category reference table: See A${tableFrom - 1}:B${tableTo} for the 10 valid category codes.`);

  // Merged cells, the category drop-down, the print area: all follow the rows.
  xml = xml.replace(/<mergeCells count="\d+">(.*?)<\/mergeCells>/s, (_, inner) => {
    const kept = [...inner.matchAll(/<mergeCell ref="([^"]+)"\/>/g)].map((m) => m[1])
      .filter((ref) => !/^B(1[2-9]):C\1$/.test(ref)).map((ref) => shiftRef(ref, TOTAL_ROW, k));
    for (let r = FIRST; r <= last; r++) kept.push(`B${r}:C${r}`);
    return `<mergeCells count="${kept.length}">${kept.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>`;
  });
  xml = xml.replace(/sqref="G12:G19"/, `sqref="G${FIRST}:G${last}"`);
  xml = xml.replace(/<dimension ref="A1:Z(\d+)"\/>/, (_, n) => `<dimension ref="A1:Z${Number(n) + k}"/>`);
  // Printed one page wide, landscape: the template has no fitting set, so the Purpose column and the logo fell onto a
  // second sheet of paper.
  xml = xml.replace(/<sheetPr>(.*?)<\/sheetPr>/s, (_, inner) => `<sheetPr>${inner.replace(/<pageSetUpPr[^>]*\/>/, "")}<pageSetUpPr fitToPage="1"/></sheetPr>`);
  xml = xml.replace(/<pageSetup [^>]*\/>/, '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>');
  sheet.data = Buffer.from(xml, "utf8");
  book.data = Buffer.from(book.data.toString("utf8").replace(/Sheet1!\$A\$1:\$I\$\d+/, `Sheet1!$A$1:$I$${total}`), "utf8");
  return makeZip(files.map((f) => ({ name: f.name, data: f.data })));
}
