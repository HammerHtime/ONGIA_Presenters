// Two people on one event budget (audit, 30 Oct 2026): the president and the VP both have the Money tab open. The president's
// change saves; the VP's, typed on the older copy, is not saved over it. The VP's page says who changed it and offers to
// load their version, and after that the VP's changes save again.
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
const PRES = { "x-admin-key": issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" }) };
const saved = async (id) => (await (await fetch(`${S}/api/budget?event=${id}`, { headers: PRES })).json()).budget;
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Budget Two ${T}`, city: "Regina, SK", venue: "Delta Regina", dayOne: "2031-05-12", lastDay: "2031-05-14", invite: false,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }] }) })).event;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (email, name, w = 1440, h = 1000) => {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [issueSession({ email, name }), { email, name, canCost: true }]);
  p.errs = []; p.on("pageerror", (e) => p.errs.push(String(e))); p.on("dialog", (d) => d.accept());
  await p.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "event", eventId: ev.id, tab: "money" })), { waitUntil: "networkidle" }); await p.waitForTimeout(2000);
  if (await p.locator("dialog.walk[open]").count()) { await p.locator("#wclose").click(); await p.waitForTimeout(500); }
  return p;
};
const type = async (p, v) => { const f = p.locator('[data-k="reg.inPerson.expected"]'); await f.fill(v); await f.press("Tab"); await p.waitForTimeout(1600); };

const pres = await open("president@ongia.ca", "Andrew Hammond");
const vp = await open("vp_operations@ongia.ca", "Barb Konkle", 390, 844);
await type(pres, "200");
ok("the president's change saves", /Saved/.test(await pres.locator("#sbx-said").innerText()) && (await saved(ev.id))?.reg?.inPerson?.expected === 200, JSON.stringify((await saved(ev.id))?.reg?.inPerson));
await type(vp, "150");
const said = await vp.locator("#sbx-said").innerText();
ok("the VP's change, on the older copy, is not saved over it, and says who changed it", /Not saved: Andrew Hammond changed this budget at \d/.test(said) && (await saved(ev.id)).reg.inPerson.expected === 200, said);
ok("it offers to load their version", await vp.locator("#sbx-latest").isVisible());
await vp.locator(".sbxacts").screenshot({ path: D + "budgetconflict-phone.png" });
await type(vp, "175");
ok("typing more doesn't try to save over it either", (await saved(ev.id)).reg.inPerson.expected === 200);
await vp.locator("#sbx-latest").click(); await vp.waitForTimeout(1500);
if (await vp.locator("dialog.walk[open]").count()) { await vp.locator("#wclose").click(); await vp.waitForTimeout(500); }
ok("Load their version shows the president's figure, and the warning goes", (await vp.locator('[data-k="reg.inPerson.expected"]').inputValue()) === "200" && !(await vp.locator("#sbx-latest").count()));
await type(vp, "160");
ok("from there the VP's change saves", /Saved/.test(await vp.locator("#sbx-said").innerText()) && (await saved(ev.id)).reg.inPerson.expected === 160);
await type(vp, "165"); await type(vp, "170");
ok("quick changes one after another all save, none tripping over the one before", /Saved/.test(await vp.locator("#sbx-said").innerText()) && (await saved(ev.id)).reg.inPerson.expected === 170);
// The president changes it while the VP is on another tab: coming back, the VP simply sees the latest, no warning.
await pres.reload({ waitUntil: "networkidle" }); await pres.waitForTimeout(1500);
if (await pres.locator("dialog.walk[open]").count()) { await pres.locator("#wclose").click(); await pres.waitForTimeout(500); }
await type(pres, "185");
ok("(the president's change saves)", (await saved(ev.id)).reg.inPerson.expected === 185);
await vp.locator('.etab[data-tab="overview"]').click(); await vp.waitForTimeout(800);
await vp.locator('.etab[data-tab="money"]').click(); await vp.waitForTimeout(1500);
if (await vp.locator("dialog.walk[open]").count()) { await vp.locator("#wclose").click(); await vp.waitForTimeout(500); }
ok("back on Money, the VP sees the president's figure, with no warning", (await vp.locator('[data-k="reg.inPerson.expected"]').inputValue()) === "185" && !(await vp.locator("#sbx-latest").count()) && !/Not saved/.test(await vp.locator("#sbx-said").innerText()));
await type(vp, "190");
ok("and the VP's next change saves", /Saved/.test(await vp.locator("#sbx-said").innerText()) && (await saved(ev.id)).reg.inPerson.expected === 190);
ok("no page errors",!pres.errs.length && !vp.errs.length, [...pres.errs, ...vp.errs].join(" | "));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
