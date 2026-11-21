// The expense link from the presenters list (Andrew 20 Nov 2026: "I don't want this auto send. I want to be able to look
// at the presenters, click a checkbox, and then send … the expense link"). Tick, Send expense link, it asks, it sends to
// just those ticked. 390 wide and on a computer.
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H } })).json();
const D = new URL(".", import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const iso = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const T = Date.now().toString(36);
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Expense link ${T}`, city: "Toronto, ON", dayOne: iso(-10), lastDay: iso(-8), invite: false,
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }],
  presenters: [["Dana", "Sample"], ["Lee", "Other"], ["Sam", "Third"]].map(([f, l]) => ({ first: f, last: l, email: `${f}.${T}@example.ca`, organization: "OPP" })) }) })).event;
const ids = Object.fromEntries((await api(`/api/events?id=${ev.id}`)).presenters.map((p) => [p.first, p.id]));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errs = [];
for (const [w, h] of [[390, 844], [1280, 900]]) {
  const a = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 2 : 1 });
  a.on("pageerror", (e) => errs.push(String(e)));
  let asked = "", sentTo = null;
  a.on("dialog", (d) => { asked = d.message(); d.accept(); });
  await a.route("**/api/presenter-expenses?*send=1*", async (r) => { sentTo = new URL(r.request().url()).searchParams.get("presenters"); await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sent: sentTo.split(",").length, failed: [], presenters: [] }) }); });
  await a.addInitScript(() => { try { sessionStorage.setItem("ongia-admin-key", "testkey"); } catch {} });
  await a.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "event", eventId: ev.id, tab: "people" })), { waitUntil: "networkidle" }); await a.waitForTimeout(2000);
  ok(`${w}: the bar is hidden until someone is ticked`, await a.locator("#pbulk").isHidden());
  await a.locator(`[data-psel="${ids.Dana}"]`).check(); await a.locator(`[data-psel="${ids.Sam}"]`).check(); await a.waitForTimeout(200);
  const [lm, le] = w < 500 ? ["Agreement", "Expenses"] : ["Send agreement link", "Send expense link"];
  ok(`${w}: two ticked: ${le} beside ${lm}`, await a.locator("#pbulk-exp").isVisible() && (await a.locator("#pbulk-exp").innerText()).trim() === le && (await a.locator("#pbulk-mail").innerText()).trim() === lm
    && await a.locator("#pbulk-exp").getAttribute("aria-label") === "Send expense link", await a.locator("#pbulk").innerText());
  ok(`${w}: the count says 2`, (await a.locator("#pbulk-n .pbn").innerText()).trim() === "2");
  ok(`${w}: everything on the bar is on one line`, await a.evaluate(() => new Set([...document.querySelectorAll("#pbulk > *")].filter((e) => getComputedStyle(e).display !== "none").map((e) => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2) / 4 | 0)).size === 1));
  // Ticked from far down the list, the bar is right there on screen, above the phone's menu (Andrew 21 Nov 2026).
  await a.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await a.waitForTimeout(300);
  const bar = await a.locator("#pbulk").boundingBox(), vh = a.viewportSize().height;
  const navTop = w < 900 ? (await a.locator(".side").boundingBox()).y : vh;
  ok(`${w}: the bar floats on screen wherever you are, above the menu`, bar.y >= 0 && bar.y + bar.height <= navTop + 1, JSON.stringify({ bar, navTop }));
  if (w < 500) ok(`${w}: each presenter is two lines`, await a.evaluate(() => [...document.querySelectorAll("tr.prow")].every((r) => r.getBoundingClientRect().height <= 100)));
  ok(`${w}: the bar is one line high`, (await a.locator("#pbulk").boundingBox()).height < 64);
  if (w < 500 && D) { await a.locator("#pbulk").scrollIntoViewIfNeeded(); await a.locator("#pbulk").screenshot({ path: D + "expenselink-bar.png" }); }
  await a.locator("#pbulk-exp").click(); await a.waitForTimeout(2500);
  ok(`${w}: it asks first, and says the event hasn't named its meals`, /Email the expense link to 2 presenters\?/.test(asked) && /hasn't said which meals it served/.test(asked), asked);
  ok(`${w}: it sends to just the two ticked`, sentTo && sentTo.split(",").sort().join() === [ids.Dana, ids.Sam].sort().join(), sentTo);
  ok(`${w}: afterwards nobody is ticked and the bar goes`, await a.locator("#pbulk").isHidden() && await a.locator("[data-psel]:checked").count() === 0);
  ok(`${w}: nothing scrolls sideways`, await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await a.close();
}
// The server sends to the ticked ones only (no mail service here, so each is recorded as not sent).
await api(`/api/events?id=${ev.id}`, { method: "PUT", body: JSON.stringify({ ...(await api(`/api/events?id=${ev.id}`)).event, mealsProvided: { breakfast: true, lunch: true, dinner: false } }) });
const r = await api(`/api/presenter-expenses?event=${ev.id}&send=1&presenters=${ids.Lee}`, { method: "POST" });
const tried = r.presenters.filter((p) => p.sentAt).map((p) => p.name);
ok("server: only the ticked presenter is tried", tried.join() === "Lee Other", JSON.stringify(tried));
ok("no script errors", !errs.length, errs.join(" | "));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
