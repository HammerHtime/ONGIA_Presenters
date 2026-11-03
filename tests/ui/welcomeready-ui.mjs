// The welcome letter's further version (the Summit's virtual attendees) goes only once Andrew says it's ready (3 Nov 2026:
// "Hold virtual until I've reviewed it"). On the event's Communications tab its panel says how many wait, with
// "It's ready: send it"; pressed, it says it's ready, with "Hold it". The local desk server can't be given extra Wix
// groups, so this test runs its own, in this process, and puts the event and its people straight into the store.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
process.argv[2] = "8797";
delete process.env.WIX_API_KEY;
await import(REPO + "scripts/dev-server.mjs");
const St = await import(REPO + "netlify/functions/lib/store.mjs");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const D = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8797";
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${S}/admin.html`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
const shift = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

// A Summit-like event: its own Wix event, the community partners', and a virtual one; made-up people.
await St.putEvent({ id: "vsum", title: "National Gang Summit (practice)", city: "Toronto", venue: "Hall", dayOne: shift(6), lastDay: shift(9), board: [], attendeeMail: true,
  wix: { eventId: "w1" }, wixMore: [{ eventId: "w2", title: "Community", group: "Community partners" }, { eventId: "w3", title: "VIRTUAL", group: "Virtual", online: true }],
  tasks: [{ id: "t1", what: "Welcome letter sent to attendees", daysBefore: 7, auto: "welcome" }],
  welcome: { main: { subject: "Welcome", body: "Hello {first},\n\nSee you {dates}." }, group: { subject: "Welcome, partners", body: "Hello {first},\n\nSee you {dates}." },
    xw3: { subject: "Welcome, joining online", body: "Hello {first},\n\nYou're joining us online {dates}." } } });
await St.putAttendees("vsum", { people: [
  { key: "a", first: "Ada", last: "Test", email: "ada@example.ca", status: "ATTENDING", wixEventId: "w1" },
  { key: "v1", first: "Val", last: "Test", email: "val@example.ca", status: "ATTENDING", group: "Virtual", wixEventId: "w3" },
  { key: "v2", first: "Vic", last: "Test", email: "vic@example.ca", status: "ATTENDING", group: "Virtual", wixEventId: "w3" },
] });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} },
  [issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" }), { email: "president@ongia.ca", name: "Andrew Hammond", owner: true }]);
const errs = []; p.on("pageerror", (x) => errs.push(String(x)));
let asked = "";
p.on("dialog", (d) => { asked = d.message(); d.accept(); });
await p.goto(`${S}/admin.html#event/vsum`, { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
await p.locator('.etab[data-tab="communications"]').click(); await p.waitForTimeout(600);
await p.evaluate(() => { const d = document.getElementById("welcomefold"); if (d) d.open = true; }); await p.waitForTimeout(1200);

const panel = p.locator('.wlver[data-wl="xw3"]');
ok("the Virtual version has its own panel", await panel.count() === 1);
ok("written, it says it isn't sent yet and how many wait, with \"It's ready: send it\"", /Not sent yet\. 2 people waiting/.test(await panel.innerText()) && await panel.locator("[data-wlready]").isVisible(), await panel.innerText().then((t) => t.slice(-200)));
ok("the other versions have no such button", await p.locator('.wlver[data-wl="main"] [data-wlready], .wlver[data-wl="group"] [data-wlready]').count() === 0);
await panel.scrollIntoViewIfNeeded(); await panel.screenshot({ path: D + "welcome-ready-before.png" });
await panel.locator("[data-wlready]").click(); await p.waitForTimeout(1200);
ok("pressing it asks first, naming the letter and the number", /Send the Virtual welcome letter to 2 people\?/.test(asked), asked);
ok("…then says it's ready, going within 15 minutes, with \"Hold it\"", /Ready to send \(since [^)]+\)\. Going/.test(await panel.innerText()) && /within 15 minutes/.test(await panel.innerText()) && await panel.locator("[data-wlhold]").isVisible());
ok("…and it's saved on the event", !!(await St.getEvent("vsum")).welcomeReady?.xw3);
await panel.screenshot({ path: D + "welcome-ready-after.png" });
await panel.locator("[data-wlhold]").click(); await p.waitForTimeout(1200);
ok("\"Hold it\" puts it back to waiting", /Not sent yet/.test(await p.locator('.wlver[data-wl="xw3"]').innerText()) && !(await St.getEvent("vsum")).welcomeReady?.xw3);
ok("no page errors", !errs.length, errs.join(" | "));

await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
