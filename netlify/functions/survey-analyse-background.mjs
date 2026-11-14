import { requireAdmin } from "./lib/http.mjs";
import { getEvent, putEvent } from "./lib/store.mjs";
import { analyseSurvey } from "./lib/surveyanalysis.mjs";
import { resultsOf } from "./survey.mjs";

/**
 * Claude's read of an event's survey, in the background (started by POST /api/survey?analyse=1). With hundreds of
 * answers the read takes longer than a page's request may stay open (the Summit, 14 Nov 2026: "I get an error read
 * 504"), so it runs here and lands on the event; the Results page waits for it.
 */
export default async (req) => {
  if (requireAdmin(req)) return new Response("Not authorized.", { status: 401 });
  const id = new URL(req.url).searchParams.get("event");
  const event = await getEvent(id);
  if (!event?.survey) return new Response("No such survey.", { status: 404 });
  let analysis = null, why = "";
  try { analysis = await analyseSurvey(event, await resultsOf(event)); }
  catch (e) { console.error("survey read failed", id, e?.status ?? "", e?.message); why = e?.message || "Claude could not read the results."; }
  // Saved onto the event as it is now, not as it was a minute ago, so nothing changed meanwhile is lost.
  const now = await getEvent(id);
  if (!now?.survey) return new Response(null, { status: 202 });
  const { reading, ...rest } = now.survey;
  now.survey = analysis ? { ...rest, analysis } : { ...rest, reading: { state: "failed", why, at: new Date().toISOString() } };
  await putEvent(now);
  return new Response(null, { status: 202 });
};
