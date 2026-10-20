// New event: start from a Wix event. The Wix answers are stubbed in the browser (no Wix key in the test).
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
const wixEvents = [
  { id: "wx-itp-sep", title: "RBH ITP September", status: "UPCOMING", dayOne: "2027-09-13", lastDay: "2027-09-17", venue: "Humaniti Hotel", city: "Montreal", url: "https://www.ongia.org/event/rdhitp-sept", registered: null, linkedTo: null },
  { id: "wx-old", title: "Gangs & Guns Symposium", status: "ENDED", dayOne: "2026-05-04", lastDay: "2026-05-06", venue: "RBC Centre", city: "Winnipeg", url: "", registered: null, linkedTo: { id: "x", title: "Gangs & Guns" } },
];
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1440, 900, "wide"], [390, 844, "phone"]]) {
  console.log(`— ${tag}`);
  const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await page.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true, canCost: true }]);
  const links = [];
  await page.route("**/api/wix**", (route) => {
    const u = new URL(route.request().url());
    if (u.searchParams.get("events")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events: wixEvents }) });
    if (u.searchParams.get("link")) { links.push({ event: u.searchParams.get("event"), wix: u.searchParams.get("link") }); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, read: 42 }) }); }
    return route.continue();
  });
  page.on("dialog", (d) => d.accept()); const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await page.waitForTimeout(1000);
  await page.click("#newevent"); await page.waitForTimeout(800);
  ok(`${tag}: the New event form offers to start from Wix`, (await page.locator("#wx-pick").count()) === 1 && /Already on your website/.test(await page.locator("#wixstart").innerText()));
  await page.screenshot({ path: D + `wixnew-start-${tag}.png` });
  await page.click("#wx-pick"); await page.waitForTimeout(600);
  const items = await page.locator("#wx-list [data-wix]").evaluateAll((els) => els.map((e) => ({ t: e.innerText, d: e.disabled })));
  ok(`${tag}: it lists the Wix events with dates, city and venue`, items.length === 2 && /RBH ITP September/.test(items[0].t) && /Montreal/.test(items[0].t) && /Humaniti Hotel/.test(items[0].t), JSON.stringify(items));
  ok(`${tag}: one already on the desk can't be picked again, and says so`, items[1].d === true && /already on the desk/.test(items[1].t));
  await page.screenshot({ path: D + `wixnew-list-${tag}.png` });
  await page.locator('[data-wix="wx-itp-sep"]').click(); await page.waitForTimeout(500);
  const val = async (id) => page.locator(id).inputValue();
  ok(`${tag}: choosing it fills the title, city, venue and both dates`, (await val("#e-title")) === "RBH ITP September" && (await val("#e-city")) === "Montreal" && (await val("#e-venue")) === "Humaniti Hotel" && (await val("#e-day1")) === "2027-09-13" && (await val("#e-last")) === "2027-09-17");
  ok(`${tag}: the deadlines worked out from day one appear`, /\d/.test(await page.locator("#preview").innerText()) && (await page.locator("#preview").innerText()).length > 20, await page.locator("#preview").innerText());
  ok(`${tag}: it says where it came from, and offers to unlink`, /From Wix: RBH ITP September/.test(await page.locator("#wx-chosen").innerText()) && (await page.locator("#wx-clear").count()) === 1);
  await page.screenshot({ path: D + `wixnew-filled-${tag}.png`, fullPage: true });
  ok(`${tag}: fits the screen`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  // choose a lead and create
  await page.locator("#bdrop summary").click(); await page.waitForTimeout(200);
  await page.locator('.member[data-email="treasurer@ongia.ca"] input.pick').check();
  await page.locator('.member[data-email="treasurer@ongia.ca"] input[name="lead"]').check();
  await page.click("#create"); await page.waitForTimeout(2500);
  const ev = (await api("/api/events")).events.find((e) => e.id === links[0]?.event);
  ok(`${tag}: the event is created with the Wix dates`, !!ev && ev.lastDay === "2027-09-17" && ev.city === "Montreal" && ev.venue === "Humaniti Hotel", JSON.stringify(ev));
  ok(`${tag}: and it was linked to that Wix event, which pulls the guests`, links.length === 1 && links[0].wix === "wx-itp-sep" && ev?.title === "RBH ITP September", JSON.stringify(links));
  ok(`${tag}: no page errors`, errs.length === 0, errs.join("|"));
  await page.close();
}
// don't link it
{
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await page.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true, canCost: true }]);
  const links = [];
  await page.route("**/api/wix**", (route) => { const u = new URL(route.request().url()); if (u.searchParams.get("events")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events: wixEvents }) }); if (u.searchParams.get("link")) links.push(1); return route.continue(); });
  page.on("dialog", (d) => d.accept());
  await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await page.click("#newevent"); await page.waitForTimeout(600);
  await page.click("#wx-pick"); await page.waitForTimeout(400); await page.locator('[data-wix="wx-itp-sep"]').click(); await page.click("#wx-clear");
  ok("with 'Don't link it' the form keeps what was filled in but nothing is linked", (await page.locator("#e-title").inputValue()) === "RBH ITP September" && (await page.locator("#wx-chosen").isHidden()));
  await page.fill("#e-title", "RBH ITP September (no link)");
  await page.locator("#bdrop summary").click(); await page.locator('.member[data-email="treasurer@ongia.ca"] input.pick').check(); await page.locator('.member[data-email="treasurer@ongia.ca"] input[name="lead"]').check();
  await page.click("#create"); await page.waitForTimeout(2000);
  ok("and no link call is made", links.length === 0);
  await page.close();
}
// Wix not connected: a clear message
{
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await page.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true, canCost: true }]);
  await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await page.click("#newevent"); await page.waitForTimeout(600);
  await page.click("#wx-pick"); await page.waitForTimeout(800);
  ok("when Wix isn't connected the list says so in plain words", /Wix is not connected/.test(await page.locator("#wx-list").innerText()), await page.locator("#wx-list").innerText());
  await page.close();
}
await b.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
