// "Add to hotel list": board members on the event with no room get a button that fills the by-hand form.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const OUT = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const mk = async (suffix) => (await api("/api/events", { method: "POST", body: JSON.stringify({ title: "Toronto Hotel Test " + suffix, city: "Toronto", venue: "Delta Hotels", dayOne: "2026-11-09", lastDay: "2026-11-12", invite: false,
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }, { name: "Jacqulyn Taylor", email: "vp_operations@ongia.ca" }, { name: "John Healy", email: "j.healy@ongia.ca" }],
  presenters: [{ first: "Dana", last: "Presenter", email: "dana@example.ca", organization: "Test Police" }] }) })).event;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1440, 900, "wide"], [390, 844, "phone"]]) {
  const ev = await mk(tag);
  const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 500 });
  await page.addInitScript(() => { try { sessionStorage.setItem("ongia-test-alltabs", "1"); } catch {} });   // every tab of the event page shown at once: this file tests the sections, evtabs-ui tests the tabs
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" });
  await page.fill('input[type="password"]', "testkey"); await page.keyboard.press("Enter"); await page.waitForTimeout(1200);
  await page.locator(`[data-open="${ev.id}"]`).first().evaluate((e) => e.click()); await page.waitForTimeout(1500);
  await page.evaluate(() => { const bar = document.querySelector(".bar"); if (bar) bar.style.position = "static"; });
  const pickDates = async () => {
    const opts = (id) => page.$$eval(`#${id} option`, (o) => o.map((x) => x.value).filter(Boolean));
    await page.selectOption("#rg-in", (await opts("rg-in")).find((v) => v >= "2026-11-08") ?? (await opts("rg-in"))[0]);
    const outs = await opts("rg-out"); await page.selectOption("#rg-out", outs.find((v) => v >= "2026-11-12") ?? outs.at(-1));
  };
  const fold = page.locator('details[data-fold="sec-hotel"]');
  if (!(await fold.evaluate((d) => d.open))) await fold.locator("summary").first().click();
  await page.waitForTimeout(300);
  const box = page.locator("#rg-noroom");
  ok(`${tag}: the box lists the three board members with no room`, await box.count() === 1 && await box.locator("[data-addboard]").count() === 3, await box.innerText().catch(() => "none"));
  ok(`${tag}: each has an "Add to hotel list" button`, (await box.locator("[data-addboard]").allInnerTexts()).every((t) => /Add to hotel list/.test(t)));
  await box.scrollIntoViewIfNeeded();
  await page.screenshot({ path: OUT + `hotelbtn-box-${tag}.png` });
  ok(`${tag}: nothing runs off the side`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await box.locator('[data-addboard="Jacqulyn Taylor"]').click(); await page.waitForTimeout(500);
  ok(`${tag}: the by-hand form opens`, await page.locator("#rg-details").evaluate((d) => d.open));
  ok(`${tag}: name and type are filled in`, (await page.inputValue("#rg-name")) === "Jacqulyn Taylor" && (await page.inputValue("#rg-type")) === "Board Member");
  ok(`${tag}: it is ONGIA's to pay, and locked`, (await page.inputValue("#rg-bill")) === "ONGIA" && await page.locator("#rg-bill").isDisabled() && await page.locator("#rg-boardnote").isVisible());
  ok(`${tag}: check-in has focus and the message says what to do`, await page.evaluate(() => document.activeElement?.id) === "rg-in" && /Jacqulyn Taylor's check-in/.test(await page.innerText("#rg-said")));
  await page.screenshot({ path: OUT + `hotelbtn-form-${tag}.png` });
  await page.click("#rg-add"); await page.waitForTimeout(800);
  ok(`${tag}: Add without dates is refused with a reason, and the name stays`, /date|check/i.test(await page.innerText("#rg-said")) && (await page.inputValue("#rg-name")) === "Jacqulyn Taylor", await page.innerText("#rg-said"));
  await pickDates();
  await page.click("#rg-add"); await page.waitForTimeout(1500);
  const st = await api(`/api/rooming?event=${ev.id}`);
  const row = st.rows.find((r) => /Jacqulyn/.test(r.name));
  ok(`${tag}: pressing Add puts her on the list as a Board Member paid by ONGIA`, row && row.type === "Board Member" && row.billing === "ONGIA", JSON.stringify(st.rows));
  const fold2 = page.locator('details[data-fold="sec-hotel"]');
  if (!(await fold2.evaluate((d) => d.open))) await fold2.locator("summary").first().click();
  ok(`${tag}: she leaves the box and the other two stay`, await page.locator('[data-addboard="Jacqulyn Taylor"]').count() === 0 && await page.locator("[data-addboard]").count() === 2);
  // Everyone on the list: the box goes away.
  for (const n of ["Andrew Hammond", "John Healy"]) {
    await page.locator(`[data-addboard="${n}"]`).click(); await page.waitForTimeout(300);
    await pickDates();
    await page.click("#rg-add"); await page.waitForTimeout(1500);
    const f = page.locator('details[data-fold="sec-hotel"]'); if (!(await f.evaluate((d) => d.open))) await f.locator("summary").first().click();
  }
  ok(`${tag}: once everyone has a room the box is gone`, await page.locator("#rg-noroom").count() === 0);
  ok(`${tag}: three board rooms on the list`, (await api(`/api/rooming?event=${ev.id}`)).rows.filter((r) => r.type === "Board Member").length === 3);
  ok(`${tag}: no page errors`, errs.length === 0, errs.join("|"));
  await page.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
