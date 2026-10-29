// RBH costing from the server's side: the SOW, the 20% fee, province tax, statuses, the lock, invoice numbers, access.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
const F = REPO + "netlify/functions/";
const events = (await import(F + "events.mjs")).default;
const sowFn = (await import(F + "sow.mjs")).default;
const contractFn = (await import(F + "contract.mjs")).default;
const inboxFn = (await import(F + "inbox.mjs")).default;
const { putInbox, getEvent: getEv } = await import(F + "lib/store.mjs");
const roster = (await import(F + "roster.mjs")).default;
const { issueSession } = await import(F + "lib/auth.mjs");
const { totals, provinceTaxes, lineAmount, guessProvince, invoiceNumber, increase } = await import(F + "lib/sow.mjs");
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const pdfText = (buf) => { const d = mkdtempSync(path.join(tmpdir(), "pdf-")); writeFileSync(path.join(d, "x.pdf"), buf); return execFileSync("pdftotext", ["-layout", path.join(d, "x.pdf"), "-"]).toString(); };
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const as = (email) => ({ "x-admin-key": issueSession({ email, name: email }), "content-type": "application/json" });
const call = async (h, url, method = "GET", body, headers = H) => { const r = await h(new Request("http://localhost" + url, { method, headers, body: body ? JSON.stringify(body) : undefined })); const ct = r.headers.get("content-type") ?? ""; return { status: r.status, res: r, ...(ct.includes("json") ? await r.json() : {}) }; };
await call(roster, "/api/roster");
const mk = async (extra) => (await call(events, "/api/events", "POST", { title: "ITP Training", city: "Montreal", dayOne: "2026-09-28", lastDay: "2026-10-02", invite: false, board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], presenters: [], ...extra })).event;

console.log("— the arithmetic, against ONGIA's sheet");
const lines = [["a", 15000], ["b", 3000], ["c", 12000], ["d", 7000], ["e", 10960], ["f", 1500], ["g", 5900]].map(([id, estimate]) => ({ id, type: "fixed", estimate }));
let t = totals({ lines, taxes: provinceTaxes("QC"), taxBase: "subtotal", deposit: 0 });
ok("the subtotal is $55,360 and the service fee is 20% of it, $11,072", t.subtotal === 55360 && t.fee === 11072);
ok("Quebec's two lines, GST 5% and QST 9.975%, add up to the one combined 14.975%: $8,290.16", t.taxes.length === 2 && t.taxTotal === 8290.16, JSON.stringify(t.taxes));
ok("taxed on the subtotal only the balance is $74,722.16", t.total === 74722.16, String(t.total));
t = totals({ lines, taxes: provinceTaxes("QC"), taxBase: "subtotal+fee", deposit: 0 });
ok("taxed on the subtotal plus the fee the tax is $9,948.19 and the balance $76,380.19", t.taxTotal === 9948.19 && t.total === 76380.19, JSON.stringify([t.taxTotal, t.total]));
t = totals({ lines, taxes: provinceTaxes("ON"), taxBase: "subtotal+fee", deposit: 10000 });
ok("Ontario is one HST line at 13%, and a deposit comes off the new subtotal but not off the tax", t.taxes.length === 1 && t.taxes[0].name === "HST" && t.deposit === 10000 && t.newSubtotal === 56432 && t.taxTotal === 8636.16 && t.total === 65068.16, JSON.stringify(t));
ok("a fixed line's actual is its estimate; an at-cost line's actual is its receipts; a typed actual wins", lineAmount({ type: "fixed", estimate: 100 }, "actual") === 100 && lineAmount({ type: "cost", estimate: 100, receiptsTotal: 80.5 }, "actual") === 80.5 && lineAmount({ type: "cost", estimate: 100, receiptsTotal: 80.5, actual: 95 }, "actual") === 95 && lineAmount({ type: "cost", estimate: 100 }, "actual") === 0);
ok("cities guess a province", guessProvince("Montreal & Quebec City") === "QC" && guessProvince("Toronto") === "ON" && guessProvince("Nowhereville") === "");
ok("an invoice number is the prefix, the year and a running number", invoiceNumber("itp", 2026, 7) === "ITP-2026-007");

console.log("— an event can be an RBH event");
const ev = await mk({ kind: "rbh", province: "QC", invoicePrefix: "itp" });
ok("kind, province and prefix are kept, the prefix cleaned", ev.kind === "rbh" && ev.province === "QC" && ev.invoicePrefix === "ITP");
const plain = await mk({ title: "ONGIA Own" });
ok("an ordinary event is not one", plain.kind === "");
ok("a made-up province is dropped", (await mk({ kind: "rbh", province: "ZZ" })).province === "");

console.log("— who may open it");
const get = (id, headers = H, extra = "") => call(sowFn, `/api/sow?event=${id}${extra}`, "GET", undefined, headers);
ok("the president can", (await get(ev.id, as("president@ongia.ca"))).status === 200);
ok("the VP can", (await get(ev.id, as("vp_operations@ongia.ca"))).status === 200);
ok("the event's lead cannot", (await get(ev.id, as("treasurer@ongia.ca"))).status === 403);
ok("another board member cannot", (await get(ev.id, as("j.healy@ongia.ca"))).status === 403);
ok("an ordinary event has no statement of work", (await get(plain.id)).status === 409);
process.env.COSTING_USERS = "someone.else@ongia.ca";
ok("COSTING_USERS replaces the VP's address; the president stays", (await get(ev.id, as("someone.else@ongia.ca"))).status === 200 && (await get(ev.id, as("vp_operations@ongia.ca"))).status === 403 && (await get(ev.id, as("president@ongia.ca"))).status === 200);
delete process.env.COSTING_USERS;

console.log("— starting one");
let r = await get(ev.id);
ok("before it exists: no SOW, and the province and the choices are offered", r.sow === null && r.province === "QC" && r.provinces.QC === "Quebec");
r = await call(sowFn, `/api/sow?event=${ev.id}&create=1`, "POST", { from: "standard" });
const sow1 = r.sow;
ok("created from the standard lines with the invoice number ITP-2026-001", r.status === 201 && sow1.invoice.number === "ITP-2026-001" && sow1.lines.length === 8 && sow1.status === "draft", JSON.stringify(r).slice(0, 300));
ok("Quebec's tax lines are filled in, on subtotal plus fee", sow1.taxes.map((x) => x.name).join() === "GST,QST" && sow1.taxBase === "subtotal+fee");
ok("the lines carry their types: hotel is fixed, dinners are at cost", sow1.lines.find((l) => l.name === "Hotel").type === "fixed" && sow1.lines.find((l) => l.name === "Dinners").type === "cost");
ok("a second start is refused", (await call(sowFn, `/api/sow?event=${ev.id}&create=1`, "POST", { from: "standard" })).status === 409);
const ev2 = await mk({ kind: "rbh", province: "ON", invoicePrefix: "ITP", dayOne: "2026-11-02", lastDay: "2026-11-06", title: "ITP Training Toronto", city: "Toronto" });
const ev3 = await mk({ kind: "rbh", province: "ON", invoicePrefix: "ITP", dayOne: "2027-01-12", lastDay: "2027-01-15", title: "ITP January", city: "Ottawa" });
r = await call(sowFn, `/api/sow?event=${ev2.id}&create=1`, "POST", { from: "standard" });
ok("the next event's number is ITP-2026-002", r.sow.invoice.number === "ITP-2026-002");
r = await call(sowFn, `/api/sow?event=${ev3.id}&create=1`, "POST", { from: "standard" });
ok("a new year starts again at 001", r.sow.invoice.number === "ITP-2027-001");

console.log("— filling it in");
const fill = sow1.lines.map((l) => ({ ...l, estimate: { Hotel: 15000, AV: 0, Dinners: 3000, Transportation: 12000, "Via Rail Train Tickets": 7000, "On Site Management": 10960, "Presenter Support / Creative Development": 1500, "Pre/Post Event Management": 5900 }[l.name] ?? 0, description: l.name === "Hotel" ? "AV Montreal, AV Quebec" : "" }));
r = await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { program: { title: "ITP Training", place: "Montreal & Quebec City", note: "Expecting a large class" }, lines: fill, taxes: sow1.taxes, taxBase: "subtotal+fee", deposit: 0 });
ok("saved, and the estimate page of figures is worked out on the server", r.status === 200 && r.estimate.subtotal === 55360 && r.estimate.fee === 11072 && r.estimate.total === 76380.19, JSON.stringify(r.estimate));
ok("descriptions are kept and optional", r.sow.lines.find((l) => l.name === "Hotel").description === "AV Montreal, AV Quebec" && r.sow.lines.find((l) => l.name === "Dinners").description === "");
ok("a line with no name is dropped", (await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines: [...r.sow.lines, { name: "  ", estimate: 5 }], taxes: r.sow.taxes })).sow.lines.length === 8);
r = await call(sowFn, `/api/sow?event=${ev.id}&doc=sow`);
const buf = Buffer.from(await r.res.arrayBuffer());
ok("the SOW comes as a PDF", r.status === 200 && buf.subarray(0, 4).toString() === "%PDF" && buf.length > 3000, buf.subarray(0, 8).toString());
r = await call(sowFn, `/api/sow?event=${ev.id}&doc=invoice`);
ok("so does the invoice", r.status === 200 && Buffer.from(await r.res.arrayBuffer()).subarray(0, 4).toString() === "%PDF");

console.log("— statuses and the lock");
r = await call(sowFn, `/api/sow?event=${ev.id}&status=submitted`, "PUT");
ok("marked sent to RBH, with the date kept, and the amounts lock right away", r.sow.status === "submitted" && !!r.sow.statusAt.submitted && r.locked === true);
ok("the copy RBH was sent is kept", r.sow.sent?.lines?.length === r.sow.lines.length && !!r.sow.sent.at);
let sentLines = r.sow;
r = await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines: sentLines.lines.map((l) => (l.name === "Dinners" ? { ...l, estimate: 1 } : l)), taxes: sentLines.taxes });
ok("once sent, a changed amount is refused", r.status === 409 && /sent to RBH/.test(r.error));
r = await call(sowFn, `/api/sow?event=${ev.id}&unlock=1`, "PUT");
ok("unlocking without the word is refused", r.status === 400 && /EDIT/.test(r.error));
const edit = (sow, over) => sow.lines.map((l) => ({ ...l, ...over(l) }));
r = await call(sowFn, `/api/sow?event=${ev.id}&status=approved`, "PUT");
ok("marked approved: the estimates lock", r.sow.status === "approved" && r.locked === true);
let cur = r.sow;
r = await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines: edit(cur, (l) => (l.name === "Dinners" ? { estimate: 9999 } : {})), taxes: cur.taxes });
ok("a changed estimate is refused while locked", r.status === 409 && /locked/.test(r.error));
r = await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines: edit(cur, (l) => (l.name === "Dinners" ? { actual: 7016.55 } : l.name === "Transportation" ? { actual: 5728.68 } : l.name === "Via Rail Train Tickets" ? { actual: 8091.22 } : {})), taxes: cur.taxes, deposit: 0 });
ok("an actual can still be typed, and the invoice figures follow", r.status === 200 && r.actual.subtotal === 54196.45 && r.actual.fee === 10839.29, JSON.stringify(r.actual));
ok("the SOW's own figures did not move", r.estimate.subtotal === 55360);
ok("the invoice is 2.1% under the SOW, so nothing needs explaining", r.increase.pct === -2.1 && r.increase.over === false, JSON.stringify(r.increase));
cur = r.sow;
r = await call(sowFn, `/api/sow?event=${ev.id}&unlock=1`, "PUT", { word: "edit" });
ok("typing EDIT unlocks, and it is noted", r.locked === false && r.sow.history.some((h) => /Unlocked/.test(h.what)));
r = await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines: edit(r.sow, (l) => (l.name === "Dinners" ? { estimate: 3500 } : {})), taxes: r.sow.taxes });
ok("then an amount can change, and the history says so", r.status === 200 && r.sow.history.some((h) => /changed after it was sent/.test(h.what)));
ok("and the page is told exactly what differs from RBH's copy", r.changedSinceSent?.length === 1 && r.changedSinceSent[0].name === "Dinners" && r.changedSinceSent[0].now === 3500, JSON.stringify(r.changedSinceSent));
r = await call(sowFn, `/api/sow?event=${ev.id}&status=invoiced`, "PUT");
r = await call(sowFn, `/api/sow?event=${ev.id}&status=paid`, "PUT");
ok("invoiced and paid are kept with dates", r.sow.status === "paid" && !!r.sow.statusAt.invoiced && !!r.sow.statusAt.paid);
ok("a made-up status is refused", (await call(sowFn, `/api/sow?event=${ev.id}&status=whenever`, "PUT")).status === 400);

console.log("— 20% over the SOW needs an explanation");
cur = (await get(ev.id)).sow;
const big = edit(cur, (l) => (l.name === "Dinners" ? { actual: 20000 } : {}));
r = await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines: big, taxes: cur.taxes, deposit: 0, increaseReason: "A second dinner service was added at RBH's request." });
ok("with dinners at $20,000 the invoice is 20.3% over, which is over the limit", r.increase.pct === 20.3 && r.increase.over === true, JSON.stringify(r.increase));
r = await call(sowFn, `/api/sow?event=${ev.id}&doc=invoice`);
let text = pdfText(Buffer.from(await r.res.arrayBuffer()));
ok("the final invoice carries the explanation under a RATIONALE FOR THE INCREASE heading", /RATIONALE FOR THE INCREASE/.test(text) && /second dinner service was added/.test(text), text.slice(-400));
r = await call(sowFn, `/api/sow?event=${ev.id}&doc=sow`);
text = pdfText(Buffer.from(await r.res.arrayBuffer()));
ok("the statement of work does not", !/RATIONALE/.test(text));
cur = (await get(ev.id)).sow;
r = await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines: edit(cur, (l) => (l.name === "Dinners" ? { actual: 7016.55 } : {})), taxes: cur.taxes, deposit: 0 });
ok("an explanation already written is kept when the PUT leaves it out", r.sow.increaseReason.includes("second dinner service"));
ok("back under 20%: it is no longer over", r.increase.over === false);
r = await call(sowFn, `/api/sow?event=${ev.id}&doc=invoice`);
ok("and the invoice does not print the old explanation", !/RATIONALE/.test(pdfText(Buffer.from(await r.res.arrayBuffer()))));
ok("exactly 20% counts as over", increase({ lines: [{ id: "a", type: "fixed", estimate: 1000, actual: 1200 }] }).over === true && increase({ lines: [{ id: "a", type: "fixed", estimate: 1000, actual: 1199 }] }).over === false);
ok("no estimate, no percentage", increase({ lines: [] }).over === false);

console.log("— province tax and filing");
r = await call(sowFn, `/api/sow?event=${ev.id}&province=ON`, "PUT");
ok("switching province swaps the tax lines", r.sow.taxes.length === 1 && r.sow.taxes[0].name === "HST");
ok("a made-up province is refused", (await call(sowFn, `/api/sow?event=${ev.id}&province=ZZ`, "PUT")).status === 400);
r = await call(sowFn, `/api/sow?event=${ev.id}&file=sow`, "POST");
ok("filing with no Microsoft connection says so plainly", r.status === 409 && /Microsoft credentials/.test(r.error), JSON.stringify(r).slice(0, 200));
r = await call(sowFn, `/api/sow?event=${ev2.id}&create=1`, "POST", { from: ev.id });
ok("copying: an event that already has one can't be copied over", r.status === 409);
const ev4 = await mk({ kind: "rbh", province: "QC", invoicePrefix: "ITP", dayOne: "2027-02-01", lastDay: "2027-02-05", title: "ITP Feb", city: "Quebec City" });
{ const c = (await get(ev4.id)).copyFrom;   // one choice per kind, the latest of each (Andrew 29 Oct 2026: "Not a running list")
  ok("the copy menu offers one choice per kind of RBH event (CFAOC, ITP, other), never one per event", c.length >= 1 && c.length <= 3 && new Set(c.map((x) => x.family)).size === c.length, JSON.stringify(c)); }
r = await call(sowFn, `/api/sow?event=${ev4.id}&create=1`, "POST", { from: ev.id });
ok("copied: the same lines and estimates, no typed actuals, a new number", r.status === 201 && r.sow.lines.length === 8 && r.sow.lines.find((l) => l.name === "Hotel").estimate === 15000 && r.sow.lines.every((l) => l.actual === null) && r.sow.invoice.number === "ITP-2027-002" && r.sow.copiedFrom === ev.id, JSON.stringify(r.sow.invoice));

console.log("— the lead does not see the contract, the rate or the offers on an RBH event");
const LEAD = as("treasurer@ongia.ca"), PRES = as("president@ongia.ca"), VP = as("vp_operations@ongia.ca");
const hot = await mk({ kind: "rbh", province: "QC", invoicePrefix: "ITP", title: "Hotel Hidden", dayOne: "2027-03-01", lastDay: "2027-03-05",
  hotel: { name: "Humaniti Hotel", rate: "$205 + tax", contact: "groups@humaniti.example", cutoff: "2027-02-01", foodAndBev: "2027-02-15", notes: "Attrition 80%, deposit due Jan 15", link: "https://hotel.example/block" } });
const ordinary = await mk({ title: "Ordinary Hotel", dayOne: "2027-03-08", lastDay: "2027-03-10", hotel: { name: "Plain Hotel", rate: "$150", cutoff: "2027-02-08", notes: "no secrets" } });
const one = async (id, h) => (await call(events, `/api/events?id=${id}`, "GET", undefined, h));
let lead = await one(hot.id, LEAD), pres = await one(hot.id, PRES);
ok("the president sees the rate and the notes", pres.event.hotel.rate === "$205 + tax" && /Attrition/.test(pres.event.hotel.notes) && pres.canCost === true && !pres.event.hotelCostsHidden);
ok("the lead does not: both are blank, and the event says why", lead.event.hotel.rate === "" && lead.event.hotel.notes === "" && lead.event.hotelCostsHidden === true && lead.canCost === false);
ok("the lead still sees the hotel's name, contact, link and every date", lead.event.hotel.name === "Humaniti Hotel" && lead.event.hotel.contact === "groups@humaniti.example" && lead.event.hotel.cutoff === "2027-02-01" && lead.event.hotel.foodAndBev === "2027-02-15" && !!lead.event.hotel.link);
ok("the VP sees it all, like the president", (await one(hot.id, VP)).event.hotel.rate === "$205 + tax");
let list = await call(events, "/api/events", "GET", undefined, LEAD);
ok("the list hides the rate from the lead too", list.events.find((e) => e.id === hot.id).hotel.rate === "" && list.events.find((e) => e.id === hot.id).hotelCostsHidden === true && list.canCost === false);
list = await call(events, "/api/events", "GET", undefined, PRES);
ok("and shows it to the president", list.events.find((e) => e.id === hot.id).hotel.rate === "$205 + tax");
ok("an ordinary event's rate is not hidden from anyone", (await one(ordinary.id, LEAD)).event.hotel.rate === "$150");
ok("the hotel contract is refused to the lead", (await call(contractFn, `/api/contract?event=${hot.id}`, "GET", undefined, LEAD)).status === 403);
ok("and open to the president", (await call(contractFn, `/api/contract?event=${hot.id}`, "GET", undefined, PRES)).status === 200);
ok("an ordinary event's contract is open to the lead", (await call(contractFn, `/api/contract?event=${ordinary.id}`, "GET", undefined, LEAD)).status === 200);

await putInbox(hot.id, { items: [
  { id: "o1", kind: "offer", status: "open", who: "Sales Manager", note: "", offer: { hotel: "Humaniti", rate: "$199", fbMinimum: "$20,000" }, received: new Date().toISOString(), subject: "Offer" },
  { id: "y1", kind: "you", status: "open", who: "Someone", note: "Reply to them", received: new Date().toISOString(), subject: "Question" }] });
let ib = await call(inboxFn, `/api/inbox?event=${hot.id}`, "GET", undefined, LEAD);
ok("the lead sees the open email items but not the hotel's offer", ib.items.length === 1 && ib.items[0].kind === "you", JSON.stringify(ib.items.map((x) => x.kind)));
ib = await call(inboxFn, `/api/inbox?event=${hot.id}`, "GET", undefined, PRES);
ok("the president sees both", ib.items.length === 2);
list = await call(events, "/api/events", "GET", undefined, LEAD);
const card = list.events.find((e) => e.id === hot.id);
ok("the event card for the lead shows no hotel offer, in the counts or the items", card.inbox.offers === 0 && !card.inboxItems.some((x) => x.kind === "offer"));
ok("the president's card does", (await call(events, "/api/events", "GET", undefined, PRES)).events.find((e) => e.id === hot.id).inbox.offers === 1);

const fullEdit = (h) => ({ title: "Hotel Hidden", city: "Montreal", venue: "V", dayOne: "2027-03-01", lastDay: "2027-03-05", board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], hotel: h, kind: "", province: "ON", invoicePrefix: "XXX" });
r = await call(events, `/api/events?id=${hot.id}`, "PUT", fullEdit({ name: "Humaniti Hotel Montreal", rate: "", contact: "groups@humaniti.example", cutoff: "2027-02-03", foodAndBev: "2027-02-15", notes: "", link: "https://hotel.example/block" }), LEAD);
const stored = await getEv(hot.id);
ok("the lead can change the hotel's name and dates", r.status === 200 && stored.hotel.name === "Humaniti Hotel Montreal" && stored.hotel.cutoff === "2027-02-03", JSON.stringify(stored.hotel));
ok("but the rate and the notes the lead could not see are exactly as they were", stored.hotel.rate === "$205 + tax" && stored.hotel.notes === "Attrition 80%, deposit due Jan 15", JSON.stringify(stored.hotel));
ok("and the lead cannot unmake an RBH event, or change its province or invoice prefix", stored.kind === "rbh" && stored.province === "QC" && stored.invoicePrefix === "ITP", JSON.stringify([stored.kind, stored.province, stored.invoicePrefix]));
ok("the reply to the lead's save does not carry the rate either", r.event.hotel.rate === "" && r.event.hotelCostsHidden === true);
r = await call(events, `/api/events?id=${hot.id}`, "PUT", { ...fullEdit({ name: "Humaniti Hotel Montreal", rate: "$180 + tax", notes: "new notes" }), kind: "rbh", province: "ON" }, PRES);
ok("the president can change them, and the province", r.status === 200 && (await getEv(hot.id)).hotel.rate === "$180 + tax" && (await getEv(hot.id)).province === "ON");
const made = await call(events, "/api/events", "POST", { title: "Lead Tries RBH", city: "Montreal", dayOne: "2027-04-01", lastDay: "2027-04-02", invite: false, kind: "rbh", province: "QC", board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], presenters: [] }, LEAD);
ok("a lead cannot make a new event an RBH event", made.status === 201 && made.event.kind === "", JSON.stringify(made.event?.kind));
ok("a lead cannot delete an RBH event", (await call(events, `/api/events?id=${hot.id}`, "DELETE", undefined, LEAD)).status === 403 && !!(await getEv(hot.id)));
ok("the president can", (await call(events, `/api/events?id=${hot.id}`, "DELETE", undefined, PRES)).status === 200 && !(await getEv(hot.id)));

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
