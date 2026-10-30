// The main room on the event page (Andrew 30 Oct 2026: "every one of those events will have a capacity ... It'd be nice
// to know when we are getting close to capacity"): a tile with the registrations against the seats left once the
// presenters and VIPs are seated, amber when nearly full, red when full; tapping it sets the seats. RBH events too.
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
const presenters = Array.from({ length: 4 }, (_, i) => ({ first: "Presenter", last: `${i + 1}`, email: `rt${T}${i}@example.ca`, organization: "Sample Police" }));
const mk = async (extra) => (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Room Tile ${T}`, city: "Montreal", dayOne: "2031-08-04", lastDay: "2031-08-05", invite: false, presenters,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], ...extra }) })).event;
const people = async (id, n) => fetch(`${S}/api/attendees?event=${id}&csv=1`, { method: "POST", headers: { "x-admin-key": "testkey", "content-type": "text/csv" }, body: "First name,Last name,Email\n" + Array.from({ length: n }, (_, i) => `Guest,${i},g${i}.${id}@example.ca`).join("\n") });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag, kind] of [[1440, 1000, "wide", ""], [390, 844, "phone", "rbh"]]) {
  const ev = await mk(kind ? { kind, province: "QC", invoicePrefix: "RT" } : {});
  await people(ev.id, 37);
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const token = issueSession({ email: "treasurer@ongia.ca", name: "Raj Jaswal" });   // the event's lead, not the president
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "treasurer@ongia.ca", name: "Raj Jaswal" }]);
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "event", eventId: ev.id })), { waitUntil: "networkidle" }); await p.waitForTimeout(1800);
  const t = p.locator("[data-roomset]");
  ok(`${tag}${kind ? " (RBH)" : ""}: the event page has a Room seats tile, asking for the room's capacity`, /Room seats/.test(await t.innerText()) && /Set the room's capacity/.test(await t.innerText()));
  await t.click(); await p.locator("#rm-seats").fill("45"); await p.locator("#rm-vips").fill("2"); await p.locator("#rm-ok").click(); await p.waitForTimeout(1800);
  // 45 seats less 4 presenters and 2 VIPs = 39 for attendees; 37 registered is over 90%.
  ok(`${tag}: 37 registered of 39 seats left for attendees: nearly full, 2 left`, /Nearly full/i.test(await p.locator("[data-roomset]").innerText()) && /37\s*\/\s*39/.test(await p.locator("[data-roomset]").innerText()) && /2 left of 45 seats/.test(await p.locator("[data-roomset]").innerText()), await p.locator("[data-roomset]").innerText());
  await p.locator("[data-roomset]").screenshot({ path: D + `roomtile-${tag}.png` });
  await people(ev.id, 40); await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(1800);
  ok(`${tag}: 40 registered: full, 1 over`, /full/i.test(await p.locator("[data-roomset]").innerText()) && /1 over/.test(await p.locator("[data-roomset]").innerText()) && await p.locator("[data-roomset].full").count() === 1, await p.locator("[data-roomset]").innerText());
  ok(`${tag}: fits, no errors`, (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) && !errs.length, errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
