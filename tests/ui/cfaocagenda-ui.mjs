// A CFAOC event's program started from another CFAOC event's (Andrew 29 Oct 2026: "pull agenda from previous CFAOC event
// in the app. The times will typically stay the same so I just need to add presenter and info").
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const { agendaToCopy } = await import(REPO + "netlify/functions/lib/website.mjs");
const D = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };

console.log("— what comes over");
const victoria = [
  { time: "08:00", end: "08:30", title: "Registration and coffee", titleFr: "Inscription et café", detail: "Salon A" },
  { time: "08:30", end: "09:45", presenter: "pjordan", title: "Following the Money", detail: "Jordan Avery, Sample Police", abstract: "How gangs move money." },
  { time: "12:00", end: "13:00", title: "Lunch" },
  { time: "13:00", end: "14:15", presenter: "psam", title: "" }];
const c = agendaToCopy(victoria);
ok("every line keeps its times", c.map((r) => `${r.time}-${r.end}`).join() === "08:00-08:30,08:30-09:45,12:00-13:00,13:00-14:15");
ok("the lines with no presenter come over whole, French and room too", c[0].title === "Registration and coffee" && c[0].titleFr === "Inscription et café" && c[0].detail === "Salon A" && c[2].title === "Lunch");
ok("a presenter's line comes over empty but for its times: no presenter, title, detail or write-up", !c[1].presenter && !c[1].title && !c[1].detail && !c[1].abstract && !c[3].presenter);

console.log("— on the page");
await api("/api/roster");
const T = Date.now().toString(36);
const mk = async (title, city, dayOne) => (await api("/api/events", { method: "POST", body: JSON.stringify({ title, city, venue: "Hotel", dayOne, lastDay: dayOne, invite: false,
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }] }) })).event;
const old = await mk(`Canadian Forum Against Organized Crime ${T}`, "Victoria, BC", "2026-11-24");
const fresh = await mk(`CFAOC Halifax ${T}`, "Halifax, NS", "2027-03-10");
const saved = await api(`/api/website?event=${old.id}`, { method: "PUT", body: JSON.stringify({ page: `victoria${T}`, agenda: victoria }) });
ok("the earlier event's program is saved", saved.website?.agenda?.length === 4, JSON.stringify(saved).slice(0, 200));

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1440, 1000, "wide"], [390, 844, "phone"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true }]);
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  p.on("dialog", (d) => d.accept());
  await p.goto(`${S}/admin.html#event/${fresh.id}`, { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  await p.locator('.etab[data-tab="settings"]').click(); await p.waitForTimeout(1500);
  const fold = p.locator("#websitecard, details:has(#ws-copy)").first();
  if (await fold.evaluate((d) => d.tagName === "DETAILS" && !d.open).catch(() => false)) await fold.locator("summary").first().click();
  await p.waitForTimeout(500);
  ok(`${tag}: the website card offers to start from the Victoria event's agenda`, await p.locator("#ws-copy").isVisible() && /Victoria/.test(await p.locator("#ws-copyfrom").innerText()), await p.locator("#ws-copyfrom").innerText().catch(() => "none"));
  await p.locator(".wscopy").screenshot({ path: D + `cfaoc-copy-${tag}.png` });
  if (tag === "wide") {
    await p.locator("#ws-copy").click(); await p.waitForTimeout(600);
    const rows = await p.locator("[data-wsrow]").evaluateAll((els) => els.map((e) => ({ time: e.querySelector('[data-k="time"]').value, end: e.querySelector('[data-k="end"]').value, presenter: e.querySelector('[data-k="presenter"]').value, title: e.querySelector('[data-k="title"]').value })));
    ok(`${tag}: Copy brings the four lines over with their times, Registration and Lunch named, the presenter lines empty`, rows.length === 4 && rows[0].time === "08:00" && rows[0].title === "Registration and coffee" && rows[1].time === "08:30" && !rows[1].presenter && !rows[1].title && rows[2].title === "Lunch", JSON.stringify(rows));
    await p.fill("#ws-page", `halifax${T}`);   // the website page this event fills, needed before it can be saved
    await p.locator("#ws-save").click().catch(() => {}); await p.waitForTimeout(1200);
    const after = (await api(`/api/website?event=${fresh.id}`)).website.agenda;
    ok(`${tag}: saved on this event; the Victoria event's own program is unchanged`, after.length === 4 && after[2].title === "Lunch" && (await api(`/api/website?event=${old.id}`)).website.agenda[1].presenter === "pjordan", JSON.stringify(after).slice(0, 200));
    await p.locator("#wsag").screenshot({ path: D + "cfaoc-copied-wide.png" });
  }
  ok(`${tag}: fits the screen, no page errors`, (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) && !errs.length, errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
