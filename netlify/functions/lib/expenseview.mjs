import { getClaim, listClaimLines, getClaimRead, listMineIds } from "./store.mjs";
import { viewLine, claimChecks, monthLabel, whoKey } from "./expenses.mjs";
import { todayIso } from "./deadlines.mjs";

/**
 * A claim's lines as the app and the filed copies show them (what was typed, with anything left empty filled from
 * Claude's reading), and Claude's check of them. Shared by the expense API and the filing job, so the PDF in the
 * Treasurer's folder says exactly what the people approving saw.
 */
const STALE_MS = 5 * 60 * 1000;
export async function shownLines(claim) {
  const lines = await listClaimLines(claim.id);
  const reads = await Promise.all(lines.map((l) => (l.kind === "receipt" && l.file ? getClaimRead(claim.id, l.id) : null)));
  return lines.map((l, i) => {
    let r = reads[i];
    if (r?.state === "reading" && Date.now() - Date.parse(r.startedAt) > STALE_MS) r = { state: "failed", why: "Reading took too long. Press Read it again, or type the details in." };
    return { ...viewLine(l, r), read: r ? { state: r.state, why: r.why ?? "", ...(r.state === "done" ? { found: r.found } : {}) } : null };
  });
}

/** Claude's check, with the person's other sent claims of the last 13 months to catch the same thing claimed twice. */
export async function checksFor(claim, lines) {
  const earlier = [];
  for (const id of await listMineIds(whoKey(claim.owner?.email))) {
    if (id === claim.id) continue;
    const c = await getClaim(id);
    if (c && c.status !== "draft" && !c.test && Date.now() - Date.parse(c.sentAt ?? c.createdAt) < 400 * 86400e3) earlier.push(...(await listClaimLines(id)));
  }
  return claimChecks(lines, { month: claim.month || monthLabel(todayIso()), earlier });
}
