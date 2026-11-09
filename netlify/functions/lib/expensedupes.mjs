import { createHash } from "node:crypto";
import { getMeta, putMeta, getClaim, listClaimIds, listClaimLines, putClaimLine, getClaimFile, getClaimRead } from "./store.mjs";

/**
 * The same receipt claimed twice (Andrew 9 Nov 2026: "upon submission of those receipts, I need you to do a check
 * against all the receipts in the database to make sure that it's not a resubmit of the same receipt. I need a check
 * and balance.").
 *
 * Every line is compared with every line on every claim that has been sent, whoever sent it:
 *   "same"   the very same photo or PDF (its fingerprint), or the same receipt / booking number. Blocks sending.
 *   "likely" the same amount on the same day to a place with a similar name (or the same drive). Shown to the person
 *            sending and to the people approving, who decide.
 * Test claims are compared only with test claims, so moving a tried receipt onto a real claim isn't called a resubmit.
 *
 * The sent claims' lines are kept in one index (meta "expdupes"), written when a claim is sent. Claims deleted since are
 * dropped by checking the list of claims, so a withdrawn claim never blocks its receipts from going again.
 */

const KEY = "expdupes";
const lc = (s) => String(s ?? "").toLowerCase();
const cents = (n) => (n === null || n === undefined || n === "" || !Number.isFinite(Number(n)) ? null : Math.round(Number(n) * 100));

export const hashOf = (bytes) => createHash("sha256").update(Buffer.from(bytes)).digest("hex").slice(0, 32);

// Words that say nothing about which business it was.
const NOISE = new Set(["the", "and", "inc", "ltd", "llc", "corp", "co", "company", "limited", "of", "de", "la", "le", "les", "du", "des", "et", "store", "shop", "restaurant", "hotel", "hotels", "canada", "canadian", "ca", "com", "www", "by", "marriott", "station"]);
const words = (s) => lc(s).normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !NOISE.has(w));
/** "AIR CANADA - Toronto" and "Air Canada" are the same place; "Tim Hortons" and "Esso" are not. */
export function similarPlace(a, b) {
  const x = words(a), y = words(b);
  if (!x.length || !y.length) return lc(a).trim() !== "" && lc(a).trim() === lc(b).trim();
  return x.some((w) => y.includes(w));
}
/** A receipt, invoice, booking or confirmation number, as compared: letters and digits only, at least five. */
export const refKey = (s) => { const k = String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); return k.length >= 5 ? k : ""; };

/** What is kept of a line for comparing. */
export const brief = (l) => ({
  id: l.id, kind: l.kind, paidTo: l.paidTo ?? "", date: l.date ?? "", amount: l.amount ?? null,
  hash: l.file?.hash ?? "", shotHash: l.shot?.hash ?? "", ref: l.ref ?? "",
  ...(l.kind === "mileage" ? { km: l.km ?? null, from: l.from ?? "", to: l.to ?? "" } : {}),
});

/** How this line matches one other, or null. */
export function matchOf(a, b) {
  if (a.hash && a.hash === b.hash) return { level: "same", why: "the same photo or PDF" };
  const ra = refKey(a.ref);
  if (ra && ra === refKey(b.ref) && (cents(a.amount) === cents(b.amount) || similarPlace(a.paidTo, b.paidTo))) return { level: "same", why: `the same receipt number (${a.ref})` };
  if (!a.date || a.date !== b.date || cents(a.amount) === null || cents(a.amount) !== cents(b.amount)) return null;
  if (a.kind === "mileage" && b.kind === "mileage") return lc(a.from) === lc(b.from) && lc(a.to) === lc(b.to) ? { level: "likely", why: "the same drive on the same day" } : null;
  if (a.shotHash && a.shotHash === b.shotHash) return { level: "likely", why: "the same card statement, amount and day" };
  if (similarPlace(a.paidTo, b.paidTo)) return { level: "likely", why: "the same amount, the same day, the same place" };
  return null;
}

/** The best match among others: "same" before "likely". */
export function bestMatch(line, others) {
  let best = null;
  for (const o of others) {
    const m = matchOf(line, o.line);
    if (m && (!best || (m.level === "same" && best.level !== "same"))) best = { ...m, on: o.claim };
    if (best?.level === "same") break;
  }
  return best;
}

/* ---------- the index of sent claims ---------- */

const claimBrief = (c) => ({ id: c.id, owner: c.owner?.name || c.owner?.email || "", email: lc(c.owner?.email), month: c.month || "", test: !!c.test });

/** A line's fingerprint, worked out now if it was uploaded before fingerprints were kept (and saved on the line). */
async function withHash(claimId, l) {
  if (l.kind !== "receipt" || l.file?.hash || !l.file) return l;
  const f = await getClaimFile("file", claimId, l.id);
  if (!f) return l;
  const line = { ...l, file: { ...l.file, hash: hashOf(f.bytes) } };
  await putClaimLine(claimId, line);
  return line;
}
/** Lines with what Claude read filled in (receipt number, and the details left empty), as the claim was sent. */
async function readFilled(claimId, l) {
  if (l.kind !== "receipt") return l;
  const r = await getClaimRead(claimId, l.id);
  const f = r?.state === "done" ? r.found : null;
  if (!f) return l;
  return { ...l, ref: l.ref || f.ref || "", paidTo: l.paidTo || f.vendor || "", date: l.date || f.date || "", amount: l.amount ?? f.total ?? null };
}

/** Write a sent claim's lines into the index. `lines` are as shown (what was read filled in). */
export async function indexClaim(claim, lines) {
  const idx = (await getMeta(KEY)) ?? { claims: {} };
  const out = [];
  for (const l of lines) out.push(brief(await withHash(claim.id, l)));
  idx.claims = { ...(idx.claims ?? {}), [claim.id]: { ...claimBrief(claim), lines: out } };
  await putMeta(KEY, { ...idx, built: idx.built ?? null });
  return idx;
}

/**
 * The index, built the first time from every claim already sent, and pruned of claims since deleted. Fingerprints for
 * receipts sent before they were kept are worked out a few at a time, so no one call reads every file.
 */
export async function dupeIndex({ hashBudget = 20 } = {}) {
  let idx = await getMeta(KEY);
  const ids = new Set(await listClaimIds());
  let changed = false;
  if (!idx?.built) {
    idx = { claims: { ...(idx?.claims ?? {}) }, built: new Date().toISOString() };
    for (const id of ids) {
      if (idx.claims[id]) continue;
      const c = await getClaim(id);
      if (!c || c.status === "draft") continue;
      const lines = [];
      for (const l of await listClaimLines(id)) lines.push(brief(await readFilled(id, l)));
      idx.claims[id] = { ...claimBrief(c), lines };
    }
    changed = true;
  }
  for (const id of Object.keys(idx.claims)) if (!ids.has(id)) { delete idx.claims[id]; changed = true; }
  // Fingerprints still to work out.
  let budget = hashBudget;
  for (const [id, c] of Object.entries(idx.claims)) {
    for (const b of c.lines) {
      if (budget <= 0 || b.kind !== "receipt" || b.hash || b.nofile) continue;
      budget--;
      const f = await getClaimFile("file", id, b.id);
      if (f) { b.hash = hashOf(f.bytes); const line = (await listClaimLines(id)).find((x) => x.id === b.id); if (line?.file && !line.file.hash) await putClaimLine(id, { ...line, file: { ...line.file, hash: b.hash } }); }
      else b.nofile = true;
      changed = true;
    }
  }
  if (changed) await putMeta(KEY, idx);
  return idx;
}

/**
 * Each line of this claim that looks like a resubmit: { [lineId]: { level, why, on: { owner, month, email, id } } }.
 * Lines on the claim itself count too (the same photo added twice). `lines` are as shown.
 */
export async function dupesFor(claim, lines, { index = null } = {}) {
  const idx = index ?? await dupeIndex();
  const others = [];
  for (const c of Object.values(idx.claims ?? {})) {
    if (c.id === claim.id || !!c.test !== !!claim.test) continue;
    for (const l of c.lines) others.push({ line: l, claim: { id: c.id, owner: c.owner, email: c.email, month: c.month } });
  }
  const out = {};
  const mine = lines.map((l) => brief(l));
  mine.forEach((b, i) => {
    const here = mine.slice(0, i).map((x) => ({ line: x, claim: { id: claim.id, owner: claim.owner?.name ?? "", email: lc(claim.owner?.email), month: claim.month || "", self: true } }));
    const m = bestMatch(b, [...here, ...others]);
    if (m) out[b.id] = m;
  });
  return out;
}

/** Where the other one is, in words: "Raj Jaswal's October 2026 claim", "your October 2026 claim", "this claim". */
export function whereWords(on, me = "") {
  if (on.self) return "this claim";
  const month = on.month ? `${on.month} ` : "";
  return on.email && on.email === lc(me) ? `your ${month}claim` : `${on.owner || "someone"}'s ${month}claim`;
}
