import { json, fail, requireAdmin, editGuard, text } from "./lib/http.mjs";
import { getEvent, getAttendees } from "./lib/store.mjs";
import { directory, agenciesOf, teach, suggest, PROVINCES } from "./lib/agencies.mjs";
import { wixConfigured, wixSites, listWixGuests, listWixEvents } from "./lib/wix.mjs";

/**
 * Agencies, one name each (Andrew 27 Oct 2026). For an event's attendee list: who came from where, under the standard
 * names, and the spellings the desk could not place.
 *
 *   GET  /api/agencies?event=…              the event's agencies, with each one's spellings, and what still needs a look
 *   POST /api/agencies?event=…&suggest=1    Claude's suggestion for each spelling still to place
 *   PUT  /api/agencies?event=…              { raw, agency, province? } this spelling means that agency, from now on
 *   GET  /api/agencies?all=1&download=1     every spelling typed in the last two years, with its count (a .csv)
 *   …?all=1 in place of event=…             the same across every registration on every Wix site, past events included
 *                                           (Andrew 27 Oct 2026: "can you see previous events in wix"), so the list is
 *                                           tidied once from years of registrations. Only the agency each person wrote
 *                                           is read; no names or addresses are kept.
 */
export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const url = new URL(req.url);
  const all = !!url.searchParams.get("all");
  const event = all ? null : await getEvent(url.searchParams.get("event"));
  if (!all && !event) return fail("No such event.", 404);
  let people;
  try { people = all && req.method === "PUT" ? [] : all ? await everyRegistration() : ((await getAttendees(event.id)) ?? {}).people ?? []; }
  catch (e) { return fail(`Wix would not list its registrations: ${e.message}`, 502); }
  if (req.method === "GET") return all && url.searchParams.get("download") ? spellingsCsv(people) : show(people);
  if (event) { const viewOnly = editGuard(req, event); if (viewOnly) return viewOnly; }
  const body = await req.json().catch(() => ({}));
  if (req.method === "POST" && url.searchParams.get("suggest")) {
    const list = await directory();
    const { unplaced } = agenciesOf(people, list);
    try { return json({ suggestions: await suggest(unplaced.slice(0, 60).map((u) => u.raw), list) }); }
    catch (e) { return fail(e.message, 503); }
  }
  if (req.method === "PUT") {
    const raw = text(body.raw, 160), agency = text(body.agency, 160);
    if (!raw || !agency) return fail("Which spelling, and which agency?");
    const name = await teach(raw, agency, text(body.province, 2).toUpperCase());
    // Across every Wix registration, listing them all again is slow: the page moves the one row itself.
    return all ? json({ ok: true, raw, agency: name }) : show(people);
  }
  return fail("Method not allowed.", 405);
};

/**
 * What every registration of the last two years on every Wix site gave as its agency (Andrew 27 Oct 2026: "go back
 * over the past 2 years of events and grab all the registrations"): the spelling only, no names or addresses.
 */
async function everyRegistration(now = Date.now()) {
  if (!wixConfigured()) throw new Error("Wix is not connected on this site.");
  const since = new Date(now - 730 * 86400000).toISOString().slice(0, 10);
  const out = [];
  for (const site of wixSites()) {
    const recent = new Set((await listWixEvents({ site: site.n })).filter((e) => !e.dayOne || e.dayOne >= since).map((e) => e.id));
    const guests = await listWixGuests({ type: null, site: site.n });
    out.push(...guests.filter((g) => recent.has(g.eventId)).map((g) => ({ organization: g.organization, status: "ATTENDING" })));
  }
  return out;
}

/** Every spelling and how often it was typed, as a spreadsheet-friendly file, for Claude to build the master list from. */
function spellingsCsv(people) {
  const counts = new Map();
  for (const p of people) { const s = String(p.organization ?? "").trim(); if (s) counts.set(s, (counts.get(s) ?? 0) + 1); }
  const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s, n]) => `${cell(s)},${n}`);
  return new Response(`\ufeffAgency as typed,Registrations\n${rows.join("\n")}\n`, { headers: { "content-type": "text/csv; charset=utf-8",
    "content-disposition": 'attachment; filename="ongia-agency-spellings-past-2-years.csv"', "cache-control": "no-store" } });
}

async function show(people) {
  const list = await directory();
  return json({ ...agenciesOf(people, list), names: list.map((a) => a.name), provinces: PROVINCES });
}
