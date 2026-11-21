// A refund, on a phone (Andrew 21 Nov 2026: a cancelled Air Canada flight, already paid, refunded to his card). On a
// line: Expense | Refund; Refund of offers the paid flight and fills who, the category and the event; the amount is what
// came back. On the claim it says Refund, in green, with its minus, and the total takes it off. 390 wide.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const { issueExpenseSession } = await import(REPO + "netlify/functions/lib/expenses.mjs");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const S = process.env.DESK_URL || "http://127.0.0.1:8788";
const D = new URL(".", import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const email = "s.hammond@ongia.ca", name = "Stephen Hammond";
const KEY = issueExpenseSession({ email, name });
const api = async (q, method = "GET", body) => { const r = await fetch(`${S}/api/expenses${q}`, { method, headers: { "x-expense-key": KEY, "content-type": "application/json" }, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) }); return r.json(); };
await fetch(`${S}/api/roster`, { headers: { "x-admin-key": "testkey" } });
const day = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(300, 3)]);

// The flight, claimed and paid (as the Treasurer would have marked it).
const fl = await api("?add=noreceipt", "POST", { paidTo: "Air Canada", date: day(-40), amount: 650, category: 8, purpose: "Flight to the Summit", statement: "Booked online; on my Visa." });
await fetch(`${S}/api/expenses?claim=${fl.claim.id}&shot=${fl.line}`, { method: "POST", headers: { "x-expense-key": KEY }, body: PNG });
// Through the real steps: sent, approved by the President and the VP, paid by the VP.
const as = (e, n) => issueExpenseSession({ email: e, name: n });
const call = async (q, key, body) => (await fetch(`${S}/api/expenses${q}`, { method: "POST", headers: { "x-expense-key": key, "content-type": "application/json" }, body: JSON.stringify(body ?? {}) })).json();
const sent = await call(`?submit=${fl.claim.id}`, KEY);
await call(`?decide=${fl.claim.id}`, as("president@ongia.ca", "Andrew Hammond"), { decision: "approve" });
await call(`?decide=${fl.claim.id}`, as("vp_operations@ongia.ca", "Jacqulyn Taylor"), { decision: "approve" });
const paid = await call(`?pay=${fl.claim.id}`, as("vp_operations@ongia.ca", "Jacqulyn Taylor"), { ref: "C1Ag4Yqu34yB", date: day(-10) });
if (paid.claim?.status !== "paid") { console.log("  FAIL the flight claim couldn't be paid on the dev server", JSON.stringify(sent).slice(0, 200), JSON.stringify(paid).slice(0, 300)); process.exit(1); }
// Something on the new claim for the refund to come off.
await api("?add=mileage", "POST", { date: day(-2), from: "Barrie", to: "Toronto", km: 1100, purpose: "Drive to the training" });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errs = [];
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
p.on("pageerror", (e) => errs.push(String(e)));
await p.addInitScript(([t, me]) => { if (!localStorage.getItem("ongia-exp-session")) { localStorage.setItem("ongia-exp-session", t); localStorage.setItem("ongia-exp-me", JSON.stringify(me)); } }, [KEY, { email, name }]);
await p.goto(`${S}/expenses`, { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
await p.click("#addnone"); await p.waitForSelector("#f-rfrow");
ok("a line offers Expense | Refund, on Expense", (await p.locator("#f-rfrow [data-rf]").allInnerTexts()).join("|") === "Expense|Refund" && await p.locator('[data-rf="0"]').getAttribute("aria-checked") === "true" && await p.locator("#rfbox").isHidden());
await p.click('[data-rf="1"]'); await p.waitForTimeout(800);
ok("Refund opens Refund of and asks for the amount refunded", await p.locator("#rfbox").isVisible() && (await p.locator("#f-amountlab").innerText()) === "Amount refunded");
const opts = await p.locator("#f-refundof option").allInnerTexts();
ok("the paid flight is offered", opts.some((o) => /^Air Canada, \w+ \d+, \$650\.00, .* claim$/.test(o)), opts.join(" / "));
await p.selectOption("#f-refundof", { index: 1 }); await p.waitForTimeout(200);
ok("picking it fills who it was paid to, the category and what it was for", (await p.inputValue("#f-paidTo")) === "Air Canada" && (await p.inputValue("#f-category")) === "8" && (await p.inputValue("#f-purpose")) === "Refund of the Air Canada charge");
await p.fill("#f-date", day(-3)); await p.locator("#f-amount").pressSequentially("65000");
ok("the amount is typed as what came back: $650.00", (await p.inputValue("#f-amount")) === "$650.00");
ok("on a refund the no-receipt boxes ask where the credit shows", (await p.locator('label[for="f-statement"]').innerText()) === "Where does the refund show?" && /screenshot of the credit/.test(await p.locator("#shotadd").innerText()));
await p.fill("#f-statement", "Refunded to my Visa when the flight was cancelled.");
if (D) await p.screenshot({ path: D + "refund-edit.png", fullPage: true });
ok("nothing scrolls sideways in the editor", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
await p.click("#save"); await p.waitForTimeout(1500);
if (!(await p.locator("#running").count())) { await p.goBack().catch(() => {}); await p.waitForTimeout(800); }
const row = p.locator(".line", { hasText: "Air Canada" });
ok("on the claim it says Refund, with −$650.00 in green", /refund/i.test(await row.innerText()) && /Of \w+ \d+, \$650\.00, .* claim/.test(await row.innerText()) && !/Refund of the Air Canada charge/.test(await row.innerText()) && /-\$650\.00|−\$650\.00/.test(await row.locator(".amt").innerText()) && await row.locator(".amt.rf").count() === 1, await row.innerText());
const h = await api("");
ok("the claim's total takes it off: 1100 km × $0.66 − $650 = $76.00", h.current?.sums?.total === 76, JSON.stringify(h.current?.sums));
if (D) await p.screenshot({ path: D + "refund-claim.png" });
ok("no script errors", !errs.length, errs.join(" | "));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
