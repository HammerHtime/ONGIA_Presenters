import { json, fail, requireAdmin, text } from "./lib/http.mjs";
import { listEvents, listPresenters, listVolunteers } from "./lib/store.mjs";

/**
 * The search box at the top of the desk: presenters, volunteers and events, by name, email, organization, title or
 * city. Every board member who can sign in may look at every event, so the results are the same for everyone; costs
 * are never part of them.
 *
 *   GET /api/search?q=…     up to 25 matches, people first
 */
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const q = norm(text(new URL(req.url).searchParams.get("q"), 80)).trim();
  if (q.length < 2) return json({ q, results: [] });
  const words = q.split(/\s+/).filter(Boolean);
  const hit = (...fields) => { const hay = norm(fields.join(" ")); return words.every((w) => hay.includes(w)); };

  const events = await listEvents();
  const out = [];
  for (const ev of events) {
    const when = { dayOne: ev.dayOne, lastDay: ev.lastDay };
    if (hit(ev.title, ev.city, ev.venue)) out.push({ type: "event", eventId: ev.id, name: ev.title, sub: [ev.city, ev.venue].filter(Boolean).join(" · "), ...when, rank: 2 });
    const [people, vols] = await Promise.all([listPresenters(ev.id), listVolunteers(ev.id)]);
    for (const p of people) {
      if (hit(`${p.first} ${p.last}`, p.email, p.organization)) {
        out.push({ type: "presenter", eventId: ev.id, eventTitle: ev.title, presenterId: p.id, name: `${p.first} ${p.last}`, sub: [p.organization, p.email].filter(Boolean).join(" · "), status: p.status, ...when, rank: 0 });
      }
    }
    for (const v of vols) {
      if (hit(`${v.first} ${v.last}`, v.email, v.organization)) {
        out.push({ type: "volunteer", eventId: ev.id, eventTitle: ev.title, name: `${v.first} ${v.last}`, sub: [v.organization, v.email].filter(Boolean).join(" · "), status: v.status, ...when, rank: 1 });
      }
    }
  }
  // People before events, and within each the soonest upcoming event first (listEvents is already in that order).
  out.sort((a, b) => a.rank - b.rank);
  return json({ q, results: out.slice(0, 25).map(({ rank, ...r }) => r), more: out.length > 25 });
};
