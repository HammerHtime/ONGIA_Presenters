// The board test, from the President's All claims (Andrew 3 Nov 2026): the switch, the banner everyone sees while it's
// on, and Clear, which says how many it would delete, whose, and asks first. This test turns the switch off again at
// the end, and cancels the clear at the question: the server it runs on is shared with the other tests.
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
const J = issueExpenseSession({ email: "j.healy@ongia.ca", name: "John Healy" });
const P = issueExpenseSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
const xapi = async (key, p, json, method) => (await fetch(S + "/api/expenses" + p, { method: method ?? (json ? "POST" : "GET"), headers: { "x-expense-key": key, "content-type": "application/json" }, body: json ? JSON.stringify(json) : undefined })).json();
// A sent claim, so there's something on All claims.
const m = await xapi(J, "?add=mileage", { date: todayIso(new Date(Date.now() - 86400e3)), from: "Barrie", to: "Toronto", km: 40, purpose: "Board test check" });
await xapi(J, `?submit=${m.claim.id}`, {});

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage();
const ANDREW = { email: "president@ongia.ca", name: "Andrew Hammond", canCost: true };
await p.addInitScript(([k, who]) => { sessionStorage.setItem("ongia-admin-key", k); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); }, [issueSession(ANDREW), ANDREW]);
const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
let asked = "", answer = true;
p.on("dialog", (d) => { asked = d.message(); answer ? d.accept() : d.dismiss(); });
await p.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await p.waitForTimeout(1000);
await p.locator("#expensesnav").click(); await p.waitForTimeout(2000);
const f = p.frameLocator("#expframe");
await f.locator('.dtab[data-tab="all"]').click(); await p.waitForTimeout(1500);
ok("All claims has the President's Board test card, off to start", await f.locator("#boardcard").count() === 1 && /^Off\./.test(await f.locator("#boardcard .note").first().innerText()));
await f.locator("#bttoggle").click(); await p.waitForTimeout(1500);
ok("turned on: the banner shows, and the card says since when", /BOARD TEST\. Claims sent now are part of testing the app, so no money is sent/.test(await f.locator("#root").innerText()) && /^On since /.test(await f.locator("#boardcard .note").first().innerText()));
ok("…and everyone's app knows", (await xapi(J, "")).boardTest?.on === true);
const j2 = await xapi(J, "?add=mileage", { date: todayIso(new Date(Date.now() - 86400e3)), from: "Barrie", to: "Orillia", km: 30, purpose: "Board test check" });
await xapi(J, `?submit=${j2.claim.id}`, {});
await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(2000);
await f.locator('.dtab[data-tab="all"]').click(); await p.waitForTimeout(1200);
ok("a claim sent now has Board test on its tile", /Board test/i.test(await f.locator(`.dlist [data-open="${j2.claim.id}"]`).innerText()));
await p.screenshot({ path: D + "expenses-boardtest.png" });
// Clear: asks first, saying how many and whose; cancelled, nothing goes.
const before = (await xapi(P, "")).all.length;
answer = false;
await f.locator("#clrgo").scrollIntoViewIfNeeded(); await f.locator("#clrgo").click(); await p.waitForTimeout(1500);
ok("Clear asks first: how many, made up to which day, whose, and that it can't be undone", /^Delete \d+ claims? made up to .+ \(.*John Healy.*\), with their receipts and their copies on SharePoint\?/.test(asked) && /can't be undone/.test(asked), asked);
ok("…cancelled, nothing is deleted", (await xapi(P, "")).all.length === before);
// Off again, after a question.
answer = true; asked = "";
await f.locator("#bttoggle").click(); await p.waitForTimeout(1500);
ok("turning it off asks first, then the banner goes", /Claims sent from now on are real claims/.test(asked) && !/BOARD TEST\./.test(await f.locator("#root").innerText()) && (await xapi(J, "")).boardTest === null);
ok("no page errors", !errs.length, errs.join(" | "));
await ctx.close();

// A board member sees no such card.
const mctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const mp = await mctx.newPage();
await mp.addInitScript(([k]) => { localStorage.setItem("ongia-exp-session", k); localStorage.setItem("ongia-exp-me", JSON.stringify({ email: "j.healy@ongia.ca", name: "John Healy" })); }, [J]);
await mp.goto(`${S}/expenses`, { waitUntil: "networkidle" }); await mp.waitForTimeout(1000);
ok("a board member has no All claims and no Board test card", await mp.locator('[data-tab="all"]').count() === 0 && await mp.locator("#boardcard").count() === 0);
await mctx.close();

// Tidy up: the claims made here would otherwise wait on the President in the tests after this one.
for (const id of [m.claim.id, j2.claim.id]) {
  await xapi(issueExpenseSession({ email: "treasurer@ongia.ca", name: "Raj Jaswal" }), `?decide=${id}`, { decision: "reject", comment: "Test claim, removed." });
  await fetch(`${S}/api/expenses?claim=${id}`, { method: "DELETE", headers: { "x-expense-key": J } });
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
