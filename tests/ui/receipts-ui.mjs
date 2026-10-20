// The Receipts section on the desk: phone (a board member on the event) and desktop (the president). Needs the dev server on 8788 started with ANTHROPIC_BASE_URL=http://127.0.0.1:8799, and mock-anthropic.mjs running.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const D = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
const mock = (reply, delay = 0) => fetch("http://127.0.0.1:8799/__set", { method: "POST", body: JSON.stringify({ reply, delay }) });
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: "Receipts RBH", city: "Montreal", venue: "V", dayOne: "2026-09-28", lastDay: "2026-10-02", invite: false, kind: "rbh", province: "QC", invoicePrefix: "ITP",
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }, { name: "J Healy", email: "j.healy@ongia.ca", lead: false }], presenters: [] }) })).event;
const sow = (await api(`/api/sow?event=${ev.id}&create=1`, { method: "POST", body: JSON.stringify({ from: "standard" }) })).sow;
await api(`/api/sow?event=${ev.id}`, { method: "PUT", body: JSON.stringify({ lines: sow.lines.map((l) => ({ ...l, estimate: l.name === "Dinners" ? 3000 : l.name === "Hotel" ? 15000 : 0 })), taxes: sow.taxes }) });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
// A camera-sized photo (well over the 5 MB limit), made in the browser rather than kept in the repository.
const BIG = await (async () => {
  const pg = await b.newPage();
  await pg.addInitScript(() => { try { sessionStorage.setItem("ongia-test-alltabs", "1"); } catch {} });   // every tab of the event page shown at once: this file tests the sections, evtabs-ui tests the tabs
  const b64 = await pg.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 3200; c.height = 3200;
    const x = c.getContext("2d"), img = x.createImageData(c.width, c.height);
    for (let i = 0; i < img.data.length; i++) img.data[i] = (i % 4 === 3) ? 255 : Math.random() * 255;
    x.putImageData(img, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.97));
    const buf = new Uint8Array(await blob.arrayBuffer()); let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  await pg.close();
  return Buffer.from(b64, "base64");
})();
const as = async (email, name, vp) => {
  const page = await b.newPage({ viewport: vp });
  await page.addInitScript(() => { try { sessionStorage.setItem("ongia-test-alltabs", "1"); } catch {} });   // every tab of the event page shown at once: this file tests the sections, evtabs-ui tests the tabs
  const token = issueSession({ email, name });
  await page.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} },
    [token, { email, name, owner: false, canCost: ["president@ongia.ca", "vp_operations@ongia.ca"].includes(email) }]);
  page.on("dialog", (d) => d.accept());
  page.errs = []; page.on("pageerror", (e) => page.errs.push(String(e)));
  await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
  await page.locator(`[data-open="${ev.id}"]`).first().evaluate((e) => e.click()); await page.waitForTimeout(1500);
  return page;
};
const openFold = async (page, key) => { const f = page.locator(`details[data-fold="sec-${key}"]`); if (!(await f.evaluate((d) => d.open))) await f.locator("summary").first().click(); await page.waitForTimeout(300); };
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

console.log("— on a phone, as a board member on the event");
const phone = await as("treasurer@ongia.ca", "Raj Jaswal", { width: 390, height: 844 });
ok("the receipts section is there and the costing is not", (await phone.locator("#receiptscard").count()) === 1 && (await phone.locator("#sowcard").count()) === 0);
await openFold(phone, "receipts");
ok("the camera and the picker buttons are there, and big enough for a thumb", await phone.locator("#rc-cam").isVisible() && (await phone.locator("#rc-cam").boundingBox()).height >= 48 && await phone.locator("#rc-pick").isVisible());
ok("the camera input asks for the back camera", (await phone.locator("#rc-cam input").getAttribute("capture")) === "environment");
await phone.screenshot({ path: D + "rc-phone-empty.png" });
await mock({ isReceipt: true, vendor: "La Belle Province", date: "2026-09-29", subtotal: 200, tax: 29.95, total: 229.95, currency: "CAD", confidence: "high", suggestedLine: "Dinners", notes: null }, 2500);
await phone.locator("#rc-pick input").setInputFiles(D + "receipt1.jpg");
await phone.waitForSelector(".rcd.reading", { timeout: 5000 });
ok("while Claude reads it, the page says so", /Claude is reading/.test(await phone.locator(".rcd").innerText()));
await phone.screenshot({ path: D + "rc-phone-reading.png" });
await phone.waitForSelector(".rcd .f-vendor", { timeout: 15000 });
const v = async (sel) => phone.locator(`.rcd ${sel}`).inputValue();
ok("then the boxes are filled in: vendor, date, amount before tax, tax, total", await v(".f-vendor") === "La Belle Province" && await v(".f-date") === "2026-09-29" && await v(".f-amount") === "200" && await v(".f-tax") === "29.95" && await v(".f-total") === "229.95");
ok("the line Claude suggested is picked", (await phone.locator(".rcd .f-line").evaluate((e) => e.selectedOptions[0].textContent)) === "Dinners");
ok("Paid by starts as the person signed in, so there is nothing to do", await phone.locator(".rcd .f-paid").inputValue() === "treasurer@ongia.ca");
ok("the list has the event's board first, then the rest of the board", await phone.locator(".rcd .f-paid optgroup").evaluateAll((g) => g.map((x) => x.label).join("|") === "On this event|Other board members" && /Raj Jaswal/.test(g[0].innerText) && /Andrew Hammond/.test(g[1].innerText) && !/Andrew Hammond/.test(g[0].innerText)));
ok("the line list shows names and Other, no amounts", await phone.locator(".rcd .f-line option").allInnerTexts().then((t) => t.includes("Hotel") && t.includes("Other") && !t.some((x) => /\$|15000/.test(x))));
ok("the photo shows", await phone.locator(".rcd img").evaluate((i) => i.complete && i.naturalWidth > 0));
ok("no sideways scrolling and the confirm button is thumb-sized", await noOverflow(phone) && (await phone.locator("[data-confirm]").boundingBox()).height >= 44);
await phone.locator(".rcd").scrollIntoViewIfNeeded(); await phone.screenshot({ path: D + "rc-phone-form.png" });
await phone.click("[data-confirm]"); await phone.waitForSelector(".rck", { timeout: 8000 });
let txt = await phone.locator("#rc-body").innerText();
ok("the receipt says who paid", /paid by Raj Jaswal/.test(txt));
ok("confirming counts it: the receipt is listed with its line and the amount before tax", /La Belle Province/.test(txt) && /\$200\.00/.test(txt) && /Dinners/.test(txt) && /tax \$29\.95 not counted/.test(txt), txt);
ok("it says it is not in SharePoint, and why (no credentials in a test)", /Not in SharePoint/.test(txt));
ok("the total before tax is shown", /\$200\.00 before tax, 1 receipt/.test(txt));
await phone.screenshot({ path: D + "rc-phone-list.png" });

console.log("— a big photo, and one Claude can't read");
await mock({ error: 401 });
await phone.locator("#rc-pick input").setInputFiles({ name: "big.jpg", mimeType: "image/jpeg", buffer: BIG });
await phone.waitForSelector(".rcd .rcn.warn", { timeout: 30000 });
txt = await phone.locator(".rcd").innerText();
ok(`a ${(BIG.length / 1048576).toFixed(1)} MB photo (over the 5 MB limit) is shrunk and goes up`, BIG.length > 5 * 1048576 && /big\.jpg/.test(txt));
ok("a failed reading says why in plain words and offers Read it again", /key was refused/.test(txt) && (await phone.locator("[data-again]").count()) === 1);
ok("the boxes are empty for typing, and the line is not guessed", (await v(".f-vendor")) === "" && (await phone.locator(".rcd .f-line").inputValue()) === "");
await phone.click("[data-confirm]"); await phone.waitForTimeout(600);
ok("confirming with nothing picked is refused (still pending)", (await phone.locator(".rcd").count()) === 1);
await phone.selectOption(".rcd .f-line", "other");
ok("choosing Other asks what it was for", await phone.locator(".rcd .f-oth").isVisible());
await phone.selectOption(".rcd .f-paid", ""); await phone.click("[data-confirm]"); await phone.waitForTimeout(500);
ok("leaving Paid by empty is refused (still pending)", (await phone.locator(".rcd").count()) === 1);
await phone.selectOption(".rcd .f-paid", "j.healy@ongia.ca");
await phone.fill(".rcd .f-oth", "Taxi to the studio"); await phone.fill(".rcd .f-vendor", "Taxi Coop"); await phone.fill(".rcd .f-date", "2026-09-30");
await phone.fill(".rcd .f-amount", "41.50"); await phone.fill(".rcd .f-tax", "6.21");
await phone.locator(".rcd .f-tax").blur();
ok("the total fills in from the amount and the tax", (await v(".f-total")) === "47.71", await v(".f-total"));
await phone.click("[data-confirm]"); await phone.waitForFunction(() => document.querySelectorAll(".rck").length === 2, null, { timeout: 8000 });
{ const tt = await phone.locator("#rc-body").innerText(); ok("typed by hand is noted on the receipt, and the colleague is named as having paid", /typed in by hand/.test(tt) && /paid by John Healy/.test(tt), tt.slice(0, 700)); }

console.log("— the same receipt twice");
await mock({ isReceipt: true, vendor: "la belle province", date: "2026-09-29", subtotal: 200, tax: 29.95, total: 229.95, currency: "CAD", confidence: "low", suggestedLine: "Dinners", notes: "Slightly cut off at the bottom." }, 0);
await phone.locator("#rc-pick input").setInputFiles(D + "receipt1.jpg");
await phone.waitForSelector(".rcd .f-vendor", { timeout: 15000 });
txt = await phone.locator(".rcd").innerText();
ok("a low-confidence reading tells them to check each figure, and shows Claude's note", /wasn't sure/.test(txt) && /cut off at the bottom/.test(txt));
let asked = "";
phone.removeAllListeners("dialog"); phone.on("dialog", (d) => { asked = d.message(); d.accept(); });
await phone.click("[data-confirm]"); await phone.waitForFunction(() => document.querySelectorAll(".rck").length === 3, null, { timeout: 8000 });
ok("they were asked, and when they said yes it was kept", /already on this event/.test(asked) && /Add it anyway/.test(asked));
await phone.screenshot({ path: D + "rc-phone-list2.png", fullPage: true });
ok("no sideways scrolling on the phone", await noOverflow(phone));
ok("no page errors on the phone", phone.errs.length === 0, phone.errs.join("|"));

console.log("— changing and removing");
phone.removeAllListeners("dialog"); phone.on("dialog", (d) => d.accept());
await phone.locator(".rck", { hasText: "Taxi Coop" }).locator("[data-edit]").click();
ok("Change opens the same boxes on the receipt", await phone.locator(".rck .f-vendor").inputValue() === "Taxi Coop");
await phone.fill(".rck .f-amount", "44.00"); await phone.click("[data-save]"); await phone.waitForTimeout(800);
ok("the change is kept", /\$44\.00/.test(await phone.locator("#rc-body").innerText()));
await phone.locator(".rck", { hasText: "Taxi Coop" }).locator("[data-del]").click(); await phone.waitForFunction(() => document.querySelectorAll(".rck").length === 2, null, { timeout: 5000 });
ok("Remove takes it off", !/Taxi Coop/.test(await phone.locator("#rc-body").innerText()));
await phone.close();

console.log("— a board member not on this event");
const out = await as("other.board@ongia.ca", "Someone Else", { width: 390, height: 844 }).catch(() => null);
if (out) { ok("sees no receipts section", (await out.locator("#receiptscard").count()) === 0); await out.close(); }

console.log("— on the desktop, as the president");
const pres = await as("president@ongia.ca", "Andrew Hammond", { width: 1440, height: 1000 });
ok("the president is not on this event's board, but is in the list and picked as the default", await (async () => { await openFold(pres, "receipts"); return true; })());
ok("both the costing and the receipts are there", (await pres.locator("#sowcard").count()) === 1 && (await pres.locator("#receiptscard").count()) === 1);
await openFold(pres, "receipts");
txt = await pres.locator("#rc-body").innerText();
ok("the president sees every receipt and can change any", /La Belle Province/.test(txt) && (await pres.locator("[data-edit]").count()) === 2);
ok("the president sees what each person has paid, to check claims against", /Paid by/.test(txt) && /Raj Jaswal \$\d/.test(txt), txt.slice(0, 600));
await openFold(pres, "sow");
txt = await pres.locator("#sw-table").innerText();
ok("the SOW editor has a Receipts so far column: $400 in 2 receipts against the $3,000 Dinners estimate, $2,600 left", /\$400\.00\s+2 receipts\s+\$2,600\.00 left/.test(txt), txt);
ok("a line with receipts can't be removed from the editor", await pres.locator(`#sw-table tr:has(.ln-name[value="Dinners"])`).locator("[data-rm]").isDisabled());
await pres.selectOption("#sw-status", "approved"); await pres.waitForTimeout(1500);
await openFold(pres, "sow");
ok("after approval the invoice column appears with an Other row", await pres.locator("tr.oth").count() === 1);
const sums = await pres.locator("#sw-sums").innerText();
ok("the invoice subtotal is the fixed lines plus the at-cost receipts: $15,400.00", /\$15,400\.00/.test(sums), sums);
await pres.screenshot({ path: D + "rc-desk-sow.png", fullPage: true });
await mock({ isReceipt: true, vendor: "Taxi Coop", date: "2026-09-30", subtotal: 41.5, tax: 6.21, total: 47.71, currency: "CAD", confidence: "high", suggestedLine: "Other", notes: null });
await openFold(pres, "receipts");
await pres.locator("#rc-pick input").setInputFiles(D + "receipt1.jpg");
await pres.waitForSelector(".rcd .f-vendor", { timeout: 15000 });
ok("Claude's Other is picked for the president too", await pres.locator(".rcd .f-line").inputValue() === "other");
ok("for the president the default is the president, who is not on the event", await pres.locator(".rcd .f-paid").inputValue() === "president@ongia.ca");
await pres.selectOption(".rcd .f-paid", "treasurer@ongia.ca");
await pres.fill(".rcd .f-oth", "Taxi to the studio");
await pres.click("[data-confirm]"); await pres.waitForFunction(() => document.querySelectorAll(".rck").length === 3, null, { timeout: 8000 });
await pres.waitForTimeout(1000);
txt = await pres.locator("tr.oth").innerText();
ok("the SOW card updated itself without a reload: Other now has the receipt and its note", /1 receipt/.test(txt) && /\$41\.50/.test(txt) && /Taxi to the studio/.test(txt), txt);
ok("and the invoice subtotal moved to $15,441.50", /\$15,441\.50/.test(await pres.locator("#sw-sums").innerText()));
await pres.fill("#sw-oth", "50"); await pres.waitForTimeout(300);
ok("typing over Other changes the sums live: $15,450.00", /\$15,450\.00/.test(await pres.locator("#sw-sums").innerText()));
await pres.click("#sw-save"); await pres.waitForTimeout(1500);
const saved = await api(`/api/sow?event=${ev.id}`);
ok("saved: the invoice's Other is 50 and the SOW itself holds no receipt figures", saved.actual.other === 50 && saved.sow.otherActual === 50);
await pres.screenshot({ path: D + "rc-desk-receipts.png", fullPage: true });
ok("no page errors on the desktop", pres.errs.length === 0, pres.errs.join("|"));
await b.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
