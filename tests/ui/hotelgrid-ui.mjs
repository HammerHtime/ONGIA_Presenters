// The hotel nights grid (Andrew 30 Oct 2026): "the window extends to right … scrolling left and right"; "the Add all
// board members pill … is too big"; "we have a plus button on either side, but we need a minus button as well"; and the
// month on each date ("there should be a Apr 3").
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
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1440, 1000, "wide"], [1024, 1366, "ipad-landscape"], [820, 1180, "ipad"]]) {
  const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Calgary Grid ${tag} ${T}`, city: "Calgary, AB", dayOne: "2027-04-05", lastDay: "2027-04-07", invite: false,
    board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], hotel: { name: "Hotel", rate: "$189 per night plus taxes" } }) })).event;
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true, canCost: true }]);
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  const asked = []; p.on("dialog", (d) => { asked.push(d.message()); d.accept(); });
  await p.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "event", eventId: ev.id, tab: "money" })), { waitUntil: "networkidle" }); await p.waitForTimeout(2000);
  if (await p.locator("dialog.walk").isVisible()) { await p.locator("#wclose").click(); await p.waitForTimeout(600); }
  const grid = p.locator("#evbudget .card").filter({ has: p.locator("table.ng") });
  const days = async () => (await p.locator(".ng thead th .d").allInnerTexts()).map((x) => x.trim());
  ok(`${tag}: each date carries its month: Fri Apr 2 to Thu Apr 8 around a 5–7 April event`, JSON.stringify(await days()) === JSON.stringify(["Apr 2", "Apr 3", "Apr 4", "Apr 5", "Apr 6", "Apr 7", "Apr 8"]), JSON.stringify(await days()));
  if (await p.locator("[data-paddall]").count()) await p.locator("[data-paddall]").click(); else { await p.locator("[data-paddboard]").selectOption({ index: 1 }); }
  await p.waitForTimeout(800);
  const pill = await p.locator("[data-paddboard]").count() ? await p.locator("[data-paddboard]").boundingBox() : null;
  ok(`${tag}: the add-a-board-member pill is small`, !pill || pill.height <= 30, JSON.stringify(pill));
  // Fits: no sideways scrolling for an event of three days with two nights either side.
  const fit = await p.evaluate(() => { const w = document.querySelector(".ngwrap"); return { sw: w.scrollWidth, cw: w.clientWidth, page: document.documentElement.scrollWidth <= innerWidth }; });
  ok(`${tag}: the grid fits without scrolling sideways`, fit.sw <= fit.cw + 1 && fit.page, JSON.stringify(fit));
  await grid.screenshot({ path: D + `hotelgrid-${tag}.png` });
  if (tag === "wide") {
    // Minus before, on a night the board has booked: it asks first, then the night goes from the grid and from them.
    const had = await p.locator('.ng [data-night$="|2027-04-02"].on').count();
    await p.locator('[data-less="before"]').click(); await p.waitForTimeout(500);
    ok("− before on a booked night asks first, then takes it off the grid and off them", had > 0 && asked.some((m) => /2 Apr/.test(m) && /Take that night off/.test(m)) && (await days())[0] === "Apr 3", JSON.stringify({ had, asked }));
    const nightsNow = await p.locator(".ng td.nm .pnn").first().innerText();
    ok("each person's night count under their name follows", /^\d+ nights?$/.test(nightsNow.trim()), nightsNow);
    await p.locator('[data-less="before"]').click(); await p.waitForTimeout(300); await p.locator('[data-less="before"]').click(); await p.waitForTimeout(400);
    ok("down to the first event day, then the minus stops", (await days())[0] === "Apr 5" && await p.locator('[data-less="before"]').isDisabled());
    await p.locator('[data-more="before"]').click(); await p.waitForTimeout(400);
    ok("+ brings a night back", (await days())[0] === "Apr 4");
    await p.locator('[data-less="after"]').click(); await p.waitForTimeout(400);
    ok("− after takes off the last night, down to the last event day", (await days()).at(-1) === "Apr 7" && await p.locator('[data-less="after"]').isDisabled());
    // Who pays still works from under the name.
    const first = p.locator(".ng td.nm [data-pays$='|agency']").first();
    await first.click(); await p.waitForTimeout(400);
    ok("who pays is chosen from under the name", await p.locator(".ng td.nm [data-pays$='|agency']").first().evaluate((e) => e.classList.contains("on")));
  }
  ok(`${tag}: no errors`, !errs.length, errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
