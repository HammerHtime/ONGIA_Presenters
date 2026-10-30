import { json, fail, requireAdmin, adminWho } from "./lib/http.mjs";
import { mayCost } from "./lib/auth.mjs";
import { getMeta, putMeta, deleteKey } from "./lib/store.mjs";
import { makePractice, practiceEvents } from "./lib/practice.mjs";
import { certIndex } from "./lib/certs.mjs";
import events from "./events.mjs";

/**
 * The Sandbox (Andrew 29 Oct 2026: "a tab ... where you could upload one event, let's say the budget for the National Gang
 * Summit ... and we could play around in that tab, in that environment that doesn't affect anything"). One budget, kept
 * on its own: nothing here reads or writes a real event, Wix, the hotel or anyone's email. The president and the VP only.
 *
 *   GET    /api/sandbox     { budget } (null until first saved; the page starts from the Summit's numbers)
 *   PUT    /api/sandbox     save it ({ budget })
 *   DELETE /api/sandbox     start over
 *
 * And practice events (Andrew 30 Oct 2026), marked practice, made-up people at @practice.invalid addresses:
 *   GET    /api/sandbox?practice=1     the practice events there are
 *   POST   /api/sandbox?practice=1     make them afresh: an RBH ITP week (12 attendees, every survey back) and a symposium
 *   DELETE /api/sandbox?practice=1     remove them and everything made from them, certificates included
 */
const KEY = "sandbox-budget";
const MAX = 400_000;   // characters: far more than a budget needs, small enough that a mistake can't fill the store

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  if (!mayCost(adminWho(req))) return fail("Only ONGIA's president and VP of operations can open the Sandbox.", 403);
  if (new URL(req.url).searchParams.get("practice")) return practice(req);
  if (req.method === "GET") return json({ budget: (await getMeta(KEY))?.budget ?? null });
  if (req.method === "PUT") {
    const raw = await req.text();
    if (raw.length > MAX) return fail("That is too big to keep.", 413);
    let body; try { body = JSON.parse(raw); } catch { return fail("Expected { budget }."); }
    if (!body?.budget || typeof body.budget !== "object") return fail("Expected { budget }.");
    await putMeta(KEY, { budget: body.budget, at: new Date().toISOString() });
    return json({ ok: true });
  }
  if (req.method === "DELETE") { await deleteKey(`meta:${KEY}`); return json({ ok: true }); }
  return fail("Not allowed.", 405);
};

const brief = (e) => ({ id: e.id, title: e.title, kind: e.kind ?? "", dayOne: e.dayOne });
async function practice(req) {
  // Removing goes through the events' own delete, so nothing is left behind; their certificates go too, since nobody holds them.
  const remove = async () => {
    for (const e of await practiceEvents()) {
      for (const code of Object.values(await certIndex(e.id))) await deleteKey(`meta:certs:code:${code}`);
      await deleteKey(`meta:certs:event:${e.id}`);
      await events(new Request(`http://desk/api/events?id=${encodeURIComponent(e.id)}`, { method: "DELETE", headers: req.headers }));
    }
  };
  if (req.method === "GET") return json({ events: (await practiceEvents()).map(brief) });
  if (req.method === "POST") return json({ events: (await makePractice(adminWho(req), { remove })).map(brief) });
  if (req.method === "DELETE") { await remove(); return json({ events: [] }); }
  return fail("Not allowed.", 405);
}
