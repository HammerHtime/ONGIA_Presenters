// The Overview's registrations card, filled in (Andrew 31 Oct 2026: "a lot of wasted space in the registration section"):
// sign-ups week by week, and the top six agencies, each with how many are coming and their share of everyone coming.
// People added by CSV count in their week; the note about Wix only appears for people who came from Wix.
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
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Reg Card ${T}`, city: "Toronto, ON", venue: "Hall", dayOne: "2031-11-10", lastDay: "2031-11-11", invite: false,
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }] }) })).event;
// Twenty people from eight agencies, by CSV (so all added today), plus one not attending.
const ags = [["TPS", 6], ["OPP", 4], ["RCMP", 3], ["Peel Police", 2], ["York Regional Police", 2], ["Durham Regional Police", 1], ["Halton Police", 1], ["Ministry of the Solicitor General of Ontario, Correctional Services Division", 1]];
let rows = "First name,Last name,Email,Organization\n", i = 0;
for (const [a, n] of ags) for (let k = 0; k < n; k++) { i++; rows += `Pat${i},Lee${i},p${i}.${T}@example.ca,${a}\n`; }
await fetch(`${S}/api/attendees?event=${ev.id}&csv=1`, { method: "POST", headers: { "x-admin-key": "testkey", "content-type": "text/csv" }, body: rows });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1440, 1000, "wide"], [390, 844, "phone"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await p.addInitScript(([t, x]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(x)); } catch {} }, [issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" }), { email: "president@ongia.ca", name: "Andrew Hammond", canCost: true }]);
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "event", eventId: ev.id, tab: "overview" })), { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  if (await p.locator("dialog.walk[open]").count()) { await p.locator("#wclose").click(); await p.waitForTimeout(400); }
  const card = p.locator(".regcard");
  const bars = await card.locator(".rgb b").allInnerTexts();
  ok(`${tag}: six weeks of sign-ups, this week's in gold with all 20 (added by CSV, so counted in their week)`, bars.length === 6 && bars[5] === "20" && await card.locator(".rgb.now").count() === 1 && /This wk/.test(await card.locator(".rgb.now").innerText()), JSON.stringify(bars));
  ok(`${tag}: no note about Wix, since nobody came from Wix`, await card.locator(".rgnote").count() === 0);
  const list = await card.locator(".regags li").evaluateAll((els) => els.map((li) => [...li.children].map((c) => c.textContent.trim())));
  ok(`${tag}: "8 agencies", and the top six, most first, each with its count and share of the 20`, /8 agencies/i.test(await card.locator(".regags .rgk").innerText()) && list.length === 6
    && JSON.stringify(list.slice(0, 3)) === JSON.stringify([["Toronto Police Service", "6", "30%"], ["Ontario Provincial Police", "4", "20%"], ["Royal Canadian Mounted Police", "3", "15%"]]), JSON.stringify(list));
  const fits = await card.evaluate((c) => [...c.querySelectorAll(".regags li")].every((li) => li.getBoundingClientRect().right <= c.getBoundingClientRect().right + 0.5));
  ok(`${tag}: every row fits inside the card`, fits);
  await card.screenshot({ path: D + `regcard-${tag}.png` });
  ok(`${tag}: no sideways scroll, no errors`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth) && !errs.length, errs.join(" | "));
  if (tag === "phone") {
    const tops = await p.locator(".qacts .qact").evaluateAll((els) => els.map((e) => [Math.round(e.getBoundingClientRect().left), Math.round(e.getBoundingClientRect().top)]));
    ok("phone: Quick actions sit in two even columns, not a zig-zag", new Set(tops.slice(1).map(([l]) => l)).size === 2 && tops.slice(1).every(([, t], k, a) => k % 2 === 0 || t === a[k - 1][1]), JSON.stringify(tops));
  }
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
