import { makeZip, readZip } from "./zip.mjs";

/**
 * A small Excel (.xlsx) writer for the lists Andrew prints or sends on: one sheet, a title, a line under it, a grey
 * header row and bordered rows that wrap, Arial, fitted to one page wide. Laid out like the dietary sheet he gave the
 * hotel for the National Gang Summit (A 16, C 48 wide; title bold 14; header bold on D9D9D9 with thin borders).
 *
 *   xlsx({ title, subtitle, columns: [{ head, width, center }], rows: [[...]], footer: [[...]], landscape })
 *
 * For a list in groups (the shared email addresses, Andrew 29 Oct 2026): `summary` lines sit under the title, a row may
 * be { section: "…" } (a bold band across the sheet) or { cells: [...], shade: true } (a lightly shaded row, so groups
 * next to each other can be told apart).
 */
const x = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
  // Characters XML 1.0 does not allow.
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const col = (i) => { let s = ""; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

// 0 plain · 1 title · 2 subtitle · 3 header · 4 body cell · 5 footer (bold, bordered)
// 6 body cell, shaded · 7 section band (bold, shaded) · 8 body cell, centred · 9 body cell, centred and shaded
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="14"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export function xlsx({ title, subtitle = "", summary = [], columns, rows, footer = [], landscape = false, sheet = "Sheet1" }) {
  const n = columns.length, last = col(n - 1);
  const cell = (r, c, v, s) => (v === null || v === undefined || v === "" ? `<c r="${col(c)}${r}" s="${s}"/>`
    : typeof v === "number" ? `<c r="${col(c)}${r}" s="${s}"><v>${v}</v></c>`
    : `<c r="${col(c)}${r}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`);
  const line = (r, values, s, extra = "") => `<row r="${r}"${extra}>${columns.map((_, c) => cell(r, c, values[c], s)).join("")}</row>`;
  let r = 0;
  const out = [];
  out.push(`<row r="${++r}">${cell(r, 0, title, 1)}</row>`);
  out.push(`<row r="${++r}">${cell(r, 0, subtitle, 2)}</row>`);
  const merged = [];
  if (summary.length) { r++; for (const s of summary) { out.push(`<row r="${++r}">${cell(r, 0, s, 0)}</row>`); merged.push(`A${r}:${last}${r}`); } }
  r++; // a blank line under the title, as on Andrew's sheet
  // The header row is as tall as its longest heading wraps to: 32.1 (two lines, as on Andrew's sheet) at least.
  const headLines = Math.max(2, ...columns.map((c) => String(c.head).split("\n").reduce((n, part) => n + Math.max(1, Math.ceil(part.length / ((c.width ?? 16) * 0.95))), 0)));
  out.push(line(++r, columns.map((c) => c.head), 3, ` ht="${Math.max(32.1, headLines * 14.5 + 3).toFixed(1)}" customHeight="1"`));
  const headRow = r;
  for (const row of rows) {
    if (row && !Array.isArray(row) && row.section !== undefined) {
      out.push(`<row r="${++r}" ht="20" customHeight="1">${columns.map((_, c) => cell(r, c, c ? "" : row.section, 7)).join("")}</row>`);
      merged.push(`A${r}:${last}${r}`);
      continue;
    }
    const cells = Array.isArray(row) ? row : row.cells, shade = !Array.isArray(row) && row.shade;
    out.push(`<row r="${++r}">${columns.map((c, i) => cell(r, i, cells[i], c.center ? (shade ? 9 : 8) : (shade ? 6 : 4))).join("")}</row>`);
  }
  for (const row of footer) out.push(line(++r, row, 5));
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${last}${r}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headRow}" topLeftCell="A${headRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="14.4"/>
<cols>${columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 16}" customWidth="1"/>`).join("")}</cols>
<sheetData>${out.join("")}</sheetData>
<mergeCells count="${2 + merged.length}"><mergeCell ref="A1:${last}1"/><mergeCell ref="A2:${last}2"/>${merged.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup orientation="${landscape ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${x(sheet).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'${x(sheet).slice(0, 31).replace(/'/g, "''")}'!$${headRow}:$${headRow}</definedName></definedNames></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: STYLES },
    { name: "xl/worksheets/sheet1.xml", data: sheetXml },
  ];
  return makeZip(files.map((f) => ({ name: f.name, data: Buffer.from(f.data, "utf8") })));
}

/**
 * The first sheet of an .xlsx someone uploads, as rows of plain values (text or numbers; empty cells are ""). Enough
 * for a list like the dietary sheet; formulas come back as their saved result.
 */
export function readXlsx(bytes) {
  const files = new Map(readZip(Buffer.from(bytes)).map((f) => [f.name, f.data.toString("utf8")]));
  const un = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, "&");
  const texts = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => un(m[1])).join("");
  const shared = [...(files.get("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  const rels = files.get("xl/_rels/workbook.xml.rels") ?? "";
  const firstId = (files.get("xl/workbook.xml") ?? "").match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1];
  const target = firstId ? rels.match(new RegExp(`Id="${firstId}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${firstId}"`)) : null;
  const sheetPath = target ? `xl/${(target[1] ?? target[2]).replace(/^\/?xl\//, "")}` : "xl/worksheets/sheet1.xml";
  const sheet = files.get(sheetPath) ?? files.get("xl/worksheets/sheet1.xml");
  if (!sheet) throw new Error("That file has no sheet in it.");
  const colOf = (ref) => [...ref.replace(/\d+$/, "")].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const rows = [];
  for (const [, attrs, body] of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const r = Number(attrs.match(/\br="(\d+)"/)?.[1] ?? rows.length + 1) - 1;
    const row = [];
    for (const [, cattrs, inner] of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = cattrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const type = cattrs.match(/\bt="([^"]+)"/)?.[1];
      const v = inner?.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const value = type === "s" ? shared[Number(v)] ?? "" : type === "inlineStr" ? texts(inner ?? "") : v === undefined ? "" : type === "str" || type === "b" ? un(v) : Number.isFinite(Number(v)) ? Number(v) : un(v);
      row[ref ? colOf(ref) : row.length] = value;
    }
    rows[r] = Array.from(row, (x) => x ?? "");
  }
  return Array.from(rows, (x) => x ?? []);
}
