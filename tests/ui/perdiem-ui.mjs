// A presenter's per diem, on the phone (Andrew 17 Nov 2026). On a claim made for a presenter, a line says which meal it
// was; a meal over its rate shows amber while it's typed and on the claim, and still goes; the approvers see it lit up;
// the President sets the rates from the menu. A board member's own claim has no meal question. 390 wide.
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
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Ontario Symposium ${T}`, city: "Windsor, ON", dayOne: "2026-11-10", lastDay: "2026-11-11", invite: false,
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }], presenters: [{ first: "Dana", last: "Sample", email: `dana.${T}@example.ca`, organization: "Windsor Police Service" }] }) })).event;
const pres = (await api(`/api/events?id=${ev.id}`)).presenters?.[0] ?? (await api(`/api/presenters?event=${ev.id}`)).presenters?.[0];

const JOHN = issueExpenseSession({ email: "j.healy@ongia.ca", name: "John Healy" });
const as = (k) => ({ "x-expense-key": k, "content-type": "application/json" });
const xp = async (p, i = {}, k = JOHN) => (await fetch(`${S}/api/expenses${p}`, { ...i, headers: as(k) })).json();
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = async (key, me) => {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await p.addInitScript(([t, m]) => { localStorage.setItem("ongia-exp-session", t); localStorage.setItem("ongia-exp-me", JSON.stringify(m)); }, [key, me]);
  p.on("pageerror", (e) => errs.push(String(e)));
  return p;
};
const errs = [];

// John's own claim: no meal question.
let r = await xp("?add=noreceipt", { method: "POST", body: JSON.stringify({ paidTo: "The Keg", date: "2026-11-10", amount: 80, category: 8, purpose: "Dinner", statement: "Receipt lost." }) });
const C = r.claim.id, keg = r.line;
const p = await page(JOHN, { email: "j.healy@ongia.ca", name: "John Healy" });
await p.goto(`${S}/expenses`, { waitUntil: "networkidle" }); await p.waitForTimeout(900);
await p.click(`[data-line="${keg}"]`); await p.waitForTimeout(700);
ok("his own claim: no meal question", await p.locator("#f-mealrow").count() === 0);
await p.goBack(); await p.waitForTimeout(500);

// Made Dana's: the per diem shows under who it's for, and the line asks which meal.
const pid = (await xp(`?presenters=${ev.id}`)).presenters[0].id;
await xp(`?claim=${C}&for=1`, { method: "PUT", body: JSON.stringify({ event: ev.id, presenter: pid }) });
await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(900);
const fw = await p.locator(".say.forwho").innerText();
ok("the claim shows Dana's per diem under who it's for", /Per diem: Breakfast \$29\.95 · Lunch \$30\.55 · Dinner \$62\.70$/m.test(fw.trim()) && !/km/.test(fw), fw);
await p.click(`[data-line="${keg}"]`); await p.waitForTimeout(700);
ok("a line on a presenter's claim asks which meal, in one row of short chips", await p.locator("#f-mealrow").isVisible() && (await p.locator("#f-mealrow button").allInnerTexts()).join("|") === "Not a meal|Breakfast|Lunch|Dinner"
  && await p.evaluate(() => { const bs = [...document.querySelectorAll("#f-mealrow button")]; return new Set(bs.map((x) => Math.round(x.getBoundingClientRect().top))).size === 1; }));
await p.click('[data-meal="dinner"]'); await p.waitForTimeout(200);
const say = await p.locator("#perdiemrow").innerText();
ok("picking Dinner on $80 says how far over, and that it still goes", /Over the dinner per diem \(\$62\.70\) by \$17\.30\. It still goes; the approvers decide\./.test(say), say);
await p.fill("#f-amount", "5500"); await p.waitForTimeout(200);
ok("under the rate, it just says the rate", /Per diem for dinner: \$62\.70/.test(await p.locator("#perdiemrow").innerText()));
await p.fill("#f-amount", "8000"); await p.waitForTimeout(200);
ok("nothing scrolls sideways in the form", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
if (D) await p.locator("#f-mealrow").locator("xpath=..").screenshot({ path: D + "perdiem-editor.png" });
await p.click("#save"); await p.waitForTimeout(1500);
const row = await p.locator(`[data-line="${keg}"]`).innerText();
ok("saved: the line on the claim says it's over, in amber", /Over the dinner per diem by \$17\.30/.test(row), row);
ok("the per diem note on the row is one short line", (await p.locator(`[data-line="${keg}"] .check.wt`, { hasText: "per diem" }).boundingBox()).height < 24);
if (D) await p.screenshot({ path: D + "perdiem-claim.png" });

// It sends.
await fetch(`${S}/api/expenses?claim=${C}&shot=${keg}`, { method: "POST", headers: { "x-expense-key": JOHN }, body: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(300, 3)]) });
r = await xp(`?submit=${C}`, { method: "POST", body: "{}" });
ok("the claim sends: over the per diem doesn't stop it", r.claim?.status === "submitted", JSON.stringify(r.problems ?? r.error));

// The President approving: the line lit up, the per diem on the presenter's card.
const PRES = issueExpenseSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
const q = await page(PRES, { email: "president@ongia.ca", name: "Andrew Hammond" });
await q.goto(`${S}/expenses#claim=${C}`, { waitUntil: "networkidle" }); await q.waitForTimeout(1500);
const body = await q.locator("#root, main, body").first().innerText();
ok("the approver sees the line lit up red with the reason", await q.locator(".line.flagged", { hasText: "Over the dinner per diem by $17.30" }).isVisible(), body.slice(0, 600));
ok("and the per diem on Dana's card", /Per diem: Breakfast \$29\.95/.test(body));
ok("Claude's check names it and leaves it to them", /\$80\.00 for dinner, \$17\.30 over the \$62\.70 per diem\. Up to you whether to allow it\./.test(body));
ok("Approve is there: nothing blocks it", await q.locator("#approve").isVisible());
if (D) await q.screenshot({ path: D + "perdiem-approve.png", fullPage: true });

// The President changes the rates from the menu.
await q.goto(`${S}/expenses`, { waitUntil: "networkidle" }); await q.waitForTimeout(1000);
await q.click("#me"); await q.waitForTimeout(200);
await q.click("#pdbtn"); await q.waitForTimeout(500);
ok("the menu opens Presenter per diem, with the three meal rates and no kilometres", await q.locator("#pd-dinner").inputValue() === "62.70" && await q.locator("#pd-km").count() === 0);
ok("nothing scrolls sideways on the rates screen", await q.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
if (D) await q.screenshot({ path: D + "perdiem-rates.png" });
await q.fill("#pd-dinner", "65.00"); await q.click("#pdsave"); await q.waitForTimeout(1200);
const after = await xp("", {}, PRES);
ok("saved: dinner is $65.00 now, and it says who set it", after.perDiem.dinner === 65 && after.perDiem.setBy === "Andrew Hammond", JSON.stringify(after.perDiem));
// John doesn't get the menu item.
await p.goto(`${S}/expenses`, { waitUntil: "networkidle" }); await p.waitForTimeout(800);
await p.click("#me"); await p.waitForTimeout(200);
ok("a board member's menu has no per diem", await p.locator("#pdbtn").count() === 0);
ok("no script errors", !errs.length, errs.join(" | "));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
