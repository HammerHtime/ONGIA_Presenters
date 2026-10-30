import { json, fail, requireAdmin, editGuard, text } from "./lib/http.mjs";
import { getEvent, getAttendees, getMeta, putMeta } from "./lib/store.mjs";
import { directory, agenciesOf, agencyOf, teach, suggest, forget, editAgency, mergeAgencies, key, agencyLog, agencyWaiting, agencyBlank, everyone, PROVINCES } from "./lib/agencies.mjs";
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
 *
 * The master list, under Admin (Andrew 30 Oct 2026: "the agencies master list should not sit inside each event"):
 *   GET  /api/agencies?master=1               the list with each agency's people, what the desk matched, what waits
 *   GET  /api/agencies?master=1&download=1    the master list as a spreadsheet
 *   GET  /api/agencies?count=1                how many wait for Andrew (the badge on Admin)
 *   POST /api/agencies?master=1&fix=1         { raw, agency, province? } that spelling is this agency, not what the desk said
 *   POST /api/agencies?master=1&undo=1        { raw } the desk was wrong and Andrew doesn't know either: it waits
 *   POST /api/agencies?master=1&blank=1       { raw } not an agency; leave it blank and stop asking
 *   POST /api/agencies?master=1&unblank=1     { raw } bring one left blank back, to be given an agency after all
 *   POST /api/agencies?master=1&clear=1       the matched list has been looked over
 *   POST /api/agencies?master=1&edit=1        { name, newName?, province?, fr?, domains? }
 *   POST /api/agencies?master=1&merge=1       { from, into }
 *   POST /api/agencies?master=1&add=1         { name, province?, fr?, domains? }
 * The matching itself runs nightly and from Check now (agencies-settle-background).
 */
export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const url = new URL(req.url);
  if (url.searchParams.get("count")) return json({ waiting: (await agencyWaiting()).length });
  if (url.searchParams.get("master")) return master(req, url);
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
  // What was read, so an empty result says why (Andrew 27 Oct 2026: "nothing was in the excel sheet").
  const read = { events: 0, registrations: 0, withAgency: 0, questions: new Map() };
  for (const site of wixSites()) {
    const recent = new Set((await listWixEvents({ site: site.n })).filter((e) => !e.dayOne || e.dayOne >= since).map((e) => e.id));
    read.events += recent.size;
    const guests = (await listWixGuests({ type: null, site: site.n })).filter((g) => recent.has(g.eventId));
    read.registrations += guests.length;
    for (const g of guests) {
      if (g.organization) read.withAgency++;
      for (const q of g.formFields ?? []) read.questions.set(q, (read.questions.get(q) ?? 0) + 1);
    }
    out.push(...guests.map((g) => ({ organization: g.organization, status: "ATTENDING" })));
  }
  out.read = { ...read, questions: [...read.questions].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([q, n]) => ({ question: q, count: n })) };
  return out;
}

/** Every spelling and how often it was typed, as a spreadsheet-friendly file, for Claude to build the master list from. */
function spellingsCsv(people) {
  const counts = new Map();
  for (const p of people) { const s = String(p.organization ?? "").trim(); if (s) counts.set(s, (counts.get(s) ?? 0) + 1); }
  const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s, n]) => `${cell(s)},${n}`);
  // Nothing found: say what was read instead of an empty sheet.
  if (!rows.length && people.read) {
    const r = people.read;
    rows.push(`${cell(`No agency answers found. Read ${r.events} events and ${r.registrations} registrations. The questions their forms asked are below.`)},`,
      ...r.questions.map((q) => `${cell(`Question: ${q.question}`)},${q.count}`));
  }
  return new Response(`\ufeffAgency as typed,Registrations\n${rows.join("\n")}\n`, { headers: { "content-type": "text/csv; charset=utf-8",
    "content-disposition": 'attachment; filename="ongia-agency-spellings-past-2-years.csv"', "cache-control": "no-store" } });
}

async function show(people) {
  const list = await directory();
  return json({ ...agenciesOf(people, list), names: list.map((a) => a.name), provinces: PROVINCES, ...(people.read ? { read: people.read } : {}) });
}

async function masterView() {
  const [list, people, log, waiting, run, blank] = await Promise.all([directory(), everyone(), agencyLog(), agencyWaiting(), getMeta("agencies:run"), agencyBlank()]);
  const counts = new Map();
  for (const p of people) { if (p.status === "WITHDRAWN") continue; const a = agencyOf(p, list); if (a) counts.set(a.name, (counts.get(a.name) ?? 0) + 1); }
  const week = Date.now() - 7 * 86400000;
  return json({
    agencies: list.map((a) => ({ name: a.name, province: a.province || "", fr: a.fr || "", domains: a.domains ?? [], aliases: a.aliases ?? [], people: counts.get(a.name) ?? 0 })),
    matched: log, waiting, blank, run: run ?? null, provinces: PROVINCES,
    stats: { agencies: list.length, spellings: list.reduce((n, a) => n + (a.aliases?.length ?? 0), 0), domains: list.reduce((n, a) => n + (a.domains?.length ?? 0), 0),
      week: log.filter((m) => Date.parse(m.at) > week).length },
  });
}

async function master(req, url) {
  const q = (k) => url.searchParams.get(k);
  if (req.method === "GET") return q("download") ? masterCsv() : masterView();
  if (req.method !== "POST") return fail("Method not allowed.", 405);
  const body = await req.json().catch(() => ({}));
  const raw = text(body.raw, 160);
  const unwait = async () => putMeta("agencies:waiting", (await agencyWaiting()).filter((w) => key(w.raw) !== key(raw)));
  // A correction shows in the matched list as Andrew's, whether it was the desk's match or one that was waiting.
  const relog = async (change, was) => {
    const log = await agencyLog();
    if (log.some((m) => key(m.raw) === key(raw))) return putMeta("agencies:log", log.map((m) => key(m.raw) === key(raw) ? { ...m, ...change } : m));
    return putMeta("agencies:log", [{ raw, count: was?.count ?? 0, events: was?.events ?? [], at: new Date().toISOString(), ...change }, ...log]);
  };
  try {
    if (q("fix")) {
      const agency = text(body.agency, 160);
      if (!raw || !agency) return fail("Which spelling, and which agency?");
      await forget(raw);
      const name = await teach(raw, agency, text(body.province, 2).toUpperCase());
      const was = (await agencyWaiting()).find((w) => key(w.raw) === key(raw));
      await unwait(); await relog({ agency: name, by: "you", reason: "You set this one.", corrected: true }, was);
    } else if (q("undo")) {
      if (!raw) return fail("Which spelling?");
      await forget(raw);
      const m = (await agencyLog()).find((x) => key(x.raw) === key(raw));
      await putMeta("agencies:log", (await agencyLog()).filter((x) => key(x.raw) !== key(raw)));
      await putMeta("agencies:waiting", [{ raw, count: m?.count ?? 0, events: m?.events ?? [], reason: `You undid ${m?.agency ?? "the match"}. Type the right agency, or leave it blank.`, at: new Date().toISOString() },
        ...(await agencyWaiting()).filter((w) => key(w.raw) !== key(raw))]);
    } else if (q("blank")) {
      if (!raw) return fail("Which spelling?");
      const was = (await agencyWaiting()).find((w) => key(w.raw) === key(raw));
      await putMeta("agencies:blank", [{ key: key(raw), raw, count: was?.count ?? 0, events: was?.events ?? [], at: new Date().toISOString() },
        ...(await agencyBlank()).filter((b) => b.key !== key(raw))]);
      await unwait();
    } else if (q("unblank")) {
      // Andrew 30 Oct 2026: a spelling left blank can come back, to be given an agency after all.
      const was = (await agencyBlank()).find((b) => b.key === key(raw));
      if (!was) return fail("That spelling isn't on the left-blank list.");
      await putMeta("agencies:blank", (await agencyBlank()).filter((b) => b.key !== key(raw)));
      await putMeta("agencies:waiting", [{ raw: was.raw, count: was.count ?? 0, events: was.events ?? [], reason: "You brought this back. Type the agency, or leave it blank again.", at: new Date().toISOString() },
        ...(await agencyWaiting()).filter((w) => key(w.raw) !== key(raw))]);
    } else if (q("clear")) {
      await putMeta("agencies:log", []);
    } else if (q("edit")) {
      await editAgency(text(body.name, 160), { newName: body.newName === undefined ? undefined : text(body.newName, 160), province: body.province === undefined ? undefined : text(body.province, 2).toUpperCase(),
        fr: body.fr === undefined ? undefined : text(body.fr, 160), domains: Array.isArray(body.domains) ? body.domains.map((d) => text(d, 120)) : undefined });
    } else if (q("merge")) {
      await mergeAgencies(text(body.from, 160), text(body.into, 160));
    } else if (q("add")) {
      const name = text(body.name, 160);
      if (!name) return fail("What is the agency called?");
      if ((await directory()).some((a) => a.name.toLowerCase() === name.toLowerCase())) return fail(`${name} is already on the list.`);
      await teach(name, name, text(body.province, 2).toUpperCase(), { fr: text(body.fr, 160), domains: Array.isArray(body.domains) ? body.domains.map((d) => text(d, 120)) : [] });
    } else return fail("Expected fix, undo, blank, unblank, clear, edit, merge or add.");
  } catch (e) { return fail(e.message); }
  return masterView();
}

/** The master list as a spreadsheet (Andrew 30 Oct 2026: "a running list of all confirmed agencies in a dataset"). */
async function masterCsv() {
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = (await directory()).map((a) => [a.name, a.province ? PROVINCES[a.province] ?? a.province : "Federal / national", a.fr, (a.domains ?? []).join(" "), (a.aliases ?? []).join(" | ")].map(cell).join(","));
  return new Response(`\ufeffAgency,Province,French name,Work email domains,Also typed as\n${rows.join("\n")}\n`, { headers: { "content-type": "text/csv; charset=utf-8",
    "content-disposition": 'attachment; filename="ongia-agencies-master-list.csv"', "cache-control": "no-store" } });
}
