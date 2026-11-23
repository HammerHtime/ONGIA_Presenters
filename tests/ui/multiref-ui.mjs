// More than one e-transfer on a payment (Andrew 23 Nov 2026: "Our etransfer limit is 10k. So when an expense is more then
// that we split etransfer over multiple payments. Therefore I need to record the transaction numbers"). A $14,500 claim
// opens to pay with two boxes; Add another adds a third, × takes it away; both numbers are kept and shown when paid.
// Under $10,000 it is one box, as before. 390 wide, and a desktop shot.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const { issueExpenseSession } = await import(REPO + "netlify/functions/lib/expenses.mjs");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const S = process.env.DESK_URL || "http://127.0.0.1:8788";
const D = new URL(".", import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const as = (e, n) => issueExpenseSession({ email: e, name: n });
const ME = as("s.hammond@ongia.ca", "Stephen Hammond"), VP = as("vp_operations@ongia.ca", "Jacqulyn Taylor");
const call = async (q, key, body, method = "POST") => (await fetch(`${S}/api/expenses${q}`, { method, headers: { "x-expense-key": key, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })).json();
await fetch(`${S}/api/roster`, { headers: { "x-admin-key": "testkey" } });
const day = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(300, 3)]);

async function approvedClaim(amount, what) {
  const a = await call("?add=noreceipt", ME, { paidTo: "Hotel Saskatchewan", date: day(-20), amount, category: 8, purpose: what, statement: "Paid on my card; the hotel's folio is to follow." });
  await fetch(`${S}/api/expenses?claim=${a.claim.id}&shot=${a.line}`, { method: "POST", headers: { "x-expense-key": ME }, body: PNG });
  await call(`?submit=${a.claim.id}`, ME);
  await call(`?decide=${a.claim.id}`, as("president@ongia.ca", "Andrew Hammond"), { decision: "approve" });
  await call(`?decide=${a.claim.id}`, VP, { decision: "approve" });
  return a.claim.id;
}
const big = await approvedClaim(14500, "Rooms for the Regina training");

// The server: the same number twice, and a number that isn't one, are refused; nothing is paid.
let r = await call(`?pay=${big}`, VP, { refs: ["CAq7Hd2Lp9", "caq7hd2lp9"], date: day(0) });
ok("the same number twice is refused", /in twice/.test(r.error ?? ""), JSON.stringify(r));
r = await call(`?pay=${big}`, VP, { refs: ["CAq7Hd2Lp9", "x"], date: day(0) });
ok("a number that isn't one is refused, by name", /"x" doesn't look like a transaction number/.test(r.error ?? ""), JSON.stringify(r));

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errs = [];
async function vpPage(width, height) {
  const p = await b.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  p.on("pageerror", (e) => errs.push(String(e)));
  await p.addInitScript(([t, me]) => { localStorage.setItem("ongia-exp-session", t); localStorage.setItem("ongia-exp-me", JSON.stringify(me)); }, [VP, { email: "vp_operations@ongia.ca", name: "Jacqulyn Taylor" }]);
  return p;
}
const p = await vpPage(390, 844);
await p.goto(`${S}/expenses#claim=${big}`, { waitUntil: "networkidle" }); await p.waitForSelector("#refs");
await p.waitForTimeout(500);
const inputs = () => p.locator("#refs .refbox .refnum"), days = () => p.locator("#refs .refbox .refday");
ok("over $10,000: two boxes, numbered, with why", await inputs().count() === 2 && (await p.locator("#refs .refn").allInnerTexts()).join() === "1,2"
  && /Over \$10,000: 2 e-transfers\. A number and the date sent for each\./.test(await p.locator("#refs .refhint").innerText()) && (await p.locator('#refs label[for="ref"]').innerText()) === "E-transfer transaction numbers");
ok("each has its own date, today to start; the one Date sent field goes", await days().count() === 2 && await days().nth(0).inputValue() === day(0) && await p.locator("#paydate").isHidden());
ok("the first box has the cursor", await p.evaluate(() => document.activeElement?.id) === "ref");
await inputs().nth(0).fill("CAq7Hd2Lp9"); await days().nth(0).fill(day(-1));
await inputs().nth(1).fill("CAz3Mn8Rt4");
await p.click("#refadd");
ok("Add another adds a third, keeping what's typed", await inputs().count() === 3 && await inputs().nth(0).inputValue() === "CAq7Hd2Lp9" && await inputs().nth(1).inputValue() === "CAz3Mn8Rt4" && await days().nth(0).inputValue() === day(-1));
await inputs().nth(2).fill("CAw1Xy5Kq2");
await p.locator(".card:has(#refs)").screenshot({ path: D + "multiref-three.png" });
await p.locator("#refs button.refx").nth(1).click();
ok("× takes that one away and keeps the rest, dates too", await inputs().count() === 2 && await inputs().nth(0).inputValue() === "CAq7Hd2Lp9" && await inputs().nth(1).inputValue() === "CAz3Mn8Rt4" && await days().nth(0).inputValue() === day(-1));
ok("nothing scrolls sideways", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await p.locator(".card:has(#refs)").screenshot({ path: D + "multiref-form.png" });
await p.click("#paybtn"); await p.waitForTimeout(1500);
const lockEl = p.locator(".lock", { hasText: "Paid" }).first(), lock = await lockEl.innerText();
ok("paid: both numbers on the claim", /2 e‑transfers CAq7Hd2Lp9 \(\w+ \d+\), CAz3Mn8Rt4 \(\w+ \d+\)\. Locked\./.test(lock), lock);
await lockEl.screenshot({ path: D + "multiref-paid.png" });
const got = await call(`?claim=${big}`, VP, undefined, "GET");
ok("stored: each number, and joined for the form and the PDF", JSON.stringify(got.claim?.paid?.refs) === '["CAq7Hd2Lp9","CAz3Mn8Rt4"]' && got.claim?.paid?.ref === "CAq7Hd2Lp9, CAz3Mn8Rt4", JSON.stringify(got.claim?.paid));
ok("stored: each with its own date; paid on the day the last went", JSON.stringify(got.claim?.paid?.sent) === JSON.stringify([{ ref: "CAq7Hd2Lp9", date: day(-1) }, { ref: "CAz3Mn8Rt4", date: day(0) }]) && got.claim?.paid?.date === day(0), JSON.stringify(got.claim?.paid));

// Under the limit: one box, as before; Add another still there for a split anyway.
const small = await approvedClaim(640, "Rooms for the Victoria training");
const q = await vpPage(1280, 900);
await q.goto(`${S}/expenses#claim=${small}`, { waitUntil: "networkidle" }); await q.waitForSelector("#refs"); await q.waitForTimeout(400);
ok("under $10,000: one box, no number, no hint", await q.locator("#refs .refbox .refnum").count() === 1 && await q.locator("#refs .refday").count() === 0 && await q.locator("#refs .refn").count() === 0 && await q.locator("#refs .refhint").isHidden() && await q.locator("#paydate").isVisible()
  && (await q.locator('#refs label[for="ref"]').innerText()) === "E-transfer transaction number");
await q.locator(".card:has(#refs)").screenshot({ path: D + "multiref-one-desktop.png" });
await q.fill("#ref", "CAp4Lm2Nb8"); await q.fill("#paydate", day(-3)); await q.click("#paybtn"); await q.waitForTimeout(1500);
ok("one number pays as before", /e-transfer CAp4Lm2Nb8\. Locked\./.test(await q.locator(".lock", { hasText: "Paid" }).first().innerText()));
const one = await call(`?claim=${small}`, VP, undefined, "GET");
ok("one number stored as before with the Date sent, no list", one.claim?.paid?.ref === "CAp4Lm2Nb8" && one.claim?.paid?.date === day(-3) && !one.claim?.paid?.refs && !one.claim?.paid?.sent);
ok("no page errors", !errs.length, errs.join(" | "));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
