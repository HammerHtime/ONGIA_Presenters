// The event board thank-you goes to the roster's addresses (Andrew 19 Nov 2026: "The board thank you letters still has
// Peglar old email"). The Summit's board held Peglar twice, once at an address that no longer exists.
const REPO = new URL("../../", import.meta.url).pathname;
const F = REPO + "netlify/functions/";
const S = await import(F + "lib/store.mjs");
const T = await import(F + "lib/thanks.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await S.putRoster([
  { name: "Andrew Hammond", email: "president@ongia.ca" },
  { name: "Peglar Artinian", email: "executiveofficer@ongia.ca" },
  { name: "Inis Artinian", email: "membership@ongia.ca" },
]);
await S.putEvent({ id: "ev-r", title: "Summit", dayOne: "2026-11-09", board: [
  { name: "Andrew Hammond", email: "president@ongia.ca", lead: true },
  { name: "Inis Artinian", email: "membership@ongia.ca" },
  { name: "Peglar Artinian", email: "executiveofficer@ongia.ca" },
  { name: "Peglar Artinian", email: "p.artinian@ongia.ca" },
  { name: "Guest Speaker", email: "guest@example.ca" },
], boardThanksPeople: { "executiveofficer@ongia.ca": { thanked: "2026-11-19T17:15:00Z" } } });
const people = await T.KINDS.board.list("ev-r");
const em = people.map((p) => p.email);
ok("Peglar once, at the roster's address", em.filter((e) => /artinian|executiveofficer/.test(e) && e !== "membership@ongia.ca").join() === "executiveofficer@ongia.ca", em.join());
ok("the old address is gone", !em.includes("p.artinian@ongia.ca"));
ok("Inis, a different Artinian, keeps her own", em.includes("membership@ongia.ca"));
ok("someone not on the roster stays as entered", em.includes("guest@example.ca"));
ok("what's been sent is kept", people.find((p) => p.email === "executiveofficer@ongia.ca").thanked === "2026-11-19T17:15:00Z");
ok("a roster address that changes is followed", T.rosterBoard([{ name: "peglar  artinian", email: "old@ongia.ca" }], [{ name: "Peglar Artinian", email: "new@ongia.ca" }])[0].email === "new@ongia.ca");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
