// A nearly empty ITP statement of work filled in from the latest ITP (Andrew 29 Oct 2026: the May and June ITPs read
// $1,600 and -$9,400 of profit "because there are no prefilled costs in the SOW").
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
const F = REPO + "netlify/functions/";
const events = (await import(F + "events.mjs")).default;
const sowFn = (await import(F + "sow.mjs")).default;
const roster = (await import(F + "roster.mjs")).default;
const { issueSession } = await import(F + "lib/auth.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const PRES = { "x-admin-key": issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" }), "content-type": "application/json" };
const call = async (h, url, method = "GET", body) => { const r = await h(new Request("http://localhost" + url, { method, headers: PRES, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
await call(roster, "/api/roster");
const T = Date.now().toString(36);
const mk = async (title, dayOne) => (await call(events, "/api/events", "POST", { title, city: "Montreal", dayOne, lastDay: dayOne, invite: false, kind: "rbh", province: "QC", invoicePrefix: "ITP",
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }] })).event;
const feb = await mk(`RBH ITP Training February ${T}`, "2032-02-08"), may = await mk(`RBH ITP Training May ${T}`, "2032-05-10");
let r = await call(sowFn, `/api/sow?event=${feb.id}&create=1`, "POST", { from: "standard" });
await call(sowFn, `/api/sow?event=${feb.id}`, "PUT", { lines: r.sow.lines.map((l, i) => ({ ...l, estimate: 1000 * (i + 1) })), taxes: r.sow.taxes });
// May, started before the default: one at-cost line priced, the rest empty, and stipends planned.
r = await call(sowFn, `/api/sow?event=${may.id}&create=1`, "POST", { from: "standard" });
await call(sowFn, `/api/sow?event=${may.id}`, "PUT", { lines: r.sow.lines.map((l) => (l.name === "Hotel" ? { ...l, type: "cost", estimate: 8000, actual: 7900 } : { ...l, estimate: 0 })), taxes: r.sow.taxes, internal: [{ name: "Stipends", planned: 11000 }] });
r = await call(sowFn, `/api/sow?event=${may.id}`);
ok("the nearly empty May reads a loss", r.profit.estimate.profit < 0, String(r.profit.estimate.profit));
ok("and, being a draft ITP, it's offered the latest filled-in ITP to fill it from", r.refill?.id === feb.id, JSON.stringify(r.refill));
const number = r.sow.invoice.number;
r = await call(sowFn, `/api/sow?event=${may.id}&refill=${feb.id}`, "PUT");
const febSow = (await call(sowFn, `/api/sow?event=${feb.id}`)).sow;
ok("filled in: the February lines, names, types and amounts", r.status === 200 && r.sow.lines.map((l) => `${l.name}|${l.type}|${l.estimate}`).join() === febSow.lines.map((l) => `${l.name}|${l.type}|${l.estimate}`).join(), JSON.stringify(r.sow?.lines?.slice(0, 2)));
ok("its own invoice number and internal rows stay", r.sow.invoice.number === number && r.sow.internal[0].planned === 11000);
ok("a line of the same name keeps what was typed in its invoice column", r.sow.lines.find((l) => l.name === "Hotel").actual === 7900);
ok("and the profit is a real one now", r.profit.estimate.profit > 0, String(r.profit.estimate.profit));
ok("filled in, it isn't offered again", !r.refill);
ok("February's own statement of work is untouched", (await call(sowFn, `/api/sow?event=${feb.id}`)).sow.lines.every((l, i) => l.estimate === 1000 * (i + 1)));
await call(sowFn, `/api/sow?event=${may.id}&status=submitted`, "PUT");
ok("once it has gone to RBH it can't be filled in again", (await call(sowFn, `/api/sow?event=${may.id}&refill=${feb.id}`, "PUT")).status === 409 && !(await call(sowFn, `/api/sow?event=${may.id}`)).refill);
const june = await mk(`RBH ITP Training June ${T}`, "2032-06-14");
const j = await call(sowFn, `/api/sow?event=${june.id}`);
ok("a new ITP is offered the latest one that's filled in, never an empty one", (j.copyFrom ?? []).find((c) => c.family === "itp")?.id === may.id || (j.copyFrom ?? []).find((c) => c.family === "itp")?.id === feb.id, JSON.stringify(j.copyFrom));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
