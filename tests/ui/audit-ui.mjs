// Audit fixes on screen: view only for board members not on the event, the signer shown (not typed), Retry filing's message, readable grey text.
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
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Audit UI ${T}`, city: "Toronto", venue: "V", dayOne: "2027-03-09", lastDay: "2027-03-11", invite: false,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], presenters: [{ first: "Ann", last: "One", email: "ann@example.ca", organization: "Org" }] }) })).event;
const [ann] = (await api(`/api/events?id=${ev.id}`)).presenters;
await fetch(`${S}/api/agreement?t=${ann.token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ first: "Ann", last: "One", email: "ann@example.ca", phone: "4165550100", organization: "Org", talk: "T", bio: "word ".repeat(40), outline: "O", travel: "no", hotel: "no", expenses: { transport: "no", meals: "no", other: "no", otherText: "" }, copyright: true, noInvestigation: true, termsAccepted: true, media: { photo: { internal: "yes", public: "yes" }, materials: { internal: "yes", public: "no" }, summary: { internal: "yes", public: "yes" }, bio: { internal: "yes", public: "yes" } }, sensitive: "no", signature: "Ann One", agreed: true, language: "en" }) });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const as = async (email, name, vp) => {
  const page = await b.newPage({ viewport: vp, deviceScaleFactor: 2 });
  await page.addInitScript(() => { try { sessionStorage.setItem("ongia-test-alltabs", "1"); } catch {} });   // every tab of the event page shown at once: this file tests the sections, evtabs-ui tests the tabs
  const token = issueSession({ email, name });
  await page.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email, name, owner: false, canCost: false }]);
  page.errs = []; page.on("pageerror", (e) => page.errs.push(String(e)));
  await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await page.waitForTimeout(900);
  return page;
};
for (const [w, h, tag] of [[1440, 900, "wide"], [390, 844, "phone"]]) {
  console.log(`— ${tag}`);
  let p = await as("b.konkle@ongia.ca", "Barb Konkle", { width: w, height: h });
  await p.locator(`[data-open="${ev.id}"]`).first().evaluate((e) => e.click()); await p.waitForTimeout(1500);
  ok(`${tag}: a board member not on the event sees it, with a "View only" line at the top saying why`, /View only\./.test(await p.locator(".viewonly").innerText()) && new RegExp(`Audit UI ${T}`).test(await p.locator("body").innerText()));
  const anyEnabled = await p.evaluate(() => [...document.querySelectorAll("button, input, select, textarea")].filter((e) => !e.disabled && !e.closest("header, #barright, .bar") && e.id !== "signout" && !e.matches(".etab, [data-msgo], [data-evn-retry], [data-pseg], [data-filter], #pfind, [data-pshow], [data-pclose], .crumb, [data-gotab], [data-gcutbtn], #gfind") && e.offsetParent !== null).map((e) => e.id || e.textContent.trim().slice(0, 30)));
  ok(`${tag}: a board member not on the event gets no website export`, (await p.locator("#webexport").count()) === 0);
  ok(`${tag}: every button and box on the event is switched off`, anyEnabled.length === 0, JSON.stringify(anyEnabled.slice(0, 8)));
  ok(`${tag}: but looking around still works: the tabs, the people switch and the way back`, (await p.locator(".etab:not([disabled])").count()) >= 6 && (await p.locator("[data-pseg]:not([disabled])").count()) === 3 && (await p.locator(".crumb:not([disabled])").count()) === 1);
  await p.locator("tr.prow", { hasText: "Ann One" }).locator(".pn").click(); await p.waitForTimeout(500);
  ok(`${tag}: a presenter's panel opens to read, with its buttons switched off but its close button working`, await p.locator("#pdrawer").isVisible() && (await p.locator("#pdrawer [data-review], #pdrawer [data-edit], #pdrawer [data-copy]").evaluateAll((els) => els.length > 0 && els.every((e) => e.disabled))) && (await p.locator("#pdrawer [data-pclose]:not([disabled])").count()) >= 1);
  await p.locator("#pdrawer .pclose").click(); await p.waitForTimeout(300);
  const fold = p.locator(".etabp details.secfold").first(); await fold.locator("summary").click({ force: true }).catch(() => {}); await p.waitForTimeout(200);
  ok(`${tag}: and every section in a tab is open to read (the tab does the folding)`, await fold.evaluate((d) => d.open) && (await p.locator(".etabp details.secfold:not([open])").count()) === 0);
  await p.screenshot({ path: D + `viewonly-${tag}.png` });
  ok(`${tag}: the switched-off controls look switched off`, await p.locator("#root, main").first().evaluate(() => { const b = document.querySelector(".ro button:disabled"); return !!b && parseFloat(getComputedStyle(b).opacity) < 0.7; }));
  ok(`${tag}: the "All events" button still works`, await (async () => { await p.click("#back"); await p.waitForTimeout(800); return (await p.locator(".evcard, .empty").count()) > 0; })());
  ok(`${tag}: no page errors`, p.errs.length === 0, p.errs.join("|"));
  await p.close();

  // the lead: the review page shows who is signing
  p = await as("treasurer@ongia.ca", "Raj Jaswal", { width: w, height: h });
  await p.evaluate(([e, a]) => { location.hash = `#review/${e}/${a}`; }, [ev.id, ann.id]); await p.waitForTimeout(1800);
  const nm = p.locator("#r-name");
  ok(`${tag}: the review page says "Signing as" with the signed-in name, and it can't be typed over`, (await nm.inputValue()) === "Raj Jaswal" && (await nm.getAttribute("readonly")) !== null && /Signing as/i.test(await p.locator('label[for="r-name"]').innerText()));
  ok(`${tag}: the signature line says "Signing as … is my electronic signature"`, /Signing as Raj Jaswal is my electronic signature/.test(await p.locator("body").innerText()));
  ok(`${tag}: and says someone else signs by signing in as themselves`, /signing in as themselves/.test(await p.locator("body").innerText()));
  await nm.scrollIntoViewIfNeeded(); await p.screenshot({ path: D + `signer-${tag}.png` });
  ok(`${tag}: no page errors`, p.errs.length === 0, p.errs.join("|"));
  await p.close();
}
// Retry filing says what really happened
{
  const p = await as("treasurer@ongia.ca", "Raj Jaswal", { width: 1440, height: 900 });
  await p.route("**/api/events?id=**", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const r = await route.fetch(); const j = await r.json();
    j.presenters = j.presenters.map((x) => ({ ...x, status: "approved", delivery: { filing: { ok: false, error: "SharePoint was down" } } }));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(j) });
  });
  let answer = { ok: true, delivery: { filing: { ok: true, files: [] } } };
  await p.route("**/api/review?**action=redeliver", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) }));
  await p.locator(`[data-open="${ev.id}"]`).first().evaluate((e) => e.click()); await p.waitForTimeout(1500);
  const btn = p.locator("[data-refile]").first();
  ok("a presenter whose filing failed has a Retry filing button", (await btn.count()) === 1);
  await btn.evaluate((e) => e.click()); await p.waitForTimeout(400);
  ok("after a retry that worked, it says 'Filed to SharePoint.' (it used to say it was still failing)", /Filed to SharePoint\./.test(await p.locator(".toast").innerText()), await p.locator(".toast").innerText().catch(() => ""));
  answer = { ok: true, delivery: { filing: { ok: false, error: "The folder is gone" } } };
  await p.waitForTimeout(1500);
  const btn2 = p.locator("[data-refile]").first(); await btn2.evaluate((e) => e.click()); await p.waitForTimeout(400);
  ok("after a retry that failed again, it says so, with the reason", /Still failing: The folder is gone/.test(await p.locator(".toast").innerText()), await p.locator(".toast").innerText().catch(() => ""));
  await p.close();
}
// readable grey text
{
  const p = await as("treasurer@ongia.ca", "Raj Jaswal", { width: 1440, height: 900 });
  const ratio = await p.evaluate(() => {
    const c = getComputedStyle(document.documentElement).getPropertyValue("--muted").trim();
    const L = (h) => { const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    return ["#fafaf7", "#edeae2", "#f2efe8", "#e9e4d8"].map((bg) => (Math.max(L(c), L(bg)) + 0.05) / (Math.min(L(c), L(bg)) + 0.05));
  });
  ok("the grey text is at least 4.5:1 against every background the desk uses (accessibility AA)", ratio.every((x) => x >= 4.5), JSON.stringify(ratio));
  await p.close();
}
await b.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
