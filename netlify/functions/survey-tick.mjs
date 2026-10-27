import { listEvents, getMeta, putMeta } from "./lib/store.mjs";
import { runSurveyRounds, surveyWorkDue } from "./lib/surveysend.mjs";
import { primeRoster } from "./lib/signature.mjs";
import { siteOrigin } from "./lib/nightly.mjs";
import { reportSends } from "./lib/sendreport.mjs";

/**
 * Every 15 minutes: send any survey part now due (Andrew 27 Oct 2026: a daily survey goes "15 minutes after the last
 * presenter or the last time on the agenda"). Quiet when nothing is due, which is almost always. When something is, the
 * sending is handed to survey-send-background, which has the time a whole guest list needs; this check has 30 seconds.
 * One run at a time: while one goes (or for 20 minutes, if it died), the check leaves it be.
 */
export default async () => {
  await primeRoster();
  const events = await listEvents();
  if (!(await surveyWorkDue(events))) return new Response("ok");
  const lock = await getMeta("survey-sending");
  if (lock?.at && Date.now() - Date.parse(lock.at) < 20 * 60 * 1000) return new Response("already sending");
  await putMeta("survey-sending", { at: new Date().toISOString(), hop: 0 });
  try {
    const origin = siteOrigin();
    if (!origin) throw new Error("the site address is not known (APP_URL / URL)");
    const r = await fetch(`${origin}/api/survey-send-background`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "" } });
    if (r.status >= 400) throw new Error(`the background run answered ${r.status}`);
    return new Response("started");
  } catch (e) {
    // Could not hand it over: send what fits in this check, as before, and say what did not go.
    console.log(`survey: sending here instead (${e.message})`);
    await putMeta("survey-sending", { at: null });
    const out = await runSurveyRounds(events, { deadline: Date.now() + 8000 });
    if (out.length) console.log(JSON.stringify(out.map(({ trouble, ...r }) => r)));
    await reportSends("the survey", out.map((r) => ({ ...r, what: r.part && r.part !== "end" ? `The survey for ${r.part}` : "The survey" })));
    return new Response("ok");
  }
};

export const config = { schedule: "*/15 * * * *" };
