// The events list says where each hotel contract stands (Andrew 21 Nov 2026: "I need a way to see which events the
// contract has been signed and locked in"): signed in the app, uploaded, or none; an RBH event's only for the president
// and the VP.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const F = REPO + "netlify/functions/";
const S = await import(F + "lib/store.mjs");
const events = (await import(F + "events.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey" };
for (const [id, kind] of [["lc-none", ""], ["lc-in", ""], ["lc-signed", ""], ["lc-rbh", "rbh"]]) await S.putEvent({ id, title: id, kind, dayOne: "2027-05-01", board: [] });
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]);
await S.putContract("lc-in", pdf, { name: "c.pdf", uploadedAt: "2026-11-01" });
await S.putContract("lc-signed", pdf, { name: "c.pdf", uploadedAt: "2026-11-01" }); await S.putContractSign("lc-signed", { state: "done" });
await S.putContract("lc-rbh", pdf, { name: "c.pdf", uploadedAt: "2026-11-01" }); await S.putContractSign("lc-rbh", { state: "done" });
const list = (await (await events(new Request("http://x/api/events", { headers: H }))).json()).events;
const of = (id) => list.find((e) => e.id === id)?.contract;
ok("no contract: null", of("lc-none") === null);
ok("uploaded, not signed: in", of("lc-in") === "in");
ok("signed in the app: signed", of("lc-signed") === "signed");
ok("an RBH event's, for the president's key: signed", of("lc-rbh") === "signed");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
