// The Survey tab in three parts (audit, 30 Oct 2026, from the mock-up Andrew picked): the survey's state in a line at the
// top, then Setup (when it goes, the sessions), Delivery (try it, a test, the link) and Results. A day with no end time
// says so and goes straight to that day's times on the Program tab.
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
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Survey Parts ${T}`, city: "Toronto, ON", venue: "Hall", dayOne: "2031-11-24", lastDay: "2031-11-26", invite: false,
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }] }) })).event;
const fresh = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `No Survey ${T}`, city: "Toronto, ON", venue: "Hall", dayOne: "2031-11-24", lastDay: "2031-11-24", invite: false,
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }] }) })).event;
await api(`/api/survey?event=${ev.id}`, { method: "PUT", body: JSON.stringify({ open: true, mode: "daily", sessions: [{ id: "a", day: "2031-11-24", title: "Following the money", presenters: ["Jordan Avery"] }, { id: "b", day: "", title: "Youth recruitment", presenters: ["Sam Ortiz"] }] }) });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (id, w = 1440, h = 1000) => {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await p.addInitScript(([t, x]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(x)); } catch {} }, [issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" }), { email: "president@ongia.ca", name: "Andrew Hammond", canCost: true }]);
  p.errs = []; p.on("pageerror", (e) => p.errs.push(String(e)));
  await p.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "event", eventId: id, tab: "survey" })), { waitUntil: "networkidle" }); await p.waitForTimeout(1600);
  return p;
};
const shown = (p) => p.locator("[data-svp]:not([hidden])").getAttribute("data-svp");

let p = await open(fresh.id);
ok("no survey yet: the line says Not set up, and Setup is open with Set up the survey", /Not set up/i.test(await p.locator("#svhead").innerText()) && await shown(p) === "setup" && await p.locator("#sv-start").isVisible());
await p.locator('[data-svpart="delivery"]').click(); await p.waitForTimeout(300);
ok("Delivery before there's a survey says to set it up first", /Set up the survey first/.test(await p.locator("#svdel").innerText()));
await p.close();

p = await open(ev.id);
const head = await p.locator("#svhead").innerText();
ok("the line at the top: what's wrong in a count, each day, the sessions, and that emails are off", /4 things to fix/i.test(head) && /Each day · 3 days · 2 sessions/.test(head) && /attendee emails are off/.test(head), head);
ok("with a Preview the survey link", await p.locator("#sv-try").isVisible());
ok("Setup opens first: when it goes and the sessions, and nothing about sending", await shown(p) === "setup" && await p.locator("#svbox [data-svmode]").count() === 2 && await p.locator("#sv-rows [data-sv]").count() === 2 && await p.locator("#svbox #sv-test").count() === 0);
ok("each day with no end time says so, with a link to set it", await p.locator("[data-svfix]").count() === 3 && /Set Mon's end time/.test(await p.locator("#svbox").innerText()));
ok("no Changes save as you type beside a Save button", !/Changes save as you type/.test(await p.locator("#svbox").innerText()));
await p.locator("#svhead").screenshot({ path: D + "surveyparts-head.png" });
await p.locator('[data-svpart="delivery"]').click(); await p.waitForTimeout(300);
const del = await p.locator("#svdel").innerText();
ok("Delivery: emails off, each day's send, Try the survey, a test, and the link", await shown(p) === "delivery" && /Attendee emails are off/.test(del) && /Day 1 · Mon 24 Nov 2031/.test(del) && await p.locator("#sv-open").isVisible() && await p.locator("#sv-test").isVisible() && await p.locator("#sv-share").isVisible(), del.slice(0, 300));
await p.locator('[data-svpart="results"]').click(); await p.waitForTimeout(300);
ok("Results: the results card", await shown(p) === "results" && await p.locator("#rsbox").isVisible());
await p.locator('[data-svpart="setup"]').click(); await p.waitForTimeout(300);
await p.locator("[data-svfix]").nth(1).click(); await p.waitForTimeout(900);
ok("a day's Set its end time link opens the Program tab at that day, the end time ready to type", await p.locator('.etab[data-tab="program"]').getAttribute("aria-selected") === "true"
  && await p.evaluate(() => document.activeElement?.dataset?.ag === "end" && document.activeElement.closest(".agrow")?.dataset.agday === "2031-11-25"));
ok("no errors", !p.errs.length, p.errs.join(" | "));
await p.close();

// Once answers are in, the tab opens on Results.
await api(`/api/survey?event=${ev.id}`, { method: "PUT", body: JSON.stringify({ open: true, mode: "end", sendOn: "2031-11-27", sessions: [{ id: "a", day: "2031-11-24", title: "Following the money", presenters: ["Jordan Avery"] }] }) });
const tok = (await api(`/api/survey?event=${ev.id}`)).survey.token;
const answered = await fetch(`${S}/api/survey?t=${tok}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ part: "end", lang: "en",
  about: { agency: "TPS", province: "ON", years: 2, before: 0, again: 0, heard: 1 }, sessions: { a: { relevant: 5, knowledge: 5, expectations: 5, expert: 5, engaging: 5, delivery: 5, rebook: 0 } },
  overall: { quality: 5, pace: 1, confidence: 5, variety: 5, practical: 5, venue: 5, av: 5, registration: 5, food: 5, length: 1, nps: 10 } }) });
p = await open(ev.id, 390, 844);
ok("phone: with answers in, it opens on Results, and the line says how many", await shown(p) === "results" && /1 answered/i.test(await p.locator("#svhead").innerText()), JSON.stringify(await p.locator("#svhead").innerText()) + " / answer: " + answered.status + " " + JSON.stringify(await answered.json().catch(() => ({}))));
ok("phone: no sideways scroll, no errors", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth) && !p.errs.length, p.errs.join(" | "));
await p.locator("#svhead").screenshot({ path: D + "surveyparts-head-phone.png" });
await p.close();
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
