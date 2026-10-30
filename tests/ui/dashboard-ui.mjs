// The new layout (Andrew 30 Oct 2026, from the mock-ups: "i like the first dashboard"): a sidebar on a wide screen, a narrow
// rail on a laptop, a bottom bar with More on a phone; and the event's Overview: the registrations circle (break-even for
// the president and the VP only), key numbers, quick actions, the survey and certificate cards, and recent activity.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const D = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await fetch(S + "/api/roster", { headers: H });
const PRES = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
// The practice events: a symposium with 24 registered, 20 checked in and 16 survey answers.
const made = await (await fetch(S + "/api/sandbox?practice=1", { method: "POST", headers: { "x-admin-key": PRES, "content-type": "application/json" }, body: "{}" })).json();
const ev = made.events.find((e) => e.kind !== "rbh");
await fetch(`${S}/api/events?id=${ev.id}&room=1`, { method: "PUT", headers: { "x-admin-key": PRES, "content-type": "application/json" }, body: JSON.stringify({ seats: 60, vips: 2 }) });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (w, h, hash = "", who = { email: "president@ongia.ca", name: "Andrew Hammond", canCost: true, owner: true }) => {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await p.addInitScript(([t, x]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(x)); } catch {} }, [issueSession(who), who]);
  p.errs = []; p.on("pageerror", (e) => p.errs.push(String(e))); p.on("dialog", (d) => d.accept());
  await p.goto(`${S}/admin.html${hash}`, { waitUntil: "networkidle" }); await p.waitForTimeout(1600);
  if (await p.locator("dialog.walk[open]").count()) { await p.locator("#wclose").click(); await p.waitForTimeout(400); }
  return p;
};
const evHash = (tab = "overview") => "#v=" + encodeURIComponent(JSON.stringify({ name: "event", eventId: ev.id, tab }));
const box = (p, sel) => p.locator(sel).boundingBox();
const regText = (p) => p.locator(".regcard").evaluate((e) => e.textContent.replace(/\s+/g, " "));

// The sidebar, wide.
let p = await open(1440, 900);
ok("wide: a sidebar down the left, with the logo and every way around", (await box(p, "#side")).width > 200 && await p.locator("#side .slogo").isVisible()
  && ["#eventsnav", "#theyear", "#letters", "#admin", "#sowsnav", "#sandboxnav"].every(async (id) => await p.locator(`#side ${id}`).isVisible()));
ok("wide: Events is lit up on the events list", await p.locator("#side #eventsnav.on").count() === 1);
ok("wide: the top bar keeps the search and New event", await p.locator(".bar #hsearch").isVisible() && await p.locator(".bar #newevent").isVisible());
await p.locator("#side .slogo").evaluate((img) => { img.dataset.mark = "kept"; });
await p.locator("#theyear").click(); await p.waitForTimeout(900);
ok("wide: going to another screen leaves the sidebar as it was (the same logo, not drawn again)", await p.locator('#side .slogo[data-mark="kept"]').count() === 1);
ok("wide: The year opens, and is the one lit up", await p.locator("#side #theyear.on").count() === 1 && await p.locator("#side #eventsnav.on").count() === 0);
ok("wide: who's signed in, at the foot of the sidebar", /Andrew Hammond/.test(await p.locator("#side .sme").innerText()) && /President/.test(await p.locator("#side .sme").innerText()));
await p.screenshot({ path: D + "dashboard-side-wide.png" });
await p.close();

// A laptop: the narrow rail, names under the icons.
p = await open(1280, 800);
const rail = await box(p, "#side");
ok("laptop: a narrow rail, each button still named", rail.width < 100 && /The year/.test(await p.locator("#theyear").innerText()) && await p.locator("#theyear span").isVisible());
ok("laptop: no sideways scroll", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await p.close();

// A phone: a bar along the bottom; More holds the rest.
p = await open(390, 844);
const bar = await box(p, "#side");
ok("phone: the bar sits along the bottom", Math.round(bar.y + bar.height) === 844 && bar.width === 390, JSON.stringify(bar));
ok("phone: Events, The year, Letters, Admin and More on it", ["#eventsnav", "#theyear", "#letters", "#admin", "#snmore"].length === 5 && await p.locator("#snmore").isVisible() && !(await p.locator("#sowsnav").isVisible()));
await p.locator("#snmore").click(); await p.waitForTimeout(300);
ok("phone: More opens RBH SOWs and the Sandbox", await p.locator("#sowsnav").isVisible() && await p.locator("#sandboxnav").isVisible());
await p.screenshot({ path: D + "dashboard-more-phone.png" });
await p.locator(".bar").click({ position: { x: 200, y: 10 } }).catch(() => {}); await p.waitForTimeout(300);
ok("phone: tapping elsewhere closes it", !(await p.locator("#sowsnav").isVisible()));
await p.locator("#snmore").click(); await p.locator("#sowsnav").click(); await p.waitForTimeout(1200);
ok("phone: and RBH SOWs opens its page", /RBH|statement/i.test(await p.locator("#root").innerText()));
ok("phone: no sideways scroll, no errors", (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) && !p.errs.length, p.errs.join(" | "));
await p.close();

// The Overview, as the president: the registrations circle with no budget yet, then with one.
p = await open(1440, 1000, evHash());
let reg = await regText(p);
ok("Overview: the registrations circle, registrations against the room's attendee seats", /24\s*of 58 seats/.test(reg) && /34 seats left/.test(reg), reg);
ok("Overview: no budget yet, so it offers to set one up for break-even", /Set up the budget/.test(reg));
ok("Overview: key numbers, quick actions, survey, certificates and recent activity", await p.locator(".dash .etile:not(.rback)").count() === 5 && await p.locator(".qact").count() >= 6
  && /Recent activity/.test(await p.locator(".dact").innerText()) && /24 registrations/.test(await p.locator(".dact").innerText()),
  JSON.stringify({ tiles: await p.locator(".dash .etile:not(.rback)").count(), q: await p.locator(".qact").count(), act: (await p.locator(".dact").innerText()).replace(/\s+/g, " ") }));
await p.waitForTimeout(1200);
ok("Overview: the survey card fills in: sent, answers, back", /Survey/.test(await p.locator("#dsurvey").innerText()) && /16\s*Answers/.test(await p.locator("#dsurvey").innerText()), await p.locator("#dsurvey").innerText());
ok("Overview: the certificates card fills in: 20 checked in, 24 registered", /20\s*Checked in/.test(await p.locator("#dcerts").innerText()) && /24\s*Registered/.test(await p.locator("#dcerts").innerText()), await p.locator("#dcerts").innerText());
await p.locator('.qact[data-tgo="program"]').click(); await p.waitForTimeout(400);
ok("Overview: a quick action opens its tab", await p.locator('.etab[data-tab="program"]').getAttribute("aria-selected") === "true");
// A budget, set on Money: back on the Overview the circle has its break-even.
await p.locator('.etab[data-tab="money"]').click(); await p.waitForTimeout(1200);
if (await p.locator("dialog.walk[open]").count()) { await p.locator("#wclose").click(); await p.waitForTimeout(400); }
const set = async (k, v) => { const f = p.locator(`[data-k="${k}"]`); await f.fill(String(v)); await f.press("Tab"); await p.waitForTimeout(900); };
await set("reg.inPerson.price", 2600); await set("reg.inPerson.expected", 50);
if (await p.locator("[data-usual]").count()) { await p.locator("[data-usual]").first().click(); await p.waitForTimeout(1500); }
await p.locator('.etab[data-tab="overview"]').click(); await p.waitForTimeout(1500);
reg = await regText(p);
ok("with a budget: how many more to break even, and gold below it", /\d+ more\s*to break even \(\d+\)/.test(reg) && /Below break-even/i.test(reg) && await p.locator(".regcard .rring line").count() === 2, reg);
await p.locator(".regcard").screenshot({ path: D + "dashboard-ring-below.png" });
await p.locator('.etab[data-tab="money"]').click(); await p.waitForTimeout(800);
await set("reg.inPerson.price", 9000);
await p.locator('.etab[data-tab="overview"]').click(); await p.waitForTimeout(1500);
reg = await regText(p);
ok("priced so 24 is past it: Past break-even, green, the forecast profit", /Past break-even/.test(reg) && /Making money/i.test(reg) && /Forecast profit \$/.test(reg)
  && /47, 107, 79|--done/.test(await p.locator(".regcard .rring circle").nth(1).evaluate((c) => getComputedStyle(c).stroke + c.getAttribute("stroke"))), reg);
await p.locator(".dash").screenshot({ path: D + "dashboard-overview-wide.png" });
ok("Overview: no errors", !p.errs.length, p.errs.join(" | "));
await p.close();

// As a board member who isn't the president or the VP: the seats, no money.
p = await open(1440, 1000, evHash(), { email: "treasurer@ongia.ca", name: "Raj Jaswal" });
reg = await regText(p);
ok("a board member sees the seats, not break-even or profit", /24\s*of 58 seats/.test(reg) && !/break/i.test(reg) && !/profit/i.test(reg) && await p.locator(".regcard .rring line").count() === 0, reg);
await p.close();

// On a phone, the Overview stacks.
p = await open(390, 844, evHash());
ok("phone: the Overview's cards stack, no sideways scroll", (await box(p, ".regcard")).width > 300 && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await p.locator(".dash").screenshot({ path: D + "dashboard-overview-phone.png" });
ok("phone: no errors", !p.errs.length, p.errs.join(" | "));
await p.close();
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
