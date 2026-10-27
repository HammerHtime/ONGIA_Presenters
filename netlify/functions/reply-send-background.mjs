import { requireAdmin } from "./lib/http.mjs";
import { getEvent, putEvent } from "./lib/store.mjs";
import { sendReplyRound } from "./lib/reply.mjs";
import { primeRoster } from "./lib/signature.mjs";
import { reportSends } from "./lib/sendreport.mjs";

/**
 * The food-allergy email to everyone registered, sent on the server (Andrew 27 Oct 2026: "it's still spinning … it's
 * been 25 min … times out or failed"). The page used to send it a few at a time while it stayed open, at the 30-a-minute
 * pace a Microsoft 365 mailbox allows, so a closed or sleeping page stopped it part way. This runs for up to 13 minutes,
 * starts a follow-up for whatever is left, and keeps going whether or not anyone is watching.
 *
 *   POST /api/reply-send-background?event=…[&hop=n]     (with the desk's own key; started by POST /api/reply?send=1)
 */
const BUDGET_MS = 13 * 60 * 1000;    // stop starting sends with two minutes to spare
const MAX_HOPS = 5;                  // 6 runs × ~370 emails: far more than any guest list

export default async (req) => {
  if (requireAdmin(req)) return new Response("Not authorized.", { status: 401 });
  const url = new URL(req.url);
  const hop = Math.min(Math.max(Number(url.searchParams.get("hop")) || 0, 0), MAX_HOPS);
  const event = await getEvent(url.searchParams.get("event"));
  if (!event?.reply) return new Response(null, { status: 202 });
  await primeRoster();
  let out;
  try { out = await sendReplyRound(event, { deadline: Date.now() + BUDGET_MS }); }
  catch (e) { out = { error: e.message }; }
  let continued = false;
  if (out.left > 0 && hop < MAX_HOPS) {
    try {
      const r = await fetch(`${url.origin}/api/reply-send-background?event=${encodeURIComponent(event.id)}&hop=${hop + 1}`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "" } });
      continued = r.status < 400;
    } catch (e) { console.log(`reply send: could not start the follow-up run: ${e.message}`); }
  }
  // The event page shows "sending" while this is set; the last run clears it and says how it went.
  const fresh = (await getEvent(event.id)) ?? event;
  if (continued) fresh.replySending = { ...(fresh.replySending ?? {}), hop: hop + 1, at: new Date().toISOString() };
  else {
    delete fresh.replySending;
    fresh.replyLastSend = { at: new Date().toISOString(), error: out.error ?? (out.blocked?.[0] ?? out.skipped ?? null), left: out.left ?? 0 };
  }
  await putEvent(fresh);
  // Any address it could not reach is emailed to the officers (each run reports its own).
  await reportSends("the food-allergy email", [{ ...out, title: event.title, what: "The food-allergy email" }]);
  console.log(`reply send ${event.id} run ${hop}: ${out.sent ?? 0} sent, ${out.failed ?? 0} failed, ${out.left ?? 0} left${continued ? ", follow-up started" : ""}${out.error ? `, error: ${out.error}` : ""}`);
  return new Response(null, { status: 202 });
};
