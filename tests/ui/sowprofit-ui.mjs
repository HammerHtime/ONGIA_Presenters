// ONGIA's own costs and profit on screen (Andrew 29 Oct 2026): the purple Internal only box under the lines, the profit
// under the totals, worked out as you type, and the profit in the RBH quick view. Same approved event as sowlayout-ui.
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
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `RBH Profit ${T}`, city: "Montreal, QC", venue: "V", dayOne: "2026-11-23", lastDay: "2026-11-27", invite: false, kind: "rbh", province: "QC", invoicePrefix: "PRO",
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }] }) })).event;
let s = await api(`/api/sow?event=${ev.id}&create=1`, { method: "POST", body: JSON.stringify({ from: "standard" }) });
const sow = s.sow;
const lines = [["Hotel", "cost", 7500, "12 nights - YUL & 2 nights - YYZ"], ["AV at hotel", "cost", 800, ""], ["Hotel Meeting Room rental", "cost", 1000, ""], ["Dinners", "cost", 2500, ""],
  ["Travel", "cost", 4000, "Car Rental & Flights & Via Rail"], ["On Site Management", "fixed", 7000, "", 9000], ["Pre/Post Event Management", "fixed", 2800, "", 4200]]
  .map(([name, type, estimate, description, actual], i) => ({ ...(sow.lines[i] ?? {}), id: sow.lines[i]?.id ?? `l${i}`, name, type, estimate, description, actual: actual ?? null }));
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
  await p.addStyleTag({ content: ".bar{position:static !important}" });
  if (tag === "phone") {
    // The quick view: saved stipends from the laptop round are in the profit.
    const q = await p.locator("#rbhcard").innerText();
    ok(`${tag}: the RBH quick view shows ONGIA's profit so far, after the stipends`, /ONGIA profit so far\s*\$11,415\.57/.test(q) && /Internal only/.test(q), q);
    await p.locator("#rbhcard").screenshot({ path: D + `sow-profit-quick-${tag}.png` });
  }
  await p.locator('.etab[data-tab="money"]').click(); await p.waitForTimeout(1200);
  const fold = p.locator("#sowcard"); if (!(await fold.evaluate((d) => d.open))) await fold.locator("summary").first().click();
  await p.waitForTimeout(500);
  const box = p.locator("#sw-internal");
  ok(`${tag}: the Internal only box is under the lines, purple, saying it's not on anything sent to RBH`, /Internal only[\s\S]*Will not be included on the statement of work or the final invoice sent to RBH[\s\S]*no tax added/i.test(await box.innerText())
    && (await box.evaluate((e) => getComputedStyle(e).borderTopColor)) === "rgb(138, 99, 184)");
  ok(`${tag}: it starts with a Stipends row`, (await box.locator(".in-name").first().inputValue()) === "Stipends");
  if (tag === "laptop") {
    await box.locator(".in-plan").first().fill("4500");
    await p.waitForTimeout(300);
    const pr = await p.locator("#sw-profit").innerText();
    ok(`${tag}: typing the stipends changes the profit straight away: $13,200 + $2,715.57 − $4,500 = $11,415.57`, /Profit\s+\$10,420\.00\s+\$11,415\.57/.test(pr) && /Internal costs\s+−\$4,500\.00\s+−\$4,500\.00/.test(pr), pr);
    ok(`${tag}: no tax in it, and the at-cost lines pass through`, /70\.1% of \$16,293\.43 billed before tax/.test(pr) && /Tax goes to the government/.test(pr), pr);
    await p.locator("#sw-addint").click(); await p.waitForTimeout(200);
    ok(`${tag}: another internal row can be added`, (await box.locator(".introw[data-int]").count()) === 2);
    await box.locator('.introw[data-int="1"] [data-inrm]').click(); await p.waitForTimeout(200);
    await p.locator("#sw-save").click(); await p.waitForTimeout(1500);
    const saved = (await api(`/api/sow?event=${ev.id}`)).sow.internal;
    ok(`${tag}: saved: one Stipends row, $4,500 planned`, saved.length === 1 && saved[0].name === "Stipends" && saved[0].planned === 4500, JSON.stringify(saved));
  }
  const card = await fold.boundingBox(), pbox = await p.locator("#sw-profit").boundingBox(), ibox = await box.boundingBox();
  const fits = (b) => b.x >= card.x - 1 && b.x + b.width <= card.x + card.width + 1;
  const inner = await p.locator("#sw-profit table").evaluate((t) => t.scrollWidth <= t.parentElement.clientWidth + 1);
  ok(`${tag}: the profit box and the internal box fit inside the card, nothing cut off`, fits(pbox) && fits(ibox) && inner && (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)), JSON.stringify({ card, pbox, ibox, inner }));
  await box.screenshot({ path: D + `sow-internal-${tag}.png` });
  await p.locator("#sw-profit").screenshot({ path: D + `sow-profit-${tag}.png` });
  ok(`${tag}: no page errors`, !errs.length, errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
