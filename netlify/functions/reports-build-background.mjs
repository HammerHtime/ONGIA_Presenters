import { requireAdmin } from "./lib/http.mjs";
import { getEvent } from "./lib/store.mjs";
import { buildReport, fileReport, reportsOf, putReports } from "./lib/reports.mjs";

/** Make a report (both languages) and file it, in the background: Claude takes a minute or two. Started by /api/reports. */
export default async (req) => {
  if (requireAdmin(req)) return new Response("Not authorized.", { status: 401 });
  const job = await req.json().catch(() => ({}));
  const event = await getEvent(job.event);
  if (!event || !job.kind) return new Response(null, { status: 202 });
  const settle = async (patch) => { const all = await reportsOf(event.id); await putReports(event.id, { ...all, [job.kind]: { ...all[job.kind], building: null, ...patch } }); };
  try {
    await buildReport(event, job.kind, { reason: job.reason || "asked", ask: job.ask || "", lang: job.lang || "both" });
    await settle({ error: null });
    await fileReport(event, job.kind);
  } catch (e) {
    console.error("report failed", event.id, job.kind, e?.message);
    const all = await reportsOf(event.id);
    const chat = job.ask ? [...(all[job.kind]?.chat ?? []), { who: "claude", text: `That didn't work: ${e.message}`, at: new Date().toISOString(), error: true }] : all[job.kind]?.chat;
    await settle({ error: e.message, chat });
  }
  return new Response(null, { status: 202 });
};
