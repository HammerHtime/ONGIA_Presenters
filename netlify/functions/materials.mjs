import { json, fail, requireAdmin } from "./lib/http.mjs";
import { getEvent, putEvent, listPresenters, getPresenter, putPresenter } from "./lib/store.mjs";
import { scanMaterials, materialsStatus } from "./lib/materials.mjs";

/**
 * Presentation materials tracking.
 *
 *   GET  /api/materials?event=…                      last scan (cached on the event) + per-presenter status
 *   POST /api/materials?event=…&scan=1               look in the request folder now
 *   POST /api/materials?event=…&presenter=…          body { draft?: true|false, final?: true|false } — mark by hand
 */
export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const url = new URL(req.url);
  const event = await getEvent(url.searchParams.get("event"));
  if (!event) return fail("No such event.", 404);
  const presenters = await listPresenters(event.id);

  if (req.method === "POST" && url.searchParams.get("scan")) {
    try {
      const scan = await scanMaterials(event, presenters);
      if (scan.skipped) return fail(scan.reason, 409);
      event.materialsScan = scan;
      await putEvent(event);
    } catch (e) {
      return fail(`Couldn't read the materials folder: ${e.message}`, 502);
    }
  } else if (req.method === "POST" && url.searchParams.get("presenter")) {
    const p = await getPresenter(event.id, url.searchParams.get("presenter"));
    if (!p) return fail("No such presenter.", 404);
    const body = (await req.json().catch(() => null)) ?? {};
    p.materials ??= {};
    const now = new Date().toISOString();
    if (body.draft === true) p.materials.draftAt = now; else if (body.draft === false) delete p.materials.draftAt;
    if (body.final === true) p.materials.finalAt = now; else if (body.final === false) delete p.materials.finalAt;
    await putPresenter(p);
    const i = presenters.findIndex((x) => x.id === p.id); if (i >= 0) presenters[i] = p;
  } else if (req.method !== "GET") {
    return fail("Method not allowed.", 405);
  }

  const scan = event.materialsScan ?? null;
  return json({
    scan: scan ? { checkedAt: scan.checkedAt, total: scan.total, folder: scan.folder, unmatched: scan.unmatched } : null,
    status: Object.fromEntries(presenters.map((p) => [p.id, materialsStatus(p, scan)])),
    files: scan?.byPresenter ?? {},
  });
};
