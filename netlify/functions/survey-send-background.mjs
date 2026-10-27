import { requireAdmin } from "./lib/http.mjs";
import { listEvents, getMeta, putMeta } from "./lib/store.mjs";
import { runSurveyRounds } from "./lib/surveysend.mjs";
import { primeRoster } from "./lib/signature.mjs";
import { reportSends } from "./lib/sendreport.mjs";

/**
 * The survey emails, sent on the server (Andrew 27 Oct 2026: "Is this going to be a problem when we send out 400 …
 * Is there way for this to run in the background and just alert me when some emails dont send"). The 15-minute check
 * has 30 seconds, about a dozen emails at the 30-a-minute pace a Microsoft 365 mailbox allows: a daily survey to 400
 * people would have taken a day. When something is due it starts this, which sends for up to 13 minutes, starts a
 * follow-up for whatever is left, and emails the officers about any address it could not reach.
 *
 *   POST /api/survey-send-background[?hop=n]      (with the desk's own key; started by survey-tick)
 */
const BUDGET_MS = 13 * 60 * 1000;
const MAX_HOPS = 5;

export default async (req) => {
  if (requireAdmin(req)) return new Response("Not authorized.", { status: 401 });
  const url = new URL(req.url);
  const hop = Math.min(Math.max(Number(url.searchParams.get("hop")) || 0, 0), MAX_HOPS);
  await primeRoster();
  let out;
  try { out = await runSurveyRounds(await listEvents(), { deadline: Date.now() + BUDGET_MS }); }
  catch (e) { out = [{ title: "every event", error: e.message }]; }
  const left = out.reduce((n, r) => n + (r.left ?? 0), 0);
  let continued = false;
  if (left > 0 && hop < MAX_HOPS) {
    try {
      const r = await fetch(`${url.origin}/api/survey-send-background?hop=${hop + 1}`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "" } });
      continued = r.status < 400;
    } catch (e) { console.log(`survey send: could not start the follow-up run: ${e.message}`); }
  }
  // While a run goes, the 15-minute check leaves it be; the last run lets the next check start fresh.
  const lock = (await getMeta("survey-sending")) ?? {};
  await putMeta("survey-sending", continued ? { ...lock, at: new Date().toISOString(), hop: hop + 1 } : { at: null, finishedAt: new Date().toISOString() });
  await reportSends("the survey", out.map((r) => ({ ...r, what: r.part && r.part !== "end" ? `The survey for ${r.part}` : "The survey" })));
  if (out.length) console.log(`survey send run ${hop}: ${JSON.stringify(out.map(({ trouble, ...r }) => r))}${continued ? ", follow-up started" : ""}`);
  return new Response(null, { status: 202 });
};
