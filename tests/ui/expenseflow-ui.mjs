// ONGIA Expenses, stages 2 and 3 on screen: John sends a claim; Andrew approves it in one tap (green, dated); Jacqulyn
// (VP of Operations) sends it back with a reason; John fixes it and sends it again; both approve; Jacqulyn records the
// e-transfer and it locks; Andrew unlocks it with a reason. The Treasurer no longer approves (Andrew 13 Nov 2026): Raj
// has nothing to approve and nothing to hand off. Jacqulyn hands her approvals and payments to Peglar while away. Andrew
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
for (const w of ["andrew", "jac"]) await api(w, `?away=${{ andrew: "president", jac: "vp" }[w]}`, { method: "DELETE" });

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
ok("sent: John sees it waiting for Andrew and Jacqulyn, not Raj", /Waiting for approval/.test(await john.textContent("#root")) && /President · Andrew Hammond/.test(await john.textContent("#root")) && /VP of Operations · Jacqulyn Taylor/.test(await john.textContent("#root")) && !/Treasurer · Raj Jaswal/.test(await john.textContent("#root")));
ok("and the message names them", /Sent to Andrew Hammond and Jacqulyn Taylor/.test(await john.textContent(".toast")), await john.textContent(".toast"));
// Andrew, 3 Nov 2026: where each sign-off stands, in colour, at the top of the claim.
const chip = (pg, who) => pg.locator(".slot", { hasText: who }).locator(".r").evaluate((e) => [e.className.replace(/^r\s*/, ""), e.textContent.trim()]);
ok("each sign-off waiting shows in yellow", JSON.stringify(await chip(john, "Andrew Hammond")) === '["wait","Waiting"]' && JSON.stringify(await chip(john, "Jacqulyn Taylor")) === '["wait","Waiting"]');
ok("…at the top: the sign-offs come before Claude's check", await john.evaluate(() => { const so = [...document.querySelectorAll(".card .k")].find((k) => k.textContent === "Sign-offs"); const ck = document.querySelector(".allok, .looks"); return !!so && !!ck && (so.compareDocumentPosition(ck) & Node.DOCUMENT_POSITION_FOLLOWING) > 0; }));
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
ok("Approve a claim: who, how much, Claude's check", (await andrew.textContent("#title")) === "Approve a claim" && /John Healy/.test(await andrew.textContent("#root")) && /\$223\.92/.test(await andrew.textContent("#root")) && /One thing to look at/.test(await andrew.textContent(".looks")) && /Green P parking: no receipt, so \$18\.00 isn't confirmed/.test(await andrew.textContent(".looks")));
await andrew.screenshot({ path: D + "exp-approve-phone.png", fullPage: true });
await andrew.click("#approve");
await andrew.waitForSelector(".stamp");
ok("the button turns green, Approved, with the date and time filled in", /Approved by you, President/.test(await andrew.textContent(".stamp")) && /\d{4}/.test(await andrew.textContent(".stamp")) && (await andrew.locator(".bigbtns .btn.green[disabled]").count()) === 1);
ok("next: waiting for Jacqulyn", /Waiting for Jacqulyn Taylor/.test(await andrew.textContent("#root")));
ok("Andrew's sign-off turns green, Jacqulyn's stays yellow", (await chip(andrew, "Andrew Hammond"))[0] === "ok" && /✓ Approved/.test((await chip(andrew, "Andrew Hammond"))[1]) && (await chip(andrew, "Jacqulyn Taylor"))[0] === "wait");
// Locally there is no Microsoft, so the filing job says so; on the site this card says where it's filed.
ok("the officers see where it stands in SharePoint (here: not filed, and why)", /Not filed: Microsoft isn't set up on this site/.test(await andrew.textContent("#root")));
await andrew.screenshot({ path: D + "exp-approved-phone.png", fullPage: true });
const line = andrew.locator(".line", { hasText: "Green P" }); await line.click();
await andrew.waitForSelector(".sheet img", { timeout: 8000 });
ok("tapping a line shows its card statement and the reason", /didn't print a receipt/.test(await andrew.textContent(".sheet")));
ok("…with its amount flagged as not confirmed, to compare with the statement", /Amount not confirmed/.test(await andrew.textContent(".sheet")) && /Compare \$18\.00 with the charge on the card statement above/.test(await andrew.textContent(".sheet")));
await andrew.screenshot({ path: D + "exp-linesheet-phone.png" });
await andrew.goBack(); await andrew.waitForTimeout(300);
ok("back closes it, still on the claim", (await andrew.locator(".sheet").count()) === 0 && (await andrew.textContent("#title")) === "Approve a claim");

console.log("— Jacqulyn sends it back");
const jac = await open("jac", { width: 390, height: 844 }, `/expenses#claim=${CID}`); errsOf.push(jac);
await jac.waitForSelector("#reject", { timeout: 8000 });
ok("an email's link opens the claim itself", (await jac.textContent("#title")) === "Approve a claim");
await jac.click("#reject");
ok("Send back: the box opens and Approve dims", await jac.isVisible("#why") && (await jac.locator("#approve.dim").count()) === 1);
await jac.click("#dosendback");
ok("without a reason it won't go", /Say why/.test(await jac.textContent(".toast")));
await jac.fill("#why", "The parking was covered by the venue. Please take that line off.");
await jac.screenshot({ path: D + "exp-reject-phone.png", fullPage: true });
await jac.click("#dosendback");
await jac.waitForSelector(".sentback");
ok("sent back: it says so, with Jacqulyn's note", /Sent back by Jacqulyn Taylor/.test(await jac.textContent(".sentback")) && /covered by the venue/.test(await jac.textContent(".sentback")));
ok("Jacqulyn's sign-off is red, Sent back, and only hers", JSON.stringify(await chip(jac, "Jacqulyn Taylor")) === '["bad","✕ Sent back"]' && (await chip(jac, "Andrew Hammond"))[0] !== "bad", JSON.stringify([await chip(jac, "Jacqulyn Taylor"), await chip(jac, "Andrew Hammond")]));
await jac.locator(".slot").first().evaluate((e) => e.closest(".card").scrollIntoView());
await jac.screenshot({ path: D + "exp-signoffs-sentback-phone.png" });

console.log("— John fixes it and sends it again");
await john.goto(S + "/expenses", { waitUntil: "networkidle" }); await john.waitForSelector("#running");
ok("a claim sent back to John puts 1 on his icon", (await john.evaluate(() => window.__badge)) === 1);
ok("My claim: the reason at the top, the total, Send it again", /Sent back by Jacqulyn Taylor/.test(await john.textContent(".sentback")) && /covered by the venue/.test(await john.textContent(".sentback")) && (await john.textContent("#submit")) === "Send it again" && /sent back/.test(await john.textContent("#running .k")));
await john.screenshot({ path: D + "exp-sentback-phone.png", fullPage: true });
await john.locator(".line", { hasText: "Green P" }).click(); await john.click("#remove"); await john.waitForSelector("#running");
ok("the parking off: $205.92", (await john.textContent("#running .big")) === "$205.92");
await john.click("#submit"); await john.waitForSelector(".slot");
ok("sent again", /Waiting for approval/.test(await john.textContent("#root")));

console.log("— both approve; Jacqulyn pays");
await api("andrew", `?decide=${CID}`, { method: "POST", body: JSON.stringify({ decision: "approve" }) });
await jac.goto(S + `/expenses#claim=${CID}`, { waitUntil: "networkidle" }); await jac.waitForSelector("#approve");
await jac.click("#approve"); await jac.waitForSelector(".stamp");
const jroot = await jac.textContent("#root");
ok("Jacqulyn approves: approved, and the e-transfer is hers to record", /Approved, waiting for payment/.test(jroot) && await jac.isVisible("#paybtn"), jroot.slice(0, 600));
await jac.goto(S + "/expenses", { waitUntil: "networkidle" }); await jac.waitForSelector("#running");
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

console.log("— Raj has nothing to approve; Jacqulyn hands off to Peglar");
const dh = await api("derek", "?add=mileage", { method: "POST", body: JSON.stringify({ date: day(-1), from: "Ottawa", to: "Kingston", km: 196, purpose: "Training" }) });
await api("derek", `?submit=${dh.claim.id}`, { method: "POST" });
// The Treasurer no longer approves (Andrew 13 Nov 2026): Derek's claim isn't his, and he has no approvals to hand off.
const raj = await open("raj"); errsOf.push(raj);
ok("Raj has no count on To approve, and Derek's claim isn't his", !/To approve\d/.test(await raj.textContent("#tabs")) && (await raj.evaluate(() => window.__badge)) === 0);
await raj.click("#me"); await raj.waitForTimeout(150);
ok("…and no Going away in his menu", (await raj.locator("#awaybtn").count()) === 0 && (await raj.locator("#dAway").count()) === 0);
await raj.click('[data-tab="all"]').catch(() => {});
ok("he still sees every claim under All", (await raj.locator(`[data-open="${dh.claim.id}"]`).count()) === 1);
await jac.goto(S + "/expenses", { waitUntil: "networkidle" }); await jac.waitForSelector("#running");
await jac.click('[data-tab="approve"]');
// Andrew, 3 Nov 2026: To approve is the claims to approve and nothing else; Going away is in the menu.
ok("Jacqulyn sees Derek's claim waiting, and nothing else on To approve", (await jac.locator(`[data-open="${dh.claim.id}"]`).count()) === 1 && !/Going away|Hand off/.test(await jac.textContent("#root")) && !(await jac.locator("#to-vp").count()));
await jac.click("#me"); await jac.click("#awaybtn"); await jac.waitForSelector("#to-vp");
ok("Going away opens from the menu, on its own screen", (await jac.textContent("#title")) === "Going away" && /Going away\?/.test(await jac.textContent("#root")) && await jac.isVisible("#back"));
await jac.selectOption("#to-vp", "executiveofficer@ongia.ca");
await jac.selectOption("#bk-vp", "j.healy@ongia.ca");
await jac.fill("#un-vp", day(14)); await jac.locator("#un-vp").dispatchEvent("change");
await jac.waitForSelector("#pv-vp .preview-rows", { timeout: 8000 });
const pv = await jac.textContent("#pv-vp");
ok("before saving, it shows who takes what: the approvals and the payments", /Board members' claims\s*Peglar Artinian/.test(pv) && /Andrew Hammond's claims\s*Peglar Artinian/.test(pv) && /Raj Jaswal's claims\s*Peglar Artinian/.test(pv) && /Recording payments\s*Peglar Artinian/.test(pv), pv);
ok("…and Peglar's own claims go to her second person, never to Peglar himself", /Peglar Artinian's own claims\s*John Healy/.test(pv), pv);
await jac.screenshot({ path: D + "exp-away-phone.png", fullPage: true });
await jac.click('[data-save="vp"]');
await jac.waitForSelector('[data-back="vp"]');
ok("saved: handed to Peglar until the date, with I'm back", /Handed to Peglar Artinian/.test(await jac.textContent("#away-vp")) && (await jac.textContent('[data-back="vp"]')) === "I'm back");
await jac.goBack(); await jac.waitForTimeout(400);
ok("back: To approve, and Derek's claim has moved off Jacqulyn's list", (await jac.textContent("#title")) === "To approve" && (await jac.locator(`[data-open="${dh.claim.id}"]`).count()) === 0);
const peg = await open("peg"); errsOf.push(peg);
ok("Peglar now has To approve, with a count", /To approve1/.test(await peg.textContent("#tabs")));
await peg.click('[data-tab="approve"]');
ok("and Derek's claim in it, its row saying for the VP of Operations, and no notes besides", /for the VP of Operations/.test(await peg.textContent(`[data-open="${dh.claim.id}"]`)) && !/standing in for the VP of Operations \(Jacqulyn Taylor\)/.test(await peg.textContent("#root")));
await peg.screenshot({ path: D + "exp-standin-phone.png", fullPage: true });
await peg.locator(`[data-open="${dh.claim.id}"]`).click(); await peg.waitForSelector("#approve");
ok("the claim says he's standing in", /You're standing in for the VP of Operations/.test(await peg.textContent("#root")));
await jac.click("#me"); await jac.click("#awaybtn"); await jac.waitForSelector('[data-back="vp"]');
await jac.click('[data-back="vp"]'); await jac.waitForSelector("#to-vp");
await jac.goBack(); await jac.waitForTimeout(400);
ok("I'm back: Derek's claim is Jacqulyn's again", (await jac.locator(`[data-open="${dh.claim.id}"]`).count()) === 1);

console.log("— test mode is gone; a test claim left from before can still be deleted");
// Andrew 14 Nov 2026: "Take out the testing mode." A test claim made before then (here through the server) still shows.
const left = await api("andrew", "?add=mileage&test=1", { method: "POST", body: JSON.stringify({ date: day(-1), km: 20, from: "A", to: "B", purpose: "Trying it out", category: 8 }) });
await api("andrew", `?submit=${left.claim.id}&test=1`, { method: "POST", body: "{}" });
await andrew.goto(S + "/expenses", { waitUntil: "networkidle" }); await andrew.waitForSelector("#running");
await andrew.click("#me"); await andrew.waitForSelector("#menu:not([hidden])");
ok("the menu has no Test mode", (await andrew.locator("#testmode").count()) === 0 && !/Test mode/.test(await andrew.textContent("#menu")));
await andrew.keyboard.press("Escape").catch(() => {}); await andrew.click("#me").catch(() => {});
await andrew.click('[data-tab="all"]');
ok("All claims: chips with counts, the old test claim marked", /Paid \d/.test(await andrew.textContent(".chips")) && (await andrew.locator(".tile .pill.test").count()) >= 1);
ok("no bulk delete, board test or Clear them: claims are deleted one at a time", (await andrew.locator("#purge, #bttoggle, #clrgo").count()) === 0);
await andrew.screenshot({ path: D + "exp-all-phone.png", fullPage: true });
// Andrew deletes the old test claim from its own screen (14 Nov 2026: "I'll delete the ones accordingly").
await andrew.locator(`[data-open="${left.claim.id}"]`).first().click(); await andrew.waitForSelector("#delthis");
await andrew.click("#delthis"); await andrew.waitForFunction(() => /Deleted/.test(document.querySelector(".toast")?.textContent ?? ""));
await andrew.waitForTimeout(600);
ok("Delete this claim: the test claim is gone, the real one stays", (await andrew.locator(`[data-open="${left.claim.id}"]`).count()) === 0 && (await andrew.locator(`[data-open="${CID}"]`).count()) === 1);
await andrew.locator(`[data-open="${CID}"]`).first().click(); await andrew.waitForSelector(".slot");
ok("a real claim has no 'Mark this as a test claim', and the President can delete it", (await andrew.locator("#marktest").count()) === 0 && await andrew.isVisible("#delthis"));
await andrew.goBack(); await andrew.waitForTimeout(400);

console.log("— on a laptop");
const wide = await open("jac", { width: 1280, height: 860 }, `/expenses#claim=${dh.claim.id}`); errsOf.push(wide);
await wide.waitForSelector("#approve");
await wide.screenshot({ path: D + "exp-approve-wide.png" });
ok("the approve screen holds its column on a laptop", await wide.evaluate(() => document.getElementById("root").getBoundingClientRect().width <= 560));
for (const p of errsOf) ok(`no script errors (${await p.evaluate(() => JSON.parse(localStorage.getItem("ongia-exp-me")).name)})`, p.errs.length === 0, p.errs.join("; "));
for (const p of errsOf) ok("nothing runs off the side", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
