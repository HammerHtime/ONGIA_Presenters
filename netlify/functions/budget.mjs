import { json, fail, requireAdmin, adminWho } from "./lib/http.mjs";
import { mayCost } from "./lib/auth.mjs";
import { getEvent, getMeta, putMeta, deleteKey, listPresenters, listVolunteers, getRoster, getContractRead, getAttendees } from "./lib/store.mjs";
import { roomingRows, sameName } from "./lib/rooming.mjs";
import { PROVINCES, guessProvince } from "./lib/sow.mjs";

/**
 * An event's own budget, on its Money tab (Andrew 30 Oct 2026: "build the ONGIA event budgets"), the same page as the
 * Sandbox he tried on the 2026 Summit's numbers, now kept for each of ONGIA's own events. The president and the VP only.
 *
 *   GET    /api/budget?event=…   { budget (null until first saved), live }
 *   PUT    /api/budget?event=…   save it ({ budget })
 *   DELETE /api/budget?event=…   start over from the event's records
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
  const id = new URL(req.url).searchParams.get("event");
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
    group: r.board || r.type === "Board Member" ? "board" : r.who === "presenter" ? "presenter" : r.who === "volunteer" ? "volunteer" : "other",
    billing: r.billing, nights: nightsOf(r.checkIn, r.checkOut), confirmed: r.confirmed !== false,
  }));
  return {
    event: { title: event.title, city: event.city ?? "", hotel: event.hotel?.name || contract?.hotelName || event.venue || "", dayOne: event.dayOne, lastDay: event.lastDay || event.dayOne },
    province, salesTax: sales?.rate ?? 13, salesTaxName: sales?.name ?? "HST",
    hotel: { rate: contract?.money?.roomRate ?? rateNumber(event.hotel?.rate), cutoff: event.hotel?.cutoff || null, foodAndBev: event.hotel?.foodAndBev || null },
    contract: contract ? { money: contract.money ?? null, dates: (contract.dates ?? []).map((d) => ({ iso: d.date, what: d.what })) } : null,
    people,
    board: (event.board ?? []).map((m) => ({ name: m.name, email: m.email })).filter((m) => m.name),
    registered: (attendees?.people ?? []).length || null,
  };
}
