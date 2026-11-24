import { listEvents, getMeta, putMeta } from "./lib/store.mjs";
import { runSurveyRounds, surveyWorkDue } from "./lib/surveysend.mjs";
import { primeRoster } from "./lib/signature.mjs";
import { siteOrigin } from "./lib/site.mjs";
import { reportSends } from "./lib/sendreport.mjs";
import { thanksWorkDue, runThanksRounds } from "./lib/thanks.mjs";
import { certsWorkDue, runCertsRounds } from "./lib/certauto.mjs";

/**
 * Every 15 minutes: send any survey part now due (Andrew 27 Oct 2026: a daily survey goes "15 minutes after the last
 * presenter or the last time on the agenda"). Quiet when nothing is due, which is almost always. When something is, the
 * sending is handed to survey-send-background, which has the time a whole guest list needs; this check has 30 seconds.
 * One run at a time: while one goes (or for 20 minutes, if it died), the check leaves it be.
 */
export default async () => {
  await primeRoster();
  const events = await listEvents();
  // The presenter thank-yous ride along: the morning after an event, at 9:00 its own time (lib/thanks.mjs).
  // …and the certificates, once their day and time come (lib/certauto.mjs).
  if (!(await surveyWorkDue(events)) && !(await thanksWorkDue(events)) && !(await certsWorkDue(events))) return new Response("ok");
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
    out.push(...(await runThanksRounds(events, { deadline: Date.now() + 8000 }).catch((e) => [{ title: "every event", kind: "thanks", error: e.message }])));
    out.push(...(await runCertsRounds(events, { deadline: Date.now() + 8000 }).catch((e) => [{ title: "every event", kind: "certs", error: e.message }])));
    if (out.length) console.log(JSON.stringify(out.map(({ trouble, ...r }) => r)));
    await reportSends("the survey", out.map((r) => ({ ...r, what: r.kind === "certs" ? "The certificates" : /^thanks/.test(r.kind ?? "") ? (r.kind === "thanks-volunteers" ? "The volunteer thank-you" : "The presenter thank-you") : /^reminder/.test(r.part ?? "") ? `The survey ${r.part}` : r.part && r.part !== "end" ? `The survey for ${r.part}` : "The survey" })));
    return new Response("ok");
  }
};

export const config = { schedule: "*/15 * * * *" };
