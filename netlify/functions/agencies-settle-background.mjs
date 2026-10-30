import { requireAdmin } from "./lib/http.mjs";
import { putMeta } from "./lib/store.mjs";
import { settle, everyone } from "./lib/agencies.mjs";

/**
 * "Check now" on Admin › Agencies, in the background (Claude may look agencies up on the web, which takes a while; the
 * caller gets 202 at once and the page watches agencies:run). The nightly run does the same as one of its steps.
 */
export default async (req) => {
  if (requireAdmin(req)) return new Response("Not authorized.", { status: 401 });
  await putMeta("agencies:run", { state: "running", at: new Date().toISOString() });
  try {
    const out = await settle(await everyone());
    await putMeta("agencies:run", { state: "done", at: new Date().toISOString(), ...out });
  } catch (e) {
    console.error("agency matching failed", e?.message);
    await putMeta("agencies:run", { state: "failed", at: new Date().toISOString(), why: e?.message ?? "Unknown error" });
  }
  return new Response(null, { status: 202 });
};
