// The budget's set-up walk-through (Andrew 30 Oct 2026, from the mock-up he approved): one question at a time; a box with
// an answer goes green with a ✓; Enter or Tab moves on, Shift+Tab goes back; Skip for now leaves it to be asked again;
// a summary at the end; "Same as" the last similar event fills every box. On a phone, a big Next above the number pad.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const D = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const T = Date.now().toString(36);
const PRES = { "x-admin-key": issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" }) };
const saved = async (id) => (await (await fetch(`${S}/api/budget?event=${id}`, { headers: PRES })).json()).budget;
const mk = async (title) => (await api("/api/events", { method: "POST", body: JSON.stringify({ title, city: "Toronto, ON", dayOne: "2031-10-14", lastDay: "2031-10-15", invite: false,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }] }) })).event;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (w, h, id) => {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true, canCost: true }]);
  p.errs = []; p.on("pageerror", (e) => p.errs.push(String(e)));
  await p.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "event", eventId: id, tab: "money" })), { waitUntil: "networkidle" }); await p.waitForTimeout(1800);
  return p;
};
const q = (p) => p.locator(".wq").innerText();
const enter = async (p, v, key = "Enter") => { if (v !== undefined) await p.locator("#wv").fill(String(v)); await p.locator("#wv").press(key); await p.waitForTimeout(250); };

const ev = await mk(`Walk Symposium ${T}`);
let p = await open(1280, 900, ev.id);
ok("opening the Money tab of a new event starts the walk-through", await p.locator("dialog.walk").isVisible() && /How would you like to start/.test(await q(p)));
await p.locator('[data-wstart="fresh"]').click(); await p.waitForTimeout(300);
ok("then: how do people register, with In person already on", /How do people register/.test(await q(p)) && /on/.test(await p.locator('[data-wkind="inPerson"]').getAttribute("class")));
await p.locator('[data-wkind="earlyBird"]').click(); await p.waitForTimeout(200);
ok("tapping Early bird turns it green", /on/.test(await p.locator('[data-wkind="earlyBird"]').getAttribute("class")));
await p.locator("#wnext").click(); await p.waitForTimeout(300);
ok("the in-person price: the box isn't green until there's an amount", /in-person ticket cost/i.test(await q(p)) && !/ok/.test(await p.locator(".wbox").getAttribute("class")));
await p.locator("#wv").fill("425"); await p.waitForTimeout(100);
ok("typing an amount turns it green with a ✓", /ok/.test(await p.locator(".wbox").getAttribute("class")) && await p.locator(".wbox .tick").isVisible());
await p.locator("dialog.walk").screenshot({ path: D + "walk-step-wide.png" });
await enter(p);
ok("Enter goes to the next question, and the list beside it ticks $425 green", /early bird ticket cost/i.test(await q(p)) && /\$425/.test(await p.locator(".wit.done", { hasText: "In-person price" }).innerText()));
await enter(p, 375, "Tab");
ok("Tab does the same", /in-person registrations do you expect/i.test(await q(p)));
await p.locator("#wv").press("Shift+Tab"); await p.waitForTimeout(250);
ok("Shift+Tab goes back, the answer still there and green", /early bird ticket cost/i.test(await q(p)) && (await p.locator("#wv").inputValue()) === "375" && /ok/.test(await p.locator(".wbox").getAttribute("class")));
await enter(p); await enter(p, 250);
await p.locator("#wv").press("Enter"); await p.waitForTimeout(250);
ok("Enter on an empty box says what to do and stays", /Type an amount, or Skip for now/.test(await p.locator("#wwhy").innerText()) && /early bird registrations/i.test(await q(p)));
await p.locator("#wskip").click(); await p.waitForTimeout(250);
ok("Skip for now moves on and marks it amber", /include HST/.test(await q(p)) && await p.locator(".wit.skip", { hasText: "Early bird expected" }).count() === 1);
await p.locator("#wnext").click(); await p.waitForTimeout(300);
ok("a yes/no question needs an answer before Next", /include HST/.test(await q(p)));
await p.locator('[data-wyes="1"]').click(); await p.waitForTimeout(700);
ok("tapping Yes answers it and moves on by itself", /nightly room rate/i.test(await q(p)));
await enter(p, 189);
await p.locator("#wskip").click(); await p.waitForTimeout(250);   // the room block
await enter(p, 300); await enter(p, 0);
ok("0 VIPs is an answer", /breakfast cost/i.test(await q(p)) && await p.locator(".wit.done", { hasText: "VIPs" }).count() === 1);
ok("the line at the bottom shows what the answers do so far", /Profit as planned/.test(await p.locator(".wlive").innerText()) && /\$/.test(await p.locator(".wlive").innerText()));
for (const v of [24, 12, 32, 55, 20000]) await enter(p, v);
ok("the end: a summary, with the two skipped in amber", /That's the budget set up/.test(await q(p)) && (await p.locator(".wsrow.skip").count()) === 2 && /\$425/.test(await p.locator(".wsum").innerText()));
await p.locator(".wmain").screenshot({ path: D + "walk-summary-wide.png" });
await p.waitForTimeout(1200);   // the save waits a moment after the last answer
let B = await saved(ev.id);
ok("every answer is saved with the event's budget", B.asked && B.reg.inPerson.price === 425 && B.reg.earlyBird.on && B.reg.earlyBird.price === 375 && B.reg.inPerson.expected === 250 && B.pricesIncludeHst === true
  && B.hotel.rate === 189 && B.meals.breakfast === 24 && B.meals.dinner === 55 && B.target === 20000 && B.walk.skipped.sort().join() === "block,expected.earlyBird", JSON.stringify(B.walk));
ok("the room's seats are the event's", (await api(`/api/events?id=${ev.id}`)).event.room?.seats === 300);
await p.locator("#wopen").click(); await p.waitForTimeout(800);
ok("Open the budget shows it, numbers in place", !(await p.locator("dialog.walk").count()) && (await p.locator('[data-k="meals.lunch"]').inputValue()) === "32");
ok("no page errors", !p.errs.length, p.errs.join(" | "));
await p.close();

p = await open(1280, 900, ev.id);
ok("next time the Money tab opens, it asks the skipped ones again", await p.locator("dialog.walk").isVisible() && /early bird registrations/i.test(await q(p)));
await enter(p, 40);
await p.locator("#wclose").click(); await p.waitForTimeout(1200);
B = await saved(ev.id);
ok("an answer given then is kept, and closing leaves the rest for next time", B.reg.earlyBird.expected === 40 && B.walk.skipped.join() === "block");
await p.close();

// "Same as the last one like it".
const ev2 = await mk(`Walk Symposium ${T} Two`);
p = await open(390, 844, ev2.id);
await p.waitForTimeout(800);
ok("phone: the next event offers to start from the last one like it", /Same as Walk Symposium/.test(await p.locator('[data-wstart="like"]').innerText().catch(() => "")));
await p.locator('[data-wstart="like"]').click(); await p.waitForTimeout(300);
ok("phone: its kinds of registration come too", /on/.test(await p.locator('[data-wkind="earlyBird"]').getAttribute("class")));
await p.locator("#wnext").click(); await p.waitForTimeout(300);
const tagText = await p.locator(".wfrom").innerText().catch(() => "none");
ok("phone: the price arrives filled, green, and says where it came from", (await p.locator("#wv").inputValue()) === "425" && /ok/.test(await p.locator(".wbox").getAttribute("class")) && /From Walk Symposium/i.test(tagText), `${await p.locator("#wv").inputValue()} | ${tagText} | ${await q(p)}`);
ok("phone: the number pad, a big Next under the thumb, the steps as bars along the top", (await p.locator("#wv").getAttribute("inputmode")) === "decimal" && (await p.locator("#wnext").boundingBox()).width > 300 && await p.locator(".wdots").isVisible() && !(await p.locator(".wside").isVisible()));
await p.screenshot({ path: D + "walk-phone.png" });
await p.locator("#wnext").click(); await p.waitForTimeout(300);
ok("phone: Next moves on", /early bird ticket cost/i.test(await q(p)));
ok("phone: fits, no errors", (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) && !p.errs.length, p.errs.join(" | "));
await p.close();
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
