// ONGIA Expenses: pull down to refresh (Andrew, 3 Nov 2026: a home-screen app has no reload button). Real touch events
// through Chromium's own input: a short pull does nothing, a long one reloads, and never inside a form.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueExpenseSession } = await import(REPO + "netlify/functions/lib/expenses.mjs");
const D = new URL(".", import.meta.url).pathname;
const S = process.env.DESK_URL || "http://127.0.0.1:8788";
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await fetch(`${S}/api/roster`, { headers: { "x-admin-key": "testkey" } });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: "America/Toronto" });
const p = await ctx.newPage();
await p.addInitScript(([t, me]) => { localStorage.setItem("ongia-exp-session", t); localStorage.setItem("ongia-exp-me", JSON.stringify(me)); },
  [issueExpenseSession({ email: "s.hammond@ongia.ca", name: "Steve Hammond" }), { email: "s.hammond@ongia.ca", name: "Steve Hammond" }]);
const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
await p.goto(S + "/expenses", { waitUntil: "networkidle" }); await p.locator("#addcam").waitFor();
const cdp = await ctx.newCDPSession(p);
const touch = (type, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: 195, y }] });
// A finger down at y=200, drawn down by `by` pixels in steps; `look` runs before it is lifted.
const pull = async (by, look = async () => {}) => {
  await touch("touchStart", 200);
  for (let d = 10; d <= by; d += 10) await touch("touchMove", 200 + d);
  await look();
  await touch("touchEnd");
};
const mark = () => p.evaluate(() => { window.__same = true; });
const same = () => p.evaluate(() => window.__same === true);

await mark();
let said = "";
await pull(40, async () => { said = await p.locator(".ptr").innerText(); });
await p.waitForTimeout(600);
ok("a short pull shows Pull down to refresh", said === "Pull down to refresh", said);
ok("…and, let go early, nothing reloads", await same());
ok("…and the pill goes away", (await p.locator(".ptr").evaluate((e) => getComputedStyle(e).opacity)) === "0");

await pull(140, async () => { said = await p.locator(".ptr").innerText(); await p.screenshot({ path: D + "expenses-pull.png" }); });
await p.waitForLoadState("load"); await p.locator("#addcam").waitFor();
ok("a long pull says Let go to refresh", said === "Let go to refresh", said);
ok("…and, let go, the app loads again", !(await same()));

await p.locator("#addmile").click(); await p.locator("#f-km").waitFor();
await p.fill("#f-km", "42"); await mark();
await pull(140);
await p.waitForTimeout(800);
ok("in a form (mileage), a pull never reloads: what was typed stays", (await same()) && (await p.inputValue("#f-km")) === "42");
ok("…and no pill shows there", (await p.locator(".ptr").evaluate((e) => getComputedStyle(e).opacity)) === "0");

// The President's To approve screen has the away dates on it: once one is typed, a pull leaves it alone.
const q = await ctx.newPage();
await q.addInitScript(([tk, me]) => { localStorage.setItem("ongia-exp-session", tk); localStorage.setItem("ongia-exp-me", JSON.stringify(me)); },
  [issueExpenseSession({ email: "president@ongia.ca", name: "Andrew Hammond" }), { email: "president@ongia.ca", name: "Andrew Hammond" }]);
q.on("pageerror", (e) => errs.push(String(e)));
await q.goto(S + "/expenses", { waitUntil: "networkidle" }); await q.locator('[data-tab="approve"]').click(); await q.locator("#un-president").waitFor();
const qcdp = await ctx.newCDPSession(q);
const qtouch = (type, y) => qcdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: 195, y }] });
const qpull = async () => { await qtouch("touchStart", 200); for (let d = 10; d <= 140; d += 10) await qtouch("touchMove", 200 + d); await qtouch("touchEnd"); };
await q.evaluate(() => window.scrollTo(0, 0));
await q.fill("#un-president", "2026-11-20"); await q.evaluate(() => { window.__same = true; });
await qpull(); await q.waitForTimeout(800);
ok("with an away date typed in, a pull leaves the screen as it is", (await q.evaluate(() => window.__same === true)) && (await q.inputValue("#un-president")) === "2026-11-20");
ok("no page errors", !errs.length, errs.join(" | "));

await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
