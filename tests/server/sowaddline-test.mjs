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
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
