// The year view's deadline marks, big enough to see (Andrew 29 Oct 2026: "any way to make the small one day events more
// noticeable"): each deadline a lettered dot (A, D, F, red when overdue) that opens its event, and a one-day training never
// a sliver.
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
const Y = 2033;   // a year of its own, so other tests' events don't crowd it
const mk = async (title, city, dayOne, lastDay) => (await api("/api/events", { method: "POST", body: JSON.stringify({ title, city, venue: "Hall", dayOne, lastDay, invite: false,
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }], presenters: [{ first: "Sam", last: "Rivera", email: `sam.${T}@example.org`, organization: "Sample Police" }] }) })).event;
const one = await mk(`One Day ${T}`, "Edmundston", `${Y}-10-15`, `${Y}-10-15`);
await mk(`Week Long ${T}`, "Toronto", `${Y}-11-08`, `${Y}-11-12`);

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1284, 900, "laptop"], [390, 844, "phone"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true }]);
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(`${S}/admin.html#v=${encodeURIComponent(JSON.stringify({ name: "year", year: Y, cal: "year" }))}`, { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  const dots = p.locator(".ygrid .ytk");
  ok(`${tag}: the deadlines show as dots on their event's row`, (await dots.count()) >= 3, String(await dots.count()));
  const box = await dots.first().boundingBox();
  ok(`${tag}: each dot is big enough to see and to tap (16px)`, box.width >= 15 && box.height >= 15, JSON.stringify(box));
  const letters = await dots.evaluateAll((els) => els.map((e) => e.textContent.trim()));
  ok(`${tag}: each carries its letter: A agreements, D draft, F final`, letters.includes("A") && letters.includes("D") && letters.includes("F"), letters.join(""));
  const band = await p.locator(`.ybar[data-goev="${one.id}"]`).boundingBox();
  ok(`${tag}: a one-day training is at least 22px wide`, band.width >= 21.5, JSON.stringify(band));
  ok(`${tag}: the key says what the letters mean`, /A, D, F: agreements, draft and final materials due/.test(await p.locator(".calside").innerText()));
  await p.locator(".calmain").screenshot({ path: D + `yearmarks-${tag}.png` });
  // Every milestone and deadline in date order, a click away.
  await p.locator("#allms").click(); await p.waitForTimeout(600);
  ok(`${tag}: Every milestone opens the whole year's list`, await p.locator("#msdlg #yside").isVisible());
  const ms = await p.locator("#msdlg .ms").evaluateAll((els) => els.map((e) => ({ d: e.querySelector(".msd b").textContent, k: e.querySelector(".msk").textContent, t: e.innerText })));
  const order = await p.evaluate(() => [...document.querySelectorAll("#msdlg .msmonth, #msdlg .ms")].map((e) => e.className.includes("msmonth") ? `M:${e.textContent}` : Number(e.querySelector(".msd b").textContent)));
  let okOrder = true, last = 0; for (const o of order) { if (typeof o === "string") last = 0; else { if (o < last) okOrder = false; last = o; } }
  ok(`${tag}: it lists the trainings and the A, D and F deadlines, by month, in date order`, okOrder && ms.some((m) => m.k === "T" && /Training \(one day\)/.test(m.t)) && ["A", "D", "F"].every((k) => ms.some((m) => m.k === k)), JSON.stringify(ms.slice(0, 4)));
  await p.locator("#yside-close").click(); await p.waitForTimeout(400);
  ok(`${tag}: ✕ shuts it`, !(await p.locator("#msdlg").isVisible()));
  if (tag === "laptop") {
    await p.locator("#allms").click(); await p.waitForTimeout(400);
    await p.locator(`#msdlg .ms.k-train[data-goev="${one.id}"]`).click(); await p.waitForTimeout(1500);
    ok(`${tag}: a row opens its event`, (await p.locator(".bhead h2").innerText().catch(() => "")).includes(`One Day ${T}`));
    await p.goBack(); await p.waitForTimeout(1500);
    await p.locator(`.ytk[data-goev="${one.id}"]`).first().click(); await p.waitForTimeout(1500);
    ok(`${tag}: clicking a dot opens its event`, (await p.locator(".bhead h2").innerText().catch(() => "")).includes(`One Day ${T}`));
  }
  ok(`${tag}: fits the screen, no page errors`, (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) && !errs.length, errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
