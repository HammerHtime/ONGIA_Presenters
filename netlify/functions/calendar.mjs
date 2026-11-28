import { createHash } from "node:crypto";
import { json, fail, requireAdmin, adminWho } from "./lib/http.mjs";
import { listEvents, getMeta, putMeta, deleteMeta } from "./lib/store.mjs";
import { buildYearPdf, calendarItems } from "./lib/yearpdf.mjs";
import { cleanSchedule, describe } from "./lib/myschedule.mjs";
import { todayIso, formatDate } from "./lib/deadlines.mjs";

/**
 * The year calendar as a PDF, and the viewer's own work schedule that goes on it (lib/yearpdf.mjs, lib/myschedule.mjs).
 *
 *   GET /api/calendar?year=2027             the year, one month a page, every event, with the viewer's schedule
 *   GET /api/calendar?schedule=1            the viewer's own schedule ({ schedule, says })
 *   PUT /api/calendar?schedule=1            set it ({ pattern: "DDDDDDDOOOOOOONNNNNNNOOOOOOO", start: "2026-11-13" }), or
 *                                           { off: true } to take it off
 * A schedule is the signed-in person's own. The desk key (no person) may name one with &email=.
 */
const keyOf = (email) => `schedule:${createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex").slice(0, 16)}`;

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const url = new URL(req.url);
  const who = adminWho(req);
  const email = who.email || (who.key ? url.searchParams.get("email") ?? "" : "");

  if (url.searchParams.get("schedule")) {
    if (!email) return fail("Sign in with your ONGIA account to keep your own schedule.", 400);
    if (req.method === "PUT") {
      const body = await req.json().catch(() => ({}));
      if (body?.off) { await deleteMeta(keyOf(email)); return json({ schedule: null, says: "" }); }
      const s = cleanSchedule(body);
      if (!s) return fail("Type the rotation as letters, D for days, N for nights, O for off, and the day it starts.");
      await putMeta(keyOf(email), { ...s, at: new Date().toISOString() });
      return json({ schedule: s, says: describe(s) });
    }
    const s = cleanSchedule(await getMeta(keyOf(email)));
    return json({ schedule: s, says: describe(s) });
  }

  const year = Number(url.searchParams.get("year"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return fail("Which year?");
  const [events, confs, sched] = await Promise.all([listEvents(), getMeta("conferences"), email ? getMeta(keyOf(email)) : null]);
  const pdf = await buildYearPdf({ year, items: calendarItems(events ?? [], confs?.items ?? []), schedule: cleanSchedule(sched), printed: formatDate(todayIso()) });
  return new Response(pdf, { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="ONGIA calendar ${year}.pdf"`, "cache-control": "no-store" } });
};
