// The presenter's form on an RBH event (no travel) and an ordinary one, on a phone and a wide screen; and the board's review screen.
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
const mk = async (kind, title, first) => { const e = (await api("/api/events", { method: "POST", body: JSON.stringify({ title, city: "Montreal", venue: "V", dayOne: "2026-09-28", lastDay: "2026-10-02", invite: false, kind, province: "QC", board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], presenters: [{ first, last: "Test", email: `${first.toLowerCase()}@example.ca`, organization: "Test Police" }] }) })).event; return { e, p: (await api(`/api/events?id=${e.id}`)).presenters[0] }; };
const R = await mk("rbh", "ITP Week RBH", "Rita"), O = await mk("", "ONGIA Symposium", "Oscar");
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const toStep3 = async (page, p) => {
  await page.goto(`${S}/a/${p.token}`, { waitUntil: "networkidle" }); await page.waitForTimeout(800);
  const next = async () => { await page.click("#next"); await page.waitForTimeout(400); };
  await next(); await page.fill("#f-phone", "416-555-0100"); await next();
  await page.fill("#f-talk", "X"); await page.fill("#f-bio", "word ".repeat(40)); await page.fill("#f-outline", "An outline of the talk."); await next();
  return next;
};
for (const [w, h, tag] of [[390, 844, "phone"], [1440, 900, "wide"]]) {
  for (const [label, X] of [["RBH", R], ["ordinary", O]]) {
    const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 500 });
    const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
    const next = await toStep3(page, X.p);
    const rbh = label === "RBH";
    const txt = await page.locator("#app, main, body").first().innerText();
    ok(`${tag} ${label}: the travel question is ${rbh ? "gone" : "there"}`, (await page.locator("#q-travel").count()) === (rbh ? 0 : 1));
    ok(`${tag} ${label}: the transportation-cost question is ${rbh ? "gone" : "there"}`, (await page.locator("#q-cov-transport").count()) === (rbh ? 0 : 1));
    ok(`${tag} ${label}: the hotel question is there`, (await page.locator("#q-hotel").count()) === 1);
    ok(`${tag} ${label}: the words say ${rbh ? "no flights or other travel" : "travel and accommodations"}`, rbh ? /does not arrange flights or other travel/.test(txt) && !/travel arranged/i.test(txt) : /travel arrangements or accommodations/.test(txt));
    await page.screenshot({ path: D + `rbhform-${label}-${tag}.png`, fullPage: true });
    // fill what is asked and go on
    await page.click('[data-set="hotel"][data-val="no"]'); await page.waitForTimeout(150);
    if (!rbh) { await page.click('[data-set="travel"][data-val="no"]'); await page.click('[data-path="expenses.transport"][data-val="no"]'); }
    await page.click('[data-path="expenses.meals"][data-val="no"]'); await page.click('[data-path="expenses.other"][data-val="no"]');
    await page.click("#next"); await page.waitForTimeout(500);
    ok(`${tag} ${label}: with only what is asked answered, the form moves on to the next step`, (await page.locator("#q-travel, #q-hotel").count()) === 0 && /copyright|Copyright|agree/i.test(await page.locator("body").innerText()), (await page.locator("body").innerText()).slice(0, 200));
    ok(`${tag} ${label}: fits the screen`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    if (rbh) {
      await page.goBack().catch(() => {}); 
    }
    ok(`${tag} ${label}: no page errors`, errs.length === 0, errs.join("|"));
    if (rbh) {
      await page.click("#lang").catch(() => {});
    }
    await page.close();
  }
}
// French wording on step 3 of the RBH form
{
  const page = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  const next = await toStep3(page, R.p);
  await page.click("#lang"); await page.waitForTimeout(400);
  const t = await page.locator("body").innerText();
  ok("RBH in French: says there are no flights or other travel", /n'organise ni vols ni autre transport/.test(t) && !/qu'on organise votre transport/.test(t), t.slice(0, 300));
  await page.screenshot({ path: D + "rbhform-RBH-fr-phone.png", fullPage: true });
  await page.close();
}
// The board's review screen for each
const sub = async (X, extra) => api(`/api/agreement?t=${X.p.token}`, { method: "POST", headers: { "x-admin-key": "" }, body: JSON.stringify({ phone: "4165550100", talk: "T", bio: "word ".repeat(40), outline: "O", copyright: true, noInvestigation: true, termsAccepted: true, media: { photo: { internal: "yes", public: "yes" }, materials: { internal: "yes", public: "no" }, summary: { internal: "yes", public: "yes" } }, sensitive: "no", agreed: true, language: "en", first: X.p.first, last: "Test", email: X.p.email, organization: "Test Police", signature: `${X.p.first} Test`, hotel: "yes", hotelFrom: "2026-09-27", hotelTo: "2026-10-02", ...extra }) });
await sub(R, { expenses: { hotel: "no", meals: "no", other: "no", otherText: "" } });
await sub(O, { travel: "yes", travelFrom: "2026-09-27", travelTo: "2026-10-02", expenses: { transport: "no", hotel: "no", meals: "no", other: "no", otherText: "" } });
for (const [label, X] of [["RBH", R], ["ordinary", O]]) {
  const rbh = label === "RBH";
  const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const token = issueSession({ email: "treasurer@ongia.ca", name: "Raj Jaswal" });
  await page.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "treasurer@ongia.ca", name: "Raj Jaswal", owner: false, canCost: false }]);
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await page.waitForTimeout(1000);
  await page.locator(`[data-open="${X.e.id}"]`).first().evaluate((e) => e.click()); await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector("[data-review]").click());
  await page.waitForTimeout(1500);
  const t = await page.locator("body").innerText();
  ok(`review ${label}: shows the hotel`, /Hotel/.test(t));
  ok(`review ${label}: the Travel line is ${rbh ? "not shown" : "shown"}`, rbh ? !/^Travel$/m.test(t.replace(/\t/g, "\n")) && !/Travel & accommodation dates/.test(t) : /Travel/.test(t));
  ok(`review ${label}: the "ONGIA covers transportation" tick is ${rbh ? "not offered" : "offered"}`, (await page.locator('[data-cover="transport"]').count()) === (rbh ? 0 : 1));
  ok(`review ${label}: the other costs are offered`, (await page.locator('[data-cover="meals"]').count()) === 1 && (await page.locator('[data-cover="hotel"]').count() + await page.locator('#r-block, input[name="r-block"]').count()) >= 1);
  await page.screenshot({ path: D + `rbhreview-${label}.png`, fullPage: true });
  ok(`review ${label}: no page errors`, errs.length === 0, errs.join("|"));
  await page.close();
}
await b.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
