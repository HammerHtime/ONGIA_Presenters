import { getClaim, listClaimLines, getClaimRead, listMineIds, getMeta, getEvent } from "./store.mjs";
import { viewLine, claimChecks, monthLabel, whoKey, PER_DIEM_DEFAULT, overPerDiem } from "./expenses.mjs";
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

/** A presenter's per diem as set in the app (the President or the VP changes it each quarter), else the one Andrew gave. */
export const PER_DIEM_KEY = "expenses-per-diem";
export async function getPerDiem() {
  const s = await getMeta(PER_DIEM_KEY).catch(() => null);
  const r = s?.rates ?? {};
  // Meals only: a km rate kept from before 19 Nov 2026 is left out.
  return { breakfast: r.breakfast ?? PER_DIEM_DEFAULT.breakfast, lunch: r.lunch ?? PER_DIEM_DEFAULT.lunch, dinner: r.dinner ?? PER_DIEM_DEFAULT.dinner, setAt: s?.at ?? null, setBy: s?.by ?? "" };
}
/** The per diem a claim is held to: a presenter's claim only. Board members have none. */
export async function perDiemFor(claim) {
  if (claim?.payee?.kind !== "presenter") return null;
  const pd = await getPerDiem();
  // The meals their event served (its setting on Edit event): no per diem for those.
  const ev = claim.payee.event ? await getEvent(claim.payee.event).catch(() => null) : null;
  return { ...pd, provided: ["breakfast", "lunch", "dinner"].filter((m) => ev?.mealsProvided?.[m] === true) };
}
/** Each meal over its per diem marked on the line itself, so it shows while the claim is being built too. */
export function markPerDiem(lines, perDiem) {
  for (const l of lines) {
    const o = overPerDiem(l, perDiem); if (o) l.overPerDiem = o; else delete l.overPerDiem;
    if (perDiem?.provided?.includes(l.meal)) l.mealProvided = true; else delete l.mealProvided;
  }
  return lines;
}

/** Claude's check, with the person's other sent claims of the last 13 months to catch the same thing claimed twice. */
export async function checksFor(claim, lines) {
  const earlier = [];
  for (const id of await listMineIds(whoKey(claim.owner?.email))) {
    if (id === claim.id) continue;
    const c = await getClaim(id);
    if (c && c.status !== "draft" && !c.test && Date.now() - Date.parse(c.sentAt ?? c.createdAt) < 400 * 86400e3) earlier.push(...(await listClaimLines(id)));
  }
  return claimChecks(lines, { month: claim.month || monthLabel(todayIso()), earlier, perDiem: await perDiemFor(claim) });
}
