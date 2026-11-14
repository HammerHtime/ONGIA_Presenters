// ONGIA Expenses: a speaker stipend needs no reason and no card statement (Andrew, 3 Nov 2026: "Any receipt line for
// stipend, does not need a reason nor an upload or screenshot"). A member enters one under No receipt, sends the claim,
// and the President sees it as needing no receipt, not as an unconfirmed amount.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueExpenseSession } = await import(REPO + "netlify/functions/lib/expenses.mjs");
const { todayIso } = await import(REPO + "netlify/functions/lib/deadlines.mjs");
const D = new URL(".", import.meta.url).pathname;
const S = process.env.DESK_URL || "http://127.0.0.1:8788";
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await fetch(`${S}/api/roster`, { headers: { "x-admin-key": "testkey" } });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (email, name) => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: "America/Toronto" });
  const p = await ctx.newPage();
  await p.addInitScript(([t, me]) => { localStorage.setItem("ongia-exp-session", t); localStorage.setItem("ongia-exp-me", JSON.stringify(me)); }, [issueExpenseSession({ email, name }), { email, name }]);
  p.errs = []; p.on("pageerror", (e) => p.errs.push(String(e)));
  p.on("dialog", (d) => d.accept());
  await p.goto(S + "/expenses", { waitUntil: "networkidle" }); await p.locator("#addcam").waitFor();
  return p;
};
const m = await open("i.artinian@ongia.ca", "Inis Artinian");
await m.click("#addnone"); await m.locator("#f-category").waitFor();
ok("No receipt says where a stipend goes", /A stipend needs neither: pick Stipend as the category/.test(await m.textContent("#nrintro")));
ok("…and, as it opens, asks for a reason and the card statement", await m.isVisible("#nrwhy") && await m.isVisible("#nrshot"));
await m.selectOption("#f-category", "10");
ok("picking Speaker Stipend puts the reason and the card statement away", await m.isHidden("#nrwhy") && await m.isHidden("#nrshot"));
ok("…and says a stipend needs none of it", /A stipend needs no receipt, no reason and no card statement/.test(await m.textContent("#nrintro")));
await m.screenshot({ path: D + "expenses-stipend.png" });
await m.fill("#f-paidTo", "Inis Artinian"); await m.fill("#f-date", todayIso(new Date(Date.now() - 86400e3)));
await m.locator("#f-amount").pressSequentially("50000"); await m.fill("#f-purpose", "Speaker stipend, Ontario Symposium");
await m.click("#save"); await m.waitForSelector("#running");
const row = m.locator(".line", { hasText: "Inis Artinian" });
ok("added: the line says no receipt is needed, and nothing is missing", /Stipend: no receipt needed/.test(await row.innerText()) && !(await m.locator(".needs").count()), await row.innerText());

await row.click(); await m.locator("#f-category").waitFor();
ok("opened again, the reason and statement stay put away", await m.isHidden("#nrwhy") && await m.isHidden("#nrshot"));
await m.selectOption("#f-category", "8");
ok("switched to another category, they come back", await m.isVisible("#nrwhy") && await m.isVisible("#nrshot"));
await m.selectOption("#f-category", "10");
await m.click("#save"); await m.waitForSelector("#running");

await m.click("#submit"); await m.waitForTimeout(1500);
const home = await (await fetch(S + "/api/expenses", { headers: { "x-expense-key": issueExpenseSession({ email: "i.artinian@ongia.ca", name: "Inis Artinian" }) } })).json();
const sent = home.past?.find((c) => c.status === "submitted") ?? home.past?.[0];
ok("the claim goes for approval with just the stipend on it", sent?.status === "submitted", JSON.stringify(home.past?.map((c) => c.status)));

const a = await open("president@ongia.ca", "Andrew Hammond");
await a.locator('[data-tab="approve"]').click();
await a.locator(`[data-open="${sent?.id}"]`).first().click(); await a.locator("#approve").waitFor();
const root = await a.textContent("#root");
ok("the President sees Everything checks out: the stipend needs no receipt", /Everything checks out/.test(root) && /The stipend needs no receipt/.test(root), root.slice(0, 400));
ok("…and no amount flagged as not confirmed", !/isn't confirmed/.test(root));
await a.locator(".line", { hasText: "Inis Artinian" }).click(); await a.locator(".sheet").waitFor();
const sheet = await a.textContent(".sheet");
ok("its line says Speaker stipend: no receipt needed, with no card statement asked for", /Stipend: no receipt needed/.test(sheet) && !/Amount not confirmed/.test(sheet) && !/Why there's no receipt/.test(sheet));
ok("no page errors", !m.errs.length && !a.errs.length, [...m.errs, ...a.errs].join(" | "));

await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
