import { json, fail, requireAdmin, adminWho } from "./lib/http.mjs";
import { mayCost } from "./lib/auth.mjs";
import { getMeta, putMeta, deleteKey } from "./lib/store.mjs";

/**
 * The Sandbox (Andrew 29 Oct 2026: "a tab ... where you could upload one event, let's say the budget for the National Gang
 * Summit ... and we could play around in that tab, in that environment that doesn't affect anything"). One budget, kept
 * on its own: nothing here reads or writes a real event, Wix, the hotel or anyone's email. The president and the VP only.
 *
 *   GET    /api/sandbox     { budget } (null until first saved; the page starts from the Summit's numbers)
 *   PUT    /api/sandbox     save it ({ budget })
 *   DELETE /api/sandbox     start over
 */
const KEY = "sandbox-budget";
const MAX = 400_000;   // characters: far more than a budget needs, small enough that a mistake can't fill the store

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  if (!mayCost(adminWho(req))) return fail("Only ONGIA's president and VP of operations can open the Sandbox.", 403);
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
