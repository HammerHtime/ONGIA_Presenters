import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { expenseDrive, normaliseFolder } from "./graph.mjs";
import { safeFileName } from "./ids.mjs";
import { todayIso } from "./deadlines.mjs";
import { claimWorkbook } from "./expensexlsx.mjs";
import { claimPdf } from "./expensepdf.mjs";
import { officers, approversFor, roleOf, OFFICER_ROLES, ROLE_TITLE, isStipend, noHst } from "./expenses.mjs";
import { lastFirst } from "./filenames.mjs";

/**
 * Filing a claim in the Treasurer's folders on SharePoint (Andrew, 2 Nov 2026):
 *
 *   ONGIA Board › Treasurer (2025-2026) (New) › Board Members Expenses › 2026 › John Healy › November 2026 ›
 *     Healy_November_Expense_Claim.xlsx   (ONGIA's template, filled in)
 *     Healy_November_Expense_Claim.pdf    (the same, with each receipt on a page)
 *     Receipts › 01 2026-11-09 Delta Hotels $658.12.jpg, …
 *
 * The year, member and month folders are made when missing; an existing one is used as it is already named ("Steve
 * Hammond" for Stephen Hammond, "11. Nov 2026" for November 2026). Filed when the claim is sent, and filed again (the
 * same two files replaced) when it is approved, paid or unlocked, so the folder always holds the claim as it stands.
 * Test claims go under "Test claims (safe to delete)" instead, and deleting them deletes their files.
 * EXPENSE_FOLDER replaces the base folder when the Treasurer's folder moves to a new year.
 */
export const expenseFolder = () => normaliseFolder(process.env.EXPENSE_FOLDER || "ONGIA Board/Treasurer (2025-2026) (New)/Board Members Expenses");
export const TEST_FOLDER = "Test claims (safe to delete)";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
/** The member's folder among those already there: the same name, else one with the same surname and first initial. */
export function memberFolder(existing, name) {
  const exact = existing.find((n) => norm(n) === norm(name));
  if (exact) return exact;
  const parts = String(name).trim().split(/\s+/);
  if (parts.length < 2) return name;
  const same = existing.filter((n) => { const p = String(n).trim().split(/\s+/); return p.length >= 2 && norm(p.at(-1)) === norm(parts.at(-1)) && p[0][0]?.toLowerCase() === parts[0][0]?.toLowerCase(); });
  return same.length === 1 ? same[0] : name;
}
/** This month's folder as the member already names it ("November 2026", "Nov 2026", "11. Nov 2026"), else "November 2026". */
export function monthFolder(existing, label) {
  const [m, y] = String(label).split(" ");
  const i = MONTHS.indexOf(m);
  if (i < 0) return label;
  const re = new RegExp(`^(?:0?${i + 1}\\s*[.)-]?\\s*)?(?:${m}|${m.slice(0, 3)})\\.?,?\\s+${y}$`, "i");
  return existing.find((n) => re.test(String(n).trim())) ?? label;
}
/**
 * "Healy John - Expense claim - November 2026", last name first like every other file the desk names (Andrew 16 Nov
 * 2026: "make the change, keep old ones as is"); a second claim in the same month gets " (2)". A claim already filed
 * keeps the name it was filed under (fileClaim reuses prev.stem), so the old "Healy_November_Expense_Claim" ones stay.
 */
export function claimStem(ownerName, month, n = 1) {
  const who = safeFileName(lastFirst({ name: ownerName }) || "Member", "Member");
  return `${who} - Expense claim - ${String(month ?? "").trim()}${n > 1 ? ` (${n})` : ""}`;
}
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf" };
/** The end of a receipt's name: the merchant and the amount, "Delta Hotels $658.12.jpg" (a card statement says so). */
export function receiptName(index, line, kind, type) {
  const what = kind === "shot" ? "card statement" : `$${(Number(line.amount) || 0).toFixed(2)}`;
  return `${safeFileName(String(line.paidTo || "receipt").slice(0, 60), "receipt")} ${what}.${EXT[type] ?? "bin"}`.replace(/\s+/g, " ");
}
/**
 * What a receipt's name starts with: the last name and which claim, "Healy - Nov 2026 claim", and "(2)" for a second
 * claim that month (Andrew 16 Nov 2026: "name the receipts … to correspond to which claim and last name and merchant").
 */
export function receiptPrefix(ownerName, month, stem = "") {
  const last = safeFileName(lastFirst({ name: ownerName }).split(" ")[0] || "Member", "Member");
  const [m, y] = String(month ?? "").split(" ");
  const n = Number(String(stem).match(/\((\d+)\)$/)?.[1] ?? String(stem).match(/_(\d+)$/)?.[1] ?? 1);
  return `${last} - ${m ? m.slice(0, 3) : ""} ${y ?? ""} claim${n > 1 ? ` (${n})` : ""}`.replace(/\s+/g, " ");
}
/** Each receipt's full name in its claim's folder, "Healy - Nov 2026 claim - Delta Hotels $658.12.jpg"; two alike get (2). */
export function receiptNames(claim, stem, receipts) {
  const pre = receiptPrefix(claim.owner?.name, claim.month, stem), seen = new Map(), out = {};
  for (const r of receipts) {
    let name = `${pre} - ${r.name}`;
    const k = name.toLowerCase(), n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    if (n > 1) name = name.replace(/(\.[a-z0-9]+)$/i, ` (${n})$1`);
    out[`${r.line.id}:${r.kind}`] = name;
  }
  return out;
}

/** The lines in the order the claim form lists them: by date, then as they were added. */
export const formOrder = (lines) => [...lines].sort((a, b) => String(a.date || "9").localeCompare(String(b.date || "9")) || String(a.addedAt).localeCompare(String(b.addedAt)));

/** "A. Hammond" from "Andrew Hammond". */
const short = (name) => { const p = String(name ?? "").trim().split(/\s+/); return p.length > 1 ? `${p[0][0]}. ${p.slice(1).join(" ")}` : String(name ?? ""); };

/** Who signs where on the form: each officer's row, the name that signed it (a stand-in "for" the officer), and when. */
export function signersOf(claim, names) {
  const o = officers();
  const owner = String(claim.owner?.email ?? "").toLowerCase();
  const need = approversFor(owner);
  const out = {};
  for (const role of OFFICER_ROLES) {
    const s = claim[`signed_${role}`];
    const officer = short(names(o[role]));
    out[role] = {
      title: role === "vp" ? "VP" : ROLE_TITLE[role],
      label: s ? (s.for ? `${short(s.name)} for ${officer}` : short(s.name)) : officer,
      // A claim signed under the earlier rules keeps the signature it has.
      name: need.includes(role) || s ? (s ? short(s.name) : officer) : "",
      for: s?.for ? ROLE_TITLE[role] : "",
      date: s?.at ? todayIso(new Date(s.at)) : null,
      note: need.includes(role) || s ? "" : roleOf(owner) === role ? "Their own claim" : "Not needed for this claim",
    };
  }
  return out;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSET_DIRS = [path.resolve(HERE, "../../../public/assets"), path.resolve(HERE, "../../public/assets"), path.resolve(process.cwd(), "public/assets"), "/var/task/public/assets"];
const ASSETS = ASSET_DIRS.find((d) => existsSync(path.join(d, "expense-claim-template.xlsx"))) ?? ASSET_DIRS[0];
export const readTemplate = () => readFile(path.join(ASSETS, "expense-claim-template.xlsx"));

/**
 * The Excel and the PDF for a claim as it stands. `getFile(kind, lineId)` gives a line's receipt ("file") or card
 * statement ("shot"); `checks` is Claude's check as the approvers saw it.
 */
export async function claimDocuments({ claim, lines, names, checks, getFile }) {
  const ordered = formOrder(lines);
  const signers = signersOf(claim, names);
  const xlsx = claimWorkbook(await readTemplate(), {
    submittedBy: claim.owner?.name ?? "", submitted: claim.submittedAt ? todayIso(new Date(claim.submittedAt)) : todayIso(),
    signers, txn: claim.paid?.ref ?? "", paidDate: claim.paid?.date ?? "",
    lines: ordered.map((l) => ({ paidTo: l.paidTo, date: l.date, amount: l.amount, category: l.category, purpose: purposeOf(l), noHst: noHst(l) })),
  });
  const receipts = [];
  for (const [i, l] of ordered.entries()) {
    if (l.kind === "receipt" && l.file) { const f = await getFile("file", l.id); if (f) receipts.push({ index: i + 1, line: l, bytes: f.bytes, type: f.type, kind: "receipt", name: receiptName(i + 1, l, "file", f.type) }); }
    if (l.kind === "noreceipt" && l.shot) { const f = await getFile("shot", l.id); if (f) receipts.push({ index: i + 1, line: l, bytes: f.bytes, type: f.type, kind: "shot", name: receiptName(i + 1, l, "shot", f.type) }); }
  }
  const pdf = await claimPdf({ claim, signers: OFFICER_ROLES.map((r) => signers[r]), lines: ordered, checks, receipts });
  return { xlsx, pdf, receipts };
}
/** What goes in the template's Purpose column: what it was for, the event, and for mileage the trip. */
export function purposeOf(l) {
  return [l.purpose, l.eventTitle && l.eventTitle !== l.purpose ? `(${l.eventTitle})` : "",
    l.kind === "mileage" ? `${l.km} km at $${Number(l.rate).toFixed(2)}/km${l.from || l.to ? `, ${l.from} to ${l.to}` : ""}` : "",
    l.kind === "noreceipt" ? (isStipend(l) ? "(stipend: no receipt needed)" : "(no receipt: reason and card statement attached)") : "",
    l.comment ? `Comment: ${l.comment}` : ""].filter(Boolean).join(" ");
}

/** A claim filed under the old names ("Healy_November_Expense_Claim", "…_2"). */
export const oldStem = (stem) => /_Expense_Claim(_\d+)?$/.test(String(stem ?? ""));

/**
 * Give a claim filed under the old names the new ones (Andrew 16 Nov 2026: "are you able to change the naming convention
 * for the current ones"): its Excel and PDF renamed where they are in SharePoint, and the claim's record changed to
 * match, so filing it again replaces those files rather than making a second pair. A second claim that month ("_2")
 * becomes "(2)"; if that name is taken in the folder, the next number. With `dry`, says what it would do.
 */
export async function renameFiled(claim, { drive = null, dry = false } = {}) {
  const f = claim?.filed;
  if (!f?.stem || !oldStem(f.stem)) return null;
  let n = Number(f.stem.match(/_(\d+)$/)?.[1] ?? 1);
  const g = dry ? null : drive ?? (await expenseDrive());
  if (!dry && !g) throw new Error("Microsoft isn't set up on this site.");
  for (let tries = 0; tries < 10; tries++, n++) {
    const stem = claimStem(claim.owner?.name, claim.month, n);
    if (dry) return { from: f.stem, to: stem, folder: f.folder };
    try {
      const x = f.xlsx?.id ? await g.rename(f.xlsx.id, `${stem}.xlsx`) : null;
      let p = null;
      try { p = f.pdf?.id ? await g.rename(f.pdf.id, `${stem}.pdf`) : null; }
      catch (e) { if (x) await g.rename(f.xlsx.id, `${f.stem}.xlsx`).catch(() => {}); throw e; }
      return { from: f.stem, to: stem, folder: f.folder, filed: { ...f, stem,
        xlsx: x ? { ...f.xlsx, name: x.name, url: x.webUrl ?? f.xlsx.url } : f.xlsx, pdf: p ? { ...f.pdf, name: p.name, url: p.webUrl ?? f.pdf.url } : f.pdf } };
    } catch (e) {
      if (e.status === 409 || e.code === "nameAlreadyExists") continue;
      // Gone from SharePoint (moved or deleted by hand): nothing to rename, and the record is left as it was.
      if (e.status === 404) return { from: f.stem, to: null, folder: f.folder, missing: true };
      throw e;
    }
  }
  throw new Error(`Every name for ${f.stem} is taken in its folder.`);
}

/**
 * A filed claim's receipts given their new names where they are (Andrew 16 Nov 2026), from the claim's own lines, and
 * the record changed to match. Returns { changes: [{ from, to }], filed } (with `dry`, what it would do). A receipt gone
 * from SharePoint is left out of the record, so filing the claim again puts it back.
 */
export async function renameReceipts(claim, lines, { drive = null, dry = false } = {}) {
  const f = claim?.filed;
  if (!f?.receipts || !Object.keys(f.receipts).length) return { changes: [], filed: f };
  const items = [];
  for (const [i, l] of formOrder(lines).entries()) {
    for (const kind of ["receipt", "shot"]) {
      const had = f.receipts[`${l.id}:${kind}`];
      if (!had) continue;
      const ext = String(had.name).match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "bin";
      const type = Object.entries(EXT).find(([, e]) => e === ext)?.[0] ?? "";
      items.push({ line: l, kind, had, name: receiptName(i + 1, l, kind === "shot" ? "shot" : "file", type).replace(/\.bin$/, `.${ext}`) });
    }
  }
  const named = receiptNames(claim, f.stem, items);
  const changes = [], receipts = { ...f.receipts };
  const g = dry ? null : drive ?? (await expenseDrive());
  for (const it of items) {
    const key = `${it.line.id}:${it.kind}`, to = named[key];
    if (it.had.name === to) continue;
    changes.push({ from: it.had.name, to });
    if (dry) continue;
    try { const r = await g.rename(it.had.id, to); receipts[key] = { ...it.had, name: r.name ?? to, url: r.webUrl ?? it.had.url }; }
    catch (e) { if (e.status === 404) { delete receipts[key]; continue; } throw e; }
  }
  return { changes, filed: { ...f, receipts } };
}

/**
 * Put the claim in its folder. `prev` is what was filed before (claim.filed): the same folders and names are used
 * again, the Excel and PDF replaced, receipts added for new lines, and the desk's own copies of receipts for lines
 * that have gone (or been renumbered) deleted. Returns the new filed record. Throws on a real failure.
 */
export async function fileClaim({ claim, docs, prev = null, drive = null }) {
  const g = drive ?? (await expenseDrive());
  if (!g) return { skipped: true, reason: "Microsoft isn't set up on this site, so nothing could be filed.", at: new Date().toISOString() };
  const base = expenseFolder();
  // A board-test claim (Andrew 3 Nov 2026) is filed with the test claims, never in the year's real folders.
  const root = claim.test || claim.trial ? `${base}/${TEST_FOLDER}` : `${base}/${String(claim.month).split(" ")[1]}`;
  const folderNames = async (p) => ((await g.children(p)) ?? []).filter((k) => k.folder).map((k) => k.name);
  const member = prev?.member ?? memberFolder(await folderNames(root), claim.owner?.name ?? "Member");
  const month = prev?.month ?? monthFolder(await folderNames(`${root}/${member}`), claim.month);
  const folder = `${root}/${member}/${month}`;
  const dir = await g.ensure(folder);
  let stem = prev?.stem;
  if (!stem) {
    const taken = new Set(((await g.children(folder)) ?? []).map((k) => k.name.toLowerCase()));
    for (let n = 1; !stem; n++) if (!taken.has(`${claimStem(claim.owner?.name, claim.month, n)}.xlsx`.toLowerCase())) stem = claimStem(claim.owner?.name, claim.month, n);
  }
  const x = await g.put(`${folder}/${stem}.xlsx`, docs.xlsx, XLSX);
  const p = await g.put(`${folder}/${stem}.pdf`, docs.pdf, "application/pdf");
  const had = { ...(prev?.receipts ?? {}) }, now = {};
  if (docs.receipts.length) await g.ensure(`${folder}/Receipts`);
  const named = receiptNames(claim, stem, docs.receipts);
  for (const r of docs.receipts) {
    const key = `${r.line.id}:${r.kind}`;
    if (had[key]?.name === named[key]) { now[key] = had[key]; delete had[key]; continue; }
    if (had[key]?.id) { await g.remove(had[key].id); delete had[key]; }
    const it = await g.put(`${folder}/Receipts/${named[key]}`, r.bytes, r.type);
    now[key] = { id: it.id, name: it.name, url: it.webUrl };
  }
  for (const gone of Object.values(had)) if (gone?.id) await g.remove(gone.id);
  return {
    at: new Date().toISOString(), status: claim.status, member, month, folder, folderUrl: dir?.webUrl ?? "", stem,
    xlsx: { id: x.id, name: x.name, url: x.webUrl }, pdf: { id: p.id, name: p.name, url: p.webUrl }, receipts: now,
  };
}

/** Take a claim's files out again (a test claim deleted, or a claim withdrawn): only the files the desk put there. */
export async function unfileClaim(filed, drive = null) {
  if (!filed || filed.skipped) return 0;
  const g = drive ?? (await expenseDrive());
  if (!g) return 0;
  const ids = [filed.xlsx?.id, filed.pdf?.id, ...Object.values(filed.receipts ?? {}).map((r) => r?.id)].filter(Boolean);
  for (const id of ids) await g.remove(id);
  return ids.length;
}
