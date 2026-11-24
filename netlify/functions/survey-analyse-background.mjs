import { requireInternal } from "./lib/http.mjs";
import { getEvent, putEvent } from "./lib/store.mjs";
import { analyseSurvey, toneComments } from "./lib/surveyanalysis.mjs";
import { resultsOf } from "./survey.mjs";

/**
 * Claude's read of an event's survey, in the background (started by POST /api/survey?analyse=1). With hundreds of
 * answers the read takes longer than a page's request may stay open (the Summit, 14 Nov 2026: "I get an error read
 * 504"), so it runs here and lands on the event; the Results page waits for it.
 */
export default async (req) => {
  if (requireInternal(req)) return new Response("Not authorized.", { status: 401 });
  const url = new URL(req.url);
  const id = url.searchParams.get("event");
  const event = await getEvent(id);
  if (!event?.survey) return new Response("No such survey.", { status: 404 });
  // Each comment's tone, for the presenter results' red and orange (Andrew 17 Nov 2026), with every read, or on its own.
  const R0 = await resultsOf(event);
  const tones = await toneComments(R0).catch((e) => { console.error("comment tones failed", id, e?.message); return null; });
  if (url.searchParams.get("tones")) {
    const now = await getEvent(id);
    if (now?.survey && tones) { now.survey = { ...now.survey, tones: { at: new Date().toISOString(), of: tones } }; await putEvent(now); }
    return new Response(null, { status: 202 });
  }
  let analysis = null, why = "";
  try { analysis = await analyseSurvey(event, R0); }
  catch (e) { console.error("survey read failed", id, e?.status ?? "", e?.message); why = e?.message || "Claude could not read the results."; }
  // Saved onto the event as it is now, not as it was a minute ago, so nothing changed meanwhile is lost.
  const now = await getEvent(id);
  if (!now?.survey) return new Response(null, { status: 202 });
  const { reading, ...rest } = now.survey;
  now.survey = analysis ? { ...rest, analysis } : { ...rest, reading: { state: "failed", why, at: new Date().toISOString() } };
  if (tones) now.survey.tones = { at: new Date().toISOString(), of: tones };
  await putEvent(now);
  return new Response(null, { status: 202 });
};
