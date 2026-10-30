// Select several on an event's checklist (Andrew 30 Oct 2026, from the mock-up he approved): every row a push button that
// goes green, shortcuts for the overdue and undated ones, a bar that marks them all done or not needed, and Undo.
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
const shift = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const jobs = async (id) => (await api(`/api/tasks?event=${id}`)).tasks;

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[390, 844, "phone"], [1440, 1000, "wide"]]) {
  const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Pick Several ${tag} ${T}`, city: "Ottawa, ON", venue: "Hotel", dayOne: shift(20), lastDay: shift(21), invite: false,
    board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }] }) })).event;
  await api(`/api/tasks?event=${ev.id}&seed=1`, { method: "POST", body: "{}" });
  const start = await jobs(ev.id);
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true }]);
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(`${S}/admin.html#event/${ev.id}`, { waitUntil: "networkidle" }); await p.waitForTimeout(1800);
  const card = p.locator('[data-fold="sec-tasks"]');
  if (!(await card.getAttribute("open").catch(() => null) !== null)) await card.locator("summary").click().catch(() => {});
  ok(`${tag}: the checklist has a Select several button beside Add a job, and the tick boxes as before`, await p.locator("#jselect").isVisible() && await p.locator("#jadd").isVisible() && (await p.locator("[data-tick]").count()) === start.length);
  await p.locator("#jselect").click(); await p.waitForTimeout(1500);
  ok(`${tag}: select mode: every job is a row to tap, the bar at the bottom says nothing is picked yet, its buttons off`,
    (await p.locator("[data-jpick]").count()) === start.length && /Tap the jobs/.test(await p.locator("#jselbar").innerText()) && await p.locator('[data-jdo="done"]').isDisabled());
  const rows = p.locator("[data-jpick]");
  await rows.nth(0).click(); await rows.nth(1).click(); await rows.nth(2).click(); await rows.nth(2).click();
  ok(`${tag}: tapped rows go green, a second tap lets one go, and the bar counts two`, (await p.locator("[data-jpick].on").count()) === 2 && /^2 jobs picked/.test(await p.locator("#jselbar").innerText()), await p.locator("#jselbar").innerText());
  await p.locator('[data-jgroup="nodate"]').click();
  const undated = start.filter((t) => !t.done && !t.na && !t.scheduled).map((t) => t.id);
  const firstTwo = await rows.evaluateAll((r) => r.slice(0, 2).map((x) => x.dataset.jpick));
  const want = new Set([...firstTwo, ...undated]);
  ok(`${tag}: "Pick the ones with no date" adds every undated job`, (await p.locator("[data-jpick].on").count()) === want.size, `${await p.locator("[data-jpick].on").count()} vs ${want.size}`);
  await p.locator("#jselbar").scrollIntoViewIfNeeded();
  await p.locator('[data-fold="sec-tasks"]').screenshot({ path: D + `jobsbulk-select-${tag}.png` });
  await p.locator('[data-jdo="na"]').click(); await p.waitForTimeout(1800);
  let now = await jobs(ev.id);
  ok(`${tag}: Not needed rules every picked job out in one go and leaves the rest alone`, now.filter((t) => t.na).length === want.size && now.every((t) => t.na === want.has(t.id)));
  ok(`${tag}: the screen leaves select mode, and a note says what happened with Undo`, !(await p.locator("#jselbar").count()) && new RegExp(`${want.size} jobs marked not needed`).test(await p.locator(".toast").innerText()) && await p.locator(".toast .undo").isVisible());
  await p.locator(".toast").screenshot({ path: D + `jobsbulk-toast-${tag}.png` });
  await p.locator(".toast .undo").click(); await p.waitForTimeout(1800);
  now = await jobs(ev.id);
  ok(`${tag}: Undo puts them all back`, now.every((t) => !t.na && !t.done));
  if (tag === "wide") {
    await p.locator("#jselect").click(); await p.waitForTimeout(1200);
    await p.locator('[data-jgroup="left"]').click();
    await p.locator('[data-jdo="done"]').click(); await p.waitForTimeout(1800);
    now = await jobs(ev.id);
    ok(`${tag}: "Pick everything left to do", then Mark all done, ticks the whole list`, now.every((t) => t.done) && (await p.locator("[data-tick]:checked").count()) === now.length);
    await p.locator('[data-fold="sec-tasks"]').screenshot({ path: D + `jobsbulk-done-${tag}.png` });
  }
  ok(`${tag}: fits the screen, no page errors`, (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) && !errs.length, errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
