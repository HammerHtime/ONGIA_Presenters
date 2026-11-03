import { requireAdmin } from "./lib/http.mjs";
import { putMeta } from "./lib/store.mjs";
import { catchUpWelcome, CATCHUP_LOCK } from "./lib/welcomecatchup.mjs";
import { pacer } from "./lib/bulk.mjs";
import { pullEvent } from "./wix.mjs";

/**
 * The welcome letter's catch-up, in the background (see lib/welcomecatchup.mjs): started by welcome-tick every 15
 * minutes while a welcome letter is going out. Five minutes at most, so it is long finished before the next check and
 * never runs into the morning run.
 */
const BUDGET_MS = 5 * 60 * 1000;

export default async (req) => {
  if (requireAdmin(req)) return new Response("Not authorized.", { status: 401 });
  try {
    const out = await catchUpWelcome({ pull: pullEvent, deadline: Date.now() + BUDGET_MS, pace: pacer() });
    for (const r of out.events ?? []) {
      if (r.sent || r.failed || r.left || r.blocked || r.error || r.pulled?.added) console.log(`welcome catch-up, ${r.title}: ${JSON.stringify({ pulled: r.pulled, sent: r.sent ?? 0, failed: r.failed ?? 0, left: r.left ?? 0, blocked: r.blocked, error: r.error, skipped: r.skipped })}`);
    }
    if (out.skipped) console.log(`welcome catch-up: ${out.skipped}`);
  } catch (e) {
    console.log(`welcome catch-up failed: ${e.message}`);
  } finally {
    await putMeta(CATCHUP_LOCK, { at: null });
  }
  return new Response(null, { status: 202 });
};
