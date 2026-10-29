// The Sandbox's one saved budget (Andrew 29 Oct 2026): the president and the VP only, kept apart from every event.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
const F = REPO + "netlify/functions/";
const sandbox = (await import(F + "sandbox.mjs")).default;
const roster = (await import(F + "roster.mjs")).default;
const { listEvents } = await import(F + "lib/store.mjs");
const { issueSession } = await import(F + "lib/auth.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const as = (email, name) => ({ "x-admin-key": issueSession({ email, name }), "content-type": "application/json" });
const PRES = as("president@ongia.ca", "Andrew Hammond"), LEAD = as("treasurer@ongia.ca", "Raj Jaswal");
const call = async (method, body, headers = PRES) => { const r = await sandbox(new Request("http://localhost/api/sandbox", { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) })); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
await roster(new Request("http://localhost/api/roster", { headers: PRES }));
await call("DELETE");
ok("nothing saved yet: the page starts from the Summit's numbers", (await call("GET")).budget === null);
const before = ((await listEvents()) ?? []).length;
let r = await call("PUT", { budget: { v: 1, hotel: { rate: 210 }, people: [{ id: "p1", name: "Test", nights: ["2026-11-09"] }] } });
ok("a budget is saved", r.status === 200);
ok("and read back as it was", (await call("GET")).budget?.hotel?.rate === 210);
ok("no event is made or changed by it", ((await listEvents()) ?? []).length === before);
ok("a board member who isn't the president or VP is refused, reading and saving", (await call("GET", undefined, LEAD)).status === 403 && (await call("PUT", { budget: { v: 1 } }, LEAD)).status === 403);
ok("something too big is refused", (await call("PUT", JSON.stringify({ budget: { pad: "x".repeat(500_000) } }))).status === 413);
ok("rubbish is refused", (await call("PUT", "not json")).status === 400 && (await call("PUT", { nope: 1 })).status === 400);
r = await call("DELETE");
ok("Start over clears it", r.status === 200 && (await call("GET")).budget === null);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
