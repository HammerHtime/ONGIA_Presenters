// ONGIA Expenses on a phone, as a board member builds a claim over a week: a receipt photographed and read by Claude
// (the stand-in on 8799), checked, saved; one typed in before Claude finished; mileage; a line with no receipt; the
// back button keeping what was typed; a photo taken with no signal, kept on the phone and sent when it comes back.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueExpenseSession } = await import(REPO + "netlify/functions/lib/expenses.mjs");
const D = new URL(".", import.meta.url).pathname;
const S = process.env.DESK_URL || "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
const mock = (reply, delay = 0) => fetch("http://127.0.0.1:8799/__set", { method: "POST", body: JSON.stringify({ reply, delay }) });
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const day = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const T = Date.now().toString(36);
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Gang Summit ${T}`, city: "Toronto, ON", venue: "V", dayOne: day(3), lastDay: day(5), invite: false,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], presenters: [] }) })).event;

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (email, name, vp, ctxOpts = {}) => {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: vp.width < 500, hasTouch: vp.width < 500, ...ctxOpts });
  const page = await ctx.newPage();
  await page.addInitScript(([t, me]) => { if (!localStorage.getItem("ongia-exp-session")) { localStorage.setItem("ongia-exp-session", t); localStorage.setItem("ongia-exp-me", JSON.stringify(me)); } },
    [issueExpenseSession({ email, name }), { email, name }]);
  page.on("dialog", (d) => d.accept());
  page.errs = []; page.on("pageerror", (e) => page.errs.push(String(e)));
  await page.goto(`${S}/expenses`, { waitUntil: "networkidle" });
  await page.waitForSelector("#running");
  page.ctx = ctx;
  return page;
};
const total = (p) => p.textContent("#running .big");
const fits = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

console.log("— an empty claim, on a phone");
// Jessy: a member expenseflow-ui (run before this on the same server) never uses, so "nothing sent yet" is true.
const phone = await open("j.johal@ongia.ca", "Jessy Johal", { width: 390, height: 844 });
ok("it opens on My claim at $0.00, saying what to do first", (await total(phone)) === "$0.00" && /Take a photo of your first receipt/.test(await phone.textContent("#running")));
ok("the photo button leads; mileage and no receipt sit under it", await phone.isVisible("#addcam") && await phone.isVisible("#addmile") && await phone.isVisible("#addnone"));
ok("a board member has My claim and Paid claims, no To approve", (await phone.locator("#tabs button").allInnerTexts()).join("|") === "My claim|Paid claims");
await phone.screenshot({ path: D + "exp-empty-phone.png" });

console.log("— a receipt, photographed");
await mock({ isReceipt: true, vendor: "Delta Hotels", date: day(-2), total: 658.12, tax: 75.71, currency: "CAD", category: 8, what: "Hotel, 3 nights", confidence: "high", notes: null }, 1500);
await phone.locator("#cam").setInputFiles(D + "receipt1.jpg");
await phone.waitForSelector("#readsay .spin", { timeout: 8000 });
ok("the check screen opens at once, Claude reading it", (await phone.textContent("#title")) === "Check the receipt" && /Claude is reading your receipt/.test(await phone.textContent("#readsay")));
await phone.screenshot({ path: D + "exp-reading-phone.png" });
await phone.waitForFunction(() => document.getElementById("f-paidTo")?.value === "Delta Hotels", null, { timeout: 15000 });
ok("the boxes fill themselves: vendor, date, total, category, what", (await phone.inputValue("#f-paidTo")) === "Delta Hotels" && (await phone.inputValue("#f-date")) === day(-2) && (await phone.inputValue("#f-amount")) === "$658.12" && (await phone.inputValue("#f-category")) === "8" && (await phone.inputValue("#f-purpose")) === "Hotel, 3 nights");
ok("each filled box is marked read", (await phone.locator("[data-readmark]").count()) === 5);
ok("and it shows the green tick: matches the receipt", /Matches the receipt/.test(await phone.textContent("#matchrow")));
// Andrew, 3 Nov 2026: the receipt viewer. Your own receipt opens in it too, and ✕ brings you back to checking it.
await phone.click("#pic"); await phone.locator(".viewer").waitFor({ timeout: 5000 });
ok("tapping your own receipt opens it full screen, in the viewer", /Delta Hotels/.test(await phone.textContent("#vcap")));
await phone.click("#vclose"); await phone.waitForTimeout(300);
ok("…and ✕ brings you back to the receipt you were checking", (await phone.locator(".viewer").count()) === 0 && (await phone.inputValue("#f-paidTo")) === "Delta Hotels");
ok("the photo shows beside it", await phone.locator("#pic img").count() === 1);
await phone.selectOption("#f-event", ev.id);
await phone.fill("#f-purpose", "Hotel for the Summit");
ok("typing in a box takes its read mark off", (await phone.locator('[data-readmark="purpose"]').count()) === 0);
await phone.screenshot({ path: D + "exp-check-phone.png" });
await phone.click("#save");
await phone.waitForSelector("#running");
ok("saved, back on My claim, the total is the hotel", (await total(phone)) === "$658.12");
let row = phone.locator(".line").first();
ok("the line: vendor, what for and the event, a green tick, the amount", /Delta Hotels/.test(await row.textContent()) && /Hotel for the Summit · Gang Summit/.test(await row.textContent()) && /Matches the receipt/.test(await row.textContent()) && /\$658\.12/.test(await row.textContent()));
await phone.waitForSelector(".line .thumb img", { timeout: 5000 }).catch(() => {});
ok("with a small picture of the receipt", (await phone.locator(".line .thumb img").count()) === 1);

console.log("— a second one, typed before Claude finished");
await mock({ isReceipt: true, vendor: "Staples", date: day(-1), total: 112.06, tax: 12.89, currency: "CAD", category: 5, what: "Name badges", confidence: "high", notes: null }, 2500);
await phone.click("#addpick").catch(() => {});
await phone.locator("#pick").setInputFiles(D + "receipt1.jpg");
await phone.waitForSelector("#f-amount", { timeout: 8000 });
await phone.locator("#f-amount").pressSequentially("10000");   // typed as on a till: $100.00
await phone.waitForFunction(() => document.getElementById("f-paidTo")?.value === "Staples", null, { timeout: 15000 });
ok("the amount they typed stays; the rest fills in round it", (await phone.inputValue("#f-amount")) === "$100.00" && (await phone.inputValue("#f-date")) === day(-1));
ok("and it says what the receipt shows instead of a tick", /The receipt says \$112\.06/.test(await phone.textContent("#matchrow")));
// Andrew, 3 Nov 2026: no decimal to type. Backspace takes digits off the end; the digits fill in from the cents.
for (let i = 0; i < 5; i++) await phone.locator("#f-amount").press("Backspace");
ok("backspace takes it back down to nothing", (await phone.inputValue("#f-amount")) === "");
await phone.locator("#f-amount").pressSequentially("11206");
ok("typed 1 1 2 0 6, with no decimal, it shows $112.06", (await phone.inputValue("#f-amount")) === "$112.06", await phone.inputValue("#f-amount"));
ok("…and the tick comes back", /Matches the receipt/.test(await phone.textContent("#matchrow")));
ok("the phone shows its number pad for it", (await phone.getAttribute("#f-amount", "inputmode")) === "numeric");
await phone.click("#save"); await phone.waitForSelector("#running");
ok("the running total: $770.18", (await total(phone)) === "$770.18");

console.log("— mileage");
await phone.click("#addmile");
ok("the mileage screen says what it pays", (await phone.textContent("#title")) === "Mileage" && /paid to you at \$0\.62 a kilometre/.test(await phone.textContent("#root")));
// Andrew, 3 Nov 2026: a new mileage line starts on today's date (the phone's own day), and can still be changed.
const phoneToday = await phone.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
ok("a new mileage line starts on today's date", (await phone.inputValue("#f-date")) === phoneToday, `${await phone.inputValue("#f-date")} vs ${phoneToday}`);
await phone.fill("#f-date", day(-1)); await phone.fill("#f-km", "312"); await phone.fill("#f-from", "Barrie"); await phone.fill("#f-to", "Toronto");
ok("312 km works out on the screen as $193.44", /312 km × \$0\.62 = \$193\.44/.test(await phone.textContent("#calc")));
ok("its category starts as Travel", (await phone.inputValue("#f-category")) === "8");
await phone.selectOption("#f-event", ev.id); await phone.fill("#f-purpose", "Drive to the Summit");
await phone.screenshot({ path: D + "exp-mileage-phone.png" });
await phone.click("#save"); await phone.waitForSelector("#running");
ok("added: $963.62", (await total(phone)) === "$963.62");
ok("its line says the sum", /Mileage: Barrie to Toronto/.test(await phone.textContent("#root")) && /312 km × \$0\.62/.test(await phone.textContent("#root")));
await phone.locator(".line", { hasText: "Barrie to Toronto" }).click(); await phone.waitForSelector("#f-date");
ok("opened again, it keeps the date that was chosen, not today's", (await phone.inputValue("#f-date")) === day(-1), await phone.inputValue("#f-date"));
await phone.goBack(); await phone.waitForSelector("#running");

console.log("— no receipt");
await phone.click("#addnone");
await phone.fill("#f-paidTo", "Green P parking"); await phone.fill("#f-date", day(-1)); await phone.locator("#f-amount").pressSequentially("1800");
await phone.selectOption("#f-category", "8"); await phone.fill("#f-purpose", "Parking at the venue");
await phone.fill("#f-statement", "The machine didn't print a receipt. The charge is on my Visa.");
// Andrew, 3 Nov 2026: an iPhone opens the picker only straight from a tap, so nothing may be saved before it opens (saving
// first made the tap do nothing but create the line). The line is saved once the picture is chosen.
const adds = []; const onReq = (r) => { if (r.method() === "POST" && /add=noreceipt/.test(r.url())) adds.push(r.url()); }; phone.on("request", onReq);
const [chooser] = await Promise.all([phone.waitForEvent("filechooser", { timeout: 4000 }), phone.click("#shotadd")]);
ok("Add a screenshot opens the picker straight from the tap, with nothing saved first", !!chooser && adds.length === 0, `${adds.length} saves first`);
await chooser.setFiles(D + "receipt1.jpg");
await phone.waitForFunction(() => /Added/.test(document.getElementById("shotbox")?.textContent ?? ""), null, { timeout: 8000 });
phone.off("request", onReq);
ok("once it's chosen, the line is saved once, with what was typed, and the statement goes on it", adds.length === 1 && (await phone.inputValue("#f-statement")).startsWith("The machine") && await phone.isVisible("#remove"));
ok("the card statement shows as added", /Added/.test(await phone.textContent("#shotbox")));
await phone.screenshot({ path: D + "exp-noreceipt-phone.png" });
await phone.click("#save"); await phone.waitForSelector("#running");
ok("added: $981.62, and the line says the statement is there", (await total(phone)) === "$981.62" && /No receipt: reason and card statement added/.test(await phone.textContent("#root")));
ok("nothing on the claim still needs anything", (await phone.locator(".needs").count()) === 0);
ok("lines are grouped by day, newest first", (await phone.locator(".day").count()) === 2);
ok("the running card counts them", /2 receipts, 1 mileage, 1 with no receipt · Gang Summit/.test(await phone.textContent("#running")));
ok("nothing runs off the side", await fits(phone));
await phone.screenshot({ path: D + "exp-claim-phone.png", fullPage: true });

console.log("— the back button keeps what was typed");
await phone.locator(".line", { hasText: "Delta Hotels" }).click();
await phone.fill("#f-purpose", "Hotel for the Summit, 3 nights");
await phone.click("#back");
await phone.waitForSelector("#running");
await phone.reload({ waitUntil: "networkidle" }); await phone.waitForSelector("#running");
ok("after going back and opening the app again, the change is there", /Hotel for the Summit, 3 nights/.test(await phone.textContent("#root")));

console.log("— no signal");
await mock({ isReceipt: true, vendor: "Tim Hortons", date: day(0), total: 46.2, tax: null, currency: "CAD", category: 5, what: "Coffee", confidence: "high", notes: null });
await phone.ctx.setOffline(true);
await phone.locator("#cam").setInputFiles(D + "receipt1.jpg");
await phone.waitForSelector(".say.wt", { timeout: 8000 });
ok("with no signal the photo is kept on the phone, and it says so", /1 photo is kept on this phone, waiting for a signal/.test(await phone.textContent(".say.wt")) && /No signal/.test(await phone.textContent(".toast")));
await phone.screenshot({ path: D + "exp-offline-phone.png" });
await phone.ctx.setOffline(false);
await phone.evaluate(() => window.dispatchEvent(new Event("online")));
await phone.waitForFunction(() => !document.querySelector(".say.wt") && /Tim Hortons|New receipt/.test(document.getElementById("root").textContent), null, { timeout: 15000 });
ok("back online it is sent by itself and shows on the claim", (await phone.locator(".line").count()) === 5);
await phone.waitForFunction(() => /Tim Hortons/.test(document.getElementById("root").textContent), null, { timeout: 15000 });
ok("Claude reads it once it has arrived: $1,027.82", (await total(phone)) === "$1,027.82");

console.log("— taking a line off");
await phone.locator(".line", { hasText: "Tim Hortons" }).click();
await phone.click("#remove"); await phone.waitForSelector("#running");
ok("removed: back to $981.62", (await total(phone)) === "$981.62" && (await phone.locator(".line").count()) === 4);

console.log("— the other tabs");
await phone.click('[data-tab="past"]');
ok("Paid claims (Andrew 3 Nov 2026, was Past claims): nothing paid yet, in words", /Nothing paid yet/.test(await phone.textContent("#root")));
await phone.click('[data-tab="claim"]');
ok("no script errors on the phone", phone.errs.length === 0, phone.errs.join("; "));

console.log("— the President, on a laptop");
const wide = await open("president@ongia.ca", "Andrew Hammond", { width: 1280, height: 860 });
const tabsSeen = (await wide.locator("#tabs button").allInnerTexts()).map((t) => t.replace(/\d+$/, "").trim()).join("|");
ok("the President has To approve and All as well", tabsSeen === "My claim|Paid|To approve|All", tabsSeen);
ok("Jessy's claim stays with Jessy: the President's claim is empty", (await total(wide)) === "$0.00");
await wide.click('[data-tab="approve"]');
// The President is shared with expenseflow-ui, which may leave claims waiting on this server: say what the server says.
const waiting = (await (await fetch(S + "/api/expenses", { headers: { "x-expense-key": issueExpenseSession({ email: "president@ongia.ca", name: "Andrew Hammond" }) } })).json()).toApprove?.length ?? 0;
ok(waiting ? "To approve lists what is waiting" : "To approve says nothing is waiting yet", waiting ? !/Nothing waiting for you/.test(await wide.textContent("#root")) : /Nothing waiting for you/.test(await wide.textContent("#root")), `${waiting} waiting`);
await wide.click('[data-tab="claim"]');
await wide.screenshot({ path: D + "exp-empty-wide.png" });
await mock({ isReceipt: true, vendor: "Air Canada", date: day(-3), total: 476.86, tax: 40.1, currency: "CAD", category: 8, what: "Flight change", confidence: "high", notes: null });
await wide.locator("#pick").setInputFiles(D + "receipt1.jpg");
await wide.waitForFunction(() => document.getElementById("f-paidTo")?.value === "Air Canada", null, { timeout: 15000 });
await wide.screenshot({ path: D + "exp-check-wide.png" });
await wide.click("#save"); await wide.waitForSelector("#running");
await wide.screenshot({ path: D + "exp-claim-wide.png" });
ok("the column stays readable on a wide screen", await wide.evaluate(() => document.getElementById("root").getBoundingClientRect().width <= 560));
ok("no script errors on the laptop", wide.errs.length === 0, wide.errs.join("; "));

await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
