// ONGIA Expenses, stages 2 and 3 on screen, as five people: John sends a claim; Andrew approves it in one tap (green,
// dated); Raj sends it back with a reason; John fixes it and sends it again; both approve; Jacqulyn records the
// e-transfer and it locks; Andrew unlocks it with a reason. Raj hands his approvals to Peglar while away. Andrew
// makes a test claim and deletes all test claims. Mileage and no-receipt lines only, so no Claude is needed.
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
const day = (n) => todayIso(new Date(Date.now() + n * 86400e3));
const people = { john: ["j.healy@ongia.ca", "John Healy"], andrew: ["president@ongia.ca", "Andrew Hammond"], raj: ["treasurer@ongia.ca", "Raj Jaswal"], jac: ["vp_operations@ongia.ca", "Jacqulyn Taylor"], peg: ["executiveofficer@ongia.ca", "Peglar Artinian"], derek: ["d.sullivan@ongia.ca", "Derek Sullivan"] };
const api = (who, p, init = {}) => fetch(S + "/api/expenses" + p, { ...init, headers: { "x-expense-key": issueExpenseSession({ email: people[who][0], name: people[who][1] }), "content-type": "application/json", ...(init.headers ?? {}) } }).then((r) => r.json());
// Start clean: nothing waiting from an earlier run of this test on the same server.
for (const w of ["raj", "andrew", "jac"]) await api(w, `?away=${{ raj: "treasurer", andrew: "president", jac: "vp" }[w]}`, { method: "DELETE" });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (who, vp = { width: 390, height: 844 }, path = "/expenses") => {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: vp.width < 500, hasTouch: vp.width < 500, timezoneId: "America/Toronto" });
  const page = await ctx.newPage();
  const [email, name] = people[who];
  await page.addInitScript(([t, me]) => { localStorage.setItem("ongia-exp-session", t); localStorage.setItem("ongia-exp-me", JSON.stringify(me));
    // The app's icon badge, recorded: what an installed app would show.
    window.__badge = null; navigator.setAppBadge = (n) => { window.__badge = n; return Promise.resolve(); }; navigator.clearAppBadge = () => { window.__badge = 0; return Promise.resolve(); }; }, [issueExpenseSession({ email, name }), { email, name }]);
  page.on("dialog", (d) => d.accept());
  page.errs = []; page.on("pageerror", (e) => page.errs.push(String(e)));
  await page.goto(S + path, { waitUntil: "networkidle" });
  await page.waitForSelector("#running, .card, .empty", { timeout: 10000 });
  return page;
};
const errsOf = [];

console.log("— John sends a claim");
// A claim left from an earlier run is cleared first, so the screens start where a person would.
const jh = await api("john", "");
if (jh.current) await api("john", `?claim=${jh.current.id}`, { method: "DELETE" });
const john = await open("john"); errsOf.push(john);
await john.click("#addmile");
await john.fill("#f-date", day(-2)); await john.fill("#f-km", "312"); await john.fill("#f-from", "Barrie"); await john.fill("#f-to", "Toronto");
await john.fill("#f-purpose", "Drive to the Summit"); await john.click("#save"); await john.waitForSelector("#running");
await john.click("#addnone");
await john.fill("#f-paidTo", "Green P parking"); await john.fill("#f-date", day(-1)); await john.locator("#f-amount").pressSequentially("1800"); await john.selectOption("#f-category", "8"); await john.fill("#f-purpose", "Parking at the venue");
await john.click("#save"); await john.waitForSelector("#running");
await john.click("#submit");
await john.waitForSelector("#submitsay .say.bad");
ok("sending with a line still missing things says exactly what", /Green P parking .* still needs a reason there's no receipt and a screenshot of the card statement/.test(await john.textContent("#submitsay")));
await john.screenshot({ path: D + "exp-submit-problems-phone.png", fullPage: true });
await john.locator(".line", { hasText: "Green P" }).click();
await john.fill("#f-statement", "The machine didn't print a receipt. The charge is on my Visa.");
await john.click("#shotadd"); await john.waitForFunction(() => document.getElementById("remove"));
await john.locator("#shotpick").setInputFiles(D + "receipt1.jpg");
await john.waitForFunction(() => /Added/.test(document.getElementById("shotbox")?.textContent ?? ""));
await john.click("#save"); await john.waitForSelector("#running");
ok("the button says what it does: Send for approval", (await john.textContent("#submit")) === "Send for approval");
await john.click("#submit");
await john.waitForSelector(".slot", { timeout: 8000 });
ok("sent: John sees it waiting for Andrew and Raj", /Waiting for approval/.test(await john.textContent("#root")) && /President · Andrew Hammond/.test(await john.textContent("#root")) && /Treasurer · Raj Jaswal/.test(await john.textContent("#root")));
ok("and the message names them", /Sent to Andrew Hammond and Raj Jaswal/.test(await john.textContent(".toast")));
await john.screenshot({ path: D + "exp-sent-phone.png", fullPage: true });
const CID = (await api("john", "")).past[0].id;

console.log("— Andrew approves in one tap");
const andrew = await open("andrew"); errsOf.push(andrew);
ok("To approve shows a count", /To approve1/.test(await andrew.textContent("#tabs")));
ok("…and so does the app's icon, and the window's title: Andrew's own count", (await andrew.evaluate(() => window.__badge)) === 1 && (await andrew.title()) === "(1) ONGIA Expenses");
ok("John has nothing waiting on him: no badge", (await john.evaluate(() => window.__badge)) === 0);
await andrew.click('[data-tab="approve"]');
await andrew.locator(`[data-open="${CID}"]`).click();
await andrew.waitForSelector("#approve");
ok("Approve a claim: who, how much, Claude's check", (await andrew.textContent("#title")) === "Approve a claim" && /John Healy/.test(await andrew.textContent("#root")) && /\$211\.44/.test(await andrew.textContent("#root")) && /Everything checks out/.test(await andrew.textContent(".allok")));
await andrew.screenshot({ path: D + "exp-approve-phone.png", fullPage: true });
await andrew.click("#approve");
await andrew.waitForSelector(".stamp");
ok("the button turns green, Approved, with the date and time filled in", /Approved by you, President/.test(await andrew.textContent(".stamp")) && /\d{4}/.test(await andrew.textContent(".stamp")) && (await andrew.locator(".bigbtns .btn.green[disabled]").count()) === 1);
ok("next: waiting for Raj", /Waiting for Raj Jaswal/.test(await andrew.textContent("#root")));
// Locally there is no Microsoft, so the filing job says so; on the site this card says where it's filed.
ok("the officers see where it stands in SharePoint (here: not filed, and why)", /Not filed: Microsoft isn't set up on this site/.test(await andrew.textContent("#root")));
await andrew.screenshot({ path: D + "exp-approved-phone.png", fullPage: true });
const line = andrew.locator(".line", { hasText: "Green P" }); await line.click();
await andrew.waitForSelector(".sheet img", { timeout: 8000 });
ok("tapping a line shows its card statement and the reason", /didn't print a receipt/.test(await andrew.textContent(".sheet")));
await andrew.screenshot({ path: D + "exp-linesheet-phone.png" });
await andrew.goBack(); await andrew.waitForTimeout(300);
ok("back closes it, still on the claim", (await andrew.locator(".sheet").count()) === 0 && (await andrew.textContent("#title")) === "Approve a claim");

console.log("— Raj sends it back");
const raj = await open("raj", { width: 390, height: 844 }, `/expenses#claim=${CID}`); errsOf.push(raj);
await raj.waitForSelector("#reject", { timeout: 8000 });
ok("an email's link opens the claim itself", (await raj.textContent("#title")) === "Approve a claim");
await raj.click("#reject");
ok("Send back: the box opens and Approve dims", await raj.isVisible("#why") && (await raj.locator("#approve.dim").count()) === 1);
await raj.click("#dosendback");
ok("without a reason it won't go", /Say why/.test(await raj.textContent(".toast")));
await raj.fill("#why", "The parking was covered by the venue. Please take that line off.");
await raj.screenshot({ path: D + "exp-reject-phone.png", fullPage: true });
await raj.click("#dosendback");
await raj.waitForSelector(".sentback");
ok("sent back: it says so, with Raj's note", /Sent back by Raj Jaswal/.test(await raj.textContent(".sentback")) && /covered by the venue/.test(await raj.textContent(".sentback")));

console.log("— John fixes it and sends it again");
await john.goto(S + "/expenses", { waitUntil: "networkidle" }); await john.waitForSelector("#running");
ok("a claim sent back to John puts 1 on his icon", (await john.evaluate(() => window.__badge)) === 1);
ok("My claim: the reason at the top, the total, Send it again", /Sent back by Raj Jaswal/.test(await john.textContent(".sentback")) && /covered by the venue/.test(await john.textContent(".sentback")) && (await john.textContent("#submit")) === "Send it again" && /sent back/.test(await john.textContent("#running .k")));
await john.screenshot({ path: D + "exp-sentback-phone.png", fullPage: true });
await john.locator(".line", { hasText: "Green P" }).click(); await john.click("#remove"); await john.waitForSelector("#running");
ok("the parking off: $193.44", (await john.textContent("#running .big")) === "$193.44");
await john.click("#submit"); await john.waitForSelector(".slot");
ok("sent again", /Waiting for approval/.test(await john.textContent("#root")));

console.log("— both approve; Jacqulyn pays");
await api("andrew", `?decide=${CID}`, { method: "POST", body: JSON.stringify({ decision: "approve" }) });
await raj.goto(S + `/expenses#claim=${CID}`, { waitUntil: "networkidle" }); await raj.waitForSelector("#approve");
await raj.click("#approve"); await raj.waitForSelector(".stamp");
ok("Raj approves: approved, and it says Jacqulyn sends the e-transfer", /Approved, waiting for payment/.test(await raj.textContent("#root")) && /Jacqulyn Taylor sends the e-transfer/.test(await raj.textContent("#root")));
const jac = await open("jac"); errsOf.push(jac);
await jac.click('[data-tab="approve"]');
ok("Jacqulyn's To approve: the claim under To pay", /To pay/.test(await jac.textContent("#root")) && (await jac.locator(`[data-open="${CID}"]`).count()) === 1);
await jac.locator(`[data-open="${CID}"]`).click(); await jac.waitForSelector("#paybtn");
ok("Pay a claim: how much, to whom, the reference box, today's date", (await jac.textContent("#title")) === "Pay a claim" && /To John Healy \(j\.healy@ongia\.ca\)/.test(await jac.textContent("#root")) && (await jac.inputValue("#paydate")).length === 10);
await jac.fill("#ref", "CA7Kx2Pq9TmR");
await jac.screenshot({ path: D + "exp-pay-phone.png", fullPage: true });
await jac.click("#paybtn"); await jac.waitForFunction(() => /e-transfer CA7Kx2Pq9TmR/.test(document.querySelector(".lock")?.textContent ?? ""));
ok("paid and locked: the date, by Jacqulyn, the reference", /Paid .* by Jacqulyn Taylor · e-transfer CA7Kx2Pq9TmR\. Locked\./.test(await jac.textContent(".lock")));
await jac.screenshot({ path: D + "exp-paid-phone.png", fullPage: true });

console.log("— Andrew unlocks it");
await andrew.goto(S + "/expenses", { waitUntil: "networkidle" }); await andrew.waitForSelector("#running");
await andrew.click('[data-tab="all"]');
await andrew.click('[data-f="paid"]');
await andrew.locator(`[data-open="${CID}"]`).click(); await andrew.waitForSelector("details.more");
await andrew.locator("details.more summary", { hasText: "Unlock" }).click();
await andrew.fill("#unwhy", "The reference number was typed wrong.");
await andrew.click("#dounlock"); await andrew.waitForFunction(() => /Approved, waiting for payment/.test(document.getElementById("root").textContent));
ok("unlocked: back to approved, waiting for Jacqulyn again", /Jacqulyn Taylor sends the e-transfer/.test(await andrew.textContent("#root")));
await api("jac", `?pay=${CID}`, { method: "POST", body: JSON.stringify({ ref: "CA7Kx2Pq9TmS" }) });

console.log("— Raj hands off to Peglar");
const dh = await api("derek", "?add=mileage", { method: "POST", body: JSON.stringify({ date: day(-1), from: "Ottawa", to: "Kingston", km: 196, purpose: "Training" }) });
await api("derek", `?submit=${dh.claim.id}`, { method: "POST" });
await raj.goto(S + "/expenses", { waitUntil: "networkidle" }); await raj.waitForSelector("#running");
await raj.click('[data-tab="approve"]');
ok("Raj sees Derek's claim waiting, and Going away?", (await raj.locator(`[data-open="${dh.claim.id}"]`).count()) === 1 && /Going away\?/.test(await raj.textContent("#root")));
await raj.selectOption("#to-treasurer", "executiveofficer@ongia.ca");
await raj.selectOption("#bk-treasurer", "j.healy@ongia.ca");
await raj.fill("#un-treasurer", day(14)); await raj.locator("#un-treasurer").dispatchEvent("change");
await raj.waitForSelector("#pv-treasurer .preview-rows", { timeout: 8000 });
ok("before saving, it shows who takes what", /Board members' claims\s*Peglar Artinian/.test(await raj.textContent("#pv-treasurer")) && /Andrew Hammond's claims\s*Peglar Artinian/.test(await raj.textContent("#pv-treasurer")));
await raj.screenshot({ path: D + "exp-away-phone.png", fullPage: true });
await raj.click('[data-save="treasurer"]');
await raj.waitForSelector('[data-back="treasurer"]');
ok("saved: handed to Peglar until the date, with I'm back", /Handed to Peglar Artinian/.test(await raj.textContent("#away-treasurer")) && (await raj.textContent('[data-back="treasurer"]')) === "I'm back");
ok("Derek's claim has moved off Raj's list", (await raj.locator(`[data-open="${dh.claim.id}"]`).count()) === 0);
const peg = await open("peg"); errsOf.push(peg);
ok("Peglar now has To approve, with a count", /To approve1/.test(await peg.textContent("#tabs")));
await peg.click('[data-tab="approve"]');
ok("and Derek's claim in it, standing in for the Treasurer", /standing in for the Treasurer \(Raj Jaswal\)/.test(await peg.textContent("#root")) && /for the Treasurer/.test(await peg.textContent(`[data-open="${dh.claim.id}"]`)));
await peg.screenshot({ path: D + "exp-standin-phone.png", fullPage: true });
await peg.locator(`[data-open="${dh.claim.id}"]`).click(); await peg.waitForSelector("#approve");
ok("the claim says he's standing in", /You're standing in for the Treasurer/.test(await peg.textContent("#root")));
await raj.click('[data-back="treasurer"]'); await raj.waitForSelector("#to-treasurer");
ok("I'm back: Derek's claim is Raj's again", (await raj.locator(`[data-open="${dh.claim.id}"]`).count()) === 1);

console.log("— Andrew's test claim, then deleting the test claims");
await andrew.goto(S + "/expenses", { waitUntil: "networkidle" }); await andrew.waitForSelector("#running");
await andrew.click("#me"); await andrew.check("#testmode"); await andrew.waitForSelector(".testbar");
ok("test mode: a striped bar says so", /TEST MODE/.test(await andrew.textContent(".testbar")));
await andrew.click("#addmile");
await andrew.fill("#f-date", day(-1)); await andrew.fill("#f-km", "20"); await andrew.fill("#f-from", "A"); await andrew.fill("#f-to", "B"); await andrew.fill("#f-purpose", "Trying it out");
await andrew.click("#save"); await andrew.waitForSelector("#running");
ok("it lands on a test claim", /test/.test(await andrew.textContent("#running .k")));
await andrew.click("#submit"); await andrew.waitForSelector(".slot");
ok("the sent test claim is marked so", /TEST CLAIM/.test(await andrew.textContent("#root")));
await andrew.goBack(); await andrew.waitForSelector("#running");
await andrew.click('[data-tab="all"]');
ok("All claims: chips with counts, the test claim marked", /Paid \d/.test(await andrew.textContent(".chips")) && (await andrew.locator(".rowbtn .pill.test").count()) >= 1);
await andrew.screenshot({ path: D + "exp-all-phone.png", fullPage: true });
await andrew.click("#purge"); await andrew.waitForFunction(() => /Deleted \d+ test claim/.test(document.querySelector(".toast")?.textContent ?? ""));
ok("Delete all test claims: gone, the real ones stay", (await andrew.locator(".rowbtn .pill.test").count()) === 0 && (await andrew.locator(`[data-open="${CID}"]`).count()) === 1);
await andrew.click("#me"); await andrew.uncheck("#testmode"); await andrew.waitForSelector("#running");
ok("test mode off: the bar is gone", (await andrew.locator(".testbar").count()) === 0);

console.log("— on a laptop");
const wide = await open("raj", { width: 1280, height: 860 }, `/expenses#claim=${dh.claim.id}`); errsOf.push(wide);
await wide.waitForSelector("#approve");
await wide.screenshot({ path: D + "exp-approve-wide.png" });
ok("the approve screen holds its column on a laptop", await wide.evaluate(() => document.getElementById("root").getBoundingClientRect().width <= 560));
for (const p of errsOf) ok(`no script errors (${await p.evaluate(() => JSON.parse(localStorage.getItem("ongia-exp-me")).name)})`, p.errs.length === 0, p.errs.join("; "));
for (const p of errsOf) ok("nothing runs off the side", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
