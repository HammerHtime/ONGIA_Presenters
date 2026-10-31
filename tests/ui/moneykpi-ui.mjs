// The Money tab's headline (audit, 30 Oct 2026, from the mock-up Andrew picked): five numbers instead of fourteen tiles
// (profit, revenue, expenses, break-even, registrations), one strip of what needs watching (room block, food & beverage
// minimum, still to pay, the next hotel date), and the rest folded under More numbers.
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
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Money KPI ${T}`, city: "Toronto, ON", venue: "Hall", dayOne: "2031-11-10", lastDay: "2031-11-13", invite: false,
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }], hotel: { name: "Delta", rate: "$205" } }) })).event;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1440, 1000, "wide"], [390, 844, "phone"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await p.addInitScript(([t, x]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(x)); } catch {} }, [issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" }), { email: "president@ongia.ca", name: "Andrew Hammond", canCost: true }]);
  const errs = []; p.on("pageerror", (e) => errs.push(String(e))); p.on("dialog", (d) => d.accept());
  await p.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "event", eventId: ev.id, tab: "money" })), { waitUntil: "networkidle" }); await p.waitForTimeout(1800);
  if (await p.locator("dialog.walk[open]").count()) { await p.locator("#wclose").click(); await p.waitForTimeout(400); }
  if (tag === "wide") {
    const set = async (k, v) => { const f = p.locator(`[data-k="${k}"]`); await f.fill(String(v)); await f.press("Tab"); await p.waitForTimeout(800); };
    await set("reg.inPerson.price", 599); await set("reg.inPerson.expected", 300);
  }
  const kpi = await p.locator(".sbkpi .sbt .k").allInnerTexts();
  ok(`${tag}: five headline numbers: profit, revenue, expenses, break-even, registrations`, kpi.length === 5 && /Profit/i.test(kpi[0]) && /Revenue/i.test(kpi[1]) && /Expenses/i.test(kpi[2]) && /Break-even/i.test(kpi[3]) && /Registrations/i.test(kpi[4]), kpi.join(" | "));
  const strip = await p.locator(".sbstrip .sbt .k").allInnerTexts();
  ok(`${tag}: one strip: room block, food & beverage, still to pay, the next hotel date`, strip.length === 4 && /Room nights/i.test(strip[0]) && /Food/i.test(strip[1]) && /Still to pay/i.test(strip[2]) && /Coming up with the hotel/i.test(strip[3]), strip.join(" | "));
  ok(`${tag}: the rest under More numbers, shut`, !(await p.locator(".sbmore").evaluate((d) => d.open)) && /Cost per attendee/i.test(await p.locator(".sbmore").innerText().catch(() => "") || await p.locator(".sbmore").evaluate((d) => d.textContent)));
  await p.locator(".sbmore summary").click(); await p.waitForTimeout(300);
  ok(`${tag}: More numbers opens them: cost per attendee, the room each day, sponsors`, /Cost per attendee/i.test(await p.locator(".sbmore").innerText()) && /In the room each day/i.test(await p.locator(".sbmore").innerText()) && /Sponsors/i.test(await p.locator(".sbmore").innerText()));
  if (tag === "wide") ok(`${tag}: the profit leads, on navy, with the break-even and registrations beside it in one row`, await p.locator(".sbkpi .sbt").first().evaluate((e) => getComputedStyle(e).backgroundColor) === "rgb(14, 26, 53)"
    && new Set(await p.locator(".sbkpi .sbt").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))).size === 1);
  ok(`${tag}: the section below says what's typed and what comes in on its own`, /The numbers behind it/.test(await p.locator("#evbudget").innerText()));
  await p.locator(".sbkpi").screenshot({ path: D + `moneykpi-${tag}.png` });
  ok(`${tag}: no sideways scroll, no errors`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth) && !errs.length, errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
