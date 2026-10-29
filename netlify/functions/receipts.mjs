import { json, fail, requireAdmin, adminWho, fileName, text } from "./lib/http.mjs";
import { mayCost } from "./lib/auth.mjs";
import { token } from "./lib/ids.mjs";
import { getEvent, getSow, putSow, getRoster, getReceipts, putReceipts, putReceiptFile, getReceiptFile, deleteReceiptFile, getReceiptRead, putReceiptRead, deleteReceiptRead } from "./lib/store.mjs";
import { MAX_BYTES, TYPES, OTHER, cleanConfirm, receiptSums, isDuplicate, payerChoices, paidByPerson } from "./lib/receipts.mjs";
import { STATUSES } from "./lib/sow.mjs";
import { anthropicKey } from "./lib/contract.mjs";
import { fileEventDocument, RECEIPTS_FOLDER } from "./lib/graph.mjs";

/**
 * Receipts for an RBH event. Who: the president and the VP on every event, and the board members attached to
 * the event on that event (the lead included). Everyone else is refused. Board members see their event's
 * receipts and the names of the SOW's lines, never the SOW's amounts: only the president and the VP see those.
 *
 *   GET    /api/receipts?event=…                    receipts, pending uploads (with what Claude read), and the lines to pick from
 *   GET    /api/receipts?event=…&file=<id>          the photo or PDF
 *   POST   /api/receipts?event=…                    upload (body = the file); starts the reading, answers with the pending one
 *   POST   /api/receipts?event=…&again=<id>         read a pending one again
 *   POST   /api/receipts?event=…&confirm=<id>       keep it: { lineId, otherNote, vendor, date, amount, tax, total, currency, force }
 *   PUT    /api/receipts?event=…&item=<id>          change a kept one
 *   DELETE /api/receipts?event=…&item=<id> | &draft=<id>
 *   POST   /api/receipts?event=…&refile=<id>        put a kept one in the SharePoint "Receipts" folder again
 *
 * Claude only ever fills in the boxes; nothing counts toward the invoice until a person has confirmed it.
 */
const STALE_MS = 5 * 60 * 1000;

/** What the file really is, from its first bytes, whatever the browser called it. */
export function sniff(b) {
  const s = (from, to) => String.fromCharCode(...b.slice(from, to));
  if (s(0, 5) === "%PDF-") return "application/pdf";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && s(1, 4) === "PNG") return "image/png";
  if (s(0, 4) === "GIF8") return "image/gif";
  if (s(0, 4) === "RIFF" && s(8, 12) === "WEBP") return "image/webp";
  return null;
}

const mine = (r, who) => who.key === true || (r.addedBy?.email && r.addedBy.email === String(who.email ?? "").toLowerCase());
const publicItem = (r) => { const { ...x } = r; return x; };

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const who = adminWho(req);
  const url = new URL(req.url);
  const id = url.searchParams.get("event");
  const event = id && (await getEvent(id));
  if (!event) return fail("No such event.", 404);
  if (event.kind !== "rbh") return fail("Receipts are kept for RBH events only.", 409);
  const email = String(who.email ?? "").toLowerCase();
  const costs = mayCost(who);
  const onBoard = !!email && (event.board ?? []).some((m) => String(m.email ?? "").toLowerCase() === email);
  if (!costs && !onBoard) return fail("Receipts for an RBH event are for the board members on that event, the president and the VP of operations.", 403);
  const q = (k) => url.searchParams.get(k);
  const who2 = { name: who.name || who.email || "", email };
  const sow = await getSow(id);
  const closed = !costs && !!sow && STATUSES.indexOf(sow.status) >= STATUSES.indexOf("invoiced");

  if (req.method === "GET" && q("file")) {
    const f = await getReceiptFile(id, q("file"));
    if (!f) return fail("That file is not on record.", 404);
    return new Response(f.bytes, { headers: { "content-type": f.type, "content-disposition": `inline; filename="${f.name.replace(/[^\w.\- ]+/g, "_")}"`, "cache-control": "no-store" } });
  }
  if (req.method === "GET") return json(await view(id, sow, costs, who, event));

  if (req.method === "POST" && q("again")) {
    const rec = await getReceipts(id);
    const d = rec.drafts.find((x) => x.id === q("again"));
    if (!d) return fail("That upload is no longer pending.", 404);
    return start(req, id, d, url.origin, sow, costs, who, event);
  }

  if (req.method === "POST" && q("confirm")) {
    const rec = await getReceipts(id);
    const d = rec.drafts.find((x) => x.id === q("confirm"));
    if (!d) return fail("That upload is no longer pending. Reload and look again.", 404);
    if (closed) return fail("The invoice has gone out, so only the president or the VP can add receipts now.", 403);
    const body = await req.json().catch(() => null);
    const ok = cleanConfirm(body, (sow?.lines ?? []).map((l) => l.id), payerChoices(event, await getRoster(), rec.items));
    if (ok.problem) return fail(ok.problem);
    const c = ok.ok;
    if (!body.force && isDuplicate(rec.items, c)) return fail("This looks like a receipt already on this event: same vendor, date and total. If it really is another one, confirm it again.", 409);
    const read = await getReceiptRead(id, d.id);
    const item = { id: d.id, ...c, name: d.name, type: d.type, size: d.size, addedBy: d.by, addedAt: d.at, confirmedAt: new Date().toISOString(), confirmedBy: who2, readBy: read?.state === "done" ? "claude" : "hand" };
    const lineName = c.lineId === OTHER ? "Other" : sow.lines.find((l) => l.id === c.lineId)?.name;
    await filed(event, item, lineName);
    rec.items.push(item);
    rec.drafts = rec.drafts.filter((x) => x.id !== d.id);
    await putReceipts(id, rec);
    await deleteReceiptRead(id, d.id);
    return json(await view(id, sow, costs, who, event), 201);
  }

  if (req.method === "POST" && q("refile")) {
    const rec = await getReceipts(id);
    const item = rec.items.find((x) => x.id === q("refile"));
    if (!item) return fail("No such receipt.", 404);
    await filed(event, item, item.lineId === OTHER ? "Other" : sow?.lines.find((l) => l.id === item.lineId)?.name);
    await putReceipts(id, rec);
    return json(await view(id, sow, costs, who, event));
  }

  if (req.method === "POST") {
    const buffer = await req.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (!bytes.length) return fail("That file was empty.");
    if (bytes.length > MAX_BYTES) return fail("That file is over 5 MB. Take the photo again at a lower size, or save a smaller PDF.", 413);
    const type = sniff(bytes);
    if (!type || !TYPES[type]) return fail("That kind of file can't be read. Use a photo (JPEG or PNG) or a PDF.", 415);
    if (closed) return fail("The invoice has gone out, so only the president or the VP can add receipts now.", 403);
    const rec = await getReceipts(id);
    if (rec.drafts.length >= 30) return fail("There are 30 uploads waiting to be confirmed. Confirm or discard some first.");
    const draft = { id: token(12).replace(/[^a-z0-9]/gi, "").toLowerCase(), name: fileName(req.headers.get("x-file-name"), `receipt.${TYPES[type]}`), type, size: bytes.length, by: who2, at: new Date().toISOString() };
    await putReceiptFile(id, draft.id, buffer, { name: draft.name, type, size: bytes.length });
    rec.drafts.push(draft);
    await putReceipts(id, rec);
    return start(req, id, draft, url.origin, sow, costs, who, event);
  }

  if (req.method === "PUT" && q("item")) {
    const rec = await getReceipts(id);
    const item = rec.items.find((x) => x.id === q("item"));
    if (!item) return fail("No such receipt.", 404);
    if (!costs && (!mine(item, who2) || closed)) return fail("You can change the receipts you added, until the invoice goes out. The president or the VP can change any.", 403);
    const body = await req.json().catch(() => null);
    const ok = cleanConfirm(body, (sow?.lines ?? []).map((l) => l.id), payerChoices(event, await getRoster(), rec.items));
    if (ok.problem) return fail(ok.problem);
    Object.assign(item, ok.ok, { editedAt: new Date().toISOString(), editedBy: who2 });
    await putReceipts(id, rec);
    return json(await view(id, sow, costs, who, event));
  }

  if (req.method === "DELETE") {
    const rec = await getReceipts(id);
    if (q("draft")) {
      if (!rec.drafts.some((x) => x.id === q("draft"))) return fail("That upload is no longer pending.", 404);
      rec.drafts = rec.drafts.filter((x) => x.id !== q("draft"));
      await Promise.all([putReceipts(id, rec), deleteReceiptFile(id, q("draft")), deleteReceiptRead(id, q("draft"))]);
      return json(await view(id, sow, costs, who, event));
    }
    const item = rec.items.find((x) => x.id === q("item"));
    if (!item) return fail("No such receipt.", 404);
    if (!costs && (!mine(item, who2) || closed)) return fail("You can remove the receipts you added, until the invoice goes out. The president or the VP can remove any.", 403);
    rec.items = rec.items.filter((x) => x.id !== item.id);
    await Promise.all([putReceipts(id, rec), deleteReceiptFile(id, item.id)]);
    // The copy on SharePoint is left where it is: the desk can't safely delete from the shared library.
    const out = await view(id, sow, costs, who, event);
    return json(item.filed ? { ...out, note: "Removed from the invoice. The copy already in the SharePoint Receipts folder is still there; delete it there if it shouldn't be." } : out);
  }
  return fail("Method not allowed.", 405);
};

/** Put the file in the SharePoint "Receipts" folder, named so the folder sorts by date. A failure is kept on the receipt, not thrown. */
async function filed(event, item, lineName) {
  const f = await getReceiptFile(event.id, item.id);
  if (!f) { item.filedProblem = "The file is missing."; return; }
  const safe = (s) => String(s).replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  const name = `${item.date} ${safe(item.vendor)} ${safe(lineName ?? "")} $${item.amount.toFixed(2)}.${TYPES[f.type] ?? "bin"}`.replace(/\s+/g, " ");
  try {
    const out = await fileEventDocument({ event, folder: RECEIPTS_FOLDER, name, bytes: f.bytes, contentType: f.type });
    if (out.skipped) { item.filed = null; item.filedProblem = out.reason; return; }
    item.filed = { at: out.filedAt, url: out.url, folderUrl: out.folderUrl, name: out.name };
    delete item.filedProblem;
  } catch (e) { item.filed = null; item.filedProblem = e.message; }
}

async function start(req, eventId, draft, origin, sow, costs, who, event) {
  if (!anthropicKey()) {
    await putReceiptRead(eventId, draft.id, { state: "failed", at: new Date().toISOString(), why: "The desk has no Anthropic API key, so Claude cannot read this. Fill the boxes in by hand." });
  } else {
    await putReceiptRead(eventId, draft.id, { state: "reading", startedAt: new Date().toISOString() });
    try {
      const r = await fetch(`${origin}/api/receipt-read-background?event=${encodeURIComponent(eventId)}&id=${encodeURIComponent(draft.id)}`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "" } });
      if (r.status >= 400) throw new Error(`the reader answered ${r.status}`);
    } catch (e) {
      await putReceiptRead(eventId, draft.id, { state: "failed", at: new Date().toISOString(), why: `Could not start the reader (${e.message}). Fill the boxes in by hand, or press Read it again.` });
    }
  }
  return json({ ...(await view(eventId, sow, costs, who, event)), started: draft.id }, 202);
}

async function view(eventId, sow, costs, who, event) {
  const rec = await getReceipts(eventId);
  const email = String(who.email ?? "").toLowerCase();
  const drafts = [];
  for (const d of rec.drafts) {
    let r = await getReceiptRead(eventId, d.id);
    if (r?.state === "reading" && Date.now() - Date.parse(r.startedAt) > STALE_MS) r = { state: "failed", why: "Reading took too long. Press Read it again, or fill the boxes in by hand." };
    drafts.push({ ...d, read: r ?? { state: "failed", why: "Not read yet. Press Read it again, or fill the boxes in by hand." } });
  }
  const items = [...rec.items].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || (b.confirmedAt ?? "").localeCompare(a.confirmedAt ?? ""));
  const closed = !costs && !!sow && STATUSES.indexOf(sow.status) >= STATUSES.indexOf("invoiced");
  return {
    allowed: true, canCost: costs, closed, hasSow: !!sow,
    // Names only: what each line is budgeted at is the president's and the VP's to see.
    lines: (sow?.lines ?? []).map((l) => ({ id: l.id, name: l.name, ...(costs && l.type === "cost" ? { estimate: l.estimate } : {}) })),
    items: items.map((r) => ({ ...publicItem(r), mine: costs || r.addedBy?.email === email })),
    drafts,
    sums: costs ? receiptSums(rec.items) : null,
    // The board members a receipt can be attached to, and (for the president and the VP) what each has paid.
    payers: payerChoices(event, await getRoster(), rec.items),
    byPayer: costs ? paidByPerson(rec.items) : null,
    total: Math.round(rec.items.reduce((n, r) => n + r.amount, 0) * 100) / 100,
  };
}
