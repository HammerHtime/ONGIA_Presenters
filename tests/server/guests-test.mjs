// Every Wix registration is a row of its own (Andrew, 21 Oct 2026: Wix showed 45 and the desk 26). An RSVP's "+ guests",
// two people sharing one email and every ticket count; letters still go once per address; rows saved the old way (one
// per address) hand over what they had, so nobody is written to twice and nobody shows as withdrawn by mistake.
const REPO = new URL("../../", import.meta.url).pathname;
const { attendeesOf } = await import(REPO + "netlify/functions/lib/wix.mjs");
const { merge, tally, writeableTo, keyOf } = await import(REPO + "netlify/functions/lib/attendees.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };

const g = (id, type, first, last, email, extra = {}) => ({ id, eventId: "wx1", first, last, email, phone: "", status: "ATTENDING", guestType: type, orderNumber: "", totalGuests: 1, guestNames: [], ...extra });
const guests = [
  g("r1", "RSVP", "Dana", "Sample", "coord@example.ca", { totalGuests: 3, guestNames: ["Pat Two"] }),   // brings two people, names one
  g("r2", "RSVP", "Lee", "Example", "coord@example.ca"),                                               // registered by the same coordinator
  g("b1", "BUYER", "Sam", "Buyer", "buyer@example.ca", { orderNumber: "O1" }),
  g("h1", "TICKET_HOLDER", "Ann", "Holder", "ann@example.ca", { orderNumber: "O1" }),
  g("h2", "TICKET_HOLDER", "", "", "", { orderNumber: "O1" }),                                         // a ticket with no details
  g("b2", "BUYER", "Solo", "Buyer", "solo@example.ca", { orderNumber: "O2" }),                         // an order with no ticket holders
];
const rows = attendeesOf(guests);
ok("every registration is a row: 3 for the RSVP with two guests, 1 more RSVP, 2 tickets, 1 buyer with no tickets", rows.length === 7, rows.map((r) => r.key).join(" "));
ok("an RSVP's named guest takes the name given", rows.some((r) => r.key === "wix:r1:2" && r.first === "Pat" && r.last === "Two"));
ok("an unnamed guest is the guest of whoever registered them", rows.some((r) => r.key === "wix:r1:3" && !r.first && r.guestOf === "Dana Sample"));
ok("two people sharing one email are both there", rows.filter((r) => r.email === "coord@example.ca").length === 4);
ok("a ticket with no email uses the buyer's, and says whose guest it is", rows.some((r) => r.key === "wix:h2" && r.email === "buyer@example.ca" && r.guestOf === "Sam Buyer"));
ok("a buyer whose order has tickets is not counted again", !rows.some((r) => r.key === "wix:b1"));

const toIncoming = (list) => list.map((x) => ({ key: x.key, first: x.first, last: x.last, email: x.email, phone: x.phone, organization: "", status: x.status, source: "wix", wixGuestId: x.id, ...(x.guestOf ? { guestOf: x.guestOf } : {}) }));
let out = merge([], toIncoming(rows), { source: "wix", authoritative: true });
ok("a first pull adds all seven, and seven are coming", out.added === 7 && tally(out.people).attending === 7);
ok("letters go once per address (4 addresses)", writeableTo(out.people).length === 4, writeableTo(out.people).map((p) => p.email).join(","));

const again = merge(out.people, toIncoming(rows), { source: "wix", authoritative: true });
ok("pulling again changes nothing", again.added === 0 && again.changed === 0 && again.withdrawn === 0 && again.people.length === 7);
const less = merge(out.people, toIncoming(rows.filter((r) => r.key !== "wix:r2")), { source: "wix", authoritative: true });
ok("someone Wix stops listing has withdrawn, and only them", less.withdrawn === 1 && less.people.find((p) => p.key === "wix:r2")?.status === "WITHDRAWN");

// Rows saved the old way: one per address, keyed by email, one of them a buyer standing in for a ticket.
const legacy = [
  { first: "Dana", last: "Sample", email: "coord@example.ca", status: "ATTENDING", source: "wix", wixGuestId: "r1", sent: ["welcome"], addedAt: "2026-09-01T00:00:00Z" },
  { first: "Sam", last: "Buyer", email: "buyer@example.ca", status: "ATTENDING", source: "wix", wixGuestId: "b1", sent: ["welcome"], addedAt: "2026-09-02T00:00:00Z" },
  { first: "Hand", last: "Typed", email: "hand@example.ca", status: "ATTENDING", source: "csv" },
];
const moved = merge(legacy, toIncoming(rows), { source: "wix", authoritative: true });
ok("after the change, the old rows become the new ones: nobody shows as withdrawn", moved.withdrawn === 0 && !moved.people.some((p) => p.status === "WITHDRAWN"), JSON.stringify(moved.people.map((p) => [p.key, p.status])));
ok("the RSVP keeps its letter history and date", moved.people.find((p) => p.key === "wix:r1")?.sent?.includes("welcome") && moved.people.find((p) => p.key === "wix:r1")?.addedAt === "2026-09-01T00:00:00Z");
ok("the buyer's history goes to the ticket that uses their address", moved.people.find((p) => p.key === "wix:h2")?.sent?.includes("welcome"));
ok("so no address that had the letter is owed it again", writeableTo(moved.people).filter((p) => !moved.people.some((q) => q.email === p.email && (q.sent ?? []).includes("welcome"))).map((p) => p.email).sort().join(",") === "ann@example.ca,hand@example.ca,solo@example.ca");
ok("the person typed in by hand stays", moved.people.some((p) => p.email === "hand@example.ca" && p.source === "csv"));
ok("eight rows in all (seven from Wix and one by hand)", moved.people.length === 8, String(moved.people.length));

// A spreadsheet adds detail to a Wix row without making a second one.
const sheet = merge(out.people, [{ first: "Ann", last: "Holder", email: "ann@example.ca", organization: "Sample Police Service", status: "ATTENDING", source: "csv" }], { source: "csv" });
const ann = sheet.people.filter((p) => p.email === "ann@example.ca");
ok("a spreadsheet row updates the Wix row in place", ann.length === 1 && ann[0].organization === "Sample Police Service" && ann[0].source === "wix" && keyOf(ann[0]) === "wix:h1", JSON.stringify(ann));
const resync = merge(sheet.people, toIncoming(rows), { source: "wix", authoritative: true });
ok("and the next Wix pull still finds them (no duplicate)", resync.people.filter((p) => p.email === "ann@example.ca").length === 1 && resync.added === 0);
// A Wix registration for someone typed in by hand takes over their row.
const typed = merge([{ first: "Ann", last: "Holder", email: "ann@example.ca", status: "ATTENDING", source: "csv", sent: ["welcome"] }], toIncoming(rows), { source: "wix", authoritative: true });
ok("someone typed in by hand who then registers on Wix is one row, with their history", typed.people.filter((p) => p.email === "ann@example.ca").length === 1 && typed.people.find((p) => p.email === "ann@example.ca").sent?.includes("welcome"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
