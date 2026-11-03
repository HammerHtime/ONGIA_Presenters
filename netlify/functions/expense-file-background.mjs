import { requireAdmin } from "./lib/http.mjs";
import { getClaim, putClaim, getClaimFile, getRoster } from "./lib/store.mjs";
import { rosterName } from "./lib/expenses.mjs";
import { shownLines, checksFor } from "./lib/expenseview.mjs";
import { claimDocuments, fileClaim, unfileClaim } from "./lib/expensefile.mjs";

/**
 * Files a claim in the Treasurer's folders on SharePoint (see lib/expensefile.mjs), in the background: a claim with
 * a dozen receipts is a dozen uploads, more than a page request may wait for. Started by /api/expenses when a claim
 * is sent, approved, paid or unlocked, and by "File it again".
 *
 *   POST ?claim=<id>        file it (again)
 *   POST ?drop=1            body = [filed records]: take those files out (test claims deleted, a claim withdrawn)
 *
 * What happened is kept on the claim (claim.filed), a failure with it in words, so it shows on the claim to the
 * officers and is never only in a log.
 */
export default async (req) => {
  if (requireAdmin(req)) return new Response("Not authorized.", { status: 401 });
  const q = new URL(req.url).searchParams;

  if (q.get("drop")) {
    const records = await req.json().catch(() => []);
    for (const f of Array.isArray(records) ? records : []) {
      try { await unfileClaim(f); } catch (e) { console.error("expense unfile failed", f?.folder, e?.message); }
    }
    return new Response(null, { status: 202 });
  }

  const id = q.get("claim");
  if (!/^[a-z0-9-]{4,40}$/.test(id ?? "")) return new Response("Bad request.", { status: 400 });
  const claim = await getClaim(id);
  if (!claim || claim.status === "draft") return new Response("Nothing to file.", { status: 404 });
  const roster = (await getRoster()) ?? [];
  const names = (e) => rosterName(e, roster, e);
  const prev = claim.filed?.folder ? claim.filed : null;
  let filed;
  try {
    const lines = await shownLines(claim);
    const docs = await claimDocuments({ claim, lines, names, checks: await checksFor(claim, lines), getFile: (kind, lineId) => getClaimFile(kind, claim.id, lineId) });
    filed = await fileClaim({ claim, docs, prev });
  } catch (e) {
    console.error("expense filing failed", id, e?.status ?? "", e?.message);
    filed = { ...(prev ?? {}), problem: whyFilingFailed(e), failedAt: new Date().toISOString() };
  }
  const fresh = await getClaim(id);
  if (!fresh) { if (filed?.folder && !filed.problem) await unfileClaim(filed).catch(() => {}); return new Response(null, { status: 202 }); }
  fresh.filed = filed;
  await putClaim(fresh);
  return new Response(null, { status: 202 });
};

/** A reason the officers can act on. */
function whyFilingFailed(e) {
  const m = String(e?.message ?? "");
  if (e?.status === 403 || /accessDenied|Forbidden/i.test(m)) return "SharePoint refused the desk (access denied). Its permission to the board's files may need renewing in Microsoft 365.";
  if (e?.status === 401 || /sign-in failed/i.test(m)) return "The desk couldn't sign in to Microsoft 365 to file it. Its credentials may have expired.";
  if (e?.status === 429 || e?.status >= 500) return "SharePoint was busy. Press File it again in a minute.";
  return `It didn't file: ${m.slice(0, 200) || "an unknown error"}. Press File it again.`;
}
