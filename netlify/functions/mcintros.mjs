import { json, fail, requireAdmin, editGuard, text } from "./lib/http.mjs";
import { getEvent, putEvent, listPresenters } from "./lib/store.mjs";
import { primeRoster } from "./lib/signature.mjs";
import { mcSessions, mcView, draftIntros, mcScriptPdf } from "./lib/mcintro.mjs";
import { slugOf } from "./lib/public.mjs";

/**
 * The MC's introductions (Andrew 12 Nov 2026), on the event's Program tab.
 *   GET  /api/mcintros?event=…               each session in order, its presenters, whether their agreement is in, its intro
 *   POST /api/mcintros?event=…&draft=1       Claude drafts those not yet drafted, three a call; `left` says how many
 *                                            are still to do (&id=… redraft just that one)
 *   PUT  /api/mcintros?event=…               { id, text } an intro as changed by hand ("" clears it)
 *   GET  /api/mcintros?event=…&pdf=1         the MC script
 */
const BATCH = 3;

export default async (req) => {
  await primeRoster();
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const url = new URL(req.url);
  const event = await getEvent(url.searchParams.get("event"));
  if (!event) return fail("No such event.", 404);
  const presenters = await listPresenters(event.id);
  if (req.method === "GET") {
    const view = mcView(event, presenters);
    if (url.searchParams.get("pdf")) {
      const name = `${slugOf(String(event.title).split(":")[0]) || "event"}-mc-script.pdf`;
      return new Response(await mcScriptPdf(event, view), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
    }
    return json(view);
  }
  const viewOnly = editGuard(req, event); if (viewOnly) return viewOnly;
  const body = await req.json().catch(() => ({}));
  const kept = { ...(event.mcIntros ?? {}) };
  if (req.method === "POST" && url.searchParams.get("draft")) {
    const one = url.searchParams.get("id");
    // Not yet drafted, or drafted from a bio since changed. One changed by hand is only redrafted when asked for by name.
    const stale = new Set(mcView(event, presenters).sessions.filter((v) => v.intro?.stale).map((v) => v.id));
    const want = mcSessions(event, presenters).filter((s) => (one ? s.id === one : !kept[s.id] || stale.has(s.id)));
    if (!want.length) return json({ ...mcView(event, presenters), left: 0 });
    // A few at a time, so each call ends well inside the function's time limit; the page asks again for the rest.
    const now = want.slice(0, BATCH);
    try {
      const drafted = await draftIntros(now);
      const at = new Date().toISOString();
      for (const [id, d] of Object.entries(drafted)) kept[id] = { ...d, by: "claude", at };
    } catch (e) { return fail(e.message, 503); }
    event.mcIntros = kept;
    event.updatedAt = new Date().toISOString();
    await putEvent(event);
    return json({ ...mcView(event, presenters), left: one ? 0 : want.length - now.length });
  }
  if (req.method === "PUT") {
    const id = text(body.id, 40);
    if (!mcSessions(event, presenters).some((s) => s.id === id)) return fail("That session isn't on this event.", 404);
    const words = text(body.text, 1500);
    if (words) kept[id] = { text: words, check: "", by: "edited", at: new Date().toISOString() };
    else delete kept[id];
    event.mcIntros = kept;
    event.updatedAt = new Date().toISOString();
    await putEvent(event);
    return json(mcView(event, presenters));
  }
  return fail("Method not allowed.", 405);
};
