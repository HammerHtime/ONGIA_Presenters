// "Is this an RBH event?" on the event page: who sees it, and that marking opens the costing. Phone and desktop.
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
const mk = async (title, city) => (await api("/api/events", { method: "POST", body: JSON.stringify({ title, city, venue: "V", dayOne: "2026-11-09", lastDay: "2026-11-12", invite: false, board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], presenters: [] }) })).event;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const as = async (email, name, vp, ev) => {
  const page = await b.newPage({ viewport: vp, deviceScaleFactor: 2 });
  await page.addInitScript(() => { try { sessionStorage.setItem("ongia-test-alltabs", "1"); } catch {} });   // every tab of the event page shown at once: this file tests the sections, evtabs-ui tests the tabs
  const token = issueSession({ email, name });
  await page.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email, name, owner: false, canCost: ["president@ongia.ca", "vp_operations@ongia.ca"].includes(email) }]);
  page.on("dialog", (d) => d.accept()); page.errs = []; page.on("pageerror", (e) => page.errs.push(String(e)));
  await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await page.waitForTimeout(1000);
  await page.locator(`[data-open="${ev.id}"]`).first().evaluate((e) => e.click()); await page.waitForTimeout(1300);
  return page;
};
const lead = await mk("Lead Sees Nothing", "Toronto");
let p = await as("treasurer@ongia.ca", "Raj Jaswal", { width: 1440, height: 900 }, lead);
ok("the event's lead does not see the question", (await p.locator("#rbhoffer").count()) === 0);
await p.close();
for (const [w, h, tag] of [[1440, 900, "wide"], [390, 844, "phone"]]) {
  console.log(`— ${tag}`);
  const ev = await mk("Canadian Forum Against Organized Crime", "Toronto");
  p = await as("president@ongia.ca", "Andrew Hammond", { width: w, height: h }, ev);
  ok(`${tag}: the president sees the question on an ordinary event`, (await p.locator("#rbhoffer").count()) === 1 && /Is this an RBH event\?/.test(await p.locator("#rbhoffer").innerText()));
  ok(`${tag}: there is no costing section yet`, (await p.locator("#sowcard").count()) === 0);
  await p.locator("#rbhoffer").scrollIntoViewIfNeeded(); await p.screenshot({ path: D + `mark-offer-${tag}.png` });
  await p.click("#rbh-open"); await p.waitForTimeout(300);
  ok(`${tag}: the form opens with the province guessed from the city, and the prefix`, (await p.locator("#rbh-prov").inputValue()) === "ON" && (await p.locator("#rbh-prefix").inputValue()) === "CFAOC");
  await p.screenshot({ path: D + `mark-form-${tag}.png` });
  ok(`${tag}: fits the screen`, await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await p.fill("#rbh-prefix", "cfaoc"); await p.selectOption("#rbh-prov", ""); await p.click("#rbh-go"); await p.waitForTimeout(500);
  ok(`${tag}: it won't mark without a province`, (await api(`/api/events?id=${ev.id}`)).event.kind === "");
  await p.selectOption("#rbh-prov", "ON"); await p.click("#rbh-go"); await p.waitForTimeout(2000);
  const after = (await api(`/api/events?id=${ev.id}`)).event;
  ok(`${tag}: marked, with the province and the prefix`, after.kind === "rbh" && after.province === "ON" && after.invoicePrefix === "CFAOC", JSON.stringify([after.kind, after.province, after.invoicePrefix]));
  ok(`${tag}: the question is gone and the statement of work section is there`, (await p.locator("#rbhoffer").count()) === 0 && (await p.locator("#sowcard").count()) === 1 && (await p.locator("#receiptscard").count()) === 1);
  await p.locator("#sowcard").scrollIntoViewIfNeeded(); await p.screenshot({ path: D + `mark-done-${tag}.png` });
  ok(`${tag}: no page errors`, p.errs.length === 0, p.errs.join("|"));
  await p.close();
}
await b.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
