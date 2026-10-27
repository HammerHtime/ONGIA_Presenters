import { listEvents } from "./lib/store.mjs";
import { runSurveyRounds } from "./lib/surveysend.mjs";
import { primeRoster } from "./lib/signature.mjs";

/**
 * Every 15 minutes: send any survey part now due (Andrew 27 Oct 2026: a daily survey goes "15 minutes after the last
 * presenter or the last time on the agenda"). Quiet when nothing is due, which is almost always.
 */
export default async () => {
  await primeRoster();
  const out = await runSurveyRounds(await listEvents(), { deadline: Date.now() + 8000 });
  if (out.length) console.log(JSON.stringify(out));
  return new Response("ok");
};

export const config = { schedule: "*/15 * * * *" };
