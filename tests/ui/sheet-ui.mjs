const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const D = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const base = { phone: "4165550100", talk: "T", bio: "word ".repeat(40), outline: "An outline.", travel: "no", copyright: true, noInvestigation: true, termsAccepted: true,
  media: { photo: { internal: "yes", public: "yes" }, materials: { internal: "yes", public: "no" }, summary: { internal: "yes", public: "yes" }, bio: { internal: "yes", public: "yes" } }, sensitive: "no", agreed: true, language: "en" };
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1440, 900, "wide"], [390, 844, "phone"]]) {
  const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: "Sheet UI " + tag, city: "Toronto", venue: "V", dayOne: "2026-11-09", lastDay: "2026-11-12", invite: false,
    board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }],
    presenters: [["Dana", "Testwood"], ["Kelly", "Samplestne"], ["Avery", "Placeholdar"], ["Newcomer", "Nosheet"], ["Late", "Signer"]].map(([f, l]) => ({ first: f, last: l, email: `${f.toLowerCase()}${tag}@example.ca`, organization: "Org " + f })) }) })).event;
  await api(`/api/sheetcheck?event=${ev.id}&enable=1`, { method: "PUT" });   // the check is off until an event has a sheet
  const ps = (await api(`/api/events?id=${ev.id}`)).presenters;
  const submit = async (first, hotel, from, to, agency, block) => {
    const p = ps.find((x) => x.first === first);
    await fetch(`${S}/api/agreement?t=${p.token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...base, first, last: p.last, email: p.email, organization: p.organization, signature: `${first} ${p.last}`, hotel,
      ...(hotel === "yes" ? { hotelFrom: from, hotelTo: to } : {}), expenses: { transport: "no", hotel: hotel === "yes" ? agency : "n/a", meals: "no", other: "no", otherText: "" } }) });
    if (block !== undefined) await api(`/api/review?event=${ev.id}&presenter=${p.id}&action=approve`, { method: "POST", body: JSON.stringify({ approverName: "Raj Jaswal", attest: true, covers: {}, ...(block ? { hotelBlock: block } : {}) }) });
    return p;
  };
  await submit("Dana", "yes", "2026-11-08", "2026-11-13", "yes", "own");        // sheet is missing Wed and Thu
  await submit("Kelly", "yes", "2026-11-08", "2026-11-12", "yes", "master");    // sheet says agency paying
  await submit("Avery", "yes", "2026-11-08", "2026-11-12", "no", "master");    // matches
  await submit("Newcomer", "no", null, null, null, "");                        // not on the sheet

  const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 500 });

  await page.addInitScript(() => { try { sessionStorage.setItem("ongia-test-alltabs", "1"); } catch {} });   // every tab of the event page shown at once: this file tests the sections, evtabs-ui tests the tabs
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  let sent = ""; page.on("request", (r) => { if (/sheetcheck/.test(r.url()) && r.method() === "PUT") sent += r.postData() ?? ""; });
  await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" });
  await page.fill('input[type="password"]', "testkey"); await page.keyboard.press("Enter"); await page.waitForTimeout(1200);
  await page.goto(`${S}/admin.html#event/${ev.id}`, { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
  const fold = page.locator('details[data-fold="sec-sheet"]');
  ok(`${tag}: the Logistics sheet check section is on the event page, for the president`, await fold.count() === 1 && /Logistics sheet check/.test(await fold.locator("summary").first().innerText()));
  if (!(await fold.evaluate((d) => d.open))) await fold.locator("summary").first().click();
  ok(`${tag}: before an upload it explains where to get the original copy`, /Version history/.test(await fold.innerText()) && /never changes the spreadsheet/.test(await fold.innerText()));
  await page.setInputFiles("#sh-file", D + "test-sheet.xlsx"); await page.waitForTimeout(2500);
  ok(`${tag}: the workbook was read in the browser and the comparison is shown`, /Baseline:/.test(await fold.innerText()) && /test-sheet\.xlsx/.test(await fold.innerText()), (await fold.innerText()).slice(0, 300));
  ok(`${tag}: the other tab with the sensitive notes never left the browser`, !sent.includes("Should Never Leave") && !sent.includes("operationally sensitive") && sent.includes("A/S/Sgt Dana Testwood"), sent.slice(0, 200));
  const text = await fold.innerText();
  const danaCard = fold.locator(".shc", { hasText: "Dana Testwood" }).first();
  ok(`${tag}: Dana has five night boxes, the date above each`, await danaCard.locator(".nb").count() === 5 && /Wed\s*Nov 11/.test(await danaCard.locator(".nb").nth(3).locator(".dt").innerText()), await danaCard.innerText());
  ok(`${tag}: Dana: Sun, Mon, Tue green; Wed and Thu red, saying the agreement has them and the sheet doesn't`,
    (await danaCard.locator(".box.ok").count()) === 3 && (await danaCard.locator(".box.miss").count()) === 2 && /agreement yes\s*sheet no/i.test(await danaCard.locator(".box.miss").first().innerText()), await danaCard.innerText());
  ok(`${tag}: Dana's card says Differs, with no long sentence about nights`, /Differs/.test(await danaCard.innerText()) && !/missing Wed/.test(await danaCard.innerText()));
  const kevinCard = fold.locator(".shc", { hasText: "Kelly Samplestne" }).first();
  ok(`${tag}: Kelly's nights are all green, and a red line says who pays: agreement master block, sheet agency paying`, (await kevinCard.locator(".box.ok").count()) === 4 && (await kevinCard.locator(".payline.flag").count()) === 1 && /ONGIA \(master block\)/.test(await kevinCard.locator(".payline").innerText()) && /agency is paying/.test(await kevinCard.locator(".payline").innerText()), await kevinCard.innerText());
  const angelaCard = fold.locator(".shc", { hasText: "Avery Placeholdar" }).first();
  ok(`${tag}: Avery matches: four green boxes, a dash for Thursday, and the Matches chip`, (await angelaCard.locator(".box.ok").count()) === 4 && (await angelaCard.locator(".box.none").count()) === 1 && /Matches/.test(await angelaCard.textContent()));
  ok(`${tag}: the legend explains the colours`, (await fold.locator(".shlegend .box").count()) === 4 && /agreement has it, sheet doesn't/.test(await fold.locator(".shlegend").innerText()));
  const chips = await page.locator(".shchips").innerText();
  ok(`${tag}: the counts read 2 differ, 1 match, 1 not on the sheet, 1 haven't signed`, /2\s*differ/.test(chips) && /1\s*match/.test(chips) && /1\s*not on the sheet/.test(chips) && /1\s*haven't signed/.test(chips), chips);
  ok(`${tag}: the closed line carries the count`, /2 differ/.test(await fold.locator("summary").first().innerText()));
  const banner = fold.locator(".shcost");
  ok(`${tag}: a dollar figure sits at the very top, labelled as the total for all presenters`, await banner.count() === 1 && /\$\d/.test(await banner.locator(".big").first().innerText()) && /total, all presenters/.test(await banner.innerText()));
  ok(`${tag}: beside it, the number of discrepancies found and the presenters they are in`, /^\d+$/.test((await banner.locator(".big").nth(1).innerText()).trim()) && /discrepanc(y|ies) in \d+ presenters?/.test(await banner.innerText()), await banner.innerText());
  ok(`${tag}: it explains the formula: $205 + 8% + 16% = $254.20 a night`, /\$205\.00 \+ 8% \+ 16% = \$254\.20/.test(await banner.innerText()), await banner.innerText());
  ok(`${tag}: the formula shows even when the figure is $0`, /\$0\.00/.test(await banner.locator(".big").first().innerText()) && /Nothing so far/.test(await banner.innerText()));
  ok(`${tag}: Dana's two missing nights and Kelly's pay mismatch make 3 discrepancies in 2 presenters`, (await banner.locator(".big").nth(1).innerText()).trim() === "3" && /in 2 presenters/.test(await banner.innerText()), await banner.innerText());
  ok(`${tag}: the sheet-only row is listed`, /Sheetonly Presenter/.test(await page.locator("body").innerText()));
  await fold.locator(".shc").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: D + `sheet-${tag}.png` });
  await page.locator('details[data-fold="sec-sheet"] .shlegend').scrollIntoViewIfNeeded();
  await page.screenshot({ path: D + `sheet-top-${tag}.png` });
  ok(`${tag}: nothing runs off the side`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  // link a nosheet presenter by hand
  const nos = page.locator(".shc.nosheet", { hasText: "Newcomer" });
  await nos.locator("[data-shlink-pick]").selectOption("Sheetonly Presenter");
  await nos.locator("[data-shlink]").click(); await page.waitForTimeout(1500);
  const newCard = page.locator(".shc", { hasText: "Newcomer Nosheet" }).first();
  ok(`${tag}: linking Newcomer to a sheet row by hand: the sheet's two nights show orange, 'sheet yes, agreement no'`, (await newCard.locator(".box.extra").count()) === 2 && /sheet yes\s*agreement no/i.test(await newCard.locator(".box.extra").first().innerText()) && /\(by you\)/.test(await newCard.innerText()), await newCard.innerText());
  const b2 = page.locator('details[data-fold="sec-sheet"] .shcost');
  ok(`${tag}: after the link, the sheet's two extra nights cost ONGIA 2 x $254.20 = $508.40, and there are 5 discrepancies in 3 presenters`, /\$508\.40/.test(await b2.locator(".big").first().innerText()) && (await b2.locator(".big").nth(1).innerText()).trim() === "5" && /in 3 presenters/.test(await b2.innerText()), await b2.innerText());
  ok(`${tag}: the closed line carries the dollars too`, /\$508\.40 extra/.test(await page.locator('details[data-fold="sec-sheet"] summary').first().innerText()), await page.locator('details[data-fold="sec-sheet"] summary').first().innerText());
  await page.locator('details[data-fold="sec-sheet"] .rates summary').click();
  await page.fill("#rt-n", "300"); await page.fill("#rt-a", "10"); await page.fill("#rt-b", "10"); await page.click("#rt-save"); await page.waitForTimeout(1500);
  const f3 = page.locator('details[data-fold="sec-sheet"]'); if (!(await f3.evaluate((d) => d.open))) await f3.locator("summary").first().click();
  ok(`${tag}: changing the rate to $300 + 10% + 10% = $360 makes it $720.00`, /\$720\.00/.test(await f3.locator(".shcost .big").first().innerText()) && /\$360\.00/.test(await f3.locator(".shcost").innerText()), await f3.locator(".shcost").innerText());
  await f3.locator(".shcost").scrollIntoViewIfNeeded(); await page.screenshot({ path: D + `sheet-banner-${tag}.png` });
  await page.locator('details[data-fold="sec-sheet"] .rates summary').click();
  await page.fill("#rt-n", "205"); await page.fill("#rt-a", "8"); await page.fill("#rt-b", "16"); await page.click("#rt-save"); await page.waitForTimeout(1500);
  // a new submission arrives and shows up with no one doing anything
  await submit("Late", "yes", "2026-11-09", "2026-11-12", "no", undefined);
  await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
  await page.locator(`[data-open="${ev.id}"]`).first().evaluate((e) => e.click()); await page.waitForTimeout(1500);
  const f2 = page.locator('details[data-fold="sec-sheet"]'); if (!(await f2.evaluate((d) => d.open))) await f2.locator("summary").first().click();
  ok(`${tag}: a presenter who submits later appears at once, as not on the sheet`, /Late Signer/.test(await f2.innerText()) && (await f2.locator(".shc", { hasText: "Late Signer" }).first().locator(".box.only").count()) === 3 && /Not on the sheet/.test(await f2.locator(".shc", { hasText: "Late Signer" }).first().innerText()));
  ok(`${tag}: no page errors`, errs.length === 0, errs.join("|"));
  await page.close();
}
await b.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
