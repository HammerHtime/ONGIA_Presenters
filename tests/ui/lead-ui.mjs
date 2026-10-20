// What an RBH event looks like to its lead, and to the president.
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
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: "Lead View RBH", city: "Montreal", venue: "V", dayOne: "2026-09-28", lastDay: "2026-10-02", invite: false, kind: "rbh", province: "QC", invoicePrefix: "ITP",
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], presenters: [],
  hotel: { name: "Humaniti Hotel", rate: "$205 + tax", contact: "groups@humaniti.example", cutoff: "2026-08-28", foodAndBev: "2026-09-10", notes: "Attrition 80%" } }) })).event;
await api(`/api/sow?event=${ev.id}&create=1`, { method: "POST", body: JSON.stringify({ from: "standard" }) });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const as = async (email, name) => {
  const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const token = issueSession({ email, name });
  await page.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch { /* a sandboxed frame has no storage */ } },
    [token, { email, name, owner: false, canCost: ["president@ongia.ca", "vp_operations@ongia.ca"].includes(email) }]);
  page.on("dialog", (d) => d.accept());
  await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
  return page;
};
for (const [email, name, isLead] of [["treasurer@ongia.ca", "Raj Jaswal", true], ["president@ongia.ca", "Andrew Hammond", false]]) {
  const tag = isLead ? "lead" : "president";
  const page = await as(email, name);
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.locator(`[data-open="${ev.id}"]`).first().evaluate((e) => e.click()); await page.waitForTimeout(1500);
  const body = await page.locator("body").innerText();
  ok(`${tag}: the page loads`, /Lead View RBH/.test(body), body.slice(0, 200));
  ok(`${tag}: the statement of work section is ${isLead ? "not there" : "there"}`, (await page.locator("#sowcard").count()) === (isLead ? 0 : 1));
  const fold = page.locator('details[data-fold="sec-hotel"]'); if (!(await fold.evaluate((d) => d.open))) await fold.locator("summary").first().click();
  const strip = page.locator(".hstrip");
  ok(`${tag}: the hotel strip shows the hotel and its dates`, /Humaniti Hotel/.test(await strip.innerText()) && /cut-off/.test(await strip.innerText()));
  ok(`${tag}: the contract button is ${isLead ? "gone" : "there"}`, (await strip.locator('[data-hgo="contract"]').count()) === (isLead ? 0 : 1));
  ok(`${tag}: "Edit hotel details" is there`, (await strip.locator('[data-hgo="hotel"]').count()) === 1);
  if (isLead) ok(`lead: nothing on the page says the rate`, !/\$205/.test(await page.locator("body").innerText()));
  await page.screenshot({ path: D + `lead-${tag}-event.png` });
  await strip.locator('[data-hgo="hotel"]').click(); await page.waitForTimeout(1500);
  const det = page.locator("details", { hasText: "Hotel and room block" }).first();
  ok(`${tag}: the form's rate box is ${isLead ? "not shown" : "shown"}`, (await page.locator('#e-hrate').evaluate((e) => e.type)) === (isLead ? "hidden" : "text"));
  ok(`${tag}: the contract box is ${isLead ? "replaced by a note" : "there"}`, isLead ? /kept by the president and the VP/.test(await page.locator("body").innerText()) && (await page.locator(".ctbox").count()) === 0 : (await page.locator(".ctbox").count()) === 1);
  ok(`${tag}: the RBH event settings are ${isLead ? "not offered" : "offered"}`, (await page.locator("#e-rbh").count()) === (isLead ? 0 : 1));
  ok(`${tag}: the hotel name, contact, link and dates are editable`, await page.locator("#e-hotel").isVisible() && await page.locator("#e-hcontact").isVisible() && await page.locator("#e-hcut").isVisible());
  if (isLead) {
    await page.fill("#e-hotel", "Humaniti Hotel Montreal");
    await page.click("#create"); await page.waitForTimeout(2500);
    const after = (await api(`/api/events?id=${ev.id}`)).event;
    ok("lead: saving keeps the rate, the notes and the RBH kind untouched", after.hotel.name === "Humaniti Hotel Montreal" && after.hotel.rate === "$205 + tax" && after.hotel.notes === "Attrition 80%" && after.kind === "rbh" && after.province === "QC", JSON.stringify([after.hotel, after.kind]));
  }
  ok(`${tag}: no page errors`, errs.length === 0, errs.join("|"));
  await page.close();
}
await b.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
