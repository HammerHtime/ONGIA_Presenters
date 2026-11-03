// ONGIA Expenses: the "Allow" button that lets an iPhone show the count on the app's icon (Andrew, 3 Nov 2026). An
// iPhone shows a number on a home-screen app only once its notifications are allowed, and asks only after a tap.
// The phone is stood in for: a home-screen app (navigator.standalone), its notification permission, and the icon.
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
// `perm`: what the phone has said so far; `answer`: what it says when asked; `home`: opened from the home screen.
const open = async ({ perm = "default", answer = "granted", home = true } = {}) => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: "America/Toronto" });
  const page = await ctx.newPage();
  await page.addInitScript(([t, me, perm, answer, home]) => {
    localStorage.setItem("ongia-exp-session", t); localStorage.setItem("ongia-exp-me", JSON.stringify(me));
    window.__badge = null; window.__asked = 0;
    navigator.setAppBadge = (n) => { window.__badge = n; return Promise.resolve(); }; navigator.clearAppBadge = () => { window.__badge = 0; return Promise.resolve(); };
    // The phone's answer is kept, as an iPhone keeps it, so a reload sees what was said.
    window.Notification = class { static get permission() { return localStorage.getItem("__perm") || perm; }
      static requestPermission() { window.__asked++; localStorage.setItem("__perm", answer); return Promise.resolve(answer); } };
    if (home) Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
  }, [issueExpenseSession({ email: "president@ongia.ca", name: "Andrew Hammond" }), { email: "president@ongia.ca", name: "Andrew Hammond" }, perm, answer, home]);
  page.errs = []; page.on("pageerror", (e) => page.errs.push(String(e)));
  await page.goto(S + "/expenses", { waitUntil: "networkidle" }); await page.locator("#addcam").waitFor();
  return page;
};
const menu = async (p) => { await p.locator("#me").click(); await p.waitForTimeout(150); return (await p.locator("#menu").innerText()).replace(/\s+/g, " "); };
const fits = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

// 1. From the home screen, not asked yet: the card, then Allow.
let p = await open();
const card = p.locator("#badgeask");
ok("on an iPhone home-screen app, My claim asks to show the count on the icon", await card.isVisible() && /Show the count on the app icon\?/.test(await card.innerText()));
ok("the Allow button is a full-size tap target", (await p.locator("#badgeyes").boundingBox()).height >= 44);
await p.screenshot({ path: D + "expenses-badge-ask.png" });
await p.locator("#badgeyes").click(); await p.waitForTimeout(400);
ok("Allow asks the phone once", (await p.evaluate(() => window.__asked)) === 1);
ok("…and the card goes, with a word that it's done", !(await card.count()) && /The count shows on the app icon/.test(await p.locator("body").innerText()));
ok("…and the icon is painted straight away", (await p.evaluate(() => window.__badge)) !== null);
ok("the menu says it's on, with nothing to press", /Count on the app icon On\./.test(await menu(p)) && !(await p.locator("#badgemenu").count()));
await p.reload({ waitUntil: "networkidle" }); await p.locator("#addcam").waitFor();
ok("once allowed, it never asks again", !(await p.locator("#badgeask").count()));
ok("fits a phone, no page errors", (await fits(p)) && !p.errs.length, p.errs.join(" | "));
await p.context().close();

// 2. Not now, then from the menu, and the phone says no.
p = await open({ answer: "denied" });
await p.locator("#badgeno").click();
ok("Not now puts the card away without asking the phone", !(await p.locator("#badgeask").count()) && (await p.evaluate(() => window.__asked)) === 0);
await p.reload({ waitUntil: "networkidle" }); await p.locator("#addcam").waitFor();
ok("…and it stays away", !(await p.locator("#badgeask").count()));
let said = await menu(p);
ok("the menu still offers it", /Count on the app icon Off until you allow it\./.test(said) && await p.locator("#badgemenu").isVisible(), said);
await p.locator("#menu").screenshot({ path: D + "expenses-badge-menu.png" });
await p.locator("#badgemenu").click(); await p.waitForTimeout(400);
said = (await p.locator("#menu").innerText()).replace(/\s+/g, " ");
ok("when the phone says no, the menu says where to turn it on", /Settings, Notifications, ONGIA Expenses/.test(said) && !(await p.locator("#badgemenu").count()), said);
ok("…and so does the note at the bottom", /Your phone said no/.test(await p.locator("body").innerText()));
ok("the menu still opens and closes (the button didn't close it)", await p.locator("#menu").isVisible());
ok("no page errors", !p.errs.length, p.errs.join(" | "));
await p.context().close();

// 3. Turned off on the phone already: no card; the menu says where.
p = await open({ perm: "denied" });
ok("already turned off: no card on My claim", !(await p.locator("#badgeask").count()));
ok("…the menu says where to turn it on", /Settings, Notifications, ONGIA Expenses/.test(await menu(p)));
await p.context().close();

// 4. In a browser, not the home screen: nothing is offered (an iPhone only badges a home-screen app).
p = await open({ home: false });
ok("in a browser tab: no card", !(await p.locator("#badgeask").count()));
ok("…and nothing about it in the menu", !/Count on the app icon/.test(await menu(p)));
ok("no page errors", !p.errs.length, p.errs.join(" | "));
await p.context().close();

await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
