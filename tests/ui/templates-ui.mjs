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
const mk = async (title, city, province) => (await api("/api/events", { method: "POST", body: JSON.stringify({ title, city, venue: "Victoria Marriott Inner Harbour", dayOne: "2026-12-09", lastDay: "2026-12-09", invite: false, kind: "rbh", province, invoicePrefix: "CFAOC", board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], presenters: [] }) })).event;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (ev, vp) => {
  const page = await b.newPage({ viewport: vp, deviceScaleFactor: 2 });
  await page.addInitScript(() => { try { sessionStorage.setItem("ongia-test-alltabs", "1"); } catch {} });   // every tab of the event page shown at once: this file tests the sections, evtabs-ui tests the tabs
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await page.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true, canCost: true }]);
  page.errs = []; page.on("pageerror", (e) => page.errs.push(String(e)));
  await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await page.waitForTimeout(1000);
  await page.locator(`[data-open="${ev.id}"]`).first().evaluate((e) => e.click()); await page.waitForTimeout(1500);
  const f = page.locator('details[data-fold="sec-sow"]'); if (!(await f.evaluate((d) => d.open))) await f.locator("summary").first().click(); await page.waitForTimeout(300);
  return page;
};
for (const [w, h, tag] of [[1440, 1000, "wide"], [390, 844, "phone"]]) {
  console.log(`— ${tag}`);
const vic = await mk("Canadian Forum Against Organized Crime", "Victoria", "BC");
  const cal = await mk("CFAOC Calgary", "Calgary", "AB");
  const ord = await mk("ITP Training", "Montreal", "QC"); await api(`/api/events?id=${ord.id}&rbh=1`, { method: "PUT", body: JSON.stringify({ kind: "rbh", province: "QC", invoicePrefix: "ITP" }) });
  let p = await open(vic, { width: w, height: h });
  ok(`${tag}: in Victoria the Victoria forum template is offered and already picked`, (await p.locator('input[name="sw-from"][value="cfaoc-victoria"]').isChecked()) && /rebranding/i.test(await p.locator("#sowcard").textContent()));
  ok(`${tag}: the generic forum template and the standard lines are offered too`, (await p.locator('input[name="sw-from"][value="cfaoc"]').count()) === 1 && (await p.locator('input[name="sw-from"][value="standard"]').count()) === 1);
  await p.screenshot({ path: D + `tpl-start-${tag}.png` });
  ok(`${tag}: the notice says British Columbia's tax`, /British Columbia/.test(await p.locator("#sowcard").innerText()));
  if (tag === "wide") {
    await p.click("#sw-start"); await p.waitForTimeout(2000);
    const f = p.locator('details[data-fold="sec-sow"]'); if (!(await f.evaluate((d) => d.open))) await f.locator("summary").first().click(); await p.waitForTimeout(300);
    const names = await p.locator("#sw-table .ln-name").evaluateAll((els) => els.map((e) => e.value));
    ok("started: the ten lines are in the editor, Rebranding / Signage among them", names.length === 10 && names.includes("Rebranding / Signage"), names.join("|"));
    const vals = await p.locator("#sw-table .ln-est").evaluateAll((els) => els.map((e) => e.value));
    ok("the estimates show as dollars", vals.includes("$17,550.00") && vals.includes("$6,000.00") && vals.includes("$4,000.00"), vals.join("|"));
    ok("the totals show $57,950.00 and the fee $11,590.00", /\$57,950\.00/.test(await p.locator("#sw-sums").innerText()) && /\$11,590\.00/.test(await p.locator("#sw-sums").innerText()));
    ok("the note shows 'Based on approx. 70 people'", (await p.locator("#sw-note").inputValue()) === "Based on approx. 70 people");
    await p.screenshot({ path: D + "tpl-victoria-editor.png", fullPage: true });
  }
  ok(`${tag}: no page errors`, p.errs.length === 0, p.errs.join("|"));
  await p.close();
  p = await open(cal, { width: w, height: h });
  ok(`${tag}: a forum in another city is offered the generic forum template and not the Victoria one`, (await p.locator('input[name="sw-from"][value="cfaoc"]').isChecked()) && (await p.locator('input[name="sw-from"][value="cfaoc-victoria"]').count()) === 0);
  await p.close();
  p = await open(ord, { width: w, height: h });
  ok(`${tag}: an ITP event still starts from the standard lines`, await p.locator('input[name="sw-from"][value="standard"]').isChecked());
  await p.close();
}
await b.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
