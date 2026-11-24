// A switch for each automatic email on Communications (Andrew 24 Nov 2026: "a toggle (on and off) for each of the auto
// emails … when it's set to off, then a send now button appears for me to press manually"), and the Overview saying so
// when one is off with its day close. Made-up event and people; no real email.
const REPO = new URL("../../", import.meta.url).pathname;
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
const shift = (d) => new Date(Date.now() + d * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
// A one-day event that was yesterday, with the hotel cut-off ahead of it (as an odd case), the survey set for tomorrow.
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Switches ${T}`, city: "Victoria, BC", venue: "Hall", dayOne: shift(-1), lastDay: shift(-1), invite: false,
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }],
  hotel: { name: "Sample Hotel", cutoff: shift(8), link: "https://hotel.example/book" } }) })).event;
await api(`/api/survey?event=${ev.id}`, { method: "PUT", body: JSON.stringify({ open: true, mode: "end", sendOn: shift(1), sessions: [{ id: "sa", day: ev.dayOne, title: "Following the Money", presenters: ["Jordan Avery"] }] }) });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (hash, vp) => {
  const page = await b.newPage({ viewport: vp, deviceScaleFactor: 2 });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await page.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true }]);
  page.errs = []; page.on("pageerror", (e) => page.errs.push(String(e)));
  page.popups = []; page.on("dialog", (d) => { page.popups.push(d.message()); d.accept(); });
  await page.goto(`${S}/admin.html${hash}`, { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
  return page;
};

for (const [tag, vp] of [["wide", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
  const p = await open(`#event/${ev.id}`, vp);
  // The Overview: the survey (tomorrow) and the certificates and thank-you (today) are off, and it says so.
  const over = await p.locator("body").innerText();
  ok(`${tag}: the Overview says the survey is off, with Turn on`, /Survey is off/.test(over) && (await p.locator('[data-autoon="survey"]').count()) === 1, over.slice(0, 600));
  ok(`${tag}: …and the certificates`, /Certificates are off/.test(over));
  await p.locator('.etab[data-tab="communications"]').click(); await p.waitForTimeout(1500);
  const list = p.locator("#mailsum");
  const text = (await list.innerText()).replace(/\s+/g, " ");
  ok(`${tag}: one line says what the switches do`, /On: sends automatically on its day · Off: nothing goes until you press Send now/.test(await p.locator(".mlhint").innerText()));
  ok(`${tag}: a switch on each automatic email, all off on a new event`, (await p.locator("[data-autosw]").count()) >= 5 && (await p.locator("[data-autosw]:checked").count()) === 0, text);
  ok(`${tag}: hotel reminders and certificates are on the list`, /Hotel reminders/.test(text) && /Certificates/.test(text), text);
  ok(`${tag}: the certificates are off, with Send now (the event is over)`, await p.locator('.mlrow[data-msgo="certs"] .mlnow').count() === 1, text);
  ok(`${tag}: the survey's Send now waits for its moment: the event is over, so it's there`, await p.locator('.mlrow[data-msgo="survey"] .mlnow').count() <= 1);
  ok(`${tag}: no switch for a message sent by hand`, await p.locator('.mlrow[data-msgo="msgfold"] [data-autosw]').count() === 0);
  const sideways = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  ok(`${tag}: nothing scrolls sideways`, !sideways);
  const heights = await p.evaluate(() => [...document.querySelectorAll("#mailsum .mlrow")].map((r) => Math.round(r.getBoundingClientRect().height)));
  ok(`${tag}: one line a row`, heights.every((h) => h <= 48), heights.join(","));
  await list.screenshot({ path: `${D}autoswitch-${tag}-off.png` });
  if (tag === "wide") {
    // Turn the certificates on: it asks, then the switch stays on and Send now goes.
    await p.locator('[data-autosw="certs"] + .track').click(); await p.waitForTimeout(1500);
    ok("turning one on asks first", p.popups.some((m) => /Send the certificates automatically\?/.test(m)), p.popups.join(" | "));
    const saved = (await api(`/api/events?id=${ev.id}`)).event.autoOn;
    ok("…it's saved, and only that one", saved.certs === true && saved.survey === false && saved.welcome === false, JSON.stringify(saved));
    ok("…the switch shows on, and Send now is gone", await p.locator('[data-autosw="certs"]').isChecked() && await p.locator('.mlrow[data-msgo="certs"] .mlnow').count() === 0);
    // Clicking the switch doesn't open the row's card.
    ok("the switch doesn't open the survey tab", await p.locator('.etab[data-tab="communications"]').getAttribute("aria-selected") === "true");
    await list.screenshot({ path: `${D}autoswitch-wide-certs-on.png` });
    // Off again: no question.
    const n = p.popups.length;
    await p.locator('[data-autosw="certs"] + .track').click(); await p.waitForTimeout(1500);
    ok("turning it off doesn't ask", p.popups.length === n && (await api(`/api/events?id=${ev.id}`)).event.autoOn.certs === false);
    // The Overview's Turn on.
    await p.locator('.etab[data-tab="overview"]').click(); await p.waitForTimeout(800);
    await p.locator('[data-autoon="survey"]').click(); await p.waitForTimeout(1500);
    ok("Turn on from the Overview turns the survey on", (await api(`/api/events?id=${ev.id}`)).event.autoOn.survey === true);
    ok("…and the warning goes", !/Survey is off/.test(await p.locator("body").innerText()));
    await api(`/api/events?id=${ev.id}&auto=1`, { method: "PUT", body: JSON.stringify({ kind: "survey", on: false }) });
  }
  ok(`${tag}: no page errors`, p.errs.length === 0, p.errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
