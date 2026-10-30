// Number boxes on a phone (Andrew 30 Oct 2026: "if it shows a zero, if I click on it, that zero kind of disappears and
// my iPhone number pad ... pop[s] up ... for all the number fields in the entire app"): a zero clears when the box is
// entered and comes back if it's left empty, nothing is saved by just tapping in and out, and every box holding a
// number asks for the number pad.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const T = Date.now().toString(36);
const PRES = { "x-admin-key": issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" }) };
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Number Pad ${T}`, city: "Toronto, ON", dayOne: "2031-05-12", lastDay: "2031-05-13", invite: false,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }] }) })).event;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true, canCost: true }]);
const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
await p.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "event", eventId: ev.id, tab: "money" })), { waitUntil: "networkidle" }); await p.waitForTimeout(1800);
await p.locator("#wclose").click(); await p.waitForTimeout(1200);
const saved = async () => (await (await fetch(`${S}/api/budget?event=${ev.id}`, { headers: PRES })).json()).budget;

const box = p.locator('[data-k="meals.breakfast"]');
ok("the breakfast price shows 0 to start", (await box.inputValue()) === "0");
await box.tap(); await p.waitForTimeout(200);
ok("tapping in clears the zero", (await box.inputValue()) === "");
await box.blur(); await p.waitForTimeout(1200);
ok("leaving it empty puts the zero back, and saves nothing new", (await box.inputValue()) === "0" && (await saved()).meals.breakfast === 0);
await box.tap(); await p.keyboard.type("24"); await box.blur(); await p.waitForTimeout(1500);
ok("typing a price after tapping in gives that price, not 024", (await p.locator('[data-k="meals.breakfast"]').inputValue()) === "24" && (await saved()).meals.breakfast === 24);
const nonPad = await p.evaluate(() => [...document.querySelectorAll("#root input")].filter((el) => el.type === "number" || el.classList.contains("money") || /^(meals|hotel|reg)\./.test(el.dataset.k ?? "") && !/name|group/.test(el.dataset.k)).filter((el) => !/^(decimal|numeric)$/.test(el.inputMode)).map((el) => el.dataset.k || el.id));
ok("every number box on the Money tab asks for the number pad", nonPad.length === 0, nonPad.join(" "));
const text = p.locator('[data-k^="other."][data-k$=".name"]').first();
if (await text.count()) ok("a text box isn't touched", (await text.getAttribute("inputmode")) === null);
await p.locator('.etab[data-tab="settings"]').click(); await p.waitForTimeout(400);
ok("no page errors", !errs.length, errs.join(" | "));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
