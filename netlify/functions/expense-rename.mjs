import { json, fail, requireAdmin, adminWho } from "./lib/http.mjs";
import { listClaimIds, getClaim, putClaim } from "./lib/store.mjs";
import { renameFiled, renameReceipts } from "./lib/expensefile.mjs";
import { listClaimLines } from "./lib/store.mjs";
import { getMeta } from "./lib/store.mjs";

/**
 * The claims filed before the names changed, given the new names (Andrew 16 Nov 2026: "are you able to change the naming
 * convention for the current ones"). "Healy_November_Expense_Claim" becomes "Healy John - Expense claim - November 2026",
 * in SharePoint and on the claim's record. Receipts keep their names.
 *
 *   GET  /api/expense-rename           what it would rename, and nothing changed
 *   POST /api/expense-rename           rename them
 *   GET  /api/expense-rename?scan=1    the list of every file in the expense folders, as the last scan found it
 *                                      (POST /api/expense-scan-background makes it)
 *   GET  /api/expense-rename?hand=1    the hand-filed 2025 and 2026 files and their planned names (expense-hand-background)
 */
export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  if (req.method === "GET" && new URL(req.url).searchParams.get("scan")) return json((await getMeta("expense-scan")) ?? { done: false, files: [] });
  // The hand-filed 2025 and 2026 files: what Claude read and the names planned (expense-hand-background).
  if (req.method === "GET" && new URL(req.url).searchParams.get("hand")) return json((await getMeta("expense-hand")) ?? { items: {} });
  const dry = req.method === "GET";
  if (!dry && req.method !== "POST") return fail("Method not allowed.", 405);
  const out = [];
  for (const id of await listClaimIds()) {
    const claim = await getClaim(id);
    try {
      const r = await renameFiled(claim, { dry });
      if (!dry && r?.filed) { claim.filed = r.filed; await putClaim(claim); }
      // Its receipts: "Healy - Nov 2026 claim - Delta Hotels $658.12.jpg" (Andrew 16 Nov 2026).
      const rr = claim?.filed ? await renameReceipts(dry && r?.to ? { ...claim, filed: { ...claim.filed, stem: r.to } } : claim, await listClaimLines(id), { dry }) : { changes: [] };
      if (!dry && rr.changes.length) { claim.filed = rr.filed; await putClaim(claim); }
      if (!r && !rr.changes.length) continue;
      out.push({ claim: id, owner: claim.owner?.name ?? "", month: claim.month, test: !!(claim.test || claim.trial), from: r?.from ?? claim.filed?.stem, to: r?.to ?? claim.filed?.stem, missing: !!r?.missing, receipts: rr.changes });
    } catch (e) {
      out.push({ claim: id, owner: claim?.owner?.name ?? "", month: claim?.month, from: claim?.filed?.stem, error: e.message });
    }
  }
  if (!dry) console.log(`expense-rename by ${adminWho(req)?.email ?? "the desk key"}: ${JSON.stringify(out)}`);
  return json({ dry, claims: out });
};
