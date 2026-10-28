// "New since you last looked" on the event's tabs (Andrew 28 Oct 2026: "if I were to get 10 new survey replies, a small
// badge 10 shows beside the survey tab. And so on for the rest"), kept for each board member.
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
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Badge Training ${T}`, city: "Calgary, AB", venue: "Hall", dayOne: shift(-3), lastDay: shift(-3), invite: false,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }] }) })).event;
const set = await api(`/api/survey?event=${ev.id}`, { method: "PUT", body: JSON.stringify({ open: true, mode: "end", sendOn: shift(-1), sessions: [{ id: "sa", day: ev.dayOne, title: "Following the Money", presenters: ["Jordan Avery"] }] }) });
const reply = await api(`/api/reply?event=${ev.id}`, { method: "PUT", body: "{}" });
const stars = (n) => Object.fromEntries(["relevant", "knowledge", "expectations", "expert", "engaging", "delivery"].map((k) => [k, n]));
const answerSurvey = (i) => fetch(`${S}/api/survey?t=${set.survey.token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ part: "end", lang: "en",
  about: { agency: "TPS", province: "ON", years: 1, before: 0, again: 0, heard: 1 }, sessions: { sa: { ...stars(4), rebook: 0 } },
  overall: { quality: 4, pace: 1, confidence: 4, variety: 4, practical: 4, venue: 4, av: 4, registration: 4, food: 4, length: 1, nps: 8 + (i % 2) } }) });
const answerReply = (i) => fetch(`${S}/api/reply?t=${reply.reply.token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ first: "Ann", last: `Number${i}`, agency: "TPS", email: `ann${i}.${T}@example.ca`, allergy: "no" }) });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (email, name, vp = { width: 1440, height: 1000 }) => {
  const page = await b.newPage({ viewport: vp, deviceScaleFactor: 2 });
  const token = issueSession({ email, name });
  await page.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email, name, owner: email === "president@ongia.ca" }]);
  page.errs = []; page.on("pageerror", (e) => page.errs.push(String(e)));
  await page.goto(`${S}/admin.html#event/${ev.id}`, { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
  return page;
};
const badge = async (p, tab) => (await p.locator(`.etab[data-tab="${tab}"] .nnew`).count()) ? (await p.locator(`.etab[data-tab="${tab}"] .nnew`).innerText()).trim() : "";

let p = await open("president@ongia.ca", "Andrew Hammond");
ok("a first visit calls nothing new", !(await badge(p, "survey")) && !(await badge(p, "communications")) && (await p.locator(".etab .nnew").count()) === 0);
await p.close();

for (let i = 0; i < 3; i++) await answerSurvey(i);
for (let i = 0; i < 2; i++) await answerReply(i);
p = await open("president@ongia.ca", "Andrew Hammond");
ok("three new survey answers: a 3 beside Survey", (await badge(p, "survey")) === "3", await badge(p, "survey"));
ok("two new food-allergy answers: a 2 beside Communications", (await badge(p, "communications")) === "2", await badge(p, "communications"));
ok("it says what it means", /3 new since you last looked/.test(await p.locator('.etab[data-tab="survey"] .nnew').getAttribute("title")));
await p.screenshot({ path: D + "tab-badges-wide.png", clip: { x: 0, y: 0, width: 1440, height: 420 } });
await p.locator('.etab[data-tab="survey"]').click(); await p.waitForTimeout(800);
ok("opening Survey clears its badge, and leaves the other", !(await badge(p, "survey")) && (await badge(p, "communications")) === "2");
ok("no page errors", p.errs.length === 0, p.errs.join(" | "));
await p.close();

p = await open("president@ongia.ca", "Andrew Hammond");
ok("back later: Survey stays seen, Communications still new", !(await badge(p, "survey")) && (await badge(p, "communications")) === "2");
await p.close();

// Each board member has their own: Raj's first visit starts fresh, and Andrew's looking does not clear Raj's.
const raj = await open("treasurer@ongia.ca", "Raj Jaswal");
ok("another board member's first visit starts from now", (await raj.locator(".etab .nnew").count()) === 0);
await raj.close();
await answerSurvey(9);
const raj2 = await open("treasurer@ongia.ca", "Raj Jaswal", { width: 390, height: 844 });
ok("and after one more answer, Raj sees 1 on Survey", (await badge(raj2, "survey")) === "1", await badge(raj2, "survey"));
ok("phone: the tabs still fit", await raj2.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await raj2.screenshot({ path: D + "tab-badges-phone.png", clip: { x: 0, y: 0, width: 390, height: 600 } });
await raj2.close();
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
