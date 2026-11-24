// A presenter's own expense claim, by their link, on a phone (Andrew 19 Nov 2026): no sign-in; the per diem for the
// meals the event didn't serve; a photo of a receipt, kilometres, which meal; over the per diem said in amber and still
// sent. And on Edit event: the meals the event serves, each presenter's link to copy, and Send. 390 wide.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
const D = new URL(".", import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const T = Date.now().toString(36);
const iso = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
let ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Summit ${T}`, city: "Toronto, ON", dayOne: iso(-5), lastDay: iso(-3), invite: false,
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }], presenters: [{ first: "Dana", last: "Sample", email: `dana.${T}@example.ca`, organization: "Windsor Police Service" }, { first: "Lee", last: "Other", email: `lee.${T}@example.ca`, organization: "OPP" }] }) })).event;
await api(`/api/events?id=${ev.id}`, { method: "PUT", body: JSON.stringify({ ...ev, mealsProvided: { breakfast: true, lunch: true, dinner: false } }) });
const links = await api(`/api/presenter-expenses?event=${ev.id}&links=1`);
const dana = links.presenters.find((p) => p.name === "Dana Sample");
const path = new URL(dana.link).pathname;

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errs = [];
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
p.on("pageerror", (e) => errs.push(String(e)));
p.on("dialog", (d) => d.accept());
await p.goto(S + path, { waitUntil: "networkidle" }); await p.waitForTimeout(600);
let body = await p.locator("#root").innerText();
ok("the link opens their claim with no sign-in: their name, the event, $0.00", /\$0\.00/.test(body) && new RegExp(`Dana Sample · Summit ${T}`).test(body), body.slice(0, 300));
ok("the per diem line shows only the meal they can claim, on one line", /Meal per diem: Dinner \$62\.70/.test(body) && !/Breakfast \$29\.95/.test(await p.locator("details.pd summary").innerText()) && (await p.locator("details.pd summary").boundingBox()).height < 30);
await p.click("details.pd summary"); await p.waitForTimeout(200);
body = await p.locator("details.pd").innerText();
ok("Details gives the rest: breakfast and lunch were provided, food only, no alcohol, mileage", /breakfast and lunch were provided, so you can claim dinner only/.test(body) && /Alcohol is not reimbursed/.test(body) && /federal government rate/.test(body), body);
await p.click("details.pd summary");
ok("a big button for a photo of a receipt, and where the money goes", await p.locator("#bcam").isVisible() && new RegExp(`paid by e-transfer to dana\\.${T}@example\\.ca`).test(await p.locator("#root").innerText()));

// Kilometres.
await p.click("#bkm"); await p.waitForTimeout(300);
ok("mileage says the rate: $0.66 a kilometre", /\$0\.66 a kilometre/.test(await p.locator("dialog").innerText()));
await p.fill("#x-km", "100"); await p.fill("#x-from", "Windsor"); await p.fill("#x-to", "Toronto");
await p.click("#x-save"); await p.waitForTimeout(1500);
ok("100 km is $66.00 on the claim", /Mileage: Windsor to Toronto/.test(await p.locator("#root").innerText()) && /\$66\.00/.test(await p.locator(".run .big").innerText()));

// A receipt.
await p.setInputFiles("#pick", REPO + "public/assets/app-icon-192.png"); await p.waitForTimeout(2500);
const rows = p.locator(".line");
ok("a photo adds a line", await rows.count() === 2, await p.locator("#root").innerText());
await rows.filter({ hasNotText: "Mileage" }).first().click(); await p.waitForTimeout(400);
await p.fill("#x-paidTo", "The Keg"); await p.fill("#x-date", iso(-4)); await p.fill("#x-amount", "80");
ok("which meal, in one row of chips", (await p.locator("#x-meals button").allInnerTexts()).join("|") === "Not a meal|Breakfast|Lunch|Dinner" && await p.evaluate(() => new Set([...document.querySelectorAll("#x-meals button")].map((x) => Math.round(x.getBoundingClientRect().top))).size === 1));
await p.click('[data-meal="lunch"]'); await p.waitForTimeout(150);
ok("lunch at an event that served lunch says so, and that it can still be sent", /Lunch was provided at the event, so there's no per diem for it\. You can still send it/.test(await p.locator("#x-note").innerText()));
await p.click('[data-meal="dinner"]'); await p.waitForTimeout(150);
ok("an $80 dinner: over by $17.30, and it can still be sent", /Over the dinner per diem \(\$62\.70\) by \$17\.30\. You can still send it/.test(await p.locator("#x-note").innerText()));
if (D) await p.locator("dialog").screenshot({ path: D + "presenterlink-edit.png" });
await p.click("#x-save"); await p.waitForTimeout(1500);
body = await p.locator("#root").innerText();
ok("the line says it's over, short, in amber; the total is $146.00", /Over by \$17\.30/.test(body) && /\$146\.00/.test(await p.locator(".run .big").innerText()), body);
ok("each line is one row about 38px high", await p.evaluate(() => [...document.querySelectorAll(".line")].every((x) => x.getBoundingClientRect().height <= 44)));
ok("nothing scrolls sideways", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
if (D) await p.screenshot({ path: D + "presenterlink-claim.png", fullPage: true });
await p.click("#lang"); await p.waitForTimeout(200);
ok("Français switches the page", /Vos dépenses/.test(await p.locator("#h1").innerText()) && /Photographier un reçu/.test(await p.locator("#root").innerText()) && await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await p.click("#lang"); await p.waitForTimeout(200);
await p.click("#send"); await p.waitForTimeout(2500);
body = await p.locator("#root").innerText();
ok("sent: it says so, who reviews it and where the money goes; nothing left to press", /Sent .*ONGIA's President and VP of Operations will review it/.test(body) && await p.locator("#send").count() === 0 && await p.locator("#bcam").count() === 0, body);
if (D) await p.screenshot({ path: D + "presenterlink-sent.png" });

// Someone else's link, or a made-up one, opens nothing.
const q = await b.newPage({ viewport: { width: 390, height: 844 } });
await q.goto(S + path.replace(/[0-9a-f]{32}$/, "0".repeat(32)), { waitUntil: "networkidle" }); await q.waitForTimeout(400);
ok("a link with the wrong key opens nothing", /This link isn't valid/.test(await q.locator("#root").innerText()));
await q.close();

// The desk: Edit event keeps the meals; each presenter's link and claim are on People › Expenses (audit section 4).
const a = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
a.on("pageerror", (e) => errs.push(String(e)));
await a.addInitScript(() => { try { sessionStorage.setItem("ongia-admin-key", "testkey"); } catch { /* a sandboxed preview frame */ } });
await a.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "edit", eventId: ev.id })), { waitUntil: "networkidle" }); await a.waitForTimeout(2000);
const box = a.locator("#px-box");
ok("Edit event has Presenter expenses, folded, saying which meals are provided", /Presenter expenses · breakfast, lunch provided/i.test(await box.locator("summary").innerText()) && !(await box.evaluate((d) => d.open)));
await box.locator("summary").click(); await a.waitForTimeout(500);
ok("the three meals as checkboxes, two ticked, and a pointer to People › Expenses", await a.locator("#e-meal-breakfast").isChecked() && await a.locator("#e-meal-lunch").isChecked() && !(await a.locator("#e-meal-dinner").isChecked()) && /People › Expenses/.test(await box.innerText()));
await a.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "event", eventId: ev.id, tab: "people", pview: "expenses" })), { waitUntil: "networkidle" }); await a.waitForTimeout(2500);
const pane = a.locator('[data-pview="expenses"]');
const row = pane.locator(".pxrow", { hasText: "Dana Sample" });
ok("People › Expenses: each presenter on one line: name, where their claim stands, Copy and Send", /Sent in \$146\.00/.test(await row.innerText()) && await row.locator("[data-pxcopy]").isVisible() && await row.locator("[data-pxsend]").isVisible() && (await row.boundingBox()).height <= 42, await row.innerText());
ok("…and one Send for everyone not yet sent, with the meals on the same line", /Send to 2/.test(await pane.locator("[data-pxall]").innerText()) && /breakfast, lunch/i.test(await pane.locator(".pxhead").innerText()));
ok("nothing scrolls sideways", await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
if (D) await pane.screenshot({ path: D + "presenterlink-desk.png" });
ok("no script errors", !errs.length, errs.join(" | "));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
