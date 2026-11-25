import { json, fail, requireAdmin, adminWho, text, isEmail } from "./lib/http.mjs";
import { deskOwners, isOwner } from "./lib/auth.mjs";
import { formatPhone } from "./lib/phone.mjs";
import { getRoster, putRoster, listEvents, putEvent } from "./lib/store.mjs";

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

/** A board member's place on the board: "" (a director), president, vp or advisor (not reviewed in the board review). */
const ROLES = ["president", "vp", "advisor"];

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);

  if (req.method === "GET") {
    let members = await getRoster();
    if (!members) { members = SEED; await putRoster(members); }
    // Rows stored before phones existed have none; answer with the field present.
    const who = adminWho(req);
    return json({ members: members.map((m) => ({ phone: "", bonvoy: "", sponsorLead: false, desk: false, role: "", ...m })),
      owners: deskOwners(), canGrant: who.key === true || isOwner(who.email) });
  }
  if (req.method === "PUT") {
    const body = await req.json().catch(() => null);
    const rows = Array.isArray(body?.members) ? body.members : null;
    if (!rows) return fail("Expected { members: [...] }.");
    const who = adminWho(req);
    const canGrant = who.key === true || isOwner(who.email);
    const before = new Map(((await getRoster()) ?? []).map((m) => [String(m.email).toLowerCase(), m]));
    const members = [], moved = [];
    for (const row of rows.slice(0, 100)) {
      const name = text(row.name, 120), email = text(row.email, 200);
      if (!name || !isEmail(email)) return fail(`"${name || email}" needs a name and a valid email.`);
      // `was` is the address they had before this save, when it is being changed.
      const was = before.get(String(text(row.was, 200) || email).toLowerCase()) ?? before.get(email.toLowerCase());
      if (was && String(was.email).toLowerCase() !== email.toLowerCase()) moved.push({ from: String(was.email).toLowerCase(), to: email, name });
      // The Marriott Bonvoy number goes on the rooming list beside their name (Andrew 29 Oct 2026).
      members.push({ name, email, phone: formatPhone(text(row.phone, 60)), bonvoy: text(row.bonvoy, 40).replace(/[^0-9A-Za-z]/g, "").slice(0, 20), sponsorLead: row.sponsorLead === true,
        desk: canGrant ? row.desk === true : was?.desk === true,
        // Their place on the board (Andrew 25 Nov 2026: "I could check off who's president, who's vp and our advisors"):
        // read by the board review. It gives no access: the desk's owners and costs stay with the site's settings.
        role: canGrant ? (ROLES.includes(row.role) ? row.role : "") : (was?.role ?? ""),
        ...(was?.lastSignIn ? { lastSignIn: was.lastSignIn } : {}),
        // When they last opened ONGIA Expenses (see expenses.mjs): kept through a save here, as the desk sign-in is.
        ...(was?.lastExpenseSignIn ? { lastExpenseSignIn: was.lastExpenseSignIn } : {}) });
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
    // One president and one VP: the one just picked wins (the first in the list that changed to it, else the first).
    for (const r of ["president", "vp"]) {
      const picked = members.filter((m) => m.role === r);
      if (picked.length < 2) continue;
      const keep = picked.find((m) => before.get(m.email.toLowerCase())?.role !== r) ?? picked[0];
      for (const m of picked) if (m !== keep) m.role = "";
    }
    await putRoster(members);
    // A board member's address changed here follows them onto every event they're on (Andrew 17 Nov 2026: Tyler's
    // was mistyped, and three events kept the wrong one): the board list, the lead's reviewer and contact, who is told.
    const updated = moved.length ? await moveAddresses(moved) : [];
    return json({ members, owners: deskOwners(), canGrant, ...(updated.length ? { eventsUpdated: updated } : {}) });
  }
  return fail("Method not allowed.", 405);
};

/** Each { from, to } address swapped on every event's board, reviewer, contact, notify list and volunteer lead. Returns the events changed. */
async function moveAddresses(moved) {
  const map = new Map(moved.map((m) => [m.from, m.to]));
  const swap = (e) => map.get(String(e ?? "").toLowerCase()) ?? e;
  const changed = [];
  for (const ev of await listEvents()) {
    const hit = (ev.board ?? []).some((m) => map.has(String(m.email ?? "").toLowerCase())) || map.has(String(ev.reviewer?.email ?? "").toLowerCase()) || map.has(String(ev.contact?.email ?? "").toLowerCase()) || map.has(String(ev.volunteerLead?.email ?? "").toLowerCase()) || (ev.notify ?? []).some((e) => map.has(String(e).toLowerCase()));
    if (!hit) continue;
    ev.board = (ev.board ?? []).map((m) => ({ ...m, email: swap(m.email) }));
    if (ev.reviewer?.email) ev.reviewer = { ...ev.reviewer, email: swap(ev.reviewer.email) };
    if (ev.contact?.email) ev.contact = { ...ev.contact, email: swap(ev.contact.email) };
    // The volunteer lead is a copy too (Andrew 19 Nov 2026: Peglar's old address was still the Summit's volunteer lead).
    if (ev.volunteerLead?.email) ev.volunteerLead = { ...ev.volunteerLead, email: swap(ev.volunteerLead.email) };
    if (Array.isArray(ev.notify)) ev.notify = ev.notify.map(swap);
    ev.updatedAt = new Date().toISOString();
    await putEvent(ev);
    changed.push({ id: ev.id, title: ev.title });
  }
  return changed;
}
