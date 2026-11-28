import { json, fail, requireAdmin, adminWho, text } from "./lib/http.mjs";
import { getMeta, putMeta } from "./lib/store.mjs";
import { siteOrigin } from "./lib/site.mjs";
import { xlsx } from "./lib/xlsx.mjs";
import { settings, saveSettings, sourcesFrom, getIndex, getStory, putStory, saveToIndex, getNight, listNights, indexEntry } from "./lib/newsroom.mjs";
import { typeOf } from "./lib/newsimage.mjs";

/**
 * The Newsroom tab (Briefing Room › Newsroom, the president only; NEWSROOM_USERS widens it).
 *
 *   GET  /api/newsroom                    { settings, sources, nights: [...ids], running }
 *   GET  /api/newsroom?index=1            the story library, newest first (what the tiles and search use)
 *   GET  /api/newsroom?story=<id>         one story in full
 *   GET  /api/newsroom?night=<id>         one night's log
 *   PUT  /api/newsroom                    { on, perNight, topics, sources } the Control room's settings
 *   PUT  /api/newsroom?story=<id>         { keywords } Andrew's keyword changes (new ones join the lists)
 *   POST /api/newsroom?run=1              { mode: "sample" | "live" } Run now (in the background)
 *   POST /api/newsroom?xlsx=1             { ids } the current results as an Excel file, keywords in their own columns
 */
export const newsroomUsers = () => String(process.env.NEWSROOM_USERS || "president@ongia.ca").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const STALE_MS = 20 * 60 * 1000;

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const who = adminWho(req);
  if (!(who.key === true || newsroomUsers().includes(String(who.email ?? "").toLowerCase()))) return fail("The Newsroom is for the president.", 403);
  const q = new URL(req.url).searchParams;
  const by = who.name || who.email || "the desk";

  if (req.method === "GET") {
    if (q.get("index")) return json({ stories: await getIndex() });
    if (q.get("story")) { const s = await getStory(q.get("story")); return s ? json({ story: s }) : fail("No such story.", 404); }
    if (q.get("night")) { const n = await getNight(q.get("night")); return n ? json({ night: n }) : fail("No such night.", 404); }
    const set = await settings();
    const nights = await Promise.all((await listNights(30)).map(async (id) => { const n = await getNight(id); return n && { id, night: n.night, mode: n.mode, by: n.by, startedAt: n.startedAt, finishedAt: n.finishedAt ?? null, picked: n.picked?.length ?? 0, found: n.found?.length ?? 0, refused: n.refused?.length ?? 0, errors: n.errors?.length ?? 0, usd: n.usage?.usd ?? 0 }; }));
    return json({ settings: set, sources: sourcesFrom(set), nights: nights.filter(Boolean), running: await running() });
  }

  if (req.method === "PUT" && q.get("story")) {
    const s = await getStory(q.get("story"));
    if (!s) return fail("No such story.", 404);
    const body = await req.json().catch(() => ({}));
    const clean = (a) => [...new Set((Array.isArray(a) ? a : []).map((x) => text(x, 80)).filter(Boolean))].slice(0, 30);
    if (body.keywords) for (const k of ["where", "agency", "crime", "specifics", "outcome", "people"]) if (k in body.keywords) s.keywords[k] = clean(body.keywords[k]);
    s.editedBy = by; s.editedAt = new Date().toISOString();
    await putStory(s); await saveToIndex([s]);
    return json({ story: s });
  }

  if (req.method === "PUT") {
    const body = await req.json().catch(() => ({}));
    const patch = {};
    for (const k of ["on", "perNight", "topics"]) if (k in body) patch[k] = body[k];
    if ("sources" in body) patch.sources = body.sources === null ? null : cleanSources(body.sources);
    return json({ settings: await saveSettings(patch, by) });
  }

  if (req.method === "POST" && q.get("run")) {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode === "live" ? "live" : "sample";
    const r = await running();
    if (r) return json({ running: r }, 202);
    await putMeta("newsroom:running", { at: new Date().toISOString(), by, mode });
    try {
      const res = await fetch(`${siteOrigin(new URL(req.url).origin)}/api/newsroom-run-background`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "", "content-type": "application/json" }, body: JSON.stringify({ mode, by }) });
      if (res.status >= 400) throw new Error(`the run answered ${res.status}`);
    } catch (e) {
      await putMeta("newsroom:running", null);
      return fail(`Could not start the run (${e.message}).`, 502);
    }
    return json({ running: await running() }, 202);
  }

  if (req.method === "POST" && q.get("xlsx")) {
    const body = await req.json().catch(() => ({}));
    const want = new Set((body.ids ?? []).map(String));
    const rows = (await getIndex()).filter((s) => !want.size || want.has(s.id));
    const k = (s, f) => (s.keywords?.[f] ?? []).join(", ");
    const bytes = xlsx({ sheet: "Stories", plain: true,
      columns: [{ head: "Date", width: 12 }, { head: "Type", width: 18 }, { head: "City", width: 18 }, { head: "Province", width: 9 }, { head: "Headline", width: 50 }, { head: "Summary", width: 70 },
        { head: "Where", width: 24 }, { head: "Agency", width: 30 }, { head: "Crime", width: 24 }, { head: "Specifics", width: 30 }, { head: "Outcome", width: 18 }, { head: "People", width: 14 }, { head: "Posted", width: 10 }, { head: "Sample", width: 8 }],
      rows: rows.map((s) => [s.night, typeOf(s.type).label, s.city, s.province, s.headline, s.summary, k(s, "where"), k(s, "agency"), k(s, "crime"), k(s, "specifics"), k(s, "outcome"), k(s, "people"), s.posted, s.mode === "sample" ? "yes" : ""]) });
    return new Response(bytes, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="ONGIA Newsroom stories.xlsx"`, "cache-control": "no-store" } });
  }

  return fail("Not found.", 404);
};

async function running() {
  const r = await getMeta("newsroom:running");
  if (!r?.at) return null;
  if (Date.now() - Date.parse(r.at) > STALE_MS) return null;
  return r;
}

function cleanSources(s) {
  const domain = (d) => String(d ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const url = (u) => { try { const x = new URL(String(u)); return x.protocol === "https:" ? x.toString() : ""; } catch { return ""; } };
  return {
    feeds: (s?.feeds ?? []).map((f) => ({ name: text(f.name, 120), agency: text(f.agency, 160), kind: f.kind === "atom" ? "atom" : "rss", official: !!f.official, url: url(f.url) })).filter((f) => f.name && f.url).slice(0, 60),
    officialSites: (s?.officialSites ?? []).map((o) => ({ name: text(o.name, 120), agency: text(o.agency, 160), province: text(o.province, 2).toUpperCase(), domain: domain(o.domain), photos: !!o.photos })).filter((o) => o.name && o.domain).slice(0, 60),
    newsQueries: (s?.newsQueries ?? []).map((x) => text(x, 80)).filter(Boolean).slice(0, 40),
  };
}
export { indexEntry };
