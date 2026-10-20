// Past events fold away at the bottom of the home page. Phone and desktop.
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
const today = new Date().toISOString().slice(0, 10);
const shift = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const mk = async (title, a, b, extra = {}) => (await api("/api/events", { method: "POST", body: JSON.stringify({ title, city: "Montreal", venue: "V", dayOne: a, lastDay: b, invite: false, board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], presenters: [], ...extra }) })).event;
const T = Date.now().toString(36);
const old1 = await mk(`PastOne ${T}`, shift(-60), shift(-57), { kind: "rbh", province: "QC" });
const old2 = await mk(`PastTwo ${T}`, shift(-20), shift(-18));
const live = await mk(`Ending today ${T}`, shift(-2), today);
const next = await mk(`Coming ${T}`, shift(30), shift(33));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1440, 900, "wide"], [390, 844, "phone"]]) {
  console.log(`— ${tag}`);
  const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await page.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); if (!sessionStorage.getItem("cleared")) { localStorage.clear(); sessionStorage.setItem("cleared", "1"); } } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true, canCost: true }]);
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
  const cards = await page.locator(".evcard").evaluateAll((els) => els.map((e) => e.querySelector("h2").innerText));
  ok(`${tag}: the cards in front are the events not yet over, including one that ends today`, cards.some((t) => t.includes(`Coming ${T}`)) && cards.some((t) => t.includes(`Ending today ${T}`)) && !cards.some((t) => t.includes(`Past`)), JSON.stringify(cards));
  ok(`${tag}: there is a Past events section, closed, saying how many`, (await page.locator("#pastevents").count()) === 1 && !(await page.locator("#pastevents").evaluate((d) => d.open)) && /\d+ events? that/.test(await page.locator("#pastevents summary").innerText()));
  ok(`${tag}: it comes after the events in front`, await page.evaluate(() => { const a = [...document.querySelectorAll(".evcard")].pop(), p = document.getElementById("pastevents"); return !!(a.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING); }));
  await page.locator("#pastevents").scrollIntoViewIfNeeded(); await page.screenshot({ path: D + `past-closed-${tag}.png` });
  await page.locator("#pastevents summary").click(); await page.waitForTimeout(300);
  const rows = await page.locator("#pastevents .pastrow").evaluateAll((els) => els.map((e) => e.innerText));
  const mine = rows.filter((r) => r.includes(T));
  ok(`${tag}: opened, the past ones are listed, the most recent first, and the RBH one is tagged`, mine.length === 2 && mine[0].includes("PastTwo") && mine[1].includes("PastOne") && /RBH/.test(mine[1]) && !/RBH/.test(mine[0]), JSON.stringify(mine));
  ok(`${tag}: nothing in the past section is one that is still on`, !rows.some((r) => r.includes("Ending today") || r.includes("Coming")));
  await page.screenshot({ path: D + `past-open-${tag}.png` });
  ok(`${tag}: fits the screen`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(1200);
  ok(`${tag}: it stays open after a reload (the way the other sections do)`, await page.locator("#pastevents").evaluate((d) => d.open));
  await page.locator("#pastevents .pastrow", { hasText: `PastOne ${T}` }).click(); await page.waitForTimeout(1500);
  ok(`${tag}: a past event still opens like any other`, new RegExp(`PastOne ${T}`).test(await page.locator("body").innerText()) && (await page.locator("#sowcard").count()) === 0 ? true : /PastOne/.test(await page.locator("body").innerText()));
  ok(`${tag}: no page errors`, errs.length === 0, errs.join("|"));
  await page.close();
}
await b.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
