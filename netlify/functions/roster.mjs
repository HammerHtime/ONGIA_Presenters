import { json, fail, requireAdmin, text, isEmail } from "./lib/http.mjs";
import { getRoster, putRoster } from "./lib/store.mjs";

/**
 * The board roster the event form picks from. Seeded once from the ONGIA
 * directory; edited here rather than typed into every event.
 *
 *   GET /api/roster          { members: [{ name, email }] }
 *   PUT /api/roster          replace the list
 */
const SEED = [
  ["Andrew Hammond", "president@ongia.ca"],
  ["Andy Bain", "a.bain@ongia.ca"],
  ["Barb Konkle", "b.konkle@ongia.ca"],
  ["Derek Sullivan", "d.sullivan@ongia.ca"],
  ["Inis Artinian", "i.artinian@ongia.ca"],
  ["Jacqulyn Taylor", "vp_operations@ongia.ca"],
  ["Jessy Johal", "j.johal@ongia.ca"],
  ["John Healy", "j.healy@ongia.ca"],
  ["Kully", "business@ongia.ca"],
  ["Peglar Artinian", "p.artinian@ongia.ca"],
  ["Raj Jaswal", "treasurer@ongia.ca"],
  ["Ryan Ferry", "westerncanada@ongia.ca"],
  ["Sebastien Pitre", "RegionalDirEastern@ongia.ca"],
  ["Stephen Hammond", "s.hammond@ongia.ca"],
  ["Tyler Zrymiak", "regionaldirectorc@ongia.ca"],
].map(([name, email]) => ({ name, email }));

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);

  if (req.method === "GET") {
    let members = await getRoster();
    if (!members) { members = SEED; await putRoster(members); }
    return json({ members });
  }
  if (req.method === "PUT") {
    const body = await req.json().catch(() => null);
    const rows = Array.isArray(body?.members) ? body.members : null;
    if (!rows) return fail("Expected { members: [...] }.");
    const members = [];
    for (const row of rows.slice(0, 100)) {
      const name = text(row.name, 120), email = text(row.email, 200);
      if (!name || !isEmail(email)) return fail(`"${name || email}" needs a name and a valid email.`);
      members.push({ name, email });
    }
    await putRoster(members);
    return json({ members });
  }
  return fail("Method not allowed.", 405);
};
