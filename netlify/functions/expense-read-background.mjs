import { requireAdmin } from "./lib/http.mjs";
import { getClaimLine, getClaimFile, putClaimRead } from "./lib/store.mjs";
import { readExpenseReceipt, whyItFailed } from "./lib/expenses.mjs";

/**
 * Background reader for one expense receipt (started by /api/expenses). Reading a photo takes seconds, and a phone at
 * a hotel counter should not have to hold the request open. The answer lands in expread:<claim>:<line>, never on the
 * line itself, so it cannot write over what the person is typing; the app folds it into the empty boxes.
 */
export default async (req) => {
  if (requireAdmin(req)) return new Response("Not authorized.", { status: 401 });
  const params = new URL(req.url).searchParams;
  const claimId = params.get("claim"), id = params.get("line");
  if (!/^[a-z0-9-]{4,40}$/.test(claimId ?? "") || !/^[a-z0-9]{6,40}$/.test(id ?? "")) return new Response("Bad request.", { status: 400 });
  const [line, file] = await Promise.all([getClaimLine(claimId, id), getClaimFile("file", claimId, id)]);
  if (!line || !file) return new Response("Nothing to read.", { status: 404 });
  try {
    const found = await readExpenseReceipt(file.bytes, file.type);
    await putClaimRead(claimId, id, { state: "done", at: new Date().toISOString(), found });
  } catch (e) {
    console.error("expense receipt read failed", claimId, id, e?.status ?? "", e?.message);
    await putClaimRead(claimId, id, { state: "failed", at: new Date().toISOString(), why: whyItFailed(e) });
  }
  return new Response(null, { status: 202 });
};
