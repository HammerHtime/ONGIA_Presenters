// A claim for a presenter, on the phone (Andrew 17 Nov 2026): on the claim being built, one small line asks "Claiming a
// presenter's expenses for them?"; it opens the event and presenter to pick; the claim then says who it's for and where
// the e-transfer goes. The VP's pay box sends it to the presenter. 390 wide, nothing sideways.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueExpenseSession } = await import(REPO + "netlify/functions/lib/expenses.mjs");
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
const D = new URL(".", import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const T = Date.now().toString(36);
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Western Forum ${T}`, city: "Victoria, BC", dayOne: "2026-11-02", lastDay: "2026-11-02", invite: false,
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }], presenters: [{ first: "Parm", last: "Dhesi", email: `parm.${T}@example.ca`, organization: "Vancouver Police Department" }] }) })).event;

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await p.addInitScript(([t, me]) => { localStorage.setItem("ongia-exp-session", t); localStorage.setItem("ongia-exp-me", JSON.stringify(me)); },
  [issueExpenseSession({ email: "j.healy@ongia.ca", name: "John Healy" }), { email: "j.healy@ongia.ca", name: "John Healy" }]);
const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
// A line on John's claim first, so the claim exists.
await p.goto(`${S}/expenses`, { waitUntil: "networkidle" }); await p.waitForTimeout(800);
const key = await p.evaluate(() => localStorage.getItem("ongia-exp-session"));
await fetch(`${S}/api/expenses?add=mileage`, { method: "POST", headers: { "x-expense-key": key, "content-type": "application/json" }, body: JSON.stringify({ date: "2026-11-02", from: "Nanaimo", to: "Victoria", km: 110, purpose: "Drive to present" }) });
await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(1000);

ok("the claim being built has one small line for a presenter's claim", await p.locator("#forchg", { hasText: "Claiming a presenter's expenses for them?" }).isVisible());
await p.click("#forchg"); await p.waitForTimeout(300);
ok("it asks for the event, then the presenter", await p.locator("dialog.ppdlg #pp-ev").isVisible() && await p.locator("#pp-who").isDisabled());
await p.selectOption("#pp-ev", ev.id); await p.waitForTimeout(1200);
await p.selectOption("#pp-who", { label: "Parm Dhesi · Vancouver Police Department" }); await p.waitForTimeout(200);
ok("picking him says where the e-transfer goes", (await p.locator("#pp-say").innerText()).includes(`Paid to parm.${T}@example.ca`));
if (D) await p.locator("dialog.ppdlg").screenshot({ path: D + "expensepresenter-pick.png" });
await p.click("#pp-save"); await p.waitForTimeout(1500);
const line = await p.locator(".say.forwho").innerText().catch(() => "");
ok("the claim now says who it's for and where the money goes", new RegExp(`For Parm Dhesi, a presenter at Western Forum ${T}\\. The e-transfer goes to parm\\.${T}@example\\.ca`).test(line), line);
ok("nothing scrolls sideways", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
if (D) await p.screenshot({ path: D + "expensepresenter-claim.png" });
await p.click("#forchg"); await p.waitForTimeout(300);
await p.click("#pp-mine"); await p.waitForTimeout(1500);
ok("…and it can be made John's own claim again", await p.locator("#forchg", { hasText: "Claiming a presenter's expenses for them?" }).isVisible() && !(await p.locator(".say.forwho").count()));
ok("no script errors", !errs.length, errs.join(" | "));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
