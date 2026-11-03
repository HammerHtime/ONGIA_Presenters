// ONGIA Expenses: the receipt viewer (Andrew, 3 Nov 2026: "click on the image and a little pop-up opens with the actual
// receipt that I could zoom in and look at the amount, then go back to the app and click ... approved"). A member's
// claim with three card statements goes for approval; the President looks at them on a phone, with real touch input
// through Chromium: swipe, double-tap, pinch, ✕ and the back gesture.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueExpenseSession } = await import(REPO + "netlify/functions/lib/expenses.mjs");
const { todayIso } = await import(REPO + "netlify/functions/lib/deadlines.mjs");
const { readFileSync } = await import("node:fs");
const D = new URL(".", import.meta.url).pathname;
const S = process.env.DESK_URL || "http://127.0.0.1:8788";
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await fetch(`${S}/api/roster`, { headers: { "x-admin-key": "testkey" } });

// The member's claim, made through the API: three lines with no receipt, each with its card statement, sent.
const MEMBER = issueExpenseSession({ email: "s.hammond@ongia.ca", name: "Steve Hammond" });
const api = async (p, init = {}) => (await fetch(S + "/api/expenses" + p, { ...init, headers: { "x-expense-key": MEMBER, ...(init.json ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) }, body: init.json ? JSON.stringify(init.json) : init.body })).json();
const day = todayIso(new Date(Date.now() - 86400e3));
const PIC = readFileSync(D + "receipt1.jpg");
const T = Date.now().toString(36).slice(-4);
let claimId = null;
const names = [`Parking ${T}`, `Taxi ${T}`, `Coffee ${T}`];
const shown = [...names].reverse();   // the claim lists lines newest first, and the viewer goes in the same order
for (const [k, paidTo] of names.entries()) {
  const out = await api(`?add=noreceipt${claimId ? `&claim=${claimId}` : ""}`, { method: "POST", json: { paidTo, date: day, amount: 10 * (k + 1), category: 8, purpose: "Viewer test", statement: "The machine printed no receipt." } });
  claimId = out.claim.id;
  await api(`?claim=${claimId}&shot=${out.line}`, { method: "POST", body: PIC, headers: { "x-file-name": "statement.jpg" } });
}
const sent = await api(`?submit=${claimId}`, { method: "POST", json: {} });
ok("the member's claim with three card statements goes for approval", sent.claim?.status === "submitted", JSON.stringify(sent).slice(0, 300));

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: "America/Toronto" });
const p = await ctx.newPage();
await p.addInitScript(([t, me]) => { localStorage.setItem("ongia-exp-session", t); localStorage.setItem("ongia-exp-me", JSON.stringify(me)); },
  [issueExpenseSession({ email: "president@ongia.ca", name: "Andrew Hammond" }), { email: "president@ongia.ca", name: "Andrew Hammond" }]);
const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
await p.goto(S + "/expenses", { waitUntil: "networkidle" });
await p.locator('[data-tab="approve"]').click();
await p.locator(`[data-open="${claimId}"]`).first().click();
await p.locator("#seepics").waitFor();
ok("the claim to approve has See the receipts (3)", (await p.textContent("#seepics")).trim() === "See the receipts (3)", await p.textContent("#seepics"));
await p.evaluate(() => { window.__same = true; });

const cdp = await ctx.newCDPSession(p);
const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
const swipe = async (x0, x1, y = 420) => { await touch("touchStart", [[x0, y]]); for (let k = 1; k <= 8; k++) await touch("touchMove", [[x0 + ((x1 - x0) * k) / 8, y]]); await touch("touchEnd", []); };
const tap = async (x, y) => { await touch("touchStart", [[x, y]]); await touch("touchEnd", []); };
const count = () => p.textContent("#vcount");
const scale = () => p.evaluate(() => { const m = /scale\(([\d.]+)\)/.exec(document.getElementById("vimg")?.style.transform ?? ""); return m ? Number(m[1]) : 1; });
const loaded = () => p.waitForFunction(() => document.getElementById("vimg")?.complete && document.getElementById("vimg").naturalWidth > 0, null, { timeout: 8000 });

await p.click("#seepics"); await p.locator(".viewer").waitFor(); await loaded();
ok("See the receipts opens the viewer, full screen, on the first in the list: 1 of 3", (await count()) === "1 of 3" && new RegExp(shown[0]).test(await p.textContent("#vcap")), await p.textContent("#vcap"));
ok("…with who, how much and when under it, and the statement flagged", /\$30\.00/.test(await p.textContent("#vcap")) && /Card statement · amount not confirmed/.test(await p.textContent("#vcap")));
const box = await p.locator(".viewer").boundingBox();
ok("…covering the whole screen", box.width === 390 && box.height === 844, JSON.stringify(box));
await p.screenshot({ path: D + "expenses-viewer.png" });

await swipe(320, 80); await p.waitForTimeout(300); await loaded();
ok("a swipe to the left goes to the next: 2 of 3", (await count()) === "2 of 3" && new RegExp(shown[1]).test(await p.textContent("#vcap")));
await p.click("#vnext"); await loaded();
ok("the › button goes on too: 3 of 3, and there is no › on the last", (await count()) === "3 of 3" && await p.locator("#vnext").isHidden());
await swipe(320, 80); await p.waitForTimeout(300);
ok("a swipe past the last stays on it", (await count()) === "3 of 3");

await tap(195, 400); await p.waitForTimeout(80); await tap(195, 400); await p.waitForTimeout(300);
ok("a double tap zooms in", (await scale()) === 2.5, String(await scale()));
await p.screenshot({ path: D + "expenses-viewer-zoomed.png" });
await swipe(100, 330); await p.waitForTimeout(300);
ok("zoomed, a drag moves the receipt and doesn't change it", (await count()) === "3 of 3" && (await scale()) === 2.5);
await tap(195, 400); await p.waitForTimeout(80); await tap(195, 400); await p.waitForTimeout(300);
ok("a double tap again goes back to fit", (await scale()) === 1);

await touch("touchStart", [[170, 420], [220, 420]]);
for (let k = 1; k <= 10; k++) await touch("touchMove", [[170 - 8 * k, 420], [220 + 8 * k, 420]]);
await touch("touchEnd", []); await p.waitForTimeout(300);
const pinched = await scale();
ok("two fingers spread from 50 to 210 px apart zoom in 4.2 times", Math.abs(pinched - 4.2) < 0.05, String(pinched));

await p.click("#vclose"); await p.waitForTimeout(300);
ok("✕ closes it, back on the claim with Approve", (await p.locator(".viewer").count()) === 0 && (await p.textContent("#title")) === "Approve a claim" && await p.isVisible("#approve"));
ok("nothing in there set off pull to refresh", await p.evaluate(() => window.__same === true));

// From a line: tap it, then its picture.
await p.locator(".line", { hasText: shown[1] }).click(); await p.locator("#zoomin").waitFor();
ok("a line's picture says it can be zoomed", /Tap it to zoom in/.test(await p.textContent(".sheet")));
await p.click("#zoomin"); await p.locator(".viewer").waitFor(); await loaded();
ok("tapping it opens the viewer on that line: 2 of 3", (await count()) === "2 of 3");
await p.goBack(); await p.waitForTimeout(300);
ok("the phone's back gesture closes the viewer and leaves the line open", (await p.locator(".viewer").count()) === 0 && (await p.locator(".sheet").count()) === 1);
await p.goBack(); await p.waitForTimeout(300);
ok("back again: the claim, with Approve", (await p.locator(".sheet").count()) === 0 && await p.isVisible("#approve"));

await p.click("#seepics"); await p.locator(".viewer").waitFor();
await p.keyboard.press("Escape"); await p.waitForTimeout(300);
ok("Escape closes it on a computer", (await p.locator(".viewer").count()) === 0);
ok("no page errors, no sideways scroll", !errs.length && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), errs.join(" | "));

await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
