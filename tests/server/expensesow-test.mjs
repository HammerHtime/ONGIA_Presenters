// Expenses on an RBH event's statement of work (Andrew 4 Nov 2026): "my Air Canada return flight to Victoria … what line
// item do I attach it to … once it's submitted and approved, boom, it gets attached to the SOW as a cost. None of those
// actual receipts, if it's a fixed fee line item, ever goes to RBH … at the end of the event, look what it actually cost
// … as the president … change the line item it's attached to."
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
delete process.env.MS_TENANT_ID; delete process.env.MS_CLIENT_ID; delete process.env.MS_CLIENT_SECRET;
const F = REPO + "netlify/functions/";
const store = await import(F + "lib/store.mjs");
const { putEvent, putSow, getSow, getReceipts, putClaim, putClaimLine, putClaimFile, getReceiptFile } = store;
const { cleanLine, viewLine, eventChoices, sowLinesFor } = await import(F + "lib/expenses.mjs");
const { syncClaimToSow } = await import(F + "lib/sowexpense.mjs");
const { withReceipts } = await import(F + "lib/receipts.mjs");
const { totals } = await import(F + "lib/sow.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };

const event = { id: "vic", kind: "rbh", title: "Canadian Forum Against Organized Crime - Western Symposium", city: "Victoria, BC", dayOne: "2026-11-24", lastDay: "2026-11-24", board: [] };
await putEvent(event);
await putSow("vic", { status: "approved", lines: [
  { id: "hotel", name: "Hotel", type: "cost", estimate: 4000 },
  { id: "onsite", name: "On Site Management", type: "fixed", estimate: 7000 },
  { id: "inc", name: "Incidentals", type: "cost", estimate: 4000 },
], taxes: [] });
const sow = await getSow("vic");
const events = [{ ...eventChoices([event], "2026-11-04")[0], sowLines: sowLinesFor(event, sow) }];
ok("the event offers its statement of work's lines, with what each is for and whether RBH is billed, and no amounts",
  events[0].sowLines.length === 3 && /flights/.test(events[0].sowLines[1].help) && /never billed to RBH/.test(events[0].sowLines[1].help) && /Billed to RBH at cost/.test(events[0].sowLines[0].help) && !JSON.stringify(events[0].sowLines).includes("7000"));

// The flight: Travel, Air Canada → On Site Management, suggested.
const flight = cleanLine("receipt", { paidTo: "Air Canada", date: "2026-11-01", amount: 1130, category: 8, eventId: "vic", purpose: "Return flight to Victoria" }, { events });
ok("a flight on the Victoria event is suggested for On Site Management", flight.sowLineId === "onsite" && flight.sowSuggested === true && flight.sowLineName === "On Site Management");
const hotel = cleanLine("receipt", { paidTo: "Delta Hotels Victoria Ocean Pointe", amount: 678, category: 8, eventId: "vic" }, { events });
ok("a hotel folio is suggested for Hotel", hotel.sowLineId === "hotel");
const none = cleanLine("receipt", { paidTo: "Staples", amount: 20, category: 5, eventId: "vic", sowLineId: "" }, { events });
ok("with no line picked, the line can't be sent: it says which line is missing", viewLine({ kind: "receipt", ...none }).problems.includes("which line of the event's statement of work"));
ok("an event without a statement of work asks nothing", cleanLine("receipt", { paidTo: "X", amount: 1, category: 8, eventId: "" }, { events }).sowNeeded === false);
const kept = cleanLine("receipt", { paidTo: "Air Canada", amount: 1130, category: 8, eventId: "vic" }, { events, had: { eventId: "vic", sowLineId: "inc" } });
ok("a line picked before is kept when the form doesn't send it", kept.sowLineId === "inc");

// A claim with the flight and the hotel, approved.
const claim = { id: "c1abc", status: "submitted", owner: { email: "president@ongia.ca", name: "Andrew Hammond" }, sentAt: "2026-11-02T00:00:00Z" };
await putClaim(claim);
await putClaimLine("c1abc", { id: "l1flight", kind: "receipt", file: true, ...flight });
await putClaimLine("c1abc", { id: "l2hotel", kind: "receipt", file: true, ...hotel });
await putClaimFile("file", "c1abc", "l1flight", new TextEncoder().encode("%PDF-1.4 flight"), { name: "aircanada.pdf", type: "application/pdf" });
const lines = async () => (await store.listClaimLines("c1abc"));
await syncClaimToSow(claim, await lines());
ok("nothing goes on the statement of work before the claim is approved", (await getReceipts("vic")).items.length === 0);

claim.status = "approved";
await syncClaimToSow(claim, await lines());
let items = (await getReceipts("vic")).items;
const fl = items.find((i) => i.source?.line === "l1flight");
ok("approved: the flight is on the event's receipts under On Site Management, before tax, with the claimant as payer",
  fl && fl.lineId === "onsite" && fl.total === 1130 && fl.tax === 130 && fl.amount === 1000 && fl.paidBy?.email === "president@ongia.ca", JSON.stringify(fl));
ok("its receipt file is on the event too", !!(await getReceiptFile("vic", fl.id)));
await syncClaimToSow(claim, await lines());
ok("syncing again adds nothing twice", (await getReceipts("vic")).items.length === 2);

// What RBH is billed: the fixed fee stays the fee; the hotel (at cost) is its receipts.
const before = totals(withReceipts(sow, []), "actual");
const after = totals(withReceipts(sow, (await getReceipts("vic")).items), "actual");
const line = (t, id) => t.lines.find((l) => l.id === id).amount;
ok("THE FIXED FEE IS UNCHANGED: On Site Management bills $7,000 with or without the flight", line(before, "onsite") === 7000 && line(after, "onsite") === 7000);
ok("the hotel, billed at cost, is what its receipts add up to (before tax)", line(after, "hotel") === 600, line(after, "hotel"));
const shown = withReceipts(sow, (await getReceipts("vic")).items).lines.find((l) => l.id === "onsite");
ok("the event still shows what On Site Management actually cost: $1,000 of the $7,000", shown.receiptsTotal === 1000 && shown.estimate === 7000);

// The President moves the flight to Incidentals: it moves on the event.
await putClaimLine("c1abc", { ...(await store.getClaimLine("c1abc", "l1flight")), sowLineId: "inc", sowLineName: "Incidentals" });
await syncClaimToSow(claim, await lines());
items = (await getReceipts("vic")).items;
ok("moved: the flight now counts under Incidentals, still once", items.filter((i) => i.source?.line === "l1flight").length === 1 && items.find((i) => i.source?.line === "l1flight").lineId === "inc");

// Sent back: it comes off; approved again: back on.
claim.status = "rejected";
const off = await syncClaimToSow(claim, await lines());
ok("sent back: its receipts come off the statement of work", (await getReceipts("vic")).items.length === 0 && off.touched.includes("vic"));
claim.status = "approved"; claim.sowEvents = off.events;
await syncClaimToSow(claim, await lines());
ok("approved again: back on", (await getReceipts("vic")).items.length === 2);

// A test claim never touches the event.
const t = { id: "c2test", status: "approved", test: true, owner: { email: "x@ongia.ca", name: "X" } };
await putClaim(t); await putClaimLine("c2test", { id: "l1", kind: "receipt", ...flight });
await syncClaimToSow(t, await store.listClaimLines("c2test"));
ok("a test claim never goes on a statement of work", (await getReceipts("vic")).items.length === 2);

// A receipt someone already uploaded to the event by hand is linked, not added twice.
const rec = await getReceipts("vic");
rec.items.push({ id: "manual1", lineId: "hotel", vendor: "Fairmont Empress", date: "2026-11-23", amount: 300, tax: 39, total: 339, currency: "CAD" });
await store.putReceipts("vic", rec);
const c3 = { id: "c3dup", status: "approved", owner: { email: "y@ongia.ca", name: "Y" } };
await putClaim(c3);
await putClaimLine("c3dup", { id: "l1", kind: "receipt", ...cleanLine("receipt", { paidTo: "Fairmont Empress", date: "2026-11-23", amount: 339, category: 8, eventId: "vic" }, { events }) });
await syncClaimToSow(c3, await store.listClaimLines("c3dup"));
items = (await getReceipts("vic")).items;
ok("the same receipt already on the event is linked, not counted twice", items.length === 3 && items.find((i) => i.id === "manual1").source?.claim === "c3dup");
c3.status = "rejected";
await syncClaimToSow(c3, await store.listClaimLines("c3dup"));
ok("and if that claim is sent back, the hand-uploaded receipt stays (only unlinked)", (await getReceipts("vic")).items.some((i) => i.id === "manual1" && !i.source));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
