// A board member's address changed under Settings › Board members follows them onto every event they're on (Andrew 17
// Nov 2026: Tyler Zrymiak's address was mistyped; three events kept the wrong one, one with him as lead).
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const F = REPO + "netlify/functions/";
const S = await import(F + "lib/store.mjs");
const roster = (await import(F + "roster.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (method, body) => { const r = await roster(new Request("http://localhost/api/roster", { method, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) })); return r.json(); };
const members = (await call("GET")).members;
await call("PUT", { members: [...members, { name: "Tyler Zrymiak", email: "regionaldirectorc@ongia.ca", phone: "" }] });
const OLD = "regionaldirectorc@ongia.ca", NEW = "regionaldircentral@ongia.ca";
await S.putEvent({ id: "re-lead", title: "Regina", board: [{ name: "Tyler Zrymiak", email: OLD, lead: true }, { name: "Andrew Hammond", email: "president@ongia.ca" }],
  reviewer: { name: "Tyler Zrymiak", email: OLD }, contact: { name: "Tyler Zrymiak", email: OLD }, notify: ["president@ongia.ca"] });
await S.putEvent({ id: "re-member", title: "Windsor", board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }, { name: "Tyler Zrymiak", email: OLD }],
  reviewer: { name: "Andrew Hammond", email: "president@ongia.ca" }, contact: { name: "Andrew Hammond", email: "president@ongia.ca" }, notify: [OLD] });
await S.putEvent({ id: "re-none", title: "Other", board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }], notify: [] });
const now = (await call("GET")).members;
const r = await call("PUT", { members: now.map((m) => (m.email === OLD ? { ...m, email: NEW, was: OLD } : m)) });
ok("the roster takes the new address", r.members.some((m) => m.email === NEW) && !r.members.some((m) => m.email === OLD));
const lead = await S.getEvent("re-lead"), mem = await S.getEvent("re-member"), none = await S.getEvent("re-none");
ok("where he leads: board, reviewer and contact all carry the new address, still lead", lead.board[0].email === NEW && lead.board[0].lead === true && lead.reviewer.email === NEW && lead.contact.email === NEW, JSON.stringify(lead));
ok("where he's a member: board and who is told", mem.board[1].email === NEW && mem.notify.includes(NEW) && !mem.notify.includes(OLD));
ok("an event he isn't on is untouched, and the answer names the two changed", !none.updatedAt && r.eventsUpdated?.map((e) => e.id).sort().join() === "re-lead,re-member", JSON.stringify(r.eventsUpdated));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
