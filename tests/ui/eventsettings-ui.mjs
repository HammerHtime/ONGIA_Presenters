// Settings on the event in place of decisions by its name (Andrew 25 Nov 2026): the main group's name and each further
// group's days under Linked to Wix, and the board inbox on Edit event. Typed on the page, each is saved on the event.
// The local desk server can't be given extra Wix groups, so this test runs its own and puts the event in the store.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
process.argv[2] = "8796";
delete process.env.WIX_API_KEY;
await import(REPO + "scripts/dev-server.mjs");
const St = await import(REPO + "netlify/functions/lib/store.mjs");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const S = "http://127.0.0.1:8796";
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${S}/admin.html`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
const shift = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const d1 = shift(40), d2 = shift(41);

await St.putEvent({ id: "es1", title: "Practice Summit", city: "Toronto, ON", venue: "Hall", dayOne: shift(39), lastDay: shift(42),
  board: [{ name: "Pat Lead", email: "president@ongia.ca", lead: true }],
  wix: { eventId: "w1", title: "Practice Summit" }, wixMore: [{ eventId: "w2", title: "Practice partners", group: "Community partners" }] });
await St.putAttendees("es1", { people: [
  { key: "a", first: "Ada", last: "Test", email: "ada@example.ca", status: "ATTENDING", wixEventId: "w1" },
  { key: "c", first: "Cam", last: "Test", email: "cam@example.ca", status: "ATTENDING", group: "Community partners", wixEventId: "w2" }] });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1440, 1000, "wide"], [390, 844, "phone"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} },
    [issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" }), { email: "president@ongia.ca", name: "Andrew Hammond", owner: true }]);
  const errs = []; p.on("pageerror", (x) => errs.push(String(x)));
  await p.goto(`${S}/admin.html#event/es1`, { waitUntil: "networkidle" }); await p.waitForTimeout(1000);
  const toSettings = async () => { await p.locator('.etab[data-tab="settings"]').click(); await p.waitForTimeout(500); await p.evaluate(() => { const d = document.querySelector(".gwix"); if (d) d.open = true; }); };
  await toSettings();
  const name = tag === "wide" ? "Justice partners" : "Police partners";
  ok(`${tag}: Linked to Wix shows the main group's box, empty meaning "Everyone else"`, await p.locator("#g-main").isVisible() && (await p.locator("#g-main").getAttribute("placeholder")) === "Everyone else");
  await p.locator("#g-main").fill(name); await p.locator("#g-main").blur(); await p.waitForTimeout(1500);
  ok(`${tag}: the main group's name saves on the event`, (await St.getEvent("es1")).mainGroup === name, (await St.getEvent("es1")).mainGroup);
  await toSettings();
  const days = p.locator('[data-gdays="w2"] input');
  await days.nth(0).fill(d1); await days.nth(0).blur(); await p.waitForTimeout(1500);
  await toSettings();
  await p.locator('[data-gdays="w2"] input').nth(1).fill(d2); await p.locator('[data-gdays="w2"] input').nth(1).blur(); await p.waitForTimeout(1500);
  const g = (await St.getEvent("es1")).wixMore[0];
  ok(`${tag}: the community partners' days save`, g.dayOne === d1 && g.lastDay === d2, JSON.stringify(g));
  await toSettings();
  ok(`${tag}: and show again when it opens`, (await p.locator('[data-gdays="w2"] input').nth(0).inputValue()) === d1 && (await p.locator("#g-main").inputValue()) === name);
  ok(`${tag}: nothing scrolls sideways`, !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  await p.locator('.etab[data-tab="attendees"], .etab[data-tab="guests"]').first().click().catch(() => {}); await p.waitForTimeout(500);
  // The chip is short ("Justice 1"), with the full name as its tooltip.
  const chip = p.locator('[data-ggrpbtn="main"]').first();
  ok(`${tag}: the attendee list's group chip uses the name`, (await chip.getAttribute("title").catch(() => "")) === name && (await chip.innerText()).startsWith(name.split(" ")[0]));

  // The board inbox, on Edit event.
  await p.locator("#edit").click(); await p.waitForSelector("#e-inbox");
  ok(`${tag}: Edit event has the board inbox, empty meaning info@ongia.ca`, (await p.locator("#e-inbox").getAttribute("placeholder")) === "info@ongia.ca");
  await p.locator("#e-inbox").fill("ngs@ongia.ca"); await p.locator("#e-inbox").blur(); await p.waitForTimeout(2000);
  ok(`${tag}: it saves as you go`, (await St.getEvent("es1")).boardInbox === "ngs@ongia.ca", (await St.getEvent("es1")).boardInbox);
  ok(`${tag}: Edit event doesn't scroll sideways`, !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  ok(`${tag}: no page errors`, errs.length === 0, errs.join(" | "));
  await St.putEvent({ ...(await St.getEvent("es1")), boardInbox: "", mainGroup: "" });
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
