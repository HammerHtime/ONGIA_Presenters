// The welcome letter card in the order it's used (Andrew 29 Oct 2026: "the email addresses for the test email is far
// from the test email button. Seems like some of these are out of order"): the day and signer, how to write it, each
// version's words and agenda, the other PDFs, then Check it (the test addresses with See the email and Send a test for
// each version), then Save.
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
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Order ${T}`, city: "Toronto, ON", venue: "Hall", dayOne: shift(14), lastDay: shift(17), invite: false,
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }] }) })).event;

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1440, 1000, "wide"], [390, 844, "phone"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true }]);
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  // Two versions, as on the Summit (the second group comes from a second Wix event, which needs Wix): the card is drawn
  // from this event's own answer with a Community partners version added beside it.
  await p.route(/\/api\/welcome\?event=[^&]+$/, async (route) => { const r = await route.fetch(); const j = await r.json();
    j.versions[0].label = "Justice partners";
    j.versions.push({ ...j.versions[0], key: "group", label: "Community partners" });
    return route.fulfill({ response: r, body: JSON.stringify(j) }); });
  await p.goto(`${S}/admin.html#event/${ev.id}`, { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  await p.locator('.etab[data-tab="communications"]').click(); await p.waitForTimeout(1500);
  const top = (sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().top + scrollY : -1; }, sel);
  const order = { signed: await top("#wl-sign"), hint: await top("#wlbox p.hint + .wlver, #wlbox .wlver"), versions: await top('.wlver[data-wl="group"]'), files: await top("#wl-addfile"),
    to: await top("#wl-to"), see: await top('.wlcheck [data-wlsee="main"]'), test2: await top('.wlcheck [data-wltest="group"]'), save: await top("#wl-save") };
  ok(`${tag}: signer, then the letters, then the PDFs, then Check it, then Save`, Object.values(order).every((v, i, a) => v > 0 && (!i || v >= a[i - 1])), JSON.stringify(order));
  ok(`${tag}: the test addresses sit right above the test buttons`, order.see - order.to < 160, `${order.see - order.to}px`);
  ok(`${tag}: one See the email and one Send a test for each version, all in Check it, none left inside the letters`,
    (await p.locator(".wlcheck [data-wltest]").count()) === 2 && (await p.locator(".wlcheck [data-wlsee]").count()) === 2 && (await p.locator(".wlver [data-wltest], .wlver [data-wlsee]").count()) === 0);
  ok(`${tag}: each row says which version it is`, /Justice partners[\s\S]*Community partners/.test(await p.locator(".wlcheck").innerText()));
  await p.fill("#wl-to", "vp_operations@ongia.ca, membership@ongia.ca");
  await p.locator("#wl-save").click(); await p.waitForTimeout(1500);
  ok(`${tag}: the test addresses are still there after saving`, (await p.inputValue("#wl-to")) === "vp_operations@ongia.ca, membership@ongia.ca");
  await p.locator(".wlcheck").scrollIntoViewIfNeeded();
  await p.locator(".wlcheck").screenshot({ path: D + `welcome-check-${tag}.png` });
  ok(`${tag}: fits the screen, no page errors`, (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) && !errs.length, errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
