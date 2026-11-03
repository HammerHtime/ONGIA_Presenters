// The desk's sidebar has Expenses, under RBH SOWs (Andrew 3 Nov 2026), with a count of what waits on you there; it opens
// ONGIA Expenses in its own tab, already signed in as you (the app takes a Briefing Room session).
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const { issueExpenseSession } = await import(REPO + "netlify/functions/lib/expenses.mjs");
const { todayIso } = await import(REPO + "netlify/functions/lib/deadlines.mjs");
const D = new URL(".", import.meta.url).pathname;
const S = process.env.DESK_URL || "http://127.0.0.1:8788";
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await fetch(`${S}/api/roster`, { headers: { "x-admin-key": "testkey" } });

// A member's claim, sent: it waits on the President.
const J = issueExpenseSession({ email: "j.healy@ongia.ca", name: "John Healy" });
const xapi = async (p, json) => (await fetch(S + "/api/expenses" + p, { method: json ? "POST" : "GET", headers: { "x-expense-key": J, "content-type": "application/json" }, body: json ? JSON.stringify(json) : undefined })).json();
const m = await xapi("?add=mileage", { date: todayIso(new Date(Date.now() - 2 * 86400e3)), from: "Barrie", to: "Toronto", km: 50, purpose: "Drive to the training" });
const sent = await xapi(`?submit=${m.claim.id}`, {});
ok("a member's claim waits on the President", sent.claim?.status === "submitted", JSON.stringify(sent).slice(0, 200));
const waiting = (await (await fetch(`${S}/api/expenses`, { headers: { "x-expense-key": issueExpenseSession({ email: "president@ongia.ca", name: "Andrew Hammond" }) } })).json()).toApprove.length;

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const desk = async (who, w = 1440, key = null) => {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
  const p = await ctx.newPage();
  await p.addInitScript(([k, who]) => { sessionStorage.setItem("ongia-admin-key", k); if (who) sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); }, [key ?? issueSession(who), who]);
  p.errs = []; p.on("pageerror", (e) => p.errs.push(String(e)));
  await p.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
  return { ctx, p };
};
const ANDREW = { email: "president@ongia.ca", name: "Andrew Hammond", canCost: true };
const { ctx, p } = await desk(ANDREW);
const order = await p.evaluate(() => [...document.querySelectorAll("#side .sn span")].map((s) => s.textContent.trim()).filter(Boolean));
ok("Expenses is in the sidebar, right under RBH SOWs", order.indexOf("Expenses") === order.indexOf("RBH SOWs") + 1, JSON.stringify(order));
ok("its badge counts the claims waiting for you", waiting > 0 && (await p.locator("#expensesnav [data-expn]").innerText()).trim() === String(waiting) && await p.locator("#expensesnav [data-expn]").isVisible(), `${waiting}`);
await p.locator("#side").screenshot({ path: D + "desk-expenses-side.png" });
const [x] = await Promise.all([ctx.waitForEvent("page"), p.locator("#expensesnav").click()]);
await x.waitForLoadState("networkidle"); await x.waitForTimeout(800);
ok("it opens ONGIA Expenses in its own tab, and the Briefing Room stays put", new URL(x.url()).pathname === "/expenses" && new URL(p.url()).pathname === "/admin.html");
ok("…already signed in as you: no sign-in, To approve there", await x.locator('[data-tab="approve"]').count() === 1 && !(await x.locator(".signin").isVisible().catch(() => false)), (await x.locator("body").innerText()).slice(0, 200));
await x.locator('[data-tab="approve"]').click(); await x.waitForTimeout(500);
ok("…with the waiting claim in it", await x.locator(`[data-open="${m.claim.id}"]`).count() >= 1);
ok("no page errors on the desk", !p.errs.length, p.errs.join(" | "));
await ctx.close();

const member = await desk({ email: "j.healy@ongia.ca", name: "John Healy" });
const morder = await member.p.evaluate(() => [...document.querySelectorAll("#side .sn span")].map((s) => s.textContent.trim()).filter(Boolean));
ok("a board member who doesn't see RBH SOWs still has Expenses", morder.includes("Expenses") && !morder.includes("RBH SOWs"), JSON.stringify(morder));
await member.ctx.close();

const keyed = await desk(null, 1440, "testkey");
ok("signed in with the desk key (nobody in particular), there's no Expenses", await keyed.p.locator("#expensesnav").count() === 0);
await keyed.ctx.close();

const rail = await desk(ANDREW, 1280);
ok("on a laptop, the icon rail has Expenses with its badge", await rail.p.locator("#expensesnav").isVisible() && await rail.p.locator("#expensesnav [data-expn]").isVisible());
await rail.p.locator("#side").screenshot({ path: D + "desk-expenses-rail.png" });
await rail.ctx.close();

await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
