// Receipts on one of ONGIA's own events (Andrew 30 Oct 2026: "every single line item is not going to have a receipt
// attached, but at least people could upload it, and the event will store those receipts ... the receipts aren't
// mandatory"). A board member on the event uploads from a phone; the line and who paid can be left blank; the
// president sees what the receipts come to beside the budget's lines. Needs mock-anthropic on 8799, as receipts-ui does.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const D = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
const mock = (reply, delay = 0) => fetch("http://127.0.0.1:8799/__set", { method: "POST", body: JSON.stringify({ reply, delay }) });
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const T = Date.now().toString(36);
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Own Receipts ${T}`, city: "Ottawa, ON", venue: "V", dayOne: "2031-05-12", lastDay: "2031-05-13", invite: false,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], presenters: [] }) })).event;
const PRES = { "x-admin-key": issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" }), "content-type": "application/json" };
// A budget with one line under Everything else, as if Andrew had typed it.
const got = await (await fetch(`${S}/api/budget?event=${ev.id}`, { headers: PRES })).json();
await fetch(`${S}/api/budget?event=${ev.id}`, { method: "PUT", headers: PRES, body: JSON.stringify({ budget: { v: 1, asked: true, eventId: ev.id, event: got.live.event, taxName: "HST",
  reg: { inPerson: { on: true, price: 300, expected: 80, sold: 0 }, earlyBird: { on: false, price: 0, expected: 0, sold: 0 }, community: { on: false, price: 0, expected: 0, sold: 0, days: [] }, virtual: { on: false, price: 0, priceNon: 0, expected: 0, expectedNon: 0, sold: 0 }, memberships: { on: false, price: 0, expected: 0, sold: 0 } },
  pricesIncludeHst: true, hst: 13, target: 0, hotel: { rate: 189, mat: 0, commitment: 0, minPct: 80, pickup: null, rebate: 0, before: 3, after: 1 }, people: [], others: 0,
  meals: { breakfast: 0, break: 0, lunch: 0, dinner: 0, noShow: 10, service: 0, admin: 0, fbMin: 0, cells: {}, boardExtra: {} },
  other: [{ id: "o1", group: "Venue & AV", name: "AV rental", planned: 2500, spent: null }], stipends: [], sponsors: [], deposits: [], dates: [] } }) });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const as = async (email, name, vp) => {
  const page = await b.newPage({ viewport: vp, deviceScaleFactor: 2 });
  const token = issueSession({ email, name });
  await page.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} },
    [token, { email, name, owner: false, canCost: email === "president@ongia.ca" }]);
  page.on("dialog", (d) => d.accept());
  page.errs = []; page.on("pageerror", (e) => page.errs.push(String(e)));
  await page.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "event", eventId: ev.id, tab: "money" })), { waitUntil: "networkidle" }); await page.waitForTimeout(1800);
  return page;
};
const openFold = async (page, key) => { const f = page.locator(`details[data-fold="sec-${key}"]`); if (!(await f.evaluate((d) => d.open))) await f.locator("summary").first().click(); await page.waitForTimeout(300); };

console.log("— on a phone, as the board member leading the event");
const phone = await as("treasurer@ongia.ca", "Raj Jaswal", { width: 390, height: 844 });
ok("the Money tab has receipts, and no budget for a board member", (await phone.locator("#receiptscard").count()) === 1 && (await phone.locator("#evbudget").count()) === 0);
await openFold(phone, "receipts");
ok("it says receipts are optional here", /Receipts are optional on this event/.test(await phone.locator("#rc-said").innerText()));
await mock({ isReceipt: true, vendor: "Ottawa AV Rentals", date: "2031-05-11", subtotal: 1200, tax: 156, total: 1356, currency: "CAD", confidence: "high", suggestedLine: "AV rental", notes: null });
await phone.locator("#rc-pick input").setInputFiles(D + "receipt1.jpg");
await phone.waitForSelector('.rcd[data-state="done"]', { timeout: 15000 });
ok("Claude's reading picks the budget's AV rental line", (await phone.locator(".rcd .f-line").evaluate((e) => e.selectedOptions[0].textContent)) === "AV rental");
ok("the lines are the budget's, and 'Not sorted' is allowed", await phone.locator(".rcd .f-line option").allInnerTexts().then((t) => t.join("|") === "Not sorted|Hotel rooms|Food & beverage|AV rental"));
ok("paid by can be left as ONGIA paid it directly", /ONGIA paid it directly/.test(await phone.locator(".rcd .f-paid option").first().innerText()));
await phone.locator(".rcd .f-paid").selectOption("");
ok("the button says Keep it", /Keep it/.test(await phone.locator("[data-confirm]").innerText()));
await phone.locator(".rcd").screenshot({ path: D + "rcown-phone-draft.png" });
await phone.click("[data-confirm]"); await phone.waitForSelector(".rcrow", { timeout: 8000 });
// A second one, no line, no note, nothing filled in but the basics.
await mock({ isReceipt: true, vendor: "Corner Store", date: "2031-05-12", subtotal: 18.5, tax: 0, total: 18.5, currency: "CAD", confidence: "high", suggestedLine: "Other", notes: null });
await phone.locator("#rc-pick input").setInputFiles(D + "receipt1.jpg");
await phone.waitForSelector('.rcd[data-state="done"]', { timeout: 15000 });
ok("Claude's 'Other' becomes Not sorted, not a line", (await phone.locator(".rcd .f-line").inputValue()) === "");
await phone.click("[data-confirm]"); await phone.waitForTimeout(1500);
ok("kept without a line or a note", (await phone.locator(".rcsec").count()) === 2 && /Not sorted/.test(await phone.locator("#rc-items").innerText()), await phone.locator("#rc-items").innerText());
ok("phone: fits, no errors", (await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)) && !phone.errs.length, phone.errs.join(" | "));
await phone.close();

console.log("— on a laptop, as the president");
const desk = await as("president@ongia.ca", "Andrew Hammond", { width: 1440, height: 1000 });
const avRow = desk.locator(".sbl tr", { has: desk.locator('[data-k="other.o1.spent"]') });
ok("the budget shows what the receipts come to beside the AV rental line", /receipts \$1,200/.test(await avRow.innerText()), await avRow.innerText());
ok("and a Receipts so far line, the unsorted one counted in it", /Receipts so far/.test(await desk.locator(".sbgrid.two").innerText()) && /\$1,219/.test(await desk.locator(".sbgrid.two").innerText()) && /\$19 not sorted|\$18\.5|not sorted/.test(await desk.locator(".sbgrid.two").innerText()));
await desk.locator(".sbgrid.two .blk").first().screenshot({ path: D + "rcown-budget.png" });
await openFold(desk, "receipts");
ok("the receipts are listed under the budget line and Not sorted", /AV rental/.test(await desk.locator("#rc-items").innerText()) && /Not sorted/.test(await desk.locator("#rc-items").innerText()));
await desk.locator("#receiptscard").screenshot({ path: D + "rcown-receipts.png" });
ok("laptop: no errors", !desk.errs.length, desk.errs.join(" | "));
await desk.close();
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
