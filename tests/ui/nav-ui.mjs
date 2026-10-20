// Back button (the browser's and the phone's) and click feedback on the desk.
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
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Nav ${T}`, city: "Montreal", venue: "V", dayOne: "2027-03-01", lastDay: "2027-03-02", invite: false, board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], presenters: [] }) })).event;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1440, 900, "wide"], [390, 844, "phone"]]) {
  console.log(`— ${tag}`);
  const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await page.addInitScript(() => { try { sessionStorage.setItem("ongia-test-alltabs", "1"); } catch {} });   // every tab of the event page shown at once: this file tests the sections, evtabs-ui tests the tabs
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await page.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true, canCost: true }]);
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  let slow = 0;
  await page.route("**/api/backups", async (route) => {
    const req = route.request();
    if (req.method() === "POST") { await new Promise((r) => setTimeout(r, slow)); return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ status: { state: "running", startedAt: new Date().toISOString() }, folder: "ONGIA Desk Backups", schedule: "4:00 America/Vancouver", configured: true }) }); }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: null, folder: "ONGIA Desk Backups", schedule: "4:00 America/Vancouver", configured: true }) });
  });
  await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await page.waitForTimeout(1000);
  const where = () => page.evaluate(() => { const m = location.hash.match(/^#v=(.*)$/); return m ? JSON.parse(decodeURIComponent(m[1])) : (location.hash === "" ? { name: "list" } : null); });
  ok(`${tag}: the first screen is recorded as the list`, (await where())?.name === "list");
  const hist0 = await page.evaluate(() => history.length);

  // open the event, then Back
  await page.locator(`[data-open="${ev.id}"]`).first().evaluate((e) => e.click()); await page.waitForTimeout(1300);
  ok(`${tag}: opening an event is a step: the address records it`, (await where())?.name === "event" && (await where())?.eventId === ev.id && (await page.evaluate(() => history.length)) === hist0 + 1);
  ok(`${tag}: and the page is the event`, new RegExp(`Nav ${T}`).test(await page.locator("body").innerText()) && (await page.locator("#sowcard, #evsettings").count()) >= 1);
  await page.goBack(); await page.waitForTimeout(1200);
  ok(`${tag}: Back returns to the events list`, (await where())?.name === "list" && (await page.locator(".evcard").count()) >= 1 && (await page.locator("#evsettings").count()) === 0);
  await page.goForward(); await page.waitForTimeout(1200);
  ok(`${tag}: Forward returns to the event`, (await where())?.name === "event" && new RegExp(`Nav ${T}`).test(await page.locator("body").innerText()));
  // the desk's own Back chip still works and Back after it goes on from there
  await page.click("#back"); await page.waitForTimeout(1000);
  ok(`${tag}: the "All events" button is one more step, and Back after it returns to the event`, (await where())?.name === "list");
  await page.goBack(); await page.waitForTimeout(1000);
  ok(`${tag}: …back to the event`, (await where())?.name === "event");

  // Admin tabs
  await page.goBack(); await page.waitForTimeout(800); await page.goBack().catch(() => {}); await page.waitForTimeout(500);
  await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await page.waitForTimeout(800);
  await page.click("#admin"); await page.waitForTimeout(900);
  await page.locator('[data-atab="backup"]').click(); await page.waitForTimeout(900);
  ok(`${tag}: Admin → Backup is recorded`, (await where())?.name === "admin" && (await where())?.tab === "backup" && /Nightly backup/.test(await page.locator("body").innerText()));
  await page.goBack(); await page.waitForTimeout(900);
  ok(`${tag}: Back from the Backup tab shows the board list`, (await where())?.tab === "board" && (await page.locator(".member").count()) >= 1 && (await page.locator("#backupline").count()) === 0);
  await page.goBack(); await page.waitForTimeout(900);
  ok(`${tag}: and Back again, the events list`, (await where())?.name === "list");

  // a refresh stays where you were
  await page.locator(`[data-open="${ev.id}"]`).first().evaluate((e) => e.click()); await page.waitForTimeout(1200);
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(1500);
  ok(`${tag}: a refresh on the event stays on the event`, (await where())?.name === "event" && new RegExp(`Nav ${T}`).test(await page.locator("body").innerText()));
  await page.goBack(); await page.waitForTimeout(1200);
  ok(`${tag}: and Back still works after a refresh`, (await where())?.name === "list");

  // click feedback
  await page.click("#admin"); await page.waitForTimeout(800);
  await page.locator('[data-atab="backup"]').click(); await page.waitForTimeout(900);
  slow = 2200;
  await page.locator("#bk-now").click();
  ok(`${tag}: the click is acknowledged straight away`, await page.locator("#bk-now").evaluate((e) => e.classList.contains("clicked") || e.classList.contains("working")));
  await page.waitForTimeout(500);
  ok(`${tag}: the button shows it is working (a spinner) while the server answers`, await page.locator("#bk-now").evaluate((e) => e.classList.contains("working")) && (await page.locator("#bk-now").evaluate((e) => getComputedStyle(e, "::after").content)) !== "none");
  ok(`${tag}: and the bar across the top is moving`, await page.locator("#netbar").evaluate((e) => e.classList.contains("on")));
  await page.screenshot({ path: D + `nav-working-${tag}.png` });
  await page.waitForTimeout(1000);
  ok(`${tag}: after a second there are words as well: "Working…"`, await page.locator("#netpill").evaluate((e) => e.classList.contains("on")) && /Working/.test(await page.locator("#netpill").innerText()));
  await page.waitForTimeout(2500);
  ok(`${tag}: when it is done the spinner, the bar and the words all go`, !(await page.locator("#netbar").evaluate((e) => e.classList.contains("on"))) && !(await page.locator("#netpill").evaluate((e) => e.classList.contains("on"))));
  ok(`${tag}: no page errors`, errs.length === 0, errs.join("|"));
  await page.close();
}
await b.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
