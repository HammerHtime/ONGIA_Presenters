import { json, fail, requireAdmin, adminWho, text } from "./lib/http.mjs";
import { isOwner } from "./lib/auth.mjs";
import { getEvent, listPresenters, getSheetBaseline, putSheetBaseline, deleteKey } from "./lib/store.mjs";
import { parseLogistics, compareSheet } from "./lib/sheetcheck.mjs";

/**
 * The logistics sheet check (president only): the sheet as it stood, against the agreements as they are now.
 *
 *   GET    /api/sheetcheck?event=…            the baseline's details and the comparison, worked out fresh
 *   PUT    /api/sheetcheck?event=…&baseline=1 the sheet's cells, read in the browser ({ fileName, cells })
 *   PUT    /api/sheetcheck?event=…&link=1     match one presenter to a sheet name by hand ({ presenterId, sheetName })
 *   DELETE /api/sheetcheck?event=…            forget the baseline
 *
 * Read-only on the spreadsheet itself: it never goes back to SharePoint.
 */
const view = async (event, baseline) => {
  const presenters = await listPresenters(event.id);
  return {
    owner: true,
    baseline: baseline ? { fileName: baseline.fileName, uploadedAt: baseline.uploadedAt, uploadedBy: baseline.uploadedBy, count: baseline.rows.length, nights: baseline.nights } : null,
    result: baseline ? compareSheet({ baseline, presenters, links: baseline.links ?? {} }) : null,
  };
};

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const who = adminWho(req);
  if (!(who.key === true || isOwner(who.email))) return fail("Only ONGIA's president can open the logistics sheet check.", 403);

  const url = new URL(req.url);
  const id = url.searchParams.get("event");
  const event = id && (await getEvent(id));
  if (!event) return fail("No such event.", 404);
  const baseline = await getSheetBaseline(id);

  if (req.method === "GET") return json(await view(event, baseline));

  if (req.method === "DELETE") { await deleteKey(`sheet:${id}`); return json(await view(event, null)); }

  if (req.method === "PUT" && url.searchParams.get("baseline")) {
    const body = await req.json().catch(() => null);
    const read = parseLogistics(body?.cells, event);
    if (read.problem) return fail(read.problem);
    const next = { fileName: text(body?.fileName, 200) || "logistics sheet", uploadedAt: new Date().toISOString(), uploadedBy: who.name || who.email || "", rows: read.rows, nights: read.nights, links: {} };
    await putSheetBaseline(id, next);
    return json(await view(event, next));
  }

  if (req.method === "PUT" && url.searchParams.get("link")) {
    if (!baseline) return fail("Upload the sheet first.");
    const body = await req.json().catch(() => null);
    const presenterId = text(body?.presenterId, 80), sheetName = text(body?.sheetName, 120);
    if (sheetName && !baseline.rows.some((r) => r.name === sheetName)) return fail("That name isn't on the sheet I read.");
    const links = { ...(baseline.links ?? {}) };
    if (sheetName) links[presenterId] = sheetName; else delete links[presenterId];
    const next = { ...baseline, links };
    await putSheetBaseline(id, next);
    return json(await view(event, next));
  }
  return fail("Method not allowed.", 405);
};
