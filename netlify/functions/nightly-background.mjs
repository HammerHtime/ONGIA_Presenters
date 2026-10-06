import { requireAdmin } from "./lib/http.mjs";
import { runNight, noteNight, siteOrigin } from "./lib/nightly.mjs";

/**
 * The morning run, in the background. The scheduled function (remind.mjs) has
 * 30 seconds; this has 15 minutes, which is what a big guest list needs at the
 * 30-a-minute pace a Microsoft 365 mailbox allows. If even that is not enough,
 * it starts a follow-up run that sends only what is left, up to three times.
 */
const BUDGET_MS = 13 * 60 * 1000;    // stop starting sends with two minutes to spare
const MAX_HOPS = 3;

export default async (req) => {
  if (requireAdmin(req)) return new Response("Not authorized.", { status: 401 });
  const url = new URL(req.url);
  const hop = Math.min(Math.max(Number(url.searchParams.get("hop")) || 0, 0), MAX_HOPS);
  const out = await runNight({ origin: siteOrigin(url.origin), deadline: Date.now() + BUDGET_MS, sendsOnly: hop > 0 });
  let continued = false;
  if (out.left > 0 && hop < MAX_HOPS) {
    try {
      const r = await fetch(`${url.origin}/api/nightly-background?hop=${hop + 1}`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "" } });
      continued = r.status < 400;
    } catch (e) { console.log(`could not start the follow-up run: ${e.message}`); }
  }
  console.log(`nightly run ${hop}: ${out.left} left${continued ? ", follow-up started" : ""}`);
  await noteNight(out, { ran: "background", hop, continued });
  return new Response(null, { status: 202 });
};
