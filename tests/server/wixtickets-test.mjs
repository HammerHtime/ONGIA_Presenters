// An event budget's ticket types from Wix (Andrew 30 Oct 2026): each ticket type's price and how many have sold, read
// from every Wix event linked to the desk event, so the budget's prices and "sold so far" aren't typed twice.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.WIX_API_KEY = "k"; process.env.WIX_SITE_ID = "11111111-1111-4111-8111-111111111111"; process.env.WIX_SITE_ID_2 = "22222222-2222-4222-8222-222222222222";
const tickets = {
  main: [
    { id: "t-in", eventId: "main", name: "In-person", pricingMethod: { fixedPrice: { value: "425.00", currency: "CAD" } }, feeType: "FEE_ADDED_AT_CHECKOUT", initialLimit: 300, actualLimit: 300, salesDetails: { soldCount: 112, reservedCount: 2, unsoldCount: 186, soldOut: false } },
    { id: "t-eb", eventId: "main", name: "Early bird", pricingMethod: { fixedPrice: { value: "375.00", currency: "CAD" } }, salesDetails: { soldCount: 40, soldOut: true }, saleStatus: "SALE_ENDED", salePeriod: { endDate: "2027-03-31T23:59:00Z" } },
    { id: "t-vir", eventId: "main", name: "Virtual", pricingMethod: { pricingOptions: { optionDetails: [{ optionId: "m", name: "Member", price: { value: "199" } }, { optionId: "n", name: "Non-member", price: { value: "249" } }] } }, salesDetails: { soldCount: 30 } },
    { id: "t-comp", eventId: "main", name: "Presenter (comp)", pricingMethod: { fixedPrice: { value: "0" }, free: true }, hidden: true, salesDetails: { soldCount: 12 } },
  ],
  partners: [{ id: "t-cp", eventId: "partners", name: "Community partner", pricingMethod: { fixedPrice: { value: "349.00" } }, salesDetails: { soldCount: 25 } }],
};
const calls = [];
let refuse = false, oldPath = false;
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body ?? "{}");
  calls.push({ url: String(url), site: init.headers["wix-site-id"], body });
  if (refuse) return Response.json({ message: "Forbidden" }, { status: 403 });
  if (oldPath && String(url).includes("/events-ticket-definitions/")) return Response.json({ message: "Not found" }, { status: 404 });
  if (/ticket-definitions\/query$/.test(String(url))) return Response.json({ ticketDefinitions: tickets[body.query.filter.eventId] ?? [] });
  throw new Error("unexpected fetch " + url);
};
const F = REPO + "netlify/functions/";
const { listWixTickets } = await import(F + "lib/wix.mjs");
const budget = (await import(F + "budget.mjs")).default;
const { putEvent } = await import(F + "lib/store.mjs");
const { issueSession } = await import(F + "lib/auth.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const PRES = { "x-admin-key": issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" }) };
const live = async (id) => (await (await budget(new Request(`http://localhost/api/budget?event=${id}`, { headers: PRES }))).json()).live;

console.log("— reading the ticket types");
const t = await listWixTickets({ eventId: "main" });
ok("asks Wix for one event's tickets, with their sales", calls[0].body.query.filter.eventId === "main" && calls[0].body.fields.includes("SALES_DETAILS") && calls[0].site === "11111111-1111-4111-8111-111111111111");
const inp = t.find((x) => x.id === "t-in");
ok("each ticket type: its name, price, sold and limit", inp.name === "In-person" && inp.price === 425 && inp.sold === 112 && inp.limit === 300 && inp.currency === "CAD", JSON.stringify(inp));
ok("sold out and the sale's end date are kept", t.find((x) => x.id === "t-eb").soldOut === true && t.find((x) => x.id === "t-eb").saleEnds === "2027-03-31");
const vir = t.filter((x) => x.ticketId === "t-vir");
ok("a ticket with price options is one row per option, its sales counted once", vir.length === 2 && vir[0].price === 199 && vir[1].price === 249 && vir[0].sold === 30 && vir[1].sold === 0 && vir[1].name === "Virtual · Non-member", JSON.stringify(vir));
ok("a free ticket is a price of 0, a hidden one says so", t.find((x) => x.id === "t-comp").price === 0 && t.find((x) => x.id === "t-comp").hidden);
calls.length = 0; oldPath = true;
ok("if Wix answers the newer address with 'not found', the older one is asked", (await listWixTickets({ eventId: "main" })).length === 5 && calls.length === 2 && calls[1].url.endsWith("/events/v3/ticket-definitions/query"));
oldPath = false;

console.log("— in the event's budget");
await putEvent({ id: "wt1", title: "Ticketed Event", city: "Toronto, ON", dayOne: "2027-05-12", lastDay: "2027-05-13", board: [],
  wix: { eventId: "main", title: "Ticketed Event", site: "1" }, wixMore: [{ eventId: "partners", title: "Partners", site: "2", group: "Community partners" }] });
let L = await live("wt1");
ok("every linked Wix event's tickets come in, each saying where it's from", L.wix.tickets.length === 6 && L.wix.tickets.find((x) => x.id === "t-cp").from === "Community partners" && L.wix.tickets.find((x) => x.id === "t-cp").sold === 25, JSON.stringify(L.wix).slice(0, 300));
ok("the partners' tickets are read from the partners' site", calls.some((c) => c.body.query.filter.eventId === "partners" && c.site === "22222222-2222-4222-8222-222222222222"));
await putEvent({ id: "wt2", title: "Not On Wix", city: "Toronto, ON", dayOne: "2027-05-12", lastDay: "2027-05-13", board: [] });
ok("an event not linked to Wix has none, and Wix isn't asked", (await live("wt2")).wix === null);
refuse = true;
L = await live("wt1");
ok("when Wix refuses the key, the budget says which permission to add instead of failing", L.wix.tickets.length === 0 && /Manage Ticket Definitions/.test(L.wix.problem) && L.event.title === "Ticketed Event");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
