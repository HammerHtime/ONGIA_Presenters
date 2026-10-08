import { requireAdmin } from "./lib/http.mjs";
import { putMeta } from "./lib/store.mjs";
import { runInbox } from "./lib/inbox.mjs";
import { whyItFailed } from "./lib/contract.mjs";

/**
 * "Check email now", in the background (up to 15 minutes; the caller gets 202
 * at once). Started by /api/inbox?run=1; the nightly run does the same read
 * as one of its steps.
 */
export default async (req) => {
  if (requireAdmin(req)) return new Response("Not authorized.", { status: 401 });
  try {
    const out = await runInbox({ deadline: Date.now() + 12 * 60 * 1000 });
    await putMeta("inboxrun", { state: "done", at: new Date().toISOString(), read: out.read ?? 0, added: out.added ?? 0 });
  } catch (e) {
    console.error("inbox read failed", e?.status ?? "", e?.message);
    await putMeta("inboxrun", { state: "failed", at: new Date().toISOString(), why: whyItFailed(e) });
  }
  return new Response(null, { status: 202 });
};
