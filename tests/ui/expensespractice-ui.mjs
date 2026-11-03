// ONGIA Expenses: practice (Andrew, 3 Nov 2026: "how do I send to myself for testing so I can see how it functions").
// One person, alone: Test mode on, a claim sent, approved as each officer in turn, a pretend e-transfer recorded, locked.
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
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: "America/Toronto" });
const p = await ctx.newPage();
await p.addInitScript(([t, me]) => { localStorage.setItem("ongia-exp-session", t); localStorage.setItem("ongia-exp-me", JSON.stringify(me)); },
  [issueExpenseSession({ email: "a.bain@ongia.ca", name: "Andy Bain" }), { email: "a.bain@ongia.ca", name: "Andy Bain" }]);
const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
p.on("dialog", (d) => d.accept());
await p.goto(S + "/expenses", { waitUntil: "networkidle" }); await p.locator("#addcam").waitFor();

await p.click("#me"); await p.waitForTimeout(150);
ok("the menu says test claims come back to you to try every step", /comes back to you to try every step/.test(await p.textContent("#menu")));
await p.check("#testmode"); await p.locator(".testbar").waitFor();
ok("Test mode on: the bar says every step comes back to you", /every step comes back to you to try/.test(await p.textContent(".testbar")));

await p.click("#addnone"); await p.locator("#f-category").waitFor();
await p.selectOption("#f-category", "10");
await p.fill("#f-paidTo", "Andy Bain"); await p.fill("#f-date", todayIso(new Date(Date.now() - 86400e3)));
await p.locator("#f-amount").pressSequentially("25000"); await p.fill("#f-purpose", "Practice stipend");
await p.click("#save"); await p.waitForSelector("#submit");
ok("before sending, it says the claim will come back to you as each approver", /A test claim comes back to you: approve it as the President and as the Treasurer, then record a pretend payment/.test(await p.textContent("#root")), (await p.textContent("#root")).slice(-400));
await p.click("#submit"); await p.waitForTimeout(1200);
ok("sent: the note says it's waiting for you under To approve", /It's waiting for you under To approve/.test(await p.textContent("body")));

// Sending opens the sent claim on its own screen; back, then To approve, as a person would.
if (await p.isVisible("#back")) { await p.click("#back"); await p.waitForTimeout(500); }
await p.locator('[data-tab="approve"]').waitFor({ timeout: 8000 });
ok("To approve appears, with the claim in it", true);
await p.click('[data-tab="approve"]'); await p.waitForTimeout(500);
const TID = await p.locator("[data-open]").first().getAttribute("data-open");
await p.locator("[data-open]").first().click(); await p.locator("#approve").waitFor();
ok("opened to approve, nothing grabs the cursor", await p.evaluate(() => document.activeElement?.tagName !== "INPUT"));
ok("the claim's banner says it's practice, and where it's filed", /TEST CLAIM\. Practice: every step comes back to whoever made it\. Nothing is paid, it's filed only under Test claims/.test(await p.textContent(".testbar")));
ok("opened: Practice, you're approving it as the President", /Practice: you're approving it as the President/.test(await p.textContent("#root")));
ok("…the sign-offs read 'you, for practice', both waiting", (await p.locator(".slot", { hasText: "you, for practice" }).count()) === 2 && (await p.locator(".slot .r.wait").count()) === 2);
await p.screenshot({ path: D + "expenses-practice-approve.png" });
await p.click("#approve"); await p.waitForTimeout(900);
ok("approved as the President: green, and now the Treasurer's turn, still yours", (await p.locator(".slot .r.ok").count()) === 1 && /Practice: you're approving it as the Treasurer/.test(await p.textContent("#root")));
await p.click("#approve"); await p.waitForTimeout(900);
ok("approved as the Treasurer too: both green, and the payment is yours to record", (await p.locator(".slot .r.ok").count()) === 2 && await p.isVisible("#paybtn"));
ok("the payment card says it's practice and nothing is sent", /Practice: nothing is sent/.test(await p.textContent("#root")) && (await p.getAttribute("#ref", "placeholder")) === "TEST123");
// Raj "will log in and see that I've approved it on this day and time" (Andrew, 3 Nov 2026).
ok("each sign-off says the day and the time it was approved", (await p.locator(".slot .tiny", { hasText: /^Approved [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}/ }).count()) === 2, await p.locator(".slot").allInnerTexts().then((t) => t.join(" | ")));
// The "ready to be paid" email's button: the claim opens with the cursor in the transaction number, and Confirm.
const q = await ctx.newPage(); q.on("pageerror", (e) => errs.push(String(e)));
await q.goto(`${S}/expenses#claim=${TID}`, { waitUntil: "networkidle" }); await q.locator("#ref").waitFor();
await q.waitForTimeout(300);
ok("the email's link opens the claim with the cursor in the transaction number, the field lit", await q.evaluate(() => document.activeElement?.id === "ref" && document.activeElement.classList.contains("hl")));
ok("…in Andrew's words: E-transfer transaction number, and Confirm payment", (await q.textContent('label[for="ref"]')) === "E-transfer transaction number" && (await q.textContent("#paybtn")).trim() === "Confirm payment");
const rb = await q.locator("#ref").boundingBox();
ok("…scrolled to, on the screen", rb && rb.y > 50 && rb.y + rb.height < 844, JSON.stringify(rb));
await q.screenshot({ path: D + "expenses-pay-link.png" });
await q.keyboard.type("TEST123");
ok("typing goes straight in, and the light goes off", (await q.inputValue("#ref")) === "TEST123" && !(await q.evaluate(() => document.getElementById("ref").classList.contains("hl"))));
await q.close();
await p.screenshot({ path: D + "expenses-practice-pay.png" });
await p.fill("#ref", "TEST123"); await p.click("#paybtn"); await p.waitForTimeout(900);
ok("a pretend reference: paid and locked", /Paid/.test(await p.textContent("#root")) && /TEST123/.test(await p.textContent("#root")) && /Locked/.test(await p.textContent("#root")));
ok("no page errors", !errs.length, errs.join(" | "));

await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
