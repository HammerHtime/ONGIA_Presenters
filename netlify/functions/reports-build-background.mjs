import { requireAdmin } from "./lib/http.mjs";
import { getEvent } from "./lib/store.mjs";
import { buildReport, fileReport, reportsOf, putReports } from "./lib/reports.mjs";
import { buildYearReport, fileYearReport, yearReportsOf, putYearReports } from "./lib/yearend.mjs";
import { buildOngReport, fileOngReport, ongReportsOf, putOngReports } from "./lib/ongiayear.mjs";
import { sortAgencies } from "./lib/sectors.mjs";
import { refreshYear } from "./lib/history.mjs";
import { putMeta } from "./lib/store.mjs";

/** Make a report (both languages) and file it, in the background: Claude takes a minute or two. Started by /api/reports. */
export default async (req) => {
  if (requireAdmin(req)) return new Response("Not authorized.", { status: 401 });
  const job = await req.json().catch(() => ({}));
  if (job.yearend) return yearEnd(job);
  if (job.ongia) return ongiaYear(job);
  if (job.sectors) return sectors(job);
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

/** The RBH year-end Executive Summary or infographic (Admin › RBH reports), made and filed the same way. */
async function yearEnd(job) {
  const year = String(job.yearend);
  const settle = async (patch) => { const all = await yearReportsOf(year); await putYearReports(year, { ...all, [job.kind]: { ...all[job.kind], building: null, ...patch } }); };
  try {
    await buildYearReport(year, job.kind, { reason: job.reason || "asked", ask: job.ask || "", lang: job.lang || "both" });
    await settle({ error: null });
    await fileYearReport(year, job.kind);
  } catch (e) {
    console.error("year-end report failed", year, job.kind, e?.message);
    const all = await yearReportsOf(year);
    const chat = job.ask ? [...(all[job.kind]?.chat ?? []), { who: "claude", text: `That didn't work: ${e.message}`, at: new Date().toISOString(), error: true }] : all[job.kind]?.chat;
    await settle({ error: e.message, chat });
  }
  return new Response(null, { status: 202 });
}

/**
 * ONGIA's year reports (Reports › ONGIA), one after another: the agencies are sorted into sectors and the year's topics
 * grouped before the first, then each is made in both languages and filed.
 */
async function ongiaYear(job) {
  const year = String(job.ongia);
  // "Refresh from Wix" on the Reports page: read the year again and keep it; no report is made.
  if (job.readOnly) {
    try { await refreshYear(year); await putMeta(`ongia:year:${year}:reading`, { state: "done", at: new Date().toISOString() }); }
    catch (e) { console.error("ONGIA year reading failed", year, e?.message); await putMeta(`ongia:year:${year}:reading`, { state: "failed", why: e.message, at: new Date().toISOString() }); }
    return new Response(null, { status: 202 });
  }
  let refresh = !!job.refresh;
  for (const kind of job.kinds ?? []) {
    const settle = async (patch) => { const all = await ongReportsOf(year); await putOngReports(year, { ...all, [kind]: { ...all[kind], building: null, ...patch } }); };
    try {
      await buildOngReport(year, kind, { reason: job.reason || "asked", ask: job.ask || "", lang: job.lang || "both", refresh });
      refresh = false;
      await settle({ error: null });
      await fileOngReport(year, kind);
    } catch (e) {
      console.error("ONGIA report failed", year, kind, e?.message);
      const all = await ongReportsOf(year);
      const chat = job.ask ? [...(all[kind]?.chat ?? []), { who: "claude", text: `That didn't work: ${e.message}`, at: new Date().toISOString(), error: true }] : all[kind]?.chat;
      await settle({ error: e.message, chat });
    }
  }
  return new Response(null, { status: 202 });
}

/** "Sort into sectors" on Admin › Agencies: Claude sorts the agencies (all of them not set by hand, with `all`). */
async function sectors(job) {
  try {
    const out = await sortAgencies({ all: !!job.all });
    await putMeta("agencies:sectorrun", { at: new Date().toISOString(), state: "done", ...out });
  } catch (e) {
    await putMeta("agencies:sectorrun", { at: new Date().toISOString(), state: "failed", why: e.message });
  }
  return new Response(null, { status: 202 });
}
