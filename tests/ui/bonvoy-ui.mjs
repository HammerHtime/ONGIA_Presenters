// The board roster's Marriott Bonvoy box (Andrew 29 Oct 2026), and the rooming-list email it feeds, at phone width.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const D = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const before = (await api("/api/roster")).members;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1280, 900, "laptop"], [390, 844, "phone"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true }]);
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(`${S}/admin.html#v=${encodeURIComponent(JSON.stringify({ name: "admin", tab: "board" }))}`, { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  const box = p.locator('[data-bonvoy="0"]');
  ok(`${tag}: each board member has a Marriott Bonvoy box beside their phone`, await box.isVisible() && (await p.locator("[data-bonvoy]").count()) === before.length);
  if (tag === "laptop") {
    await box.fill("555 000 111"); await p.locator("#ph-save").click(); await p.waitForTimeout(1200);
    ok(`${tag}: Save numbers keeps it`, (await api("/api/roster")).members[0].bonvoy === "555000111");
  }
  await p.locator(".board").screenshot({ path: D + `bonvoy-roster-${tag}.png` });
  ok(`${tag}: fits, no page errors`, (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) && !errs.length, errs.join(" | "));
  await p.close();
}
// The email to the hotel, as it reads on a phone.
const m0 = (await api("/api/roster")).members[0];
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Bonvoy ${Date.now().toString(36)}`, city: "Toronto, ON", venue: "Hotel", dayOne: "2026-11-09", lastDay: "2026-11-12", invite: false,
  board: [{ name: m0.name, email: m0.email, lead: true }] }) })).event;
const r = await api(`/api/rooming?event=${ev.id}`, { method: "PUT", body: JSON.stringify({ guests: [{ name: m0.name, type: "Board Member", checkIn: "2026-11-08", checkOut: "2026-11-12", billing: "Guest" },
  { name: "Pat Example", type: "ONGIA Guest", checkIn: "2026-11-09", checkOut: "2026-11-11", billing: "ONGIA" }] }) });
const pv = await api(`/api/rooming?event=${ev.id}&preview=1`, { method: "POST", body: JSON.stringify({ keys: r.rows.map((x) => x.key) }) });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await p.setContent(pv.html); await p.waitForTimeout(300);
ok("the hotel's email shows the number under the board member's name, and fits a phone", /Marriott Bonvoy 555000111/.test(await p.innerText("body")) && (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)));
await p.screenshot({ path: D + "bonvoy-email-phone.png", fullPage: true });
await b.close();
await api("/api/roster", { method: "PUT", body: JSON.stringify({ members: before }) });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
