// Which events still have no signed hotel contract, at a glance (Andrew 29 Oct 2026: "none of these events can go
// forward, or we can start building out the ticket sales and looking for presenters until we lock in the hotel contract
// ... I need to know from the events page or the upcoming events page so I can look at it in a glance"). The checklist's
// "Contract signed" job is what says so; the event page offers to tick it.
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
const mk = async (title, extra = {}) => (await api("/api/events", { method: "POST", body: JSON.stringify({ title, city: "Ottawa, ON", venue: "Hotel", dayOne: shift(60), lastDay: shift(62), invite: false,
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }], ...extra }) })).event;
const held = await mk(`Held Dates ${T}`, { kind: "rbh", province: "ON", invoicePrefix: "HLD" });
const signed = await mk(`Signed Hotel ${T}`);
// The signed one: its checklist's Contract signed job ticked.
await api(`/api/tasks?event=${signed.id}&seed=1`, { method: "POST", body: "{}" });
let job = (await api(`/api/tasks?event=${signed.id}`)).tasks.find((t) => /^contract signed/i.test(t.what));
if (!job) job = (await api(`/api/tasks?event=${signed.id}`, { method: "POST", body: JSON.stringify({ what: "Contract signed", daysBefore: null }) })).tasks.find((t) => /^contract signed/i.test(t.what));
await api(`/api/tasks?event=${signed.id}&id=${job.id}`, { method: "PUT", body: JSON.stringify({ done: true }) });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[390, 844, "phone"], [1440, 1000, "wide"]]) {   // the phone first: the wide run ticks it
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true }]);
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  const row = (id) => p.locator(`tr.evrow[data-open="${id}"]`);
  ok(`${tag}: the event with no signed contract says Hotel not signed, its dates held, not locked`, /Hotel not signed/i.test(await row(held.id).innerText()) && /held, not locked/i.test(await row(held.id).innerText()), await row(held.id).innerText());
  ok(`${tag}: the event whose contract is signed doesn't`, !/Hotel not signed|held, not locked/i.test(await row(signed.id).innerText()), await row(signed.id).innerText());
  ok(`${tag}: a line over the list counts them`, /\d+ of \d+\s+upcoming events? ha(s|ve) no signed hotel contract yet/.test(await p.locator(".lockline").innerText()), await p.locator(".lockline").innerText().catch(() => "none"));
  await p.locator(".lockline").screenshot({ path: D + `hotellock-line-${tag}.png` });
  await row(held.id).scrollIntoViewIfNeeded();
  await row(held.id).screenshot({ path: D + `hotellock-row-${tag}.png` });
  await row(signed.id).screenshot({ path: D + `hotellock-signed-${tag}.png` });
  if (tag === "wide") {
    await row(held.id).click(); await p.waitForTimeout(1500);
    ok(`${tag}: the event page says the hotel contract isn't signed, with a button to say it is`, /Hotel contract not signed yet/.test(await p.locator(".lockbar").innerText()) && await p.locator("#lock-hotel").isVisible());
    await p.locator(".bhead").screenshot({ path: D + "hotellock-event.png" });
    await p.locator("#lock-hotel").click(); await p.waitForTimeout(1800);
    const t = (await api(`/api/tasks?event=${held.id}`)).tasks.find((x) => /^contract signed/i.test(x.what));
    ok(`${tag}: pressing it ticks Contract signed on the checklist (adding it if the list had none), and the warning goes`, t?.done === true && !(await p.locator(".lockbar").count()), JSON.stringify(t));
  }
  ok(`${tag}: fits the screen, no page errors`, (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) && !errs.length, errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
