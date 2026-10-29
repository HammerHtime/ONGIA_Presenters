// ONGIA's own costs and profit on an RBH event (Andrew 29 Oct 2026: "rows that do not show up on the invoice or SOW
// that gets sent to RBH ... for my own internal calculations only"; "do not include tax on the stipends"). The fixed
// fees and the 20% fee are ONGIA's, the at-cost lines pass through, the stipends come off; none of it reaches RBH.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
const F = REPO + "netlify/functions/";
const events = (await import(F + "events.mjs")).default;
const sowFn = (await import(F + "sow.mjs")).default;
const roster = (await import(F + "roster.mjs")).default;
const { issueSession } = await import(F + "lib/auth.mjs");
const { profit, provinceTaxes } = await import(F + "lib/sow.mjs");
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const pdfText = (buf) => { const d = mkdtempSync(path.join(tmpdir(), "pdf-")); writeFileSync(path.join(d, "x.pdf"), buf); return execFileSync("pdftotext", ["-layout", path.join(d, "x.pdf"), "-"]).toString(); };
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const PRES = { "x-admin-key": issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" }), "content-type": "application/json" };
const LEAD = { "x-admin-key": issueSession({ email: "treasurer@ongia.ca", name: "Raj Jaswal" }), "content-type": "application/json" };
const call = async (h, url, method = "GET", body, headers = PRES) => { const r = await h(new Request("http://localhost" + url, { method, headers, body: body ? JSON.stringify(body) : undefined })); const ct = r.headers.get("content-type") ?? ""; return { status: r.status, res: r, ...(ct.includes("json") ? await r.json() : {}) }; };
await call(roster, "/api/roster");

console.log("— the sum, with Andrew's own figures");
const sow = { lines: [
  { id: "h", type: "cost", estimate: 7500, receiptsTotal: 0 }, { id: "av", type: "cost", estimate: 800 }, { id: "m", type: "cost", estimate: 1000 }, { id: "d", type: "cost", estimate: 2500 },
  { id: "t", type: "cost", estimate: 4000, receiptsTotal: 377.86 },
  { id: "o", type: "fixed", estimate: 7000, actual: 9000 }, { id: "p", type: "fixed", estimate: 2800, actual: 4200 }],
  taxes: provinceTaxes("QC"), taxBase: "subtotal+fee", deposit: 0, internal: [{ id: "s", name: "Stipends", planned: 4500, paid: null }] };
const A = profit(sow, "actual"), E = profit(sow, "estimate");
ok("the invoice so far: fixed $13,200 + fee $2,715.57 − stipends $4,500 = $11,415.57", A.fixed === 13200 && A.fee === 2715.57 && A.internal === 4500 && A.profit === 11415.57, JSON.stringify(A));
ok("the receipts pass through: billed as receipted, they make nothing", A.margin === 0);
ok("no tax in it: what's billed before tax is $16,293.43, and the profit is 70.1% of it", A.billed === 16293.43 && A.pct === 70.1, JSON.stringify(A));
ok("the SOW: fixed $9,800 + fee $5,120 − stipends $4,500 = $10,420", E.fixed === 9800 && E.fee === 5120 && E.profit === 10420, JSON.stringify(E));
ok("an at-cost line billed above its receipts makes the difference", profit({ ...sow, lines: sow.lines.map((l) => (l.id === "t" ? { ...l, actual: 400 } : l)) }, "actual").margin === 22.14);
ok("once paid, what was paid counts instead of what was planned", profit({ ...sow, internal: [{ name: "Stipends", planned: 4500, paid: 4200 }] }, "actual").internal === 4200
  && profit({ ...sow, internal: [{ name: "Stipends", planned: 4500, paid: 4200 }] }, "estimate").internal === 4500);

console.log("— on an RBH event");
const ev = (await call(events, "/api/events", "POST", { title: "RBH VIP Event", city: "Montreal", dayOne: "2026-11-23", lastDay: "2026-11-27", invite: false, kind: "rbh", province: "QC", invoicePrefix: "PRF",
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }] })).event;
let r = await call(sowFn, `/api/sow?event=${ev.id}&create=1`, "POST", { from: "standard" });
ok("a new statement of work starts with one internal row, Stipends, with nothing in it", r.sow.internal?.length === 1 && r.sow.internal[0].name === "Stipends" && r.sow.internal[0].planned === null, JSON.stringify(r.sow.internal));
const lines = r.sow.lines.map((l, i) => ({ ...l, estimate: 1000 * (i + 1) }));
r = await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines, taxes: r.sow.taxes, taxBase: "subtotal+fee", deposit: 0,
  internal: [{ name: "Stipends: board members at the event", planned: 4500 }, { name: "Parking not billed", planned: 150, paid: 120 }, { name: "  ", planned: 9 }] });
ok("internal rows are saved (one with no name dropped), as typed, no tax", r.status === 200 && r.sow.internal.length === 2 && r.sow.internal[1].planned === 150 && r.sow.internal[1].paid === 120, JSON.stringify(r.sow.internal));
ok("the page gets the profit both ways", r.profit?.estimate?.internal === 4650 && r.profit.actual.internal === 4620 && typeof r.profit.estimate.profit === "number", JSON.stringify(r.profit));
const before = r.estimate.total;
ok("the totals RBH sees are the same with them or without them", (await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines, taxes: r.sow.taxes, internal: [] })).estimate.total === before);
await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines, taxes: r.sow.taxes, internal: [{ name: "Stipends: board members at the event", planned: 4500 }, { name: "Parking not billed", planned: 150, paid: 120 }] });
for (const s of ["submitted", "approved"]) r = await call(sowFn, `/api/sow?event=${ev.id}&status=${s}`, "PUT");
r = await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines: r.sow.lines, taxes: r.sow.taxes, internal: [...r.sow.internal.slice(0, 1).map((x) => ({ ...x, paid: 4400 })), r.sow.internal[1]] });
ok("after it's approved and locked, the internal rows still change (they aren't what RBH agreed to)", r.status === 200 && r.sow.internal[0].paid === 4400, JSON.stringify(r).slice(0, 200));

console.log("— never on anything sent to RBH");
for (const doc of ["sow", "invoice"]) {
  const res = await call(sowFn, `/api/sow?event=${ev.id}&doc=${doc}`);
  const text = pdfText(Buffer.from(await res.res.arrayBuffer()));
  ok(`the ${doc === "sow" ? "statement of work" : "final invoice"} PDF has no internal row, no stipend, no profit`, res.status === 200 && !/stipend|parking not billed|internal|profit/i.test(text) && /TOTAL BALANCE DUE/i.test(text), text.slice(0, 300));
}
ok("and the lead of the event, who never sees the costing, is refused it", (await call(sowFn, `/api/sow?event=${ev.id}`, "GET", undefined, LEAD)).status === 403);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
