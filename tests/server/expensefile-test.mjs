// ONGIA Expenses, filing: the Treasurer's folders on SharePoint (against a stand-in drive), ONGIA's Excel template
// filled in (and read back by openpyxl and LibreOffice where they are installed), and the PDF.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const F = REPO + "netlify/functions/";
const E = await import(F + "lib/expensefile.mjs");
const { claimWorkbook } = await import(F + "lib/expensexlsx.mjs");
const { readZip } = await import(F + "lib/zip.mjs");
const exp = (await import(F + "expenses.mjs")).default;
const bg = (await import(F + "expense-file-background.mjs")).default;
const roster = (await import(F + "roster.mjs")).default;
const X = await import(F + "lib/expenses.mjs");
const S = await import(F + "lib/store.mjs");
const { todayIso } = await import(F + "lib/deadlines.mjs");
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const tool = (cmd, args) => { try { return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "ignore"] }).toString(); } catch { return null; } };

console.log("— which folders");
const members = ["Andrew Hammond", "Derek Sullivan", "John Healy", "Peglar Artinian", "Sebastien Pitre", "Steve Hammond", "Tyler Zrymiak"];
ok("a member's own folder, whatever its case", E.memberFolder(members, "john healy") === "John Healy");
ok("Stephen Hammond files in Steve Hammond (same surname and initial), not Andrew's", E.memberFolder(members, "Stephen Hammond") === "Steve Hammond");
ok("someone new gets a folder in their own name", E.memberFolder(members, "Dana Reyes") === "Dana Reyes");
ok("two folders that could be theirs: a new one rather than a guess", E.memberFolder(["Sam Lee", "Sara Lee"], "Stan Lee") === "Stan Lee");
ok("this month as the member already names it", E.monthFolder(["October 2026", "November 2026"], "November 2026") === "November 2026" && E.monthFolder(["10. Oct 2026", "11. Nov 2026"], "November 2026") === "11. Nov 2026" && E.monthFolder(["Nov 2026"], "November 2026") === "Nov 2026");
ok("never last year's November, nor an event folder", E.monthFolder(["November 2025", "Strat Weekend Nov 2026"], "November 2026") === "November 2026");
ok("files are named as the board names theirs; a second claim that month is _2", E.claimStem("John Healy", "November 2026") === "Healy_November_Expense_Claim" && E.claimStem("John Healy", "November 2026", 2) === "Healy_November_Expense_Claim_2");
ok("a receipt is named by its line, date, vendor and amount", E.receiptName(1, { date: "2026-11-09", paidTo: "Delta Hotels", amount: 658.12 }, "file", "image/jpeg") === "01 2026-11-09 Delta Hotels $658.12.jpg" && E.receiptName(4, { date: "2026-11-11", paidTo: "Green P", amount: 18 }, "shot", "image/png") === "04 2026-11-11 Green P card statement.png");

console.log("— who signs where on the form");
const names = (e) => ({ "president@ongia.ca": "Andrew Hammond", "vp_operations@ongia.ca": "Jacqulyn Taylor", "treasurer@ongia.ca": "Raj Jaswal", "executiveofficer@ongia.ca": "Peglar Artinian" }[e] ?? e);
let sg = E.signersOf({ owner: { email: "j.healy@ongia.ca" }, signed_president: { name: "Andrew Hammond", at: "2026-11-14T15:00:00Z" }, signed_vp: { name: "Peglar Artinian", for: "VP of Operations", at: "2026-11-14T18:00:00Z" } }, names);
ok("a member's claim: Andrew and Peglar for Jacqulyn, dated; the Treasurer's row isn't needed", sg.president.label === "A. Hammond" && sg.president.date === "2026-11-14" && sg.vp.label === "P. Artinian for J. Taylor" && sg.vp.for === "VP of Operations" && sg.treasurer.name === "" && sg.treasurer.note === "Not needed for this claim", JSON.stringify(sg));
sg = E.signersOf({ owner: { email: "president@ongia.ca" } }, names);
ok("the President's own claim: their row says so, the VP signs, the Treasurer isn't needed", sg.president.note === "Their own claim" && sg.vp.name === "J. Taylor" && sg.treasurer.name === "" && sg.treasurer.note === "Not needed for this claim");
sg = E.signersOf({ owner: { email: "vp_operations@ongia.ca" } }, names);
ok("the VP's own claim: her row says so, the President signs, the Treasurer isn't needed", sg.vp.note === "Their own claim" && sg.president.name === "A. Hammond" && sg.treasurer.name === "" && sg.treasurer.note === "Not needed for this claim");
sg = E.signersOf({ owner: { email: "j.healy@ongia.ca" }, signed_president: { name: "Andrew Hammond", at: "2026-11-10T15:00:00Z" }, signed_treasurer: { name: "Raj Jaswal", at: "2026-11-10T18:00:00Z" } }, names);
ok("a claim the Treasurer signed under the earlier rules keeps his signature on the form", sg.treasurer.name === "R. Jaswal" && sg.treasurer.note === "" && sg.treasurer.date === "2026-11-10");

console.log("— ONGIA's template, filled in");
const T = await E.readTemplate();
const L = (i) => ({ paidTo: `Vendor ${i}`, date: `2026-11-${String(i).padStart(2, "0")}`, amount: 10 * i, category: ((i - 1) % 10) + 1, purpose: `Purpose ${i}` });
const sheetOf = (buf) => readZip(buf).find((f) => f.name === "xl/worksheets/sheet1.xml").data.toString("utf8");
const bookOf = (buf) => readZip(buf).find((f) => f.name === "xl/workbook.xml").data.toString("utf8");
let wb = claimWorkbook(T, { submittedBy: "Dana Reyes", submitted: "2026-11-13", signers: sg, txn: "CA7Kx2Pq9TmR", paidDate: "2026-11-15", lines: [L(1), L(2), L(3)] });
let xml = sheetOf(wb);
ok("the name, the reference, the dates go in their cells", xml.includes('<c r="C3" s="73" t="inlineStr"><is><t xml:space="preserve">Dana Reyes</t>') && xml.includes(">CA7Kx2Pq9TmR<") && /<c r="G3" s="\d+"><v>46339<\/v>/.test(xml));
ok("three lines, the rest of the eight left blank, the total of all eight", (xml.match(/<row r="1[2-9]"/g) ?? []).length === 8 && xml.includes("<f>SUM(E12:E19)</f><v>60</v>") && /<c r="B13" s="61" t="inlineStr"><is><t xml:space="preserve">Vendor 2</);
// (The quotation marks inside a formula are written as &quot;, which Excel reads as the same formula.)
ok("HST is the tax inside the amount, and the category the template's formula, with their results", xml.includes('<f>IF(E12=&quot;&quot;,&quot;&quot;,ROUND(E12*13/113,2))</f><v>1.15</v>') && xml.includes('<f>IFERROR(VLOOKUP(G12,$A$24:$B$33,2,FALSE),&quot;&quot;)</f><v>Advertising &amp; Promotion</v>'));
ok("it prints one page wide, landscape", xml.includes('<pageSetUpPr fitToPage="1"/>') && xml.includes('fitToWidth="1" fitToHeight="0"'));
ok("the instructions say the VP fills in the payment", xml.includes("Filled in by the VP at time of payment."));
const rowsWellFormed = (s) => (s.match(/<row\b(?:[^>/]|\/(?!>))*\/>/g) ?? []).length + (s.match(/<\/row>/g) ?? []).length === (s.match(/<row\b/g) ?? []).length;
ok("every row is whole", rowsWellFormed(xml));
wb = claimWorkbook(T, { submittedBy: "Dana Reyes", submitted: "2026-11-13", signers: {}, lines: Array.from({ length: 11 }, (_, i) => L(i + 1)) });
xml = sheetOf(wb);
ok("eleven lines: three more rows, and the total, the table and every reference to it move down", xml.includes("<f>SUM(E12:E22)</f>") && xml.includes("VLOOKUP(G22,$A$27:$B$36,2,FALSE)") && xml.includes('<mergeCell ref="B22:C22"/>') && xml.includes('sqref="G12:G22"') && xml.includes(">5. Total (E23) auto-sums all amounts.<") && bookOf(wb).includes("Sheet1!$A$1:$I$23"));
ok("…the category table's own rows are there, below", /<row r="27"[^>]*>.*?<v>1<\/v>.*?<\/row>/s.test(xml) && /<row r="36"[^>]*>.*?<v>10<\/v>/s.test(xml));
ok("…and every row is still whole (the template has hundreds of empty short rows)", rowsWellFormed(xml));
const dir = mkdtempSync(path.join(tmpdir(), "xl-"));
writeFileSync(path.join(dir, "c.xlsx"), wb);
const py = tool("python3", ["-I", "-c", `import openpyxl;ws=openpyxl.load_workbook(${JSON.stringify(path.join(dir, "c.xlsx"))}).active;print(ws['B22'].value,'|',ws['E23'].value,'|',ws['B36'].value,'|',ws['A47'].value)`]);
if (py !== null) ok("openpyxl opens it and finds line 11, the total, the table and the instructions where they should be", py.trim() === "Vendor 11 | =SUM(E12:E22) | Speaker Stipend | 6. Category reference table: See A26:B36 for the 10 valid category codes.", py);
else console.log("  (openpyxl isn't installed here, so the workbook wasn't opened by Python)");
if (tool("soffice", ["--version"]) !== null) {
  tool("soffice", ["--headless", "--calc", "--convert-to", "pdf", "--outdir", dir, path.join(dir, "c.xlsx")]);
  const txt = tool("pdftotext", ["-layout", path.join(dir, "c.pdf"), "-"]) ?? "";
  ok("LibreOffice opens it: the title, line 11 and the total of $660.00", /ONGIA Expense Reimbursement Submission/.test(txt) && /Vendor 11/.test(txt) && /\$660\.00/.test(txt), txt.slice(0, 400));
} else console.log("  (LibreOffice isn't installed here, so the workbook wasn't opened by it)");

console.log("— the PDF");
const img = readFileSync(REPO + "tests/ui/receipt1.jpg");
const lines = [{ id: "l1", kind: "receipt", paidTo: "Delta Hotels", date: "2026-11-09", amount: 658.12, category: 8, purpose: "Hotel, 3 nights", file: { type: "image/jpeg" } },
  { id: "l2", kind: "mileage", paidTo: "Dana Reyes", date: "2026-11-08", amount: 193.44, category: 8, purpose: "Drive", km: 312, rate: 0.62, from: "Barrie", to: "Toronto" },
  { id: "l3", kind: "noreceipt", paidTo: "Green P", date: "2026-11-11", amount: 18, category: 8, purpose: "Parking", statement: "No receipt from the machine.", shot: { type: "image/png" } }];
const claim = { id: "abc-1", owner: { name: "Dana Reyes", email: "d.reyes@ongia.ca" }, month: "November 2026", status: "submitted", submittedAt: "2026-11-13T15:00:00Z" };
const getFile = async (kind, id) => (id === "l1" && kind === "file" ? { bytes: img, type: "image/jpeg" } : id === "l3" && kind === "shot" ? { bytes: readFileSync(REPO + "public/assets/expenses-icon-192.png"), type: "image/png" } : null);
const docs = await E.claimDocuments({ claim, lines, names, checks: { ok: true, summary: ["The receipt matches what's claimed"], notes: [] }, getFile });
writeFileSync(path.join(dir, "claim.pdf"), docs.pdf);
const ptxt = tool("pdftotext", ["-layout", path.join(dir, "claim.pdf"), "-"]);
if (ptxt !== null) {
  ok("the PDF: the claim, the lines in date order, the total", /ONGIA Expense Reimbursement Submission/.test(ptxt) && ptxt.indexOf("Dana Reyes") < ptxt.indexOf("Delta Hotels") && /\$869\.56/.test(ptxt), ptxt.slice(0, 600));
  ok("…then a page for the receipt and one for the card statement, numbered as on the claim", (tool("pdfinfo", [path.join(dir, "claim.pdf")]) ?? "").includes("Pages:           3") && /Line 2: receipt/.test(ptxt) && /Line 3: card statement/.test(ptxt));
}
// Andrew, 3 Nov 2026: no HST on mileage or a stipend; on anything bought, the tax inside the total (× 13 ÷ 113).
if (ptxt !== null) ok("the PDF's HST: $75.71 inside the hotel's $658.12, $2.07 inside the $18 parking, $0.00 on the mileage", /\$658\.12\s+\$75\.71/.test(ptxt) && /\$18\.00\s+\$2\.07/.test(ptxt) && /\$193\.44\s+\$0\.00/.test(ptxt), ptxt.slice(0, 900));
{
  const sx = sheetOf(docs.xlsx);
  ok("the Excel sheet: the mileage line's HST is 0, the others the formula", /<c r="F12" s="\d+"><v>0<\/v><\/c>/.test(sx) && sx.includes('ROUND(E13*13/113,2))</f><v>75.71</v>') && sx.includes('ROUND(E14*13/113,2))</f><v>2.07</v>'), sx.match(/<c r="F1[2-4]"[^]*?<\/c>/g)?.join(" "));
  ok("a speaker stipend has no HST either, and Food Basics' $61.77 has $7.11 in it", X.hstOf({ kind: "noreceipt", category: 10, amount: 1000 }) === 0 && X.hstOf({ kind: "mileage", amount: 279 }) === 0 && X.hstOf({ kind: "receipt", category: 5, amount: 61.77 }) === 7.11 && X.hstOf({ kind: "noreceipt", category: 5, amount: 458.74 }) === 52.78);
}
ok("the receipts to file, named by their line on the form", docs.receipts.map((r) => r.name).join("|") === "02 2026-11-09 Delta Hotels $658.12.jpg|03 2026-11-11 Green P card statement.png");

console.log("— filing, against a stand-in SharePoint");
const drive = () => {
  const items = new Map(); let n = 0;
  const parent = (p) => p.split("/").slice(0, -1).join("/");
  const d = {
    items, puts: [], removed: [],
    async children(folder) { if (![...items.values()].some((i) => i.folder && i.path === folder)) return null; return [...items.values()].filter((i) => parent(i.path) === folder); },
    async ensure(folder) { let built = ""; for (const seg of folder.split("/")) { built = built ? `${built}/${seg}` : seg; if (![...items.values()].some((i) => i.path === built)) items.set(`f${++n}`, { id: `f${n}`, path: built, name: seg, folder: {}, webUrl: `https://sp/${built}` }); } return [...items.values()].find((i) => i.path === folder); },
    async put(file, bytes, type) { d.puts.push(file); const had = [...items.values()].find((i) => i.path === file); const id = had?.id ?? `i${++n}`; items.set(id, { id, path: file, name: file.split("/").at(-1), file: {}, size: bytes.length, type, webUrl: `https://sp/${file}` }); return items.get(id); },
    async remove(id) { d.removed.push(id); items.delete(id); },
  };
  return d;
};
const base = E.expenseFolder();
const g = drive();
for (const m of members) await g.ensure(`${base}/2026/${m}`);
await g.ensure(`${base}/2026/Steve Hammond/October 2026`);
const steve = { ...claim, owner: { name: "Stephen Hammond", email: "s.hammond@ongia.ca" } };
let filed = await E.fileClaim({ claim: steve, docs, drive: g });
ok("filed under 2026 › Steve Hammond › a new November 2026 folder", filed.folder === `${base}/2026/Steve Hammond/November 2026` && filed.folderUrl.endsWith("/November 2026"));
ok("the Excel and the PDF, named as the board names theirs", filed.xlsx.name === "Hammond_November_Expense_Claim.xlsx" && filed.pdf.name === "Hammond_November_Expense_Claim.pdf");
ok("the receipts in a Receipts folder beside them", Object.values(filed.receipts).map((r) => r.name).sort().join("|") === "02 2026-11-09 Delta Hotels $658.12.jpg|03 2026-11-11 Green P card statement.png" && g.puts.some((p) => p.endsWith("/November 2026/Receipts/02 2026-11-09 Delta Hotels $658.12.jpg")));
g.puts.length = 0;
const again = await E.fileClaim({ claim: { ...steve, status: "paid" }, docs, prev: filed, drive: g });
ok("filed again (approved, paid): the same two files replaced, the receipts not sent twice", g.puts.length === 2 && again.xlsx.id === filed.xlsx.id && again.stem === filed.stem && g.removed.length === 0);
const fewer = await E.claimDocuments({ claim, lines: [lines[0], lines[1]], names, checks: null, getFile });
const third = await E.fileClaim({ claim: steve, docs: fewer, prev: again, drive: g });
ok("a line taken off after it was sent back: its card statement comes out of the folder (the desk's own copy only)", g.removed.length === 1 && Object.keys(third.receipts).length === 1);
const other = await E.fileClaim({ claim: { ...steve, id: "abc-2" }, docs, drive: g });
ok("a second claim the same month doesn't overwrite the first: _2", other.xlsx.name === "Hammond_November_Expense_Claim_2.xlsx" && other.folder === third.folder);
const t = await E.fileClaim({ claim: { ...claim, test: true }, docs, drive: g });
ok("a test claim goes under Test claims (safe to delete), never a member's folder", t.folder === `${base}/Test claims (safe to delete)/Dana Reyes/November 2026`);
const before = g.items.size;
ok("deleting it takes out exactly its files", (await E.unfileClaim(t, g)) === 4 && g.items.size === before - 4);
ok("without Microsoft set up, nothing is filed and it says so", (await E.fileClaim({ claim, docs })).skipped === true);

console.log("— the filing job, in the app");
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
await roster(new Request("http://localhost/api/roster", { headers: H }));
const who = { "x-expense-key": X.issueExpenseSession({ email: "j.healy@ongia.ca", name: "John Healy" }), "content-type": "application/json" };
const PRES = { "x-expense-key": X.issueExpenseSession({ email: "president@ongia.ca", name: "Andrew Hammond" }), "content-type": "application/json" };
const call = async (url, method = "GET", body, headers = who) => { const r = await exp(new Request("http://localhost" + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })); return { status: r.status, ...(await r.json()) }; };
const m = await call("/api/expenses?add=mileage", "POST", { date: todayIso(new Date(Date.now() - 3 * 86400e3)), from: "Barrie", to: "Toronto", km: 100, purpose: "Drive" });
await call(`/api/expenses?submit=${m.claim.id}`, "POST", {});
ok("sending starts the filing (in-process there's no Netlify to start it, so the claim says so, for the officers)", /didn't start/.test((await S.getClaim(m.claim.id)).filed?.problem ?? ""));
await bg(new Request(`http://localhost/api/expense-file-background?claim=${m.claim.id}`, { method: "POST", headers: H }));
let v = (await call(`/api/expenses?claim=${m.claim.id}`, "GET", undefined, PRES)).claim;
ok("the job ran: here, with no Microsoft set up, the claim says it wasn't filed and why", v.filed.skipped === true && /Microsoft isn't set up/.test(v.filed.reason) && v.can.refile === true);
ok("John can't press File it again; an officer can", (await call(`/api/expenses?refile=${m.claim.id}`, "POST", {})).status === 403 && (await call(`/api/expenses?refile=${m.claim.id}`, "POST", {}, PRES)).status === 202);
ok("the job refuses anyone without the desk key", (await bg(new Request(`http://localhost/api/expense-file-background?claim=${m.claim.id}`, { method: "POST" }))).status === 401);

{ // Comments (Andrew 5 Nov 2026): optional; kept, carried to the claim form, and not lost when a save leaves them out.
  const { cleanLine } = await import(F + "lib/expenses.mjs");
  const c = cleanLine("receipt", { paidTo: "Staples", amount: 20, category: 5, purpose: "Name tags", comment: "Ran out of name tags on day two, bought more for the registration desk." });
  ok("a comment is kept with the line", c.comment === "Ran out of name tags on day two, bought more for the registration desk.");
  ok("a save that doesn't send the comment keeps it", cleanLine("receipt", { paidTo: "Staples", amount: 20 }, { had: c }).comment === c.comment && cleanLine("receipt", { comment: "" }, { had: c }).comment === "");
  ok("no comment is fine: nothing is asked for", cleanLine("receipt", { paidTo: "X", amount: 1, category: 5, purpose: "Y" }).comment === "");
  ok("the claim form shows the comment after what it was for", E.purposeOf({ kind: "receipt", ...c }) === "Name tags Comment: Ran out of name tags on day two, bought more for the registration desk.");
}
ok("on the claim form a stipend says it needs no receipt", E.purposeOf({ kind: "noreceipt", category: 10, purpose: "Speaker stipend" }) === "Speaker stipend (speaker stipend: no receipt needed)" && /reason and card statement attached/.test(E.purposeOf({ kind: "noreceipt", category: 8, purpose: "Parking" })));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
