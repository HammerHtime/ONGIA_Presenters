// Every RBH statement of work in one list, and all of them in one PDF (Andrew 29 Oct 2026: "a tab ... I could see a list
// and access all of the RBH SOWs ... the total amount of expenses planned, the total sum of profit planned").
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
const pdfInfo = (buf) => { const d = mkdtempSync(path.join(tmpdir(), "pdf-")); writeFileSync(path.join(d, "x.pdf"), buf);
  return { text: execFileSync("pdftotext", ["-layout", path.join(d, "x.pdf"), "-"]).toString(), pages: Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [path.join(d, "x.pdf")]).toString())?.[1]) }; };
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const PRES = { "x-admin-key": issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" }), "content-type": "application/json" };
const LEAD = { "x-admin-key": issueSession({ email: "treasurer@ongia.ca", name: "Raj Jaswal" }), "content-type": "application/json" };
const call = async (h, url, method = "GET", body, headers = PRES) => { const r = await h(new Request("http://localhost" + url, { method, headers, body: body ? JSON.stringify(body) : undefined })); const ct = r.headers.get("content-type") ?? ""; return { status: r.status, res: r, ...(ct.includes("json") ? await r.json() : {}) }; };
await call(roster, "/api/roster");
const T = Date.now().toString(36);
const mk = async (title, dayOne, extra = {}) => (await call(events, "/api/events", "POST", { title, city: "Montreal", dayOne, lastDay: dayOne, invite: false, kind: "rbh", province: "QC", invoicePrefix: "ALL",
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], ...extra })).event;

const a = await mk(`RBH VIP All ${T}`, "2031-03-02"), b = await mk(`CFAOC All ${T}`, "2031-05-11"), none = await mk(`RBH ITP None ${T}`, "2031-06-01");
for (const [ev, base] of [[a, 1000], [b, 2000]]) {
  let r = await call(sowFn, `/api/sow?event=${ev.id}&create=1`, "POST", { from: "standard" });
  const lines = r.sow.lines.map((l, i) => ({ ...l, estimate: base + i * 100 }));
  await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines, taxes: r.sow.taxes, taxBase: "subtotal+fee", deposit: 0, internal: [{ name: "Stipends", planned: 500 }] });
}
const list = await call(sowFn, "/api/sow?all=1");
const rows = list.events.filter((e) => e.title.endsWith(T));
ok("the list has every RBH event, the one with no statement of work too, earliest first", rows.map((e) => e.id).join() === [a.id, b.id, none.id].join() && rows[2].sow === false, JSON.stringify(rows.map((e) => [e.title, e.sow])));
const one = (await call(sowFn, `/api/sow?event=${a.id}`));
const ra = rows[0];
ok("each one's figures are the event's own: its total, its profit planned, its stipends", ra.estimate.total === one.estimate.total && ra.estimate.profit === one.profit.estimate.profit && ra.estimate.internal === 500, JSON.stringify({ list: ra.estimate, sow: one.estimate.total, p: one.profit.estimate }));
ok("expenses at cost and fixed fees add up to what it comes to before the fee", Math.abs(ra.estimate.atCost + ra.estimate.fixed - ra.estimate.subtotal) < 0.01 && ra.estimate.fixed > 0 && ra.estimate.atCost > 0, JSON.stringify(ra.estimate));
ok("it says its number and status", /^ALL-2031-\d{3}$/.test(ra.number) && ra.status === "draft", ra.number);
ok("a lead, who never sees the costing, is refused the list", (await call(sowFn, "/api/sow?all=1", "GET", undefined, LEAD)).status === 403);

const pdf = await call(sowFn, `/api/sow?all=1&doc=sow&ids=${a.id},${none.id},${b.id}`);
const info = pdfInfo(Buffer.from(await pdf.res.arrayBuffer()));
// Page by page: a long title can wrap in the PDF (how far depends on the random T's letters), so look for its words on
// the page rather than the whole title on one line.
const pages = info.text.split("\f"), has = (pg, ...w) => w.every((x) => (pg ?? "").includes(x));
ok("Print all: one PDF, both statements of work, each on its own page; the event with none is skipped", pdf.status === 200 && info.pages >= 2 && has(pages[0], "RBH VIP All", T) && has(pages[1], "CFAOC All", T) && !info.text.includes("ITP None"), `${info.pages} pages`);
ok("each still carries its own total", (info.text.match(/TOTAL BALANCE DUE/g) ?? []).length === 2);
ok("the one PDF a single event makes is unchanged", (await call(sowFn, `/api/sow?event=${a.id}&doc=sow`)).status === 200);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
