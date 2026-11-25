// A board member's role on the board list (Andrew 25 Nov 2026: "I could check off who's president, who's vp and our
// advisors"): read by the board review; it gives nobody any access. Made-up people.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const F = REPO + "netlify/functions/";
const roster = (await import(F + "roster.mjs")).default;
const S = await import(F + "lib/store.mjs");
const { issueSession } = await import(F + "lib/auth.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const call = async (method, body, who = "key") => {
  const headers = { "content-type": "application/json", "x-admin-key": who === "key" ? "testkey" : issueSession({ email: who, name: who }) };
  const r = await roster(new Request("http://x/api/roster", { method, headers, body: body ? JSON.stringify(body) : undefined }));
  return { status: r.status, ...(await r.json()) };
};
await S.putRoster([{ name: "Pat Chair", email: "pat@example.ca" }, { name: "Vic Deputy", email: "vic@example.ca" }, { name: "Ada Advisor", email: "ada@example.ca" }, { name: "Dee Director", email: "dee@example.ca", desk: true }]);
const base = (await call("GET")).members;
ok("everyone comes back a director, not in the 360, not first year, until ticked", base.every((m) => m.role === "" && m.review === false && m.firstYear === false));
const set = (roles) => base.map((m) => ({ ...m, role: roles[m.email] ?? m.role }));
let r = await call("PUT", { members: set({ "pat@example.ca": "president", "vic@example.ca": "vp" }).map((m) => ({ ...m, review: m.email !== "ada@example.ca", firstYear: m.email === "dee@example.ca" })) });
ok("roles are saved", r.status === 200 && r.members.find((m) => m.email === "pat@example.ca").role === "president" && r.members.find((m) => m.email === "vic@example.ca").role === "vp");
ok("the 360 and first-year ticks are saved; an advisor is just left unticked", r.members.find((m) => m.email === "ada@example.ca").review === false && r.members.find((m) => m.email === "pat@example.ca").review === true && r.members.find((m) => m.email === "dee@example.ca").firstYear === true);
// An advisor (Andrew 25 Nov 2026): never in the 360, even if the tick is sent; several can be advisors.
r = await call("PUT", { members: r.members.map((m) => (m.email === "ada@example.ca" ? { ...m, role: "advisor", review: true, firstYear: true } : m)) });
const ada = r.members.find((m) => m.email === "ada@example.ca");
ok("an advisor is saved, and can't be in the 360 or first year even if ticked", ada.role === "advisor" && ada.review === false && ada.firstYear === false, JSON.stringify(ada));
// Someone just made VP is ticked for the 360; unticking them afterwards sticks.
await call("PUT", { members: r.members.map((m) => (m.email === "vic@example.ca" ? { ...m, role: "", review: false } : m)) });
r = await call("PUT", { members: (await call("GET")).members.map((m) => (m.email === "vic@example.ca" ? { ...m, role: "vp", review: false } : m)) });
ok("picking VP ticks the 360", r.members.find((m) => m.email === "vic@example.ca").review === true);
r = await call("PUT", { members: r.members.map((m) => (m.email === "vic@example.ca" ? { ...m, review: false } : m)) });
ok("…and it can be unticked after", r.members.find((m) => m.email === "vic@example.ca").review === false);
ok("a role that isn't one is ignored", (await call("PUT", { members: r.members.map((m) => (m.email === "dee@example.ca" ? { ...m, role: "king" } : m)) })).members.find((m) => m.email === "dee@example.ca").role === "");
r = await call("PUT", { members: (await call("GET")).members.map((m) => (m.email === "dee@example.ca" ? { ...m, role: "president" } : m)) });
ok("one president: the one just picked takes it over", r.members.filter((m) => m.role === "president").map((m) => m.email).join() === "dee@example.ca");
// Someone who isn't the president can't change roles (only the president gives roles, as with desk access).
r = await call("PUT", { members: r.members.map((m) => (m.email === "dee@example.ca" ? { ...m, role: "", review: false } : m)) }, "dee@example.ca");
ok("a director can't change anyone's role or ticks", r.status === 200 && r.members.find((m) => m.email === "dee@example.ca").role === "president" && r.members.find((m) => m.email === "dee@example.ca").review === true);
ok("a role changes nobody's desk access", r.members.find((m) => m.email === "pat@example.ca").desk === false && r.members.find((m) => m.email === "dee@example.ca").desk === true);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
