// Adding a line to an approved statement of work, on the screen (Andrew 29 Oct 2026: sporting event tickets).
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
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `RBH VIP ${T}`, city: "Montreal, QC", venue: "V", dayOne: "2026-11-23", lastDay: "2026-11-27", invite: false, kind: "rbh", province: "QC", invoicePrefix: "ADU",
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }] }) })).event;
let s = await api(`/api/sow?event=${ev.id}&create=1`, { method: "POST", body: JSON.stringify({ from: "standard" }) });
await api(`/api/sow?event=${ev.id}`, { method: "PUT", body: JSON.stringify({ lines: s.sow.lines.map((l, i) => ({ ...l, estimate: 1000 * (i + 1) })), taxes: s.sow.taxes }) });
for (const st of ["submitted", "approved"]) await api(`/api/sow?event=${ev.id}&status=${st}`, { method: "PUT", body: "{}" });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1280, 900, "laptop"], [390, 844, "phone"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true }]);
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(`${S}/admin.html#event/${ev.id}`, { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  await p.locator('.etab[data-tab="money"]').click(); await p.waitForTimeout(1200);
  const fold = p.locator("#sowcard"); if (!(await fold.evaluate((d) => d.open))) await fold.locator("summary").first().click();
  const add = p.locator("#sw-add");
  ok(`${tag}: on an approved SOW, Add a line is there and says it's not in the agreed SOW`, await add.isEnabled() && /not in the agreed SOW/.test(await add.innerText()), await add.innerText());
  if (tag === "laptop") {
    await add.click(); await p.waitForTimeout(800);
    const row = p.locator("#sw-table tr.added").last();
    await row.locator(".ln-name").fill(`Entertainment: sporting event tickets ${T}`);
    await row.locator(".ln-act").fill("1240"); await p.waitForTimeout(2800);
    const saved = (await api(`/api/sow?event=${ev.id}`)).sow.lines.find((l) => l.added);
    ok(`${tag}: it saves as typed, marked added, with no agreed amount`, saved?.name === `Entertainment: sporting event tickets ${T}` && saved.actual === 1240 && saved.estimate === 0, JSON.stringify(saved));
  }
  const row = p.locator("#sw-table tr.added").first();
  ok(`${tag}: the new line says it was added after approval and is on the invoice only`, /Added after approval/.test(await row.innerText()));
  ok(`${tag}: its name can be typed in, its SOW estimate can't; the agreed lines stay locked`, await row.locator(".ln-name").isEnabled() && !(await row.locator(".ln-est").isEnabled()) && !(await p.locator("#sw-table tr:not(.added) .ln-name").first().isEnabled()));
  await p.locator("#sw-table").screenshot({ path: D + `sow-addline-${tag}.png` });
  ok(`${tag}: fits, no page errors`, (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) && !errs.length, errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
