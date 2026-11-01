// Reports (Andrew 1 Nov 2026, from the mock-up he approved): a Reports item in the left menu after The year, opening on
// ONGIA (the year's figures, contacts typed in once a year, the three reports and the infographic, Open RBH reports),
// with RBH beside it (the RBH reports page, moved here from Admin). Readable at 390 wide, with no sideways scroll.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const T = Date.now().toString(36), YEAR = "2024";
const mk = async (title, dayOne, extra = {}) => (await api("/api/events", { method: "POST", body: JSON.stringify({ title, city: "Toronto, ON", dayOne, lastDay: dayOne, invite: false, presenters: [],
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }], province: "ON", invoicePrefix: "RP", ...extra }) })).event;
await mk(`Ontario Gang Symposium ${T}`, `${YEAR}-03-05`);
await mk(`RBH SOR Training ${T}`, `${YEAR}-04-13`, { kind: "rbh" });

const asAndrew = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
const asLee = issueSession({ email: "secretary@ongia.ca", name: "Lee Board" });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (w, h, who = asAndrew, whoInfo = { email: "president@ongia.ca", name: "Andrew Hammond" }, v = { name: "list" }) => {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await p.addInitScript(([t, x]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(x)); } catch {} }, [who, whoInfo]);
  p.errs = []; p.on("pageerror", (e) => p.errs.push(String(e)));
  await p.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify(v)), { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
  return p;
};

let p = await open(1280, 1000);
const menu = await p.$$eval("#side .snav > .sn span", (els) => els.map((e) => e.textContent));
ok("Reports is in the left menu, right after The year", menu.indexOf("Reports") === menu.indexOf("The year") + 1, menu.join(", "));
await p.locator("#reportsnav").click(); await p.waitForTimeout(1500);
ok("it opens on ONGIA, with Reports lit in the menu", (await p.locator(".rptabs .atab.on").innerText()).trim() === "ONGIA" && await p.locator("#reportsnav.on").count() === 1);
await p.locator(`[data-ongyear="${YEAR}"]`).click(); await p.waitForTimeout(1500);
const glance = await p.locator(".ye").innerText();
ok(`${YEAR}'s figures: two events held (the RBH one counts too), contacts, agencies, provinces, rating`, /\b2\b[\s\S]*trainings and events/.test(glance) && /all held/.test(glance) && /contacts/.test(glance) && /average rating/.test(glance), glance.slice(0, 300));
ok("the four reports are listed, none made yet", await p.locator(".rcard").count() === 4 && (await p.locator(".rcards").innerText()).match(/Not made yet/gi)?.length === 4
  && /Annual Impact Report/.test(await p.locator(".rcards").innerText()) && /Reach and Network Report/.test(await p.locator(".rcards").innerText()) && /Training Program Report/.test(await p.locator(".rcards").innerText()) && /Year-end infographic/.test(await p.locator(".rcards").innerText()));
ok("the president can make them: an event that year has taken place", await p.locator("#ong-make").count() === 1);
await p.locator("#ong-contacts").fill("6092"); await p.locator("#ong-save").click(); await p.waitForTimeout(1500);
ok("contacts are typed in once a year and saved", (await api(`/api/reports?ongia=${YEAR}`)).inputs.contacts === 6092 && /6,092/.test(await p.locator(".ye").innerText()));
await p.screenshot({ path: new URL("./reportspage-desk.png", import.meta.url).pathname, fullPage: true });
await p.locator("#ong-rbh").click(); await p.waitForTimeout(1500);
ok("Open RBH reports goes to Reports › RBH, the year kept", (await p.locator(".rptabs .atab.on").innerText()).trim() === "RBH" && await p.locator(`[data-rbhyear="${YEAR}"].solid`).count() === 1 && /RBH SOR Training/.test(await p.locator("#root").innerText()));
await p.locator('[data-rptab="ongia"]').click(); await p.waitForTimeout(1200);
ok("and ONGIA is one tap back", await p.locator(".rcard").count() === 4);
ok("Admin no longer has an RBH reports tab", !(await (await open(1280, 900, asAndrew, undefined, { name: "admin", tab: "board" })).locator('[data-atab="rbh"]').count()));
ok("no page errors", p.errs.length === 0, p.errs.join(" | "));
await p.close();

p = await open(1280, 900, asLee, { email: "secretary@ongia.ca", name: "Lee Board" }, { name: "reports", sub: "ongia", year: YEAR });
ok("any board member can see ONGIA's reports, without the buttons that change them", await p.locator(".rcard").count() === 4 && await p.locator("#ong-make").count() === 0 && await p.locator("#ong-contacts").count() === 0);
await p.close();

p = await open(390, 900, asAndrew, undefined, { name: "reports", sub: "ongia", year: YEAR });
ok("at 390 wide, nothing scrolls sideways", !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
ok("on a phone the cards stack, one a row", await p.evaluate(() => { const c = [...document.querySelectorAll(".rcard")].map((e) => e.getBoundingClientRect()); return c.length === 4 && c.every((r, i) => !i || r.top > c[i - 1].top); }));
await p.screenshot({ path: new URL("./reportspage-phone.png", import.meta.url).pathname, fullPage: true });
ok("no page errors", p.errs.length === 0, p.errs.join(" | "));
await p.close();
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
