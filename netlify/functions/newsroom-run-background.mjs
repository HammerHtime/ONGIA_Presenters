import { requireInternal } from "./lib/http.mjs";
import { putMeta } from "./lib/store.mjs";
import { runNewsroom } from "./lib/newsroom.mjs";

/** One Newsroom night, in the background (15 minutes; the run stops starting new stories at 13). Started by
 * /api/newsroom (Run now) or newsroom-schedule (2 a.m. Toronto, when switched on). */
export default async (req) => {
  if (requireInternal(req)) return new Response("Not authorized.", { status: 401 });
  const job = await req.json().catch(() => ({}));
  try {
    const log = await runNewsroom({ daysAgo: job.daysAgo ?? 0, mode: job.mode === "live" ? "live" : "sample", by: job.by || "the nightly run", deadline: Date.now() + 13 * 60 * 1000 });
    console.log(`newsroom ${log.mode} ${log.id}: ${log.picked.length} written, ${log.refused.length} refused, ${log.errors.length} errors, $${log.usage?.usd ?? "?"}`);
  } catch (e) {
    console.error("newsroom run failed", e?.message);
  } finally {
    await putMeta("newsroom:running", null).catch(() => {});
  }
  return new Response(null, { status: 202 });
};
