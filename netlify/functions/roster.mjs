import { json, fail, requireAdmin, adminWho, text, isEmail } from "./lib/http.mjs";
import { deskOwners, isOwner } from "./lib/auth.mjs";
import { formatPhone } from "./lib/phone.mjs";
import { getRoster, putRoster } from "./lib/store.mjs";

/**
 * The board roster the event form picks from. Seeded once from the ONGIA
 * directory; edited here rather than typed into every event.
 *
 *   GET /api/roster          { members: [{ name, email, phone, desk, lastSignIn }], owners, canGrant }
 *   PUT /api/roster          replace the list (a row may carry `was`: the address it is changing from)
 *
 * `desk` is whether that person may sign in to the desk with their Microsoft
 * account. Only an owner (DESK_OWNERS) or the shared key can change it; anyone
 * else's save keeps the switches exactly as they were.
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
  ["Peglar Artinian", "executiveofficer@ongia.ca"],
  ["Raj Jaswal", "treasurer@ongia.ca"],
  ["Ryan Ferry", "westerncanada@ongia.ca"],
  ["Sebastien Pitre", "RegionalDirEastern@ongia.ca"],
  ["Stephen Hammond", "s.hammond@ongia.ca"],
  ["Tyler Zrymiak", "regionaldirectorc@ongia.ca"],
].map(([name, email]) => ({ name, email, phone: "" }));

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);

  if (req.method === "GET") {
    let members = await getRoster();
    if (!members) { members = SEED; await putRoster(members); }
    // Rows stored before phones existed have none; answer with the field present.
    const who = adminWho(req);
    return json({ members: members.map((m) => ({ phone: "", sponsorLead: false, desk: false, ...m })),
      owners: deskOwners(), canGrant: who.key === true || isOwner(who.email) });
  }
  if (req.method === "PUT") {
    const body = await req.json().catch(() => null);
    const rows = Array.isArray(body?.members) ? body.members : null;
    if (!rows) return fail("Expected { members: [...] }.");
    const who = adminWho(req);
    const canGrant = who.key === true || isOwner(who.email);
    const before = new Map(((await getRoster()) ?? []).map((m) => [String(m.email).toLowerCase(), m]));
    const members = [];
    for (const row of rows.slice(0, 100)) {
      const name = text(row.name, 120), email = text(row.email, 200);
      if (!name || !isEmail(email)) return fail(`"${name || email}" needs a name and a valid email.`);
      // `was` is the address they had before this save, when it is being changed.
      const was = before.get(String(text(row.was, 200) || email).toLowerCase()) ?? before.get(email.toLowerCase());
      members.push({ name, email, phone: formatPhone(text(row.phone, 60)), sponsorLead: row.sponsorLead === true,
        desk: canGrant ? row.desk === true : was?.desk === true,
        ...(was?.lastSignIn ? { lastSignIn: was.lastSignIn } : {}) });
    }
    const seen = new Set();
    for (const m of members) {
      const k = m.email.toLowerCase();
      if (seen.has(k)) return fail(`${m.email} is already on the list.`);
      seen.add(k);
    }
    // One person carries sponsorship for all of ONGIA, so the flag is a radio,
    // not a checkbox: the last one ticked wins and the rest are cleared.
    const leadAt = members.findIndex((m) => m.sponsorLead);
    members.forEach((m, i) => { m.sponsorLead = i === leadAt; });
    await putRoster(members);
    return json({ members, owners: deskOwners(), canGrant });
  }
  return fail("Method not allowed.", 405);
};
