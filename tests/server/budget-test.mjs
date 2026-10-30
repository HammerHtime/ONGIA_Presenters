// An event's own budget on its Money tab (Andrew 30 Oct 2026: "build the ONGIA event budgets"): kept per event, for the
// president and the VP only, starting from what the event's records say (the rooming list, the hotel contract, the board).
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
delete process.env.RESEND_API_KEY; delete process.env.MS_MAIL_FROM;
const F = REPO + "netlify/functions/";
const events = (await import(F + "events.mjs")).default;
const budget = (await import(F + "budget.mjs")).default;
const rooming = (await import(F + "rooming.mjs")).default;
const roster = (await import(F + "roster.mjs")).default;
const { issueSession } = await import(F + "lib/auth.mjs");
const { cleanMoney, tidy } = await import(F + "lib/contract.mjs");
const { putContractRead, getMeta } = await import(F + "lib/store.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const PRES = { "x-admin-key": issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" }), "content-type": "application/json" };
const LEAD = { "x-admin-key": issueSession({ email: "treasurer@ongia.ca", name: "Raj Jaswal" }), "content-type": "application/json" };
const call = async (h, url, method = "GET", body, headers = PRES) => { const r = await h(new Request("http://localhost" + url, { method, headers, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
await call(roster, "/api/roster");
const T = Date.now().toString(36);

console.log("— the hotel contract's amounts");
const m = cleanMoney({ roomRate: 205, roomTaxPct: "8.5%", blockNights: 619.4, minimumPct: 80, fbMinimum: "$10,000", servicePct: 13.6, adminPct: 4.4, rebatePerNight: 10, facilityFee: -5 });
ok("numbers come through, written ones are read, a negative is left out", m.roomRate === 205 && m.roomTaxPct === 8.5 && m.blockNights === 619 && m.fbMinimum === 10000 && m.facilityFee === null, JSON.stringify(m));
ok("a contract read with no amounts gives nulls, never a guess", Object.values(tidy({ dates: [] }, null).money).every((v) => v === null));

console.log("— one event's budget");
const ev = (await call(events, "/api/events", "POST", { title: `Budget Test ${T}`, city: "Regina, SK", venue: "Delta Regina", dayOne: "2031-05-12", lastDay: "2031-05-14", invite: false,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }, { name: "Andrew Hammond", email: "president@ongia.ca" }],
  hotel: { name: "Delta Regina", rate: "$189 per night plus taxes", cutoff: "2031-04-11" } })).event;
await call(rooming, `/api/rooming?event=${ev.id}`, "PUT", { guests: [{ name: "Pat Example", type: "ONGIA Guest", checkIn: "2031-05-11", checkOut: "2031-05-14", billing: "ONGIA" }] });
let r = await call(budget, `/api/budget?event=${ev.id}`);
ok("a new event has no budget saved yet", r.status === 200 && r.budget === null);
const L = r.live;
ok("what the records say: the dates, the hotel, Saskatchewan's GST", L.event.dayOne === "2031-05-12" && L.event.hotel === "Delta Regina" && L.province === "SK" && L.salesTax === 5 && L.salesTaxName === "GST", JSON.stringify({ e: L.event, p: L.province, t: L.salesTax }));
ok("the rate is read from the hotel's wording until a contract says otherwise", L.hotel.rate === 189 && L.hotel.cutoff === "2031-04-11");
const pat = L.people.find((p) => p.name === "Pat Example");
ok("the rooming list comes in: each person's nights, the night of check-out not counted", pat && pat.nights.join() === "2031-05-11,2031-05-12,2031-05-13" && pat.billing === "ONGIA" && pat.group === "other", JSON.stringify(pat));
ok("the board on the event comes too", L.board.map((b) => b.name).sort().join() === "Andrew Hammond,Raj Jaswal");

await putContractRead(ev.id, { state: "done", at: new Date().toISOString(), name: "c.pdf", found: tidy({ hotelName: "Delta Regina", rate: "$189", money: { roomRate: 179, roomTaxPct: 3, blockNights: 120, minimumPct: 80, fbMinimum: 5000, servicePct: 15, adminPct: 3, rebatePerNight: null, facilityFee: null },
  dates: [{ kind: "deposit", what: "First deposit", date: "2031-01-15", quote: "x", page: 2 }] }, null, "2030-01-01") });
r = await call(budget, `/api/budget?event=${ev.id}`);
ok("once the contract is read, its amounts and dates are there for the budget", r.live.contract.money.roomRate === 179 && r.live.hotel.rate === 179 && r.live.contract.money.blockNights === 120 && r.live.contract.dates[0].what === "First deposit", JSON.stringify(r.live.contract));

const B = { v: 1, asked: true, reg: { inPerson: { on: true, price: 450, expected: 120 } }, people: [{ id: "x", name: "Pat Example", nights: [] }] };
r = await call(budget, `/api/budget?event=${ev.id}`, "PUT", { budget: B });
ok("saved, and there on the next open", r.status === 200 && (await call(budget, `/api/budget?event=${ev.id}`)).budget.reg.inPerson.price === 450);
ok("a lead, who never sees the money, is refused it", (await call(budget, `/api/budget?event=${ev.id}`, "GET", undefined, LEAD)).status === 403 && (await call(budget, `/api/budget?event=${ev.id}`, "PUT", { budget: B }, LEAD)).status === 403);
ok("nonsense isn't kept", (await call(budget, `/api/budget?event=${ev.id}`, "PUT", { budget: [1] })).status === 400 && (await call(budget, `/api/budget?event=${ev.id}`, "PUT", { budget: { x: "y".repeat(410_000) } })).status === 413);
r = await call(budget, `/api/budget?event=${ev.id}`, "DELETE");
ok("Start over clears it and hands back the records to start again from", r.status === 200 && r.live?.event && (await call(budget, `/api/budget?event=${ev.id}`)).budget === null);

const rbh = (await call(events, "/api/events", "POST", { title: `RBH Budget ${T}`, city: "Montreal", dayOne: "2031-06-02", lastDay: "2031-06-02", invite: false, kind: "rbh", province: "QC", invoicePrefix: "BUD",
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }] })).event;
ok("an RBH event's money stays on its statement of work", (await call(budget, `/api/budget?event=${rbh.id}`)).status === 409);

await call(budget, `/api/budget?event=${ev.id}`, "PUT", { budget: B });
await call(events, `/api/events?id=${ev.id}`, "DELETE");
ok("deleting the event deletes its budget", !(await getMeta(`budget:${ev.id}`)));
await call(events, `/api/events?id=${rbh.id}`, "DELETE");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
