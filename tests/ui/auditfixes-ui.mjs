// The audit's screen changes (Andrew 28 Oct 2026, from the mock-ups): no browser pop-ups, a part that didn't load says so
// with Retry, every attendee email at a glance on Communications, and a Decide bar on the agreement review on a phone.
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
const T = Date.now().toString(36);
const shift = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Audit Fixes ${T}`, city: "Toronto, ON", venue: "Hall", dayOne: shift(14), lastDay: shift(15), invite: false,
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }],
  presenters: [{ first: "Jordan", last: "Avery", email: "jordan@example.ca", organization: "Sample Police" }, { first: "Casey", last: "Morgan", email: "casey@example.ca", organization: "Sample Police" }] }) })).event;
const [jordan, casey] = (await api(`/api/events?id=${ev.id}`)).presenters;
const answers = (p) => ({ first: p.first, last: p.last, email: p.email, phone: "4165550100", organization: "Sample Police", talk: "Following the Money", bio: "word ".repeat(300), outline: "O", travel: "no", hotel: "no",
  expenses: { transport: "no", meals: "no", other: "no", otherText: "" }, copyright: true, noInvestigation: true, termsAccepted: true,
  media: { photo: { internal: "yes", public: "yes" }, materials: { internal: "yes", public: "no" }, summary: { internal: "yes", public: "yes" }, bio: { internal: "yes", public: "yes" } }, sensitive: "no", signature: `${p.first} ${p.last}`, agreed: true, language: "en" });
for (const p of [jordan, casey]) await fetch(`${S}/api/agreement?t=${p.token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(answers(p)) });
await api(`/api/review?event=${ev.id}&presenter=${casey.id}&action=approve`, { method: "POST", body: JSON.stringify({ approverName: "Andrew Hammond", attest: true, covers: {} }) });
const reply = (await api(`/api/reply?event=${ev.id}`, { method: "PUT", body: "{}" })).reply;
await api(`/api/survey?event=${ev.id}`, { method: "PUT", body: JSON.stringify({ open: true, mode: "end", sendOn: shift(17), sessions: [{ id: "sa", day: ev.dayOne, title: "Following the Money", presenters: ["Jordan Avery"] }] }) });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (hash, vp = { width: 1440, height: 1000 }, before) => {
  const page = await b.newPage({ viewport: vp, deviceScaleFactor: 2 });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await page.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true }]);
  page.errs = []; page.on("pageerror", (e) => page.errs.push(String(e)));
  page.popups = []; page.on("dialog", (d) => { page.popups.push(d.message()); d.accept(); });
  if (before) await before(page);
  await page.goto(`${S}/admin.html${hash}`, { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
  return page;
};

console.log("— a new event with a row that can't be added: said on the event, not in a pop-up");
let p = await open("");
await p.locator("button:has-text('New event')").first().click(); await p.waitForTimeout(1000);
const made = `Pop Up Test ${T}`;
await p.fill("#e-title", made); await p.fill("#e-city", "Ottawa, ON");
await p.fill("#e-day1", shift(30)); await p.fill("#e-last", shift(30));
await p.evaluate(() => { const m = document.querySelector('#board .member[data-email="president@ongia.ca"]'); const pick = m.querySelector(".pick"); pick.checked = true; pick.dispatchEvent(new Event("change", { bubbles: true }));
  const r = m.querySelector('input[name="lead"]'); r.disabled = false; r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); });
await p.fill("#e-people", "Riley, Chen, riley@example.ca, Sample Police\nSam, Ortiz, sam@example, Sample Police");
await p.locator("#e-invite").uncheck().catch(() => {});
await p.locator("#create").click(); await p.waitForTimeout(2500);
let note = p.locator('[data-evn="notice"]');
if (!(await note.count())) console.log("   (the form said: " + (await p.locator("#problem").innerText().catch(() => "")).slice(0, 200) + ")");
ok("no browser pop-up", p.popups.length === 0, p.popups.join(" | "));
ok("the event opens with a box naming who wasn't added and why", /1 presenter wasn't added\./.test(await note.innerText().catch(() => "")) && /Sam Ortiz: "sam@example" is not an email address\./.test(await note.innerText()) && /The other 1 was added/.test(await note.innerText()), await note.innerText().catch(() => "none"));
await p.screenshot({ path: D + "auditfix-notice-wide.png", clip: { x: 0, y: 0, width: 1440, height: 640 } });
await p.locator("[data-evn-add]").click(); await p.waitForTimeout(500);
ok("Fix and add opens Add presenters with the row put back to correct", await p.locator("#padd").isVisible() && (await p.locator("#p-rows").inputValue()) === "Sam, Ortiz, sam@example, Sample Police" && !(await p.locator('[data-evn="notice"]').count()));
await p.close();

console.log("— a part of the event that fails to load says so, with Retry");
let failing = true;
p = await open(`#event/${ev.id}`, undefined, (page) => page.route(/\/api\/(attendees|rooming)\?/, (r) => failing ? r.fulfill({ status: 503, body: "{}" }) : r.continue()));
const failed = p.locator('[data-evn="failed"]');
ok("the box names what didn't load", /Couldn't load registrations and the hotel list\./.test(await failed.innerText().catch(() => "")), await failed.innerText().catch(() => "none"));
await p.screenshot({ path: D + "auditfix-failed-wide.png", clip: { x: 0, y: 0, width: 1440, height: 640 } });
failing = false;
await p.locator("[data-evn-retry]").click(); await p.waitForTimeout(1800);
ok("Retry loads it again, and the box goes", !(await p.locator('[data-evn="failed"]').count()));
await p.close();
p = await open(`#event/${ev.id}`, undefined, (page) => page.route(/\/api\/sheetcheck\?/, (r) => r.fulfill({ status: 403, contentType: "application/json", body: '{"error":"no"}' })));
ok("a part this board member isn't allowed to see is not called a failure", !(await p.locator('[data-evn="failed"]').count()));
await p.close();

console.log("— Communications: every attendee email at a glance");
for (const [w, h, tag] of [[1440, 1000, "wide"], [390, 844, "phone"]]) {
  p = await open(`#event/${ev.id}`, { width: w, height: h });
  await p.locator('.etab[data-tab="communications"]').click(); await p.waitForTimeout(1200);
  const sum = p.locator("#mailsum");
  const text = await sum.innerText();
  ok(`${tag}: three rows, in date order: food allergies, welcome letter, survey`, /Food allergies[\s\S]*Welcome letter[\s\S]*Survey/.test(text), text);
  ok(`${tag}: the welcome letter says it won't go until it's saved`, /Not saved: won't go/i.test(text));
  ok(`${tag}: food allergies is ready for you to send, the survey ready but emails are off`, /Ready: you press Send/i.test(text) && /Ready, but emails are off/i.test(text));
  ok(`${tag}: the line under the heading says the automatic emails are off`, /Automatic emails are off/.test(await p.locator("#mailsum-s").innerText()));
  ok(`${tag}: fits the screen`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await sum.scrollIntoViewIfNeeded();
  await p.locator(".mailsum").screenshot({ path: D + `auditfix-mailsum-${tag}.png` });
  await p.locator('[data-msgo="welcomefold"]').click(); await p.waitForTimeout(900);
  ok(`${tag}: Open takes you to the welcome letter`, await p.evaluate(() => { const r = document.getElementById("welcomefold").getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }));
  await p.locator('[data-msgo="survey"]').click(); await p.waitForTimeout(900);
  ok(`${tag}: and the survey's Open goes to its tab`, await p.locator('.etab[data-tab="survey"]').getAttribute("aria-selected") === "true");
  ok(`${tag}: no page errors`, p.errs.length === 0, p.errs.join(" | "));
  await p.close();
}
await api(`/api/events?id=${ev.id}&attendeeMail=1`, { method: "PUT", body: JSON.stringify({ on: true }) });
p = await open(`#event/${ev.id}`);
await p.locator('.etab[data-tab="communications"]').click(); await p.waitForTimeout(1200);
ok("with emails switched on, the survey says it sends itself", /Ready: sends itself/i.test(await p.locator("#mailsum").innerText()) && !/Automatic emails are off/.test(await p.locator("#mailsum-s").innerText()), (await p.locator(".mailsum").innerText()).replace(/\s+/g, " "));
await p.close();

console.log("— the agreement review: a Decide bar on a phone");
p = await open(`#review/${ev.id}/${jordan.id}`, { width: 390, height: 844 });
ok("phone: the bar is there, with the presenter's name", await p.locator("#rvbar").isVisible() && /Jordan Avery/.test(await p.locator("#rvbar").innerText()));
await p.screenshot({ path: D + "auditfix-decide-phone.png" });
await p.locator("#rvbar-go").click(); await p.waitForTimeout(1200);
ok("Decide takes you to the board decision", await p.evaluate(() => { const r = document.getElementById("rvdecide").getBoundingClientRect(); return r.top >= -2 && r.top < 200; }));
ok("and the bar gets out of the way", await p.evaluate(() => document.getElementById("rvbar").classList.contains("away")));
ok("phone: no page errors", p.errs.length === 0, p.errs.join(" | "));
await p.close();
p = await open(`#review/${ev.id}/${jordan.id}`);
ok("computer: no bar (the decision is beside the agreement)", !(await p.locator("#rvbar").isVisible()));
await p.close();
p = await open(`#review/${ev.id}/${casey.id}`, { width: 390, height: 844 });
ok("an approved agreement has no Decide bar", !(await p.locator("#rvbar").count()));
await p.close();

console.log("— the attendee's form when the connection drops");
for (const lang of ["en", "fr"]) {
  const q = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const popups = []; q.on("dialog", (d) => { popups.push(d.message()); d.accept(); });
  await q.addInitScript((l) => { try { localStorage.setItem("ongia-lang", l); } catch {} }, lang);
  await q.goto(`${S}/q/${reply.token}`, { waitUntil: "networkidle" }); await q.waitForTimeout(600);
  await q.fill('[data-k="first"]', "Pat"); await q.fill('[data-k="last"]', "Sample"); await q.fill('[data-k="email"]', `pat.${T}@example.ca`); await q.fill('[data-k="agency"]', "Sample Police");
  await q.locator('[data-allergy="no"]').click();
  await q.route(/\/api\/reply\?t=/, (r) => r.request().method() === "POST" ? r.abort() : r.continue());
  await q.locator("#send").click(); await q.waitForTimeout(800);
  const msg = await q.locator(".problems").innerText().catch(() => "");
  ok(`${lang}: no pop-up; the message sits above the button`, !popups.length && (lang === "en" ? /That didn't send\.[\s\S]*still here/ : /L'envoi n'a pas fonctionné\.[\s\S]*encore là/).test(msg), msg || popups.join());
  ok(`${lang}: and what they typed is still there`, (await q.locator('[data-k="first"]').inputValue()) === "Pat");
  if (lang === "en") await q.screenshot({ path: D + "auditfix-reply-phone.png" });
  await q.unroute(/\/api\/reply\?t=/);
  await q.locator("#send").click(); await q.waitForTimeout(1200);
  ok(`${lang}: pressing Send again goes through`, !(await q.locator(".problems").count()) && !(await q.locator("#send").count()), (await q.locator("#root, body").first().innerText()).slice(0, 300));
  await q.close();
}

console.log("— the presenter's room-and-equipment form when the connection drops");
const a = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const aPop = []; a.on("dialog", (d) => { aPop.push(d.message()); d.accept(); });
await a.goto(`${S}/a/${casey.token}`, { waitUntil: "networkidle" }); await a.waitForTimeout(800);
await a.route(/av=1/, (r) => r.abort());
const hasAv = await a.locator("#av-send").count();
if (hasAv) { await a.locator("#av-send").click(); await a.waitForTimeout(800); }
ok("no pop-up; the message sits above the button", hasAv && !aPop.length && /Couldn't reach ONGIA/.test(await a.locator(".problems").innerText().catch(() => "")), `${hasAv} ${aPop.join()}`);
await a.close();

await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
