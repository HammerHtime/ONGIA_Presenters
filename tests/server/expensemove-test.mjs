// The President or the VP moves an expense to another event, or to none (Andrew 26 Nov 2026: Inis's claim had a
// preferred seat on an RBH event; "ONGIA will pay it out but not attached to the RBH event. RBH should not be billed for
// a preferred seat"). Made-up claim; the event is a sample RBH event with a statement of work.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.MS_TENANT_ID; delete process.env.MS_CLIENT_ID; delete process.env.MS_CLIENT_SECRET;
const F = REPO + "netlify/functions/";
const exp = (await import(F + "expenses.mjs")).default;
const roster = (await import(F + "roster.mjs")).default;
const X = await import(F + "lib/expenses.mjs");
const S = await import(F + "lib/store.mjs");
const { syncClaimToSow } = await import(F + "lib/sowexpense.mjs");
const { todayIso } = await import(F + "lib/deadlines.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const as = (email, name = email) => ({ "x-expense-key": X.issueExpenseSession({ email, name }), "content-type": "application/json" });
const call = async (url, method = "GET", body, headers) => { const r = await exp(new Request("http://localhost" + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })); return { status: r.status, ...(await r.json()) }; };
await roster(new Request("http://localhost/api/roster", { headers: { "x-admin-key": "testkey" } }));
const day = (n) => todayIso(new Date(Date.now() + n * 86400e3));
const PRES = as("president@ongia.ca", "Andrew Hammond"), VP = as("vp_operations@ongia.ca", "Jacqulyn Taylor"), INIS = as("membership@ongia.ca", "Inis Artinian"), DEREK = as("d.sullivan@ongia.ca", "Derek Sullivan");

await S.putEvent({ id: "rbhx", kind: "rbh", title: "Sample RBH Training", city: "Montreal", dayOne: day(-3), lastDay: day(-2), board: [] });
await S.putEvent({ id: "ongx", title: "Sample Symposium", city: "Regina", dayOne: day(30), lastDay: day(31), board: [] });
await S.putSow("rbhx", { status: "approved", lines: [{ id: "travel", name: "Travel", type: "cost", estimate: 3000 }, { id: "inc", name: "Incidentals", type: "cost", estimate: 500 }], taxes: [] });
const claim = { id: "mv1abc", status: "submitted", owner: { email: "membership@ongia.ca", name: "Inis Artinian" }, sentAt: new Date().toISOString(), history: [] };
await S.putClaim(claim);
await S.putClaimLine("mv1abc", { id: "seatline1", kind: "noreceipt", paidTo: "Air Canada preferred seat", date: day(-4), amount: 64, category: 8, eventId: "rbhx", eventTitle: "Sample RBH Training", sowLineId: "travel", sowLineName: "Travel", purpose: "Seat", statement: "On my card" });
await S.putClaimLine("mv1abc", { id: "fareline1", kind: "noreceipt", paidTo: "Air Canada fare", date: day(-4), amount: 400, category: 8, eventId: "rbhx", eventTitle: "Sample RBH Training", sowLineId: "travel", sowLineName: "Travel", purpose: "Flight", statement: "On my card" });
claim.status = "approved"; await S.putClaim(claim);
await syncClaimToSow(claim, await S.listClaimLines("mv1abc"));
claim.sowEvents = ["rbhx"]; await S.putClaim(claim);
const onSow = async () => (await S.getReceipts("rbhx")).items.filter((i) => i.source?.claim === "mv1abc").map((i) => i.source.line).sort().join();
ok("approved: the seat and the fare are on the RBH event's statement of work", (await onSow()) === "fareline1,seatline1");

const move = (who, line, eventId) => call(`/api/expenses?claim=mv1abc&line=${line}&moveevent=1`, "POST", { eventId }, who);
ok("Inis, who claimed it, can't move it", (await move(INIS, "seatline1", "")).status === 403);
ok("another board member can't either", (await move(DEREK, "seatline1", "")).status === 403);
let r = await move(PRES, "seatline1", "");
const seat = r.claim?.lines.find((l) => l.id === "seatline1");
ok("the President moves the seat off the event: Not for an event", r.status === 200 && seat.eventId === "" && seat.eventTitle === "" && seat.sowLineId === "", JSON.stringify(r).slice(0, 300));
ok("…it comes off RBH's statement of work; the fare stays", (await onSow()) === "fareline1");
ok("…what was claimed is unchanged: same amount, still on the approved claim", seat.amount === 64 && r.claim.status === "approved" && r.claim.sums.total === 464);
ok("…and the claim's history says who moved what", /moved Air Canada preferred seat from Sample RBH Training to no event/.test(r.claim.history.at(-1).what) && r.claim.history.at(-1).by === "Andrew Hammond");
r = await move(VP, "seatline1", "ongx");
ok("the VP can move it to another event", r.status === 200 && r.claim.lines.find((l) => l.id === "seatline1").eventTitle === "Sample Symposium");
r = await move(VP, "seatline1", "rbhx");
const back = r.claim.lines.find((l) => l.id === "seatline1");
ok("moved back to the RBH event, it asks for a statement of work line before it's billed", r.status === 200 && back.eventId === "rbhx" && back.sowLineId === "" && (await onSow()) === "fareline1");
ok("an event that isn't on the list is refused", (await move(PRES, "seatline1", "no-such-event")).status === 400);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
