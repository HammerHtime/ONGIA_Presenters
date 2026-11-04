import { getEvent, getSow, getReceipts, putReceipts, putReceiptFile, deleteReceiptFile, getClaimFile, getClaimRead } from "./store.mjs";
import { fileEventDocument, RECEIPTS_FOLDER } from "./graph.mjs";
import { hstOf, sowLinesFor } from "./expenses.mjs";
import { isDuplicate } from "./receipts.mjs";

/**
 * Expenses on an RBH event's statement of work (Andrew 4 Nov 2026). A line of an expense claim that names an RBH event
 * also says which line of its statement of work it belongs to ("my Air Canada flight to Victoria … under on-site
 * management"). Once the claim is approved, the receipt is on the event's Receipts against that line, so the event shows
 * what each line really cost: "$7,000 fixed fee for on-site management … if the receipts total $8,700, I know I've
 * underestimated." The President can move it to another line later.
 *
 * What RBH is billed doesn't change for a fixed-fee line: the invoice bills its agreed amount whatever its receipts add
 * up to (lib/sow.mjs lineAmount). A line billed at cost is the sum of its receipts, as it always was. No receipt itself
 * ever goes to RBH; the copies are filed in ONGIA's SharePoint, for when RBH asks.
 */

const itemId = (claimId, lineId) => `x${String(claimId).replace(/[^a-z0-9]/gi, "").slice(0, 12)}${String(lineId).replace(/[^a-z0-9]/gi, "").slice(0, 12)}`.toLowerCase();
const money = (n) => Math.round(Number(n) * 100) / 100;

/**
 * Bring the events' Receipts in line with one claim. Approved or paid (and not a test): each of its lines that names an
 * RBH event and a statement-of-work line is there, against that line. Anything else (sent back, a line taken off, a
 * test): its receipts come off. A receipt someone had already uploaded to the event by hand (same vendor, date and total)
 * is linked rather than added twice, and only unlinked when the claim comes off. Returns the events touched.
 */
export async function syncClaimToSow(claim, lines, { origin = "" } = {}) {
  const live = (claim.status === "approved" || claim.status === "paid") && !claim.test && !claim.trial;
  const eventIds = new Set([...(claim.sowEvents ?? []), ...lines.filter((l) => l.eventId && l.sowLineId).map((l) => l.eventId)]);
  const touched = [];
  for (const eventId of eventIds) {
    const event = await getEvent(eventId);
    if (!event) continue;
    const valid = new Set((sowLinesFor(event, await getSow(eventId)) ?? []).map((l) => l.id));
    const want = live ? lines.filter((l) => l.eventId === eventId && valid.has(l.sowLineId)) : [];
    const rec = await getReceipts(eventId);
    let changed = false;
    // Off: from this claim, and no longer wanted.
    for (const item of rec.items.filter((i) => i.source?.claim === claim.id && !want.some((l) => l.id === i.source.line))) {
      if (item.source.linked) { delete item.source; }
      else { rec.items = rec.items.filter((i) => i !== item); await deleteReceiptFile(eventId, item.id).catch(() => {}); }
      changed = true;
    }
    for (const line of want) {
      const had = rec.items.find((i) => i.source?.claim === claim.id && i.source.line === line.id);
      if (had) { if (had.lineId !== line.sowLineId) { had.lineId = line.sowLineId; had.movedAt = new Date().toISOString(); changed = true; } continue; }
      const read = await getClaimRead(claim.id, line.id).catch(() => null);
      const total = money(line.amount ?? 0);
      const readTax = Number(read?.found?.tax);
      const tax = Number.isFinite(readTax) && readTax >= 0 && readTax < total ? money(readTax) : hstOf(line);
      const c = { vendor: String(line.paidTo || (line.kind === "mileage" ? "Mileage" : "Expense")).slice(0, 120), date: line.date || claim.sentAt?.slice(0, 10) || "", amount: money(total - tax), tax, total, currency: "CAD" };
      const source = { claim: claim.id, line: line.id, by: claim.owner?.name ?? "" };
      const same = rec.items.find((i) => !i.source && isDuplicate([i], c));
      if (same) { same.source = { ...source, linked: true }; changed = true; continue; }
      const id = itemId(claim.id, line.id);
      const file = line.kind === "receipt" ? await getClaimFile("file", claim.id, line.id).catch(() => null) : null;
      const item = { id, lineId: line.sowLineId, otherNote: "", ...c, ...(claim.owner?.email ? { paidBy: { email: claim.owner.email, name: claim.owner.name } } : {}),
        name: file?.name ?? null, type: file?.type ?? null, size: file?.bytes?.byteLength ?? 0,
        addedBy: claim.owner?.name ?? "", addedAt: new Date().toISOString(), confirmedAt: new Date().toISOString(), confirmedBy: "expense claim, approved", readBy: "claim", source };
      if (file) {
        await putReceiptFile(eventId, id, file.bytes, { name: file.name, type: file.type, size: item.size });
        const lineName = (await getSow(eventId))?.lines?.find((l) => l.id === line.sowLineId)?.name ?? "";
        const safe = (s) => String(s).replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
        try {
          const out = await fileEventDocument({ event, folder: RECEIPTS_FOLDER, name: `${item.date} ${safe(item.vendor)} ${safe(lineName)} $${item.amount.toFixed(2)}.${(file.name.split(".").pop() || "pdf").slice(0, 5)}`.replace(/\s+/g, " "), bytes: file.bytes, contentType: file.type });
          if (!out.skipped) item.filed = { at: out.filedAt, url: out.url, folderUrl: out.folderUrl, name: out.name }; else item.filedProblem = out.reason;
        } catch (e) { item.filedProblem = e.message; }
      }
      rec.items.push(item);
      changed = true;
    }
    if (changed) { await putReceipts(eventId, rec); touched.push(eventId); }
  }
  return { events: [...eventIds].filter((id) => lines.some((l) => l.eventId === id && l.sowLineId) || touched.includes(id)), touched };
}
