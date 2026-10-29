// The statement of work once approved (Andrew 29 Oct 2026: "for RBH events, the layout is off ... once I change SOW to
// approve the layout gets squished", and on a phone it ran off the screen; "the date boxes at the top are really small").
// Laid out beside the Getting ready column on a laptop, and on a phone, with a receipt against Travel.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const D = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const T = Date.now().toString(36);
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `RBH Layout ${T}`, city: "Montreal, QC", venue: "V", dayOne: "2026-11-23", lastDay: "2026-11-27", invite: false, kind: "rbh", province: "QC", invoicePrefix: "LAY",
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }] }) })).event;
let s = await api(`/api/sow?event=${ev.id}&create=1`, { method: "POST", body: JSON.stringify({ from: "standard" }) });
const sow = s.sow;
const lines = [["Hotel", "cost", 7500, "12 nights - YUL & 2 nights - YYZ"], ["AV at hotel", "cost", 800, ""], ["Hotel Meeting Room rental", "cost", 1000, ""], ["Dinners", "cost", 2500, ""],
  ["Travel", "cost", 4000, "Car Rental & Flights & Via Rail"], ["On Site Management", "fixed", 7000, ""], ["Pre/Post Event Management", "fixed", 2800, ""]]
  .map(([name, type, estimate, description], i) => ({ ...(sow.lines[i] ?? {}), id: sow.lines[i]?.id ?? `l${i}`, name, type, estimate, description }));
s = await api(`/api/sow?event=${ev.id}`, { method: "PUT", body: JSON.stringify({ program: { ...sow.program, title: "RBH VIP Event", place: "Montreal, QC" }, lines, taxes: sow.taxes, taxBase: sow.taxBase, deposit: sow.deposit }) });
const travel = (await api(`/api/sow?event=${ev.id}`)).sow.lines.find((l) => l.name === "Travel");
const up = await (await fetch(`${S}/api/receipts?event=${ev.id}`, { method: "POST", headers: { "x-admin-key": "testkey", "x-file-name": "r.jpg" }, body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) })).json();
const draft = up.draft?.id ?? up.drafts?.[0]?.id ?? up.id;
await api(`/api/receipts?event=${ev.id}&confirm=${draft}`, { method: "POST", body: JSON.stringify({ paidBy: "president@ongia.ca", lineId: travel.id, vendor: "Via Rail", date: "2026-10-20", amount: 377.86 }) });
for (const st of ["submitted", "approved"]) await api(`/api/sow?event=${ev.id}&status=${st}`, { method: "PUT", body: "{}" });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1280, 900, "laptop"], [390, 844, "phone"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true }]);
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(`${S}/admin.html#event/${ev.id}`, { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  await p.locator('.etab[data-tab="money"]').click(); await p.waitForTimeout(1200);
  const fold = p.locator("#sowcard"); if (!(await fold.evaluate((d) => d.open))) await fold.locator("summary").first().click();
  await p.waitForTimeout(500);
  const card = await fold.boundingBox(), table = await p.locator("#sw-table").boundingBox();
  ok(`${tag}: the lines fit inside the card, nothing runs off the side`, table.x + table.width <= card.x + card.width + 1 && (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)), JSON.stringify({ card, table }));
  // Every row's first boxes on one line, the first row too (Andrew 29 Oct 2026: "the boxes in the row for hotel seem off").
  const tops = await p.evaluate(() => [...document.querySelectorAll("#sw-table tbody tr[data-i]")].map((tr) => ["ln-name", "ln-type", "ln-est"].map((c) => Math.round(tr.querySelector("." + c).getBoundingClientRect().top))));
  if (tag === "laptop") ok(`${tag}: in every row, the first row too, name, type and estimate line up`, tops.every(([a, b2, c]) => a === b2 && b2 === c), JSON.stringify(tops.slice(0, 2)));
  const lefts = await p.evaluate(() => { const th = [...document.querySelectorAll("#sw-table thead th")].filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().left)); const tr = document.querySelector("#sw-table tbody tr[data-i]"); return { th, box: ["ln-name", "ln-type", "ln-est"].map((c) => Math.round(tr.querySelector("." + c).getBoundingClientRect().left)) }; });
  if (tag === "laptop") ok(`${tag}: each heading sits over its boxes`, lefts.box.every((x, i) => Math.abs(x - lefts.th[i]) <= 10), JSON.stringify(lefts));
  if (tag === "laptop") ok(`${tag}: one heading line above them says Line, Type, SOW estimate`, /Line\s+Type\s+SOW estimate/i.test(await p.locator("#sw-table thead").innerText()), await p.locator("#sw-table thead").innerText());
  const name = await p.locator('#sw-table .ln-name').first().boundingBox();
  ok(`${tag}: a line's name has room to be read`, name.width >= 240, `${name.width}px`);
  const inv = p.locator('#sw-table tr:has(.ln-name[value="Travel"]) td.inv');
  ok(`${tag}: each box says what it is (Invoice amount, vs estimate, Receipts so far)`, await inv.evaluate((e) => getComputedStyle(e, "::before").content.includes("Invoice amount"))
    && await p.locator('#sw-table tr:has(.ln-name[value="Travel"]) td.v').evaluate((e) => getComputedStyle(e, "::before").content.includes("vs estimate")));
  ok(`${tag}: Travel shows its receipt and what's left`, /\$377\.86[\s\S]*1 receipt[\s\S]*\$3,622\.14 left/.test(await p.locator('#sw-table tr:has(.ln-name[value="Travel"])').innerText()));
  const dateH = await p.locator("#sw-idate").evaluate((e) => e.getBoundingClientRect().height), textH = await p.locator("#sw-title").evaluate((e) => e.getBoundingClientRect().height);
  ok(`${tag}: an empty date box is as tall as the boxes beside it`, dateH >= textH - 1, `${dateH} vs ${textH}`);
  ok(`${tag}: and it holds its height even where nothing else sets it (as on an iPhone)`, await p.locator("#sw-idate").evaluate((e) => parseFloat(getComputedStyle(e).minHeight) >= 28));
  await p.addStyleTag({ content: ".bar{position:static !important}" });
  await p.locator("#sw-table").screenshot({ path: D + `sow-lines-${tag}.png` });
  ok(`${tag}: no page errors`, !errs.length, errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
