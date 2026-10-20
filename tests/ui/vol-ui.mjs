// The volunteer's form in a browser, on a phone and on a desktop.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const OUT = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: "National Gang Summit: Organized Crime, Gangs & Youth: Building Solutions for a Safer Future", city: "Toronto",
  venue: "Delta Hotels Toronto Airport & Conference Centre", dayOne: "2026-11-09", lastDay: "2026-11-12", board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }], invite: false, presenters: [] }) })).event;
const add = await api(`/api/volunteers?event=${ev.id}`, { method: "POST", body: JSON.stringify({ invite: false, volunteers: [
  { first: "Vera", last: "Volunteer", email: "vera@example.ca", organization: "Peel Regional Police" },
  { first: "Marc", last: "Thibault", email: "marc@example.ca", organization: "Service de police de la Ville de Montréal" }] }) });
const [vera, marc] = (await api(`/api/volunteers?event=${ev.id}`)).volunteers;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

for (const [w, h, tag] of [[390, 844, "phone"], [1440, 900, "wide"]]) {
  const v = tag === "phone" ? vera : marc;
  const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 500 });
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`${S}/v/${v.token}`, { waitUntil: "networkidle" }); await page.waitForTimeout(700);
  const body = () => page.evaluate(() => document.body.innerText);
  let t = await body();
  ok(`${tag}: their name, the event, the dates and the venue`, new RegExp(`Welcome, ${v.first}`).test(t) && /Summit/.test(t) && /Mon 9 Nov 2026 – Thu 12 Nov 2026/.test(t) && /Delta Hotels/.test(t), t.slice(0, 300));
  ok(`${tag}: all ten terms are on the page`, (await page.$$(".termlist li")).length === 10 && /Professional conduct/.test(t) && /Confidentiality/.test(t));
  ok(`${tag}: the good-standing and no-investigation words are there`, /good standing with my agency or organization/.test(t) && /not currently subject to any formal investigation/.test(t));
  ok(`${tag}: details are filled in`, await page.inputValue("#f-first") === v.first && await page.inputValue("#f-org") === v.organization);
  ok(`${tag}: nothing runs off the side`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: OUT + `form-${tag}.png`, fullPage: true });

  await page.click("#submit"); await page.waitForTimeout(300);
  const probs = await page.$$eval(".problems li", (l) => l.map((x) => x.textContent));
  ok(`${tag}: pressing Sign with nothing done lists what is missing (phone, hotel, both boxes, name, signature)`, probs.length === 6 && probs.some((x) => /hotel accommodation/.test(x)), probs.join(" | "));
  ok(`${tag}: and marks each control`, (await page.$$(".field.err, .attest.err, .qblock.err")).length === 6);
  await page.screenshot({ path: OUT + `problems-${tag}.png`, fullPage: true });

  await page.fill("#f-phone", "4165550123"); await page.waitForTimeout(150);
  ok(`${tag}: the phone is formatted as typed`, await page.inputValue("#f-phone") === "416-555-0123");
  ok(`${tag}: the warning for it clears at once`, !(await page.$$eval(".problems li", (l) => l.map((x) => x.textContent))).some((x) => /contact number/.test(x)) && !(await page.$eval("#f-phone", (e) => e.closest(".field").classList.contains("err"))));
  ok(`${tag}: the hotel question is Yes / No, neither chosen to begin with`, (await page.$$eval('[data-seg="accommodation"]', (b) => b.map((x) => x.getAttribute("aria-pressed")))).join() === "false,false");
  await page.click('[data-seg="accommodation"][data-val="no"]'); await page.waitForTimeout(150);
  ok(`${tag}: choosing an answer clears its warning at once, without redrawing the page`, !(await page.$$eval(".problems li", (l) => l.map((x) => x.textContent))).some((x) => /hotel accommodation/.test(x)) && !(await page.$eval("#q-accommodation", (e) => e.classList.contains("err"))));
  await page.check("#f-terms"); await page.check("#f-standing");
  await page.fill("#f-sign", `${v.first} ${v.last}`);
  ok(`${tag}: the typed name shows as a signature`, (await page.textContent("#sigline")).trim() === `${v.first} ${v.last}`);
  ok(`${tag}: one warning is left (the electronic-signature box)`, (await page.$$eval(".problems li", (l) => l.length)) === 1);

  // Leave and come back: the answers are still there.
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(500);
  ok(`${tag}: closing the page and coming back keeps what was typed, the hotel answer too`, await page.getAttribute('[data-seg="accommodation"][data-val="no"]', "aria-pressed") === "true" && await page.inputValue("#f-phone") === "416-555-0123" && await page.isChecked("#f-terms") && await page.inputValue("#f-sign") === `${v.first} ${v.last}` && /Picked up where you left off/.test(await body()));

  if (tag === "wide") { await page.click("#lang"); await page.waitForTimeout(300);
    t = await body();
    ok("wide: the French switch translates the whole page, terms included", /Bienvenue, Marc/.test(t) && /BÉNÉVOLE/.test(t) && /Conduite professionnelle/.test(t) && /en règle auprès/.test(t) && /Signer et envoyer/.test(t));
    ok("wide: and the answers survive the switch", await page.inputValue("#f-phone") === "416-555-0123" && await page.isChecked("#f-standing"));
    await page.screenshot({ path: OUT + "form-wide-fr.png", fullPage: true });
    await page.click("#lang"); await page.waitForTimeout(200); }

  await page.check("#f-agree");
  ok(`${tag}: the last warning goes the moment it is ticked`, (await page.$$(".problems")).length === 0);
  await page.click("#submit"); await page.waitForSelector(".done-screen", { timeout: 8000 });
  t = await body();
  ok(`${tag}: signed: thanks, the date, a reference`, /Thank you — you're signed/.test(t) && /Signed /.test(t) && /Reference VOL-/.test(t));
  ok(`${tag}: no mail transport here, so it says the copy couldn't be emailed and offers the download`, /couldn't email your copy/.test(t) && await page.isVisible("text=Download your signed copy"));
  ok(`${tag}: nothing runs off the side`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: OUT + `done-${tag}.png`, fullPage: true });
  const href = await page.getAttribute(".done-actions a", "href");
  const pdfRes = await fetch(href.startsWith("http") ? href : S + href);
  ok(`${tag}: the download is the PDF`, pdfRes.status === 200 && pdfRes.headers.get("content-type") === "application/pdf");
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(500);
  ok(`${tag}: reopening the link later says they have already signed`, /already signed/.test(await body()) && !(await page.$("#submit")));
  ok(`${tag}: the saved draft was cleared at signing`, await page.evaluate((k) => localStorage.getItem(k), `ongia-vdraft-${v.token}`) === null);
  ok(`${tag}: no script errors`, errs.length === 0, errs.join("; "));
  await page.close();
}
// A volunteer who needs a hotel room: signed, but with ONGIA for one more step.
{
  await api(`/api/volunteers?event=${ev.id}`, { method: "POST", body: JSON.stringify({ invite: false, volunteers: [{ first: "Priya", last: "Nair", email: "priya@example.ca", organization: "Toronto Police Service" }] }) });
  const pri = (await api(`/api/volunteers?event=${ev.id}`)).volunteers.find((x) => x.first === "Priya");
  for (const [w, h, tag] of [[390, 844, "phone"]]) {
    const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true });
    await page.goto(`${S}/v/${pri.token}`, { waitUntil: "networkidle" }); await page.waitForTimeout(500);
    await page.fill("#f-phone", "6475550100"); await page.click('[data-seg="accommodation"][data-val="yes"]');
    await page.check("#f-terms"); await page.check("#f-standing"); await page.fill("#f-sign", "Priya Nair"); await page.check("#f-agree");
    await page.click("#submit"); await page.waitForSelector(".done-screen", { timeout: 8000 });
    const t = await page.evaluate(() => document.body.innerText);
    ok("needs a room: told it is with ONGIA for one more step, a board member confirms the nights, then a final copy", /One more step happens on our side/.test(t) && /confirms your hotel nights/.test(t) && /final signed copy is then emailed/.test(t), t);
    ok("needs a room: no download is offered, because there is no final copy yet", !(await page.$(".done-actions")));
    await page.screenshot({ path: OUT + "done-hotel-phone.png", fullPage: true });
    await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(500);
    ok("needs a room: reopening says a board member is confirming the hotel nights", /board member is confirming your hotel nights/.test(await page.evaluate(() => document.body.innerText)) && !(await page.$("#submit")));
    await page.click("#lang"); await page.waitForTimeout(300);
    ok("needs a room: and in French", /confirme vos nuitées d'hôtel/.test(await page.evaluate(() => document.body.innerText)));
    await page.close();
  }
  const got = (await api(`/api/volunteers?event=${ev.id}`)).volunteers.find((x) => x.first === "Priya");
  ok("on the desk's side she is submitted, waiting for review", got.status === "submitted" && got.submission.accommodation === "yes");
}
const bad = await b.newPage(); await bad.goto(`${S}/v/not-a-real-link`, { waitUntil: "networkidle" }); await bad.waitForTimeout(400);
ok("a link that isn't theirs says so plainly", /isn't valid/.test(await bad.evaluate(() => document.body.innerText)));
await b.close();
const mine = (await api(`/api/volunteers?event=${ev.id}`)).volunteers;
ok("both of the first two are signed on the desk's side", mine.filter((x) => x.first !== "Priya").every((x) => x.status === "signed") && mine[0].submission.phone === "416-555-0123");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
