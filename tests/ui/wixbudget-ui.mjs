// The event budget with its ticket types from Wix (Andrew 30 Oct 2026): prices and sales come in from Wix, each ticket
// type counts as one kind of registration (changeable), and Expected stays the plan. The dev server has no Wix, so the
// page is handed what the server would send for an event with these tickets.
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
const TICKETS = [
  { id: "t-in", ticketId: "t-in", name: "In-person", price: 425, sold: 112, limit: 300, from: "" },
  { id: "t-eb", ticketId: "t-eb", name: "Early bird", price: 375, sold: 40, soldOut: true, from: "" },
  { id: "t-vir:m", ticketId: "t-vir", name: "Virtual · Member", price: 199, sold: 30, shared: true, from: "" },
  { id: "t-vir:n", ticketId: "t-vir", name: "Virtual · Non-member", price: 249, sold: 0, shared: true, from: "" },
  { id: "t-comp", ticketId: "t-comp", name: "Presenter (comp)", price: 0, sold: 12, hidden: true, from: "" },
  { id: "t-cp", ticketId: "t-cp", name: "Community partner", price: 349, sold: 25, from: "Community partners" },
];
let wix = { tickets: TICKETS, at: new Date().toISOString() };

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (w, h, id) => {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true, canCost: true }]);
  p.errs = []; p.on("pageerror", (e) => p.errs.push(String(e))); p.on("dialog", (d) => d.accept());
  await p.route(/\/api\/budget\?/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const r = await route.fetch(); const j = await r.json(); if (!j.live) return route.fulfill({ response: r, json: j }); j.live.wix = wix;
    return route.fulfill({ response: r, json: j });
  });
  await p.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "event", eventId: id, tab: "money" })), { waitUntil: "networkidle" }); await p.waitForTimeout(2000);
  return p;
};

for (const [w, h, tag] of [[1440, 1000, "wide"], [390, 844, "phone"]]) {
  wix = { tickets: TICKETS, at: new Date().toISOString() };
  const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Wix Tickets ${tag} ${T}`, city: "Toronto, ON", dayOne: "2031-05-12", lastDay: "2031-05-13", invite: false,
    board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }] }) })).event;
  const p = await open(w, h, ev.id);
  ok(`${tag}: the questions show Wix's in-person price, not to be typed`, (await p.locator('.sbxq [data-q="inPerson.price"]').inputValue()) === "425" && (await p.locator('.sbxq [data-q="inPerson.price"]').getAttribute("readonly")) !== null);
  ok(`${tag}: and say yes already to the kinds sold on Wix (early bird, community, virtual)`, /on/.test(await p.locator('.sbxq [data-yn="earlyBird"][data-v="1"]').getAttribute("class")) && /on/.test(await p.locator('.sbxq [data-yn="virtual"][data-v="1"]').getAttribute("class")));
  await p.locator('.sbxq [data-q="inPerson.expected"]').fill("250");
  await p.locator("#q-done").click(); await p.waitForTimeout(1600);
  const regTile = () => p.locator(".sbt").filter({ has: p.locator(".k", { hasText: /^Registrations$/i }) });
  const row = (label) => p.locator(".sbreg tbody tr", { hasText: label }).first();
  ok(`${tag}: In person: Wix's price and sold so far, marked Wix, Expected still mine`, /\$425/.test(await row("In person").innerText()) && /112/.test(await row("In person").innerText()) && (await row("In person").locator(".s-wix").count()) === 2 && (await row("In person").locator('[data-k="reg.inPerson.expected"]').inputValue()) === "250", await row("In person").innerText());
  ok(`${tag}: early bird and community from Wix too, the partners' site included`, /\$375/.test(await row("Early bird").innerText()) && /40/.test(await row("Early bird").innerText()) && /\$349/.test(await row("Community").innerText()) && /25/.test(await row("Community").innerText()));
  ok(`${tag}: virtual takes the member and non-member prices and the sales`, /\$199/.test(await row("Virtual").innerText()) && /\$249/.test(await row("Virtual").innerText()) && /30/.test(await row("Virtual").innerText()), await row("Virtual").innerText());
  ok(`${tag}: the list of Wix ticket types, the comp ticket not counted`, (await p.locator(".wixt tbody tr").count()) === 6 && (await p.locator('[data-wixkind="t-comp"]').inputValue()) === "skip" && /hidden on Wix/.test(await p.locator(".wixt").innerText()));
  let B = await saved(ev.id);
  ok(`${tag}: saved with the event: Wix's numbers and my Expected`, B.reg.inPerson.price === 425 && B.reg.inPerson.sold === 112 && B.reg.inPerson.expected === 250 && B.reg.community.sold === 25 && B.reg.virtual.priceNon === 249, JSON.stringify(B.reg));
  ok(`${tag}: the Registrations tile counts what's sold on Wix`, /^207/.test((await regTile().locator(".v").innerText()).trim()), await regTile().innerText());
  await p.locator(".blk.wide").screenshot({ path: D + `wixbudget-${tag}.png` });
  if (tag === "wide") {
    await p.locator('[data-wixkind="t-comp"]').selectOption("inPerson"); await p.waitForTimeout(1500);
    B = await saved(ev.id);
    ok(`${tag}: counting the comp ticket as in person adds its 12 and averages the price over what sold`, B.reg.inPerson.sold === 124 && B.reg.inPerson.price === Math.round(425 * 112 / 124 * 100) / 100 && B.wixKinds["t-comp"] === "inPerson", JSON.stringify(B.reg.inPerson));
    // Sales move on: the next open has Wix's new numbers; my Expected and my choice stay.
    wix = { tickets: TICKETS.map((x) => (x.id === "t-in" ? { ...x, sold: 130 } : x)), at: new Date().toISOString() };
    await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(2000);
    B = await saved(ev.id);
    ok(`${tag}: reopened after more sales: sold so far follows Wix, Expected and the choice stay`, B.reg.inPerson.sold === 142 && B.reg.inPerson.expected === 250 && B.wixKinds["t-comp"] === "inPerson", JSON.stringify(B.reg.inPerson));
    wix = { tickets: [], problem: "Wix wouldn't share this event's ticket types. The Wix API key needs one more permission, Manage Ticket Definitions, added in the Wix dashboard's API Key Manager." };
    await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(2000);
    ok(`${tag}: if Wix won't share them, the page says what to change`, /Manage Ticket Definitions/.test(await p.locator(".wixnote").innerText()));
    await p.locator(".blk.wide").screenshot({ path: D + "wixbudget-refused.png" });
  }
  ok(`${tag}: fits the screen, no page errors`, (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) && !p.errs.length, p.errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
