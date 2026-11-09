import { requireAdmin } from "./lib/http.mjs";
import { getEvent, putEvent } from "./lib/store.mjs";
import { primeRoster } from "./lib/signature.mjs";
import { sendVersionNow } from "./lib/attmail.mjs";
import { sendHotelRound } from "./lib/hotel.mjs";
import { sendJoinRound } from "./lib/joinreminder.mjs";
import { reportSends } from "./lib/sendreport.mjs";
import { sendSurveyRound } from "./lib/surveysend.mjs";
import { sendMessageRound } from "./lib/message.mjs";

/**
 * Send now, from Coming up (Andrew 5 Nov 2026), on the server so closing the page doesn't stop it: a welcome-letter
 * version to everyone still owed it, or a hotel reminder. Runs up to 13 minutes and starts a follow-up for anyone left.
 *
 *   POST /api/attmail-send-background?event=…&type=welcome&key=<version>[&hop=n]   (with the desk's own key)
 *   POST /api/attmail-send-background?event=…&type=hotel&days=<30|15|7>[&hop=n]
 *   POST /api/attmail-send-background?event=…&type=message&key=<id>[&hop=n]   a message of Andrew's own, to its group
 *   POST /api/attmail-send-background?event=…&type=survey&key=<end|YYYY-MM-DD>[&hop=n]   the survey, before its time
 *   POST /api/attmail-send-background?event=…&type=join&key=<group>[&auto=1][&hop=n]   the reminder to those joining online;
 *        auto=1 is join-tick at its time, without it Send now
 */
const BUDGET_MS = 13 * 60 * 1000;
const MAX_HOPS = 5;

export default async (req) => {
  if (requireAdmin(req)) return new Response("Not authorized.", { status: 401 });
  const url = new URL(req.url);
  const hop = Math.min(Math.max(Number(url.searchParams.get("hop")) || 0, 0), MAX_HOPS);
  const event = await getEvent(url.searchParams.get("event"));
  if (!event) return new Response(null, { status: 202 });
  await primeRoster();
  const type = url.searchParams.get("type");
  const key = url.searchParams.get("key") ?? "";
  const days = Number(url.searchParams.get("days"));
  let out, what;
  try {
    if (type === "welcome") { what = "The welcome letter (sent now)"; out = await sendVersionNow(event, key, { deadline: Date.now() + BUDGET_MS }); }
    else if (type === "join") { what = "The reminder to those joining online"; out = await sendJoinRound(event, key, { deadline: Date.now() + BUDGET_MS, force: url.searchParams.get("auto") !== "1" }); }
    else if (type === "survey") { what = key === "end" ? "The survey (sent now)" : `The survey for ${key} (sent now)`; out = await sendSurveyRound(event, key, { deadline: Date.now() + BUDGET_MS }); }
    else if (type === "message") { what = `Your message: ${(event.messages ?? []).find((m) => m.id === key)?.subject ?? ""}`; out = await sendMessageRound(event, key, { deadline: Date.now() + BUDGET_MS }); }
    else if (type === "hotel") { what = `The ${days}-day hotel reminder (sent now)`; out = await sendHotelRound(event, days, { deadline: Date.now() + BUDGET_MS }); }
    else out = { error: "unknown kind" };
  } catch (e) { out = { error: e.message }; }
  let continued = false;
  if (out.left > 0 && hop < MAX_HOPS) {
    try {
      const r = await fetch(`${url.origin}/api/attmail-send-background?event=${encodeURIComponent(event.id)}&type=${type}&key=${encodeURIComponent(key)}&days=${days || ""}${url.searchParams.get("auto") === "1" ? "&auto=1" : ""}&hop=${hop + 1}`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "" } });
      continued = r.status < 400;
    } catch (e) { console.log(`send now: could not start the follow-up run: ${e.message}`); }
  }
  const fresh = (await getEvent(event.id)) ?? event;
  if (continued) fresh.sendNow = { ...(fresh.sendNow ?? {}), hop: hop + 1, at: new Date().toISOString() };
  else { delete fresh.sendNow; fresh.sendNowLast = { at: new Date().toISOString(), type, key, days: days || null, sent: out.sent ?? 0, failed: out.failed ?? 0, error: out.error ?? out.blocked?.[0] ?? out.skipped ?? null }; }
  await putEvent(fresh);
  await reportSends("Send now", [{ ...out, title: event.title, what }]);
  console.log(`send now ${event.id} ${type} ${key || days} run ${hop}: ${out.sent ?? 0} sent, ${out.failed ?? 0} failed, ${out.left ?? 0} left`);
  return new Response(null, { status: 202 });
};
