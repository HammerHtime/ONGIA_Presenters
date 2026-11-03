// A line added to an approved statement of work (Andrew 29 Oct 2026: "the VIP event, we need to add Sporting event
// tickets ... even though there is no approved set amount"). The agreed lines stay locked; the new one has no agreed
// amount, shows on the invoice and never on the statement of work.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
const F = REPO + "netlify/functions/";
const events = (await import(F + "events.mjs")).default;
const sowFn = (await import(F + "sow.mjs")).default;
const roster = (await import(F + "roster.mjs")).default;
const { issueSession } = await import(F + "lib/auth.mjs");
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const pdfText = (buf) => { const d = mkdtempSync(path.join(tmpdir(), "pdf-")); writeFileSync(path.join(d, "x.pdf"), buf); return execFileSync("pdftotext", ["-layout", path.join(d, "x.pdf"), "-"]).toString(); };
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const PRES = { "x-admin-key": issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" }), "content-type": "application/json" };
const call = async (h, url, method = "GET", body) => { const r = await h(new Request("http://localhost" + url, { method, headers: PRES, body: body ? JSON.stringify(body) : undefined })); const ct = r.headers.get("content-type") ?? ""; return { status: r.status, res: r, ...(ct.includes("json") ? await r.json() : {}) }; };
await call(roster, "/api/roster");
const ev = (await call(events, "/api/events", "POST", { title: "RBH VIP Add Line", city: "Montreal", dayOne: "2026-11-23", lastDay: "2026-11-27", invite: false, kind: "rbh", province: "QC", invoicePrefix: "ADL",
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }] })).event;
let r = await call(sowFn, `/api/sow?event=${ev.id}&create=1`, "POST", { from: "standard" });
await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines: r.sow.lines.map((l, i) => ({ ...l, estimate: 1000 * (i + 1) })), taxes: r.sow.taxes });
for (const s of ["submitted", "approved"]) r = await call(sowFn, `/api/sow?event=${ev.id}&status=${s}`, "PUT");
const agreed = r.sow.lines, before = r.estimate.total;
ok("approved and locked", r.locked === true && r.sow.status === "approved");

r = await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines: [...agreed, { id: "new1", name: "Entertainment: sporting event tickets", type: "cost", estimate: 500, actual: 1240 }], taxes: r.sow.taxes });
const added = r.sow?.lines?.find((l) => /sporting/.test(l.name));
ok("a new line can be added after approval", r.status === 200 && !!added, JSON.stringify(r).slice(0, 200));
ok("it is marked added, with no agreed amount (an estimate sent is ignored)", added?.added === true && added.estimate === 0, JSON.stringify(added));
ok("the statement of work's total is what RBH agreed to", r.estimate.total === before, `${r.estimate.total} vs ${before}`);
ok("the invoice counts it", r.actual.total > 0 && r.sow.lines.some((l) => l.added && l.actual === 1240));
ok("and it's listed as added since RBH was sent the SOW", (r.changedSinceSent ?? []).some((c) => c.what === "added" && /sporting/.test(c.name)), JSON.stringify(r.changedSinceSent));
const withNew = r.sow.lines;
r = await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines: withNew.map((l) => (l.added ? { ...l, name: "Entertainment: hockey tickets", actual: 1300 } : l)), taxes: r.sow.taxes });
ok("the added line can be renamed and its invoice amount changed", r.status === 200 && r.sow.lines.some((l) => l.added && l.name === "Entertainment: hockey tickets" && l.actual === 1300));
const bad = await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines: r.sow.lines.map((l, i) => (i === 0 ? { ...l, estimate: l.estimate + 1 } : l)), taxes: r.sow.taxes });
ok("an agreed line's amount still can't change", bad.status === 409);
const renamed = await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines: r.sow.lines.map((l, i) => (i === 0 ? { ...l, name: "Something else" } : l)), taxes: r.sow.taxes });
ok("nor its name", renamed.status === 409);

for (const doc of ["sow", "invoice"]) {
  const res = await call(sowFn, `/api/sow?event=${ev.id}&doc=${doc}`);
  const text = pdfText(Buffer.from(await res.res.arrayBuffer()));
  ok(doc === "sow" ? "the statement of work PDF leaves it off" : "the final invoice PDF has it, with its amount",
    res.status === 200 && (doc === "sow" ? !/hockey/i.test(text) : /hockey/i.test(text) && /1,300\.00/.test(text)), text.slice(0, 300));
}
r = await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines: r.sow.lines.filter((l) => !l.added), taxes: r.sow.taxes });
ok("and it can be taken out again", r.status === 200 && !r.sow.lines.some((l) => l.added));

// RBH asks for the SOW again with the added line on it (Andrew 3 Nov 2026, the VIP event), after receipts are in.
// The SOW carries estimates only: the receipts stay on the invoice.
const { putReceipts } = await import(F + "lib/store.mjs");
r = await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines: [...r.sow.lines, { id: "new2", name: "Entertainment: hockey tickets", type: "cost", estimate: 0, actual: null }], taxes: r.sow.taxes });
const hockey = r.sow.lines.find((l) => l.added);
const agreedCost = r.sow.lines.find((l) => !l.added && l.type === "cost") ?? r.sow.lines[0];
await putReceipts(ev.id, { drafts: [], items: [
  { id: "rc1", lineId: hockey.id, vendor: "Ticketmaster", date: "2026-11-24", amount: 777.77, total: 777.77 },
  { id: "rc2", lineId: agreedCost.id, vendor: "Taxi Montréal", date: "2026-11-24", amount: 333.33, total: 333.33 } ] });
const subBefore = (await call(sowFn, `/api/sow?event=${ev.id}`)).estimate.subtotal;
const stale = r.sow.lines;   // the page's copy, still saying "added"
r = await call(sowFn, `/api/sow?event=${ev.id}&unlock=1`, "PUT", { word: "EDIT" });
ok("unlocked with EDIT", r.status === 200 && r.locked === false);
r = await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines: stale.map((l) => (l.id === hockey.id ? { ...l, estimate: 0 } : l)), taxes: r.sow.taxes });
ok("left at nil, it is still on the invoice only", r.sow.lines.find((l) => l.id === hockey.id)?.added === true && r.estimate.subtotal === subBefore);
r = await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines: stale.map((l) => (l.id === hockey.id ? { ...l, estimate: 1500 } : l)), taxes: r.sow.taxes });
const onIt = r.sow.lines.find((l) => l.id === hockey.id);
ok("given an estimate, it is on the SOW (even though the page's copy still said added)", r.status === 200 && onIt && !onIt.added && onIt.estimate === 1500, JSON.stringify(onIt));
ok("the SOW subtotal grows by its estimate, not by its receipts", r.estimate.subtotal === Math.round((subBefore + 1500) * 100) / 100, `${r.estimate.subtotal} vs ${subBefore} + 1500`);
ok("and RBH's copy is flagged as missing it", (r.changedSinceSent ?? []).some((c) => c.what === "added" && c.now === 1500));
{
  const res = await call(sowFn, `/api/sow?event=${ev.id}&doc=sow`);
  const text = pdfText(Buffer.from(await res.res.arrayBuffer()));
  ok("the SOW PDF lists it at its estimate", /hockey/i.test(text) && /1,500\.00/.test(text), text.slice(0, 400));
  ok("and shows no receipt amounts", !/777\.77|333\.33/.test(text), text);
}
r = await call(sowFn, `/api/sow?event=${ev.id}&status=submitted`, "PUT");
ok("sent again: locked, and RBH's copy matches", r.locked === true && !(r.changedSinceSent ?? []).length && r.estimate.subtotal === Math.round((subBefore + 1500) * 100) / 100);
r = await call(sowFn, `/api/sow?event=${ev.id}&status=approved`, "PUT");
const again = await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines: stale.map((l) => (l.id === hockey.id ? { ...l, estimate: 1500 } : l)), taxes: r.sow.taxes });
ok("approved: a save from a page that still says added changes nothing", again.status === 200 && !again.sow.lines.find((l) => l.id === hockey.id)?.added && again.sow.lines.find((l) => l.id === hockey.id)?.estimate === 1500, JSON.stringify(again).slice(0, 300));
const moved = await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines: again.sow.lines.map((l) => (l.id === hockey.id ? { ...l, estimate: 2000 } : l)), taxes: r.sow.taxes });
ok("and its amount is now agreed, so locked like the others", moved.status === 409);
{
  const res = await call(sowFn, `/api/sow?event=${ev.id}&doc=invoice`);
  const text = pdfText(Buffer.from(await res.res.arrayBuffer()));
  ok("the invoice bills the at-cost line from its receipts", /hockey/i.test(text) && /777\.77/.test(text), text.slice(0, 400));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
