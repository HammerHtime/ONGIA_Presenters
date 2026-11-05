import { requireAdmin } from "./lib/http.mjs";
import { runNight, noteNight, siteOrigin } from "./lib/nightly.mjs";
import { reportSends, KIND_NAMES } from "./lib/sendreport.mjs";
import { putMeta } from "./lib/store.mjs";
import { scanBounces } from "./lib/attmail.mjs";
import { NIGHT_LOCK } from "./lib/welcomecatchup.mjs";

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
  // While the morning run sends, the welcome letter's 15-minute catch-up keeps out of its way, so nobody gets two.
  await putMeta(NIGHT_LOCK, { at: new Date().toISOString(), hop });
  const out = await runNight({ origin: siteOrigin(url.origin), deadline: Date.now() + BUDGET_MS, sendsOnly: hop > 0 });
  let continued = false;
  if (out.left > 0 && hop < MAX_HOPS) {
    try {
      const r = await fetch(`${url.origin}/api/nightly-background?hop=${hop + 1}`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "" } });
      continued = r.status < 400;
    } catch (e) { console.log(`could not start the follow-up run: ${e.message}`); }
  }
  console.log(`nightly run ${hop}: ${out.left} left${continued ? ", follow-up started" : ""}`);
  if (!continued) await putMeta(NIGHT_LOCK, { at: null });
  await noteNight(out, { ran: "background", hop, continued });
  // Anything to attendees that did not go, or was held back, is emailed to the officers rather than left in the log.
  const rows = [...(out.detail?.letters ?? []).map((r) => ({ ...r, what: KIND_NAMES[r.kind] ?? "An email to attendees" })),
    ...(out.detail?.hotel ?? []).map((r) => ({ ...r, what: r.days ? `The ${r.days}-day hotel reminder` : "A hotel reminder" }))];
  await reportSends("the morning run", rows);
  // Bounce notices in the sending mailbox, marked on the person's row (Andrew 5 Nov 2026).
  if (hop === 0) await scanBounces().catch((e) => console.log(`bounce read failed: ${e.message}`));
  return new Response(null, { status: 202 });
};
