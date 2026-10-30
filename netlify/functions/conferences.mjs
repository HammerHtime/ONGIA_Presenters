import { json, fail, requireAdmin, adminWho, text } from "./lib/http.mjs";
import { getMeta, putMeta } from "./lib/store.mjs";
import { randomBytes } from "node:crypto";

/**
 * Other people's conferences that ONGIA's board goes to (Andrew 30 Oct 2026: "just placeholders ... we may send Andrew and
 * Jacqueline to the Arizona Gang Conference ... or presenting at the Alberta Association of Chiefs of Police"). They show
 * on The year's calendar so a month or the year shows where our people are, and nowhere else: they are not events, so no
 * presenters, logistics, budget, emails, reminders or action queue ever pick them up ("keep it out the event list, but
 * have it show in the calendar"). Anyone signed in to the desk can add, change or take one off.
 *
 *   GET    /api/conferences              { conferences } every one, earliest first
 *   POST   /api/conferences              add one: { title, from, to, place, role: attending|presenting, who: [email], note }
 *   PUT    /api/conferences?id=…         change one (the same fields)
 *   DELETE /api/conferences?id=…         take one off
 */
const KEY = "conferences";
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? "") && !Number.isNaN(Date.parse(v));

function clean(body) {
  const title = text(body.title, 160), from = text(body.from, 10), to = text(body.to, 10) || from;
  if (!title) return { error: "Name the conference." };
  if (!isDay(from)) return { error: "Pick the day it starts." };
  if (!isDay(to) || to < from) return { error: "The last day can't be before the first." };
  const who = [...new Set((Array.isArray(body.who) ? body.who : []).map((e) => text(e, 200).toLowerCase()).filter((e) => /@/.test(e)))].slice(0, 30);
  return { title, from, to, place: text(body.place, 160), role: body.role === "presenting" ? "presenting" : "attending", who, note: text(body.note, 600) };
}

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const id = new URL(req.url).searchParams.get("id");
  const list = (await getMeta(KEY))?.items ?? [];
  const save = async (items) => {
    items.sort((a, b) => a.from.localeCompare(b.from) || a.title.localeCompare(b.title));
    await putMeta(KEY, { items });
    return json({ conferences: items });
  };
  if (req.method === "GET") return json({ conferences: list });
  const by = adminWho(req)?.email || "desk";
  if (req.method === "POST") {
    const c = clean(await req.json().catch(() => ({})));
    if (c.error) return fail(c.error);
    return save([...list, { id: randomBytes(6).toString("hex"), ...c, addedBy: by, addedAt: new Date().toISOString() }]);
  }
  const at = list.findIndex((c) => c.id === id);
  if (at < 0) return fail("No such conference.", 404);
  if (req.method === "PUT") {
    const c = clean(await req.json().catch(() => ({})));
    if (c.error) return fail(c.error);
    list[at] = { ...list[at], ...c, changedBy: by, changedAt: new Date().toISOString() };
    return save(list);
  }
  if (req.method === "DELETE") return save(list.filter((c) => c.id !== id));
  return fail("Not allowed.", 405);
};
