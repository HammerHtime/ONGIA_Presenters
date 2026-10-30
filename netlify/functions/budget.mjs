import { json, fail, requireAdmin, adminWho } from "./lib/http.mjs";
import { mayCost } from "./lib/auth.mjs";
import { getEvent, listEvents, getMeta, putMeta, deleteKey, listPresenters, listVolunteers, getRoster, getContractRead, getAttendees } from "./lib/store.mjs";
import { roomingRows, sameName } from "./lib/rooming.mjs";
import { PROVINCES, guessProvince } from "./lib/sow.mjs";
import { wixConfigured, listWixTickets } from "./lib/wix.mjs";
import { tally } from "./lib/attendees.mjs";

/**
 * An event's own budget, on its Money tab (Andrew 30 Oct 2026: "build the ONGIA event budgets"), the same page as the
 * Sandbox he tried on the 2026 Summit's numbers, now kept for each of ONGIA's own events. The president and the VP only.
 *
 *   GET    /api/budget?event=…   { budget (null until first saved), live }
 *   PUT    /api/budget?event=…   save it ({ budget })
 *   DELETE /api/budget?event=…   start over from the event's records
 *   GET    /api/budget?like=…      the budget of the last event most like this one, to start from ({ from, budget })
 *   GET    /api/budget?groups=1    the groups the "Everything else" lines can be put under
 *   POST   /api/budget?groups=1    add one ({ name }); kept for every budget, the Sandbox's too
 *
 * `live` is what the event's own records say right now: its dates and hotel, the amounts read from the hotel contract,
 * the rooming list (who has a room, which nights, who pays) and the board members on the event. The page starts a new
 * budget from it and, every time it opens, brings the rooming list's people and nights back in: the rooming list is the
 * truth about rooms, the budget is the plan around it.
 */
const MAX = 400_000;   // characters, as for the Sandbox
const key = (id) => `budget:${id}`;

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  if (!mayCost(adminWho(req))) return fail("Only ONGIA's president and VP of operations can open an event's budget.", 403);
  const url = new URL(req.url);
  if (url.searchParams.get("groups")) return groups(req);
  if (url.searchParams.get("like")) return like(url.searchParams.get("like"));
  const id = url.searchParams.get("event");
  const event = id ? await getEvent(id) : null;
  if (!event) return fail("No such event.", 404);
  if (event.kind === "rbh") return fail("An RBH event's money is on its statement of work.", 409);

  if (req.method === "GET") return json({ budget: (await getMeta(key(id)))?.budget ?? null, live: await live(event) });
  if (req.method === "PUT") {
    const raw = await req.text();
    if (raw.length > MAX) return fail("That is too big to keep.", 413);
    let body; try { body = JSON.parse(raw); } catch { return fail("Expected { budget }."); }
    if (!body?.budget || typeof body.budget !== "object" || Array.isArray(body.budget)) return fail("Expected { budget }.");
    await putMeta(key(id), { budget: body.budget, at: new Date().toISOString(), by: adminWho(req)?.email ?? null });
    return json({ ok: true });
  }
  if (req.method === "DELETE") { await deleteKey(`meta:${key(id)}`); return json({ ok: true, live: await live(event) }); }
  return fail("Not allowed.", 405);
};

/**
 * The groups for the budget's "Everything else" lines (Andrew 30 Oct 2026: "a dropdown for all the common groupings ...
 * click add ... I add a new group, and then that gets added to the list"). The common ones are built in; the ones he
 * adds are kept once for every event.
 */
export const COMMON_GROUPS = ["Venue & AV", "Food & hospitality", "Travel", "Speakers", "Supplies & merchandise", "Printing & marketing", "Insurance", "Volunteers & staff", "Other"];
async function groups(req) {
  const had = (await getMeta("budget-groups"))?.groups ?? [];
  const all = () => [...COMMON_GROUPS, ...had.filter((g) => !COMMON_GROUPS.some((c) => c.toLowerCase() === g.toLowerCase()))];
  if (req.method === "GET") return json({ groups: all(), added: had });
  if (req.method !== "POST") return fail("Not allowed.", 405);
  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!name) return fail("What's the group called?");
  if (!all().some((g) => g.toLowerCase() === name.toLowerCase())) {
    if (had.length >= 60) return fail("That's 60 groups added already. Use one of those.", 409);
    had.push(name);
    await putMeta("budget-groups", { groups: had, at: new Date().toISOString() });
  }
  return json({ groups: all(), name: all().find((g) => g.toLowerCase() === name.toLowerCase()) }, 201);
}

/**
 * The budget to start a new one from (Andrew 30 Oct 2026, the set-up walk-through: "Same as the last one like it"): of
 * ONGIA's own events with a budget, the one whose title shares the most words with this one's, the latest of those.
 */
async function like(id) {
  const event = await getEvent(id);
  if (!event) return fail("No such event.", 404);
  const words = (t) => new Set(String(t ?? "").toLowerCase().replace(/\b(20\d\d|ongia|the|of|and|for|training|event)\b/g, " ").split(/[^a-z]+/).filter((w) => w.length > 2));
  const mine = words(event.title);
  const others = (await listEvents()).filter((e) => e.id !== id && e.kind !== "rbh");
  const scored = [];
  for (const e of others) {
    const b = (await getMeta(key(e.id)))?.budget;
    if (!b?.reg) continue;
    scored.push({ e, b, score: [...words(e.title)].filter((w) => mine.has(w)).length });
  }
  scored.sort((x, y) => y.score - x.score || String(y.e.dayOne).localeCompare(String(x.e.dayOne)));
  const best = scored[0];
  return json(best ? { from: { id: best.e.id, title: best.e.title, dayOne: best.e.dayOne }, budget: best.b } : { from: null, budget: null });
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""));
const nightsOf = (from, to) => {
  const out = [];
  if (!isDate(from) || !isDate(to)) return out;
  for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) < to && out.length < 60; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
};
/** The first dollar amount in the hotel's rate as written ("$205 per night plus taxes" → 205). */
const rateNumber = (s) => { const m = /\$?\s*(\d{2,4}(?:\.\d{1,2})?)/.exec(String(s ?? "")); return m ? Number(m[1]) : null; };

/** What the event's records say, for the budget to start from and keep up with. */
export async function live(event) {
  const roster = (await getRoster()) ?? [];
  const [presenters, volunteers, read, attendees] = await Promise.all([listPresenters(event.id), listVolunteers(event.id), getContractRead(event.id).catch(() => null), getAttendees(event.id).catch(() => null)]);
  const bonvoy = Object.fromEntries(roster.filter((m) => m.name && m.bonvoy).map((m) => [sameName(m.name), m.bonvoy]));
  const { rows } = roomingRows(event, presenters, event.roomingGuests ?? [], roster.map((m) => m.name).filter(Boolean), volunteers, bonvoy);
  const province = event.province || guessProvince(event.city);
  const sales = (PROVINCES[province]?.taxes ?? []).find((t) => t.name === "HST" || t.name === "GST");
  const contract = read?.state === "done" ? read.found ?? null : null;
  const people = rows.map((r) => ({
    key: r.key, name: r.name, org: r.organization || "",
    // Listed by type as well as by where they came from: a presenter typed straight onto the rooming list is a presenter.
    group: r.board || /^board/i.test(r.type ?? "") ? "board" : r.who === "presenter" || /^presenter/i.test(r.type ?? "") ? "presenter" : r.who === "volunteer" || /^volunteer/i.test(r.type ?? "") ? "volunteer" : "other",
    billing: r.billing, nights: nightsOf(r.checkIn, r.checkOut), confirmed: r.confirmed !== false,
  }));
  return {
    event: { title: event.title, city: event.city ?? "", hotel: event.hotel?.name || contract?.hotelName || event.venue || "", dayOne: event.dayOne, lastDay: event.lastDay || event.dayOne },
    province, salesTax: sales?.rate ?? 13, salesTaxName: sales?.name ?? "HST",
    hotel: { rate: contract?.money?.roomRate ?? rateNumber(event.hotel?.rate), cutoff: event.hotel?.cutoff || null, foodAndBev: event.hotel?.foodAndBev || null },
    contract: contract ? { money: contract.money ?? null, dates: (contract.dates ?? []).map((d) => ({ iso: d.date, what: d.what })) } : null,
    people,
    board: (event.board ?? []).map((m) => ({ name: m.name, email: m.email })).filter((m) => m.name),
    // Who is coming, as the event page counts them: registrations marked attending (Wix's, and any typed in).
    registered: tally(attendees?.people ?? []).attending || null,
    room: event.room ?? null,
    // The presenters on the event (their agreements), for the room's seats, as the event page counts them.
    presenters: presenters.length,   // the main room's seats and VIPs, kept on the event (every event has one)
    wix: await wixTickets(event),
  };
}

/**
 * The ticket types on every Wix event linked to this one (the main one, and any others such as the community partners'
 * site), with their prices and sales. null when the event isn't linked to Wix; { problem } when Wix wouldn't say, so the
 * page can say why instead of quietly showing typed numbers as if they were Wix's.
 */
async function wixTickets(event) {
  const links = [...(event.wix?.eventId ? [{ ...event.wix, group: "" }] : []), ...(event.wixMore ?? [])].filter((l) => l?.eventId);
  if (!links.length || !wixConfigured()) return null;
  try {
    const per = await Promise.all(links.map(async (l) => (await listWixTickets({ eventId: l.eventId, site: l.site || "1" })).map((t) => ({ ...t, from: l.group || l.title || "" }))));
    return { tickets: per.flat(), at: new Date().toISOString() };
  } catch (e) {
    return { tickets: [], problem: e.status === 401 || e.status === 403
      ? "Wix wouldn't share this event's ticket types. The Wix API key needs one more permission, Manage Ticket Definitions, added in the Wix dashboard's API Key Manager."
      : `Couldn't read the ticket types from Wix just now: ${e.message}` };
  }
}
