// The desk's Volunteers section, on a desktop and on a phone: add, send, copy, correct, remove, PDF.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const OUT = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: "National Gang Summit: Organized Crime, Gangs & Youth: Building Solutions for a Safer Future", city: "Toronto",
  venue: "Delta Hotels Toronto Airport & Conference Centre", dayOne: "2026-11-09", lastDay: "2026-11-12", board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }], invite: false,
  presenters: [{ first: "Dana", last: "Presenter", email: "dana@example.ca", organization: "Test Police" }] }) })).event;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

for (const [w, h, tag] of [[1440, 900, "wide"], [390, 844, "phone"]]) {
  const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 500 });
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  page.on("dialog", (d) => d.accept());
  await page.addInitScript(() => { window.open = (u) => { window.__opened = u; return null; }; });
  await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" });
  await page.fill('input[type="password"]', "testkey"); await page.keyboard.press("Enter"); await page.waitForTimeout(1200);
  await page.locator(`[data-open="${ev.id}"]`).first().evaluate((e) => e.click()); await page.waitForTimeout(1200);
  await page.evaluate(() => { const bar = document.querySelector(".bar"); if (bar) bar.style.position = "static"; });
  const fold = page.locator('details[data-fold="sec-volunteers"]');
  ok(`${tag}: a Volunteers section sits on the event page, with its line`, await fold.count() === 1 && /Volunteers sign the ONGIA Volunteer Terms|volunteer/.test(await fold.locator("summary").innerText()));
  if (!(await fold.evaluate((d) => d.open))) await fold.locator("summary").click();
  await page.waitForTimeout(300);
  ok(`${tag}: empty, it says what to do`, /No volunteers yet/.test(await fold.innerText()));

  // Add three, one of them with a mistake.
  await page.click("#v-add"); await page.waitForTimeout(300);
  await page.fill("#va-rows", "Vera, Volunteer, vera@" + tag + ".example.ca, Peel Regional Police\nMarc, Thibault, m.thibault@" + tag + ".example.ca, SPVM\nBad, Address, not-an-email, Nowhere");
  await page.screenshot({ path: OUT + `desk-add-${tag}.png` });
  await page.click("#va-go"); await page.waitForSelector("#va-out .note, #va-out .bad", { timeout: 8000 });
  let out = await page.innerText("#va-out");
  ok(`${tag}: two are added, one is turned away with the reason, and it stays in the box to fix`, /2 added/.test(out) && /not an email address/.test(out) && (await page.inputValue("#va-rows")).trim() === "Bad, Address, not-an-email, Nowhere", out + " | " + await page.inputValue("#va-rows"));
  ok(`${tag}: no mail here, so it says they were not emailed and where to go next`, /Not emailed/.test(out) && /Email link/.test(out));
  await page.screenshot({ path: OUT + `desk-add-result-${tag}.png` });
  await page.click("#va-close");
  const rows = page.locator('details[data-fold="sec-volunteers"] .trow');
  await rows.first().waitFor({ timeout: 8000 }); await page.waitForTimeout(400);
  ok(`${tag}: the two appear, never sent, each with Email link / Copy link / Edit`, await rows.count() === 2 && /never sent/i.test(await rows.nth(0).innerText()) && await rows.nth(0).locator("[data-vinvite]").count() === 1 && await rows.nth(0).locator("[data-vcopy]").count() === 1 && await rows.nth(0).locator("[data-vedit]").count() === 1);
  ok(`${tag}: the badge and line count them`, /never sent/.test(await fold.locator("summary").innerText()) && /2 volunteers/.test(await fold.locator("summary").innerText()), await fold.locator("summary").innerText());
  ok(`${tag}: the failed send is kept in a red box`, /could not be sent/.test(await fold.innerText()));

  // Presenters were not touched.
  ok(`${tag}: the presenter list still has just Dana, and no volunteer is among them`, (await page.locator('details[data-fold="sec-presenters"] .trow').count()) === 1);

  // The volunteer lead: picked from the board, saved at once, and it can be put back.
  ok(`${tag}: a Volunteer lead picker sits at the top, defaulting to the event lead`, await page.locator("#v-lead").count() === 1 && /Same as the event lead \(Andrew Hammond\)/.test(await page.locator("#v-lead option:checked").innerText()));
  ok(`${tag}: it offers the event's board first, then the other board members`, (await page.$$eval("#v-lead optgroup", (g) => g.map((x) => x.label))).join("|") === "On this event|Other board members");
  await page.selectOption("#v-lead", "j.healy@ongia.ca"); await page.waitForTimeout(1200);
  ok(`${tag}: picking John Healy is saved on the event`, (await api(`/api/volunteers?event=${ev.id}`)).lead?.email === "j.healy@ongia.ca");
  ok(`${tag}: and the page says who volunteers now hear from`, /Volunteers hear from\s*John Healy/.test(await page.locator('details[data-fold="sec-volunteers"]').innerText()) && /John Healy/.test(await page.locator("#v-lead option:checked").innerText()));
  await page.screenshot({ path: OUT + `desk-lead-${tag}.png`, fullPage: false });
  await page.selectOption("#v-lead", ""); await page.waitForTimeout(1200);
  ok(`${tag}: choosing the first option puts the event lead back`, (await api(`/api/volunteers?event=${ev.id}`)).lead === null);

  // The buttons on a row line up, and nothing runs off the side.
  const boxes = await rows.evaluateAll((els) => els.map((e) => { const a = e.querySelector(".pact").getBoundingClientRect(); return { x: Math.round(a.left), w: Math.round(a.width) }; }));
  ok(`${tag}: both rows' button blocks start and end in the same place`, boxes.length === 2 && boxes[0].x === boxes[1].x && boxes[0].w === boxes[1].w, JSON.stringify(boxes));
  ok(`${tag}: nothing runs off the side`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await fold.scrollIntoViewIfNeeded();
  await page.screenshot({ path: OUT + `desk-list-${tag}.png`, fullPage: true });

  // Copy link, email link (fails here), edit, PDF for a signed one, remove.
  await rows.nth(0).locator("[data-vcopy]").click(); await page.waitForTimeout(200);
  ok(`${tag}: Copy link puts their own /v/ link on the clipboard`, /^http:\/\/127\.0\.0\.1:8788\/v\/[a-z0-9]{24}$/.test(await page.evaluate(() => navigator.clipboard.readText())) && /Copied/.test(await rows.nth(0).locator("[data-vcopy]").innerText()));
  await rows.nth(0).locator("[data-vinvite]").click(); await page.waitForTimeout(1200);
  ok(`${tag}: Email link with no mail set up says so rather than pretending`, /could not be sent|transport|configured/i.test(await page.locator("body").innerText()));

  const vols = (await api(`/api/volunteers?event=${ev.id}`)).volunteers;
  const vera = vols.find((v) => v.first === "Vera");
  await rows.nth(0).locator("[data-vedit]").click(); await page.waitForTimeout(300);
  await page.fill("#ve-org", "Peel Regional Police Service"); await page.click("#ve-save"); await page.waitForTimeout(1000);
  ok(`${tag}: a correction is saved`, (await api(`/api/volunteers?event=${ev.id}`)).volunteers.find((v) => v.id === vera.id).organization === "Peel Regional Police Service");

  // Sign Vera's agreement from her own link, as a volunteer would, then see it on the desk.
  const sign = await fetch(`${S}/api/volunteer?t=${vera.token}`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ first: "Vera", last: "Volunteer", email: vera.email, phone: "4165550123", organization: "Peel Regional Police Service", accommodation: "no", termsAccepted: true, standing: true, signature: "Vera Volunteer", agreed: true, language: "en" }) });
  ok(`${tag}: she signs from her own link`, sign.status === 200);
  await page.goto(S + "/admin.html#event/" + ev.id, { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
  const f2 = page.locator('details[data-fold="sec-volunteers"]'); if (!(await f2.evaluate((d) => d.open))) await f2.locator("summary").click();
  const row0 = page.locator('details[data-fold="sec-volunteers"] .trow').nth(0);
  ok(`${tag}: her row says Signed, and the filing problem shows because there is no SharePoint here`, /signed/i.test(await row0.innerText()) && /not filed/i.test(await row0.innerText()) && await row0.locator("[data-vrefile]").count() === 1, await row0.innerText());
  ok(`${tag}: a signed row offers PDF and Retry filing`, await row0.locator("[data-vpdf]").count() === 1);
  ok(`${tag}: the line counts her as signed`, /1 signed/.test(await f2.locator("summary").innerText()));
  await row0.locator("[data-vpdf]").click(); await page.waitForTimeout(700);
  ok(`${tag}: PDF opens the signed copy`, /^blob:/.test(await page.evaluate(() => window.__opened ?? "")));
  await row0.locator("[data-vrefile]").click(); await page.waitForTimeout(900);
  ok(`${tag}: Retry filing reports the real reason`, /Still not filed.*Microsoft credentials/.test(await page.locator(".toast").first().innerText().catch(() => "")));
  await page.screenshot({ path: OUT + `desk-signed-${tag}.png`, fullPage: true });

  // Two volunteers who need a hotel room: they wait for a board member to choose their nights.
  await api(`/api/volunteers?event=${ev.id}`, { method: "POST", body: JSON.stringify({ invite: false, volunteers: [
    { first: "Hana", last: "Hotel", email: `hana@${tag}.example.ca`, organization: "OPP" }, { first: "Zed", last: "Zero", email: `zed@${tag}.example.ca`, organization: "OPP" }] }) });
  for (const v of (await api(`/api/volunteers?event=${ev.id}`)).volunteers.filter((x) => ["Hana", "Zed"].includes(x.first))) {
    await fetch(`${S}/api/volunteer?t=${v.token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ first: v.first, last: v.last, email: v.email, phone: "4165550188", organization: "OPP", accommodation: "yes", termsAccepted: true, standing: true, signature: `${v.first} ${v.last}`, agreed: true, language: "en" }) });
  }
  await page.goto(S + "/admin.html#event/" + ev.id, { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
  const f3 = page.locator('details[data-fold="sec-volunteers"]'); if (!(await f3.evaluate((d) => d.open))) await f3.locator("summary").click();
  ok(`${tag}: two volunteers are waiting: a Needs review pill, a Review button, and a count in the heading`, (await f3.locator('.trow:has-text("Needs review")').count()) === 2 && (await f3.locator("[data-vreview]").count()) === 2 && /2 to review/.test(await f3.locator("summary").innerText()));
  const hrow = f3.locator('.trow', { hasText: "Hana Hotel" });
  await hrow.locator("[data-vreview]").click(); await page.waitForTimeout(300);
  ok(`${tag}: Review opens a sheet, and Approve is off to begin with`, await page.isVisible("#vreview") && await page.isDisabled("#vr-go"));
  await page.fill("#vr-name", "Raj Jaswal"); await page.waitForTimeout(100);
  ok(`${tag}: a name alone is not enough: a hotel choice is still needed`, await page.isDisabled("#vr-go"));
  await page.click('#vr-need [data-need="yes"]'); await page.waitForTimeout(150);
  ok(`${tag}: choosing 'Add hotel nights' shows check-in and check-out, and Approve is still off until both are picked`, await page.isVisible("#vr-in") && await page.isVisible("#vr-out") && await page.isDisabled("#vr-go"));
  await page.selectOption("#vr-in", "2026-11-08"); await page.selectOption("#vr-out", "2026-11-13"); await page.waitForTimeout(150);
  ok(`${tag}: with both dates Approve wakes, and the sheet says how many nights`, !(await page.isDisabled("#vr-go")) && /5 night\(s\)/.test(await page.innerText("#vr-sum")));
  await page.selectOption("#vr-out", "2026-11-07"); await page.waitForTimeout(100).catch(() => {});
  await page.screenshot({ path: OUT + `desk-review-${tag}.png` });
  await page.selectOption("#vr-out", "2026-11-13"); await page.waitForTimeout(100);
  await page.click("#vr-go"); await page.waitForTimeout(1500);
  const hv2 = (await api(`/api/volunteers?event=${ev.id}`)).volunteers.find((x) => x.first === "Hana");
  ok(`${tag}: approved: final, with the nights and the board member's name`, hv2.status === "signed" && hv2.review.hotel.from === "2026-11-08" && hv2.review.hotel.to === "2026-11-13" && hv2.review.approver.name === "Raj Jaswal");
  const hotel = page.locator('details[data-fold="sec-hotel"]'); if (!(await hotel.evaluate((d) => d.open))) await hotel.locator("> summary").click();
  const hr = hotel.locator(".room", { hasText: "Hana Hotel" });
  ok(`${tag}: her nights are on the Hotel rooms list as a Volunteer, 5 nights, ONGIA pays`, await hr.count() === 1 && /Volunteer/.test(await hr.innerText()) && /5 nights/.test(await hr.innerText()) && /ONGIA pays/i.test(await hr.innerText()), await hotel.innerText());
  ok(`${tag}: and her row there has no presenter-style Edit button`, (await hr.locator(".gedit").count()) === 0);
  await page.screenshot({ path: OUT + `desk-hotel-list-${tag}.png`, fullPage: false });
  const zrow = page.locator('details[data-fold="sec-volunteers"] .trow', { hasText: "Zed Zero" });
  await zrow.locator("[data-vreview]").click(); await page.waitForTimeout(300);
  await page.fill("#vr-name", "Raj Jaswal"); await page.click('#vr-need [data-need="no"]'); await page.waitForTimeout(150);
  ok(`${tag}: 'No room needed' needs no dates: Approve wakes`, !(await page.isDisabled("#vr-go")) && !(await page.isVisible("#vr-in")));
  await page.click("#vr-go"); await page.waitForTimeout(1500);
  const zv = (await api(`/api/volunteers?event=${ev.id}`)).volunteers.find((x) => x.first === "Zed");
  ok(`${tag}: he is final with no nights, and nothing was added to the hotel list for him`, zv.status === "signed" && zv.review.hotel === null && !(await api(`/api/rooming?event=${ev.id}`)).rows.some((x) => /Zed/.test(x.name)));
  ok(`${tag}: nothing runs off the side`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  // Remove the other one: reason, then DELETE.
  const row1 = page.locator('details[data-fold="sec-volunteers"] .trow').nth(1);
  await row1.locator("[data-vedit]").click(); await page.waitForTimeout(300);
  await page.click("#ve-remove"); await page.waitForTimeout(300);
  ok(`${tag}: removing is two steps: the button is off until DELETE is typed`, await page.isDisabled("#vrm-go"));
  await page.fill("#vrm-why", "No longer available");
  await page.fill("#vrm-confirm", "delete"); await page.waitForTimeout(150);
  ok(`${tag}: typing DELETE wakes it`, !(await page.isDisabled("#vrm-go")));
  await page.screenshot({ path: OUT + `desk-remove-${tag}.png` });
  await page.click("#vrm-go"); await page.waitForTimeout(1000);
  const left = (await api(`/api/volunteers?event=${ev.id}`)).volunteers;
  ok(`${tag}: removed, and Vera is still there`, left.some((v) => v.first === "Vera") && !left.some((v) => v.first === "Marc"));
  ok(`${tag}: the event keeps the reason`, /No longer available/.test(JSON.stringify((await api(`/api/events?id=${ev.id}`)).event.removedPresenters)));
  const st = page.locator("#evsettings"); await st.locator("summary").click().catch(() => {}); await page.waitForTimeout(200);
  ok(`${tag}: Event settings lists them as a removed volunteer, with the reason`, /volunteer/.test(await page.locator("#evsettings").innerText()) && /No longer available/.test(await page.locator("#evsettings").innerText()));
  ok(`${tag}: no script errors`, errs.length === 0, errs.join("; "));
  // Clean up so the second pass starts fresh.
  for (const v of (await api(`/api/volunteers?event=${ev.id}`)).volunteers) await api(`/api/volunteers?event=${ev.id}&id=${v.id}&final=1`, { method: "DELETE", body: JSON.stringify({ reason: "test" }) });
  await page.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
