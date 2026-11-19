// Saving an event brings its volunteer lead's address up to date from the roster (Andrew 19 Nov 2026: the Summit's
// volunteer lead still had Peglar's old address).
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const F = REPO + "netlify/functions/";
const S = await import(F + "lib/store.mjs");
const events = (await import(F + "events.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await S.putRoster([{ name: "Andrew Hammond", email: "president@ongia.ca" }, { name: "Peglar Artinian", email: "executiveofficer@ongia.ca", phone: "647-224-4532" }]);
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const made = await (await events(new Request("http://x/api/events", { method: "POST", headers: H, body: JSON.stringify({ title: "Summit test", city: "Toronto, ON", dayOne: "2027-03-01", invite: false,
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }, { name: "Peglar Artinian", email: "executiveofficer@ongia.ca" }, { name: "Peglar Artinian", email: "p.artinian@ongia.ca" }] }) }))).json();
const id = made.event.id;
const ev = await S.getEvent(id); ev.volunteerLead = { name: "Peglar Artinian", email: "p.artinian@ongia.ca", phone: "" }; await S.putEvent(ev);
const r = await events(new Request(`http://x/api/events?id=${id}`, { method: "PUT", headers: H, body: JSON.stringify(await S.getEvent(id)) }));
const after = await S.getEvent(id);
ok("the save goes through", r.status === 200, r.status);
ok("the volunteer lead takes the roster's address and phone", after.volunteerLead.email === "executiveofficer@ongia.ca" && after.volunteerLead.phone === "647-224-4532", JSON.stringify(after.volunteerLead));
ok("Peglar once on the board, the old address nowhere", after.board.filter((m) => m.name === "Peglar Artinian").length === 1 && !JSON.stringify([after.board, after.notify, after.volunteerLead]).includes("p.artinian"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
