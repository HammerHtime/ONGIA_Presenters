const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const OUT = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const base = { phone: "4165550100", talk: "T", bio: "word ".repeat(40), outline: "An outline.", travel: "no", copyright: true, noInvestigation: true, termsAccepted: true,
  media: { photo: { internal: "yes", public: "yes" }, materials: { internal: "yes", public: "no" }, summary: { internal: "yes", public: "yes" } }, sensitive: "no", agreed: true, language: "en" };
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1440, 900, "wide"], [390, 844, "phone"]]) {
  const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: "Block UI " + tag, city: "Toronto", dayOne: "2026-11-09", lastDay: "2026-11-12", invite: false,
    board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }],
    presenters: [["Ann", "Master"], ["Bob", "Agency"], ["Di", "NoRoom"]].map(([f, l]) => ({ first: f, last: l, email: `${f.toLowerCase()}${tag}@example.ca`, organization: "Org " + f })) }) })).event;
  const list = (await api(`/api/events?id=${ev.id}`)).presenters;
  for (const p of list) {
    const x = { Ann: ["yes", "no"], Bob: ["yes", "yes"], Di: ["no", "no"] }[p.first];
    await fetch(`${S}/api/agreement?t=${p.token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...base, first: p.first, last: p.last, email: p.email, organization: p.organization, signature: `${p.first} ${p.last}`,
      hotel: x[0], ...(x[0] === "yes" ? { hotelFrom: "2026-11-08", hotelTo: "2026-11-13" } : {}), expenses: { transport: "no", hotel: x[1], meals: "no", other: "no", otherText: "" } }) });
  }
  const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 500 });
  await page.addInitScript(() => { try { sessionStorage.setItem("ongia-test-alltabs", "1"); } catch {} });   // every tab of the event page shown at once: this file tests the sections, evtabs-ui tests the tabs
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  let confirmText = ""; page.on("dialog", (d) => { confirmText = d.message(); d.accept(); });
  await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" });
  await page.fill('input[type="password"]', "testkey"); await page.keyboard.press("Enter"); await page.waitForTimeout(1200);
  const open = async (first) => { await page.goto(`${S}/admin.html#event/${ev.id}`, { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
    await page.evaluate(() => { const bar = document.querySelector(".bar"); if (bar) bar.style.position = "static"; });
    const sec = page.locator('details[data-fold="sec-presenters"]'); if (!(await sec.evaluate((d) => d.open))) await sec.locator("summary").first().click();
    await page.locator("tr.prow", { hasText: first }).locator("text=/Review|Details/").first().click();
    await page.waitForTimeout(1200); };
  // Ann: wants a room
  await open("Ann");
  ok(`${tag}: the board decision has the room question, required, nothing pre-picked`, await page.locator("#r-block").count() === 1 && await page.locator('input[name="r-block"]:checked').count() === 0 && /required/.test(await page.innerText("#r-block")));
  ok(`${tag}: it says what the presenter told us about their agency`, /not covering/.test(await page.innerText("#r-block")));
  ok(`${tag}: the hotel line in the costs points down to it, with no tick to forget`, await page.locator('[data-cover="hotel"]').count() === 0 && /Choose below/.test(await page.locator(".costs").innerText()));
  ok(`${tag}: the read-back says not chosen yet`, /not chosen yet/.test(await page.innerText("#readback")));
  await page.fill("#r-name", "Raj Jaswal"); await page.check("#r-attest");
  await page.click("#approve"); await page.waitForTimeout(400);
  ok(`${tag}: approving without choosing is stopped on screen with the reason`, /Choose how the hotel room is paid/.test(await page.innerText("#problem")));
  await page.locator("#r-block").scrollIntoViewIfNeeded();
  await page.screenshot({ path: OUT + `block-choice-${tag}.png` });
  ok(`${tag}: nothing runs off the side`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.check('input[name="r-block"][value="master"]'); await page.waitForTimeout(200);
  ok(`${tag}: the choices look like round buttons, so the one picked shows its dot`, (await page.locator('input[name="r-block"]').first().evaluate((e) => getComputedStyle(e).appearance)) !== "none");
  await page.locator("#r-block").screenshot({ path: OUT + `block-picked-${tag}.png` });
  await page.locator('input[name="r-block"][value="master"]').click(); await page.waitForTimeout(150);
  ok(`${tag}: clicking the chosen one again clears it`, (await page.locator('input[name="r-block"]:checked').count()) === 0 && /not chosen yet/.test(await page.innerText("#readback")));
  await page.locator('input[name="r-block"][value="own"]').click(); await page.waitForTimeout(100);
  await page.locator('label:has(input[name="r-block"][value="master"])').click(); await page.waitForTimeout(150);
  ok(`${tag}: and clicking the other switches to it (by its words too)`, (await page.locator('input[name="r-block"][value="master"]').isChecked()) && !(await page.locator('input[name="r-block"][value="own"]').isChecked()));
  ok(`${tag}: choosing updates the read-back`, /on ONGIA's master block/.test(await page.innerText("#readback")) && /accommodation \(master block\)/.test(await page.innerText("#readback")));
  await page.click("#approve"); await page.waitForTimeout(2500);
  ok(`${tag}: no pop-up: the read-back above the button already said it`, confirmText === "", confirmText);
  const reopen = async (first) => { await page.goto(`${S}/admin.html#review/${ev.id}/${list.find((x) => x.first === first).id}`, { waitUntil: "networkidle" }); await page.waitForTimeout(1500); };
  await reopen("Ann");
  ok(`${tag}: Ann is approved, and the decision shows where the room sits`, /on ONGIA's master block/.test(await page.locator("body").innerText()));
  // Bob: agency pays
  await open("Bob");
  ok(`${tag}: Bob's screen says his agency is covering, and that they pay at check-out`, /agency is covering/.test(await page.innerText("#r-block")) && /pay the hotel at check-out/.test(await page.innerText("#r-block")) && /\[their name\] pays/.test(await page.innerText("#r-block")));
  await page.check('input[name="r-block"][value="own"]'); await page.fill("#r-name", "Raj Jaswal"); await page.check("#r-attest");
  await page.click("#approve"); await page.waitForTimeout(2500);
  await reopen("Bob");
  ok(`${tag}: Bob is approved as not on the master block`, /not on the master block, they pay their own/.test(await page.locator("body").innerText()), "");
  // Di: no hotel, nothing to choose
  await open("Di");
  ok(`${tag}: someone who needs no room is not asked`, await page.locator("#r-block").count() === 0);
  // The hotel card
  await page.goto(`${S}/admin.html#event/${ev.id}`, { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
  const fold = page.locator('details[data-fold="sec-hotel"]'); if (!(await fold.evaluate((d) => d.open))) await fold.locator("summary").first().click();
  const heads = await page.locator(".rghead b").allInnerTexts();
  ok(`${tag}: the hotel list has the two groups, master first`, heads.join("|") === "Master block (ONGIA pays)|Not on the master block", heads.join("|"));
  ok(`${tag}: Ann sits under master, Bob under not`, /Ann Master/.test(await page.locator(".roomgroup").nth(0).innerText()) && /Bob Agency/.test(await page.locator(".roomgroup").nth(1).innerText()));
  ok(`${tag}: the closed line counts the ones off the block`, /1 not on the master block/.test(await fold.locator("summary").first().innerText()), await fold.locator("summary").first().innerText());
  await fold.locator(".roomgroup").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: OUT + `block-hotel-${tag}.png` });
  ok(`${tag}: the badges read "ONGIA pays" and "Bob Agency pays"`, /ONGIA pays/.test(await page.locator(".roomgroup").nth(0).innerText()) && /Bob Agency pays/i.test(await page.locator(".roomgroup").nth(1).innerText()));
  ok(`${tag}: nothing runs off the side here either`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  ok(`${tag}: no page errors`, errs.length === 0, errs.join("|"));
  await page.close();
}
await b.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
