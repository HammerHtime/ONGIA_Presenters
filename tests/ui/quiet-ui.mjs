// Nothing automatic on the event page (Andrew 18 Nov 2026, the RBH VIP Event): ticked in Edit event, it shows on the
// event's title line, takes attendee emails off with it, and the Communications tab says nothing goes by itself.
// A made-up event; nothing is sent.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const D = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[390, 844, "phone"], [1440, 900, "wide"]]) {
  const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: "VIP Training " + tag, city: "Montréal, QC", dayOne: "2031-02-01", lastDay: "2031-02-02", invite: false, presenters: [],
    board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }] }) })).event;
  await api(`/api/events?id=${ev.id}&attendeeMail=1`, { method: "PUT", body: JSON.stringify({ on: true }) });
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await p.addInitScript(([t]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify({ email: "president@ongia.ca", name: "Andrew Hammond", owner: true, canCost: true })); } catch {} }, [token]);
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  const view = (tab) => `${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "event", eventId: ev.id, tab }));
  await p.goto(view("overview"), { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
  ok(`${tag}: off to start, no tag on the title`, !/nothing automatic/i.test(await p.locator(".bhead h2").innerText()));
  await p.locator("#edit").click(); await p.waitForTimeout(800);
  const fold = p.locator("details.settings", { has: p.locator("#e-quiet") });
  ok(`${tag}: Edit event has a Nothing automatic fold, closed while it's off`, await fold.count() === 1 && !(await fold.evaluate((d) => d.open)));
  await fold.locator("summary").click(); await p.waitForTimeout(200);
  ok(`${tag}: attendee emails ticked before`, await p.locator("#e-amail").isChecked());
  await p.locator("#e-quiet").check(); await p.waitForTimeout(200);
  ok(`${tag}: ticking it unticks attendee emails and locks them`, !(await p.locator("#e-amail").isChecked()) && await p.locator("#e-amail").isDisabled());
  await fold.scrollIntoViewIfNeeded(); await fold.screenshot({ path: D + `quiet-setting-${tag}.png` });
  ok(`${tag}: nothing scrolls sideways`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await p.locator("#create").click(); await p.waitForTimeout(2000);
  const e = (await api(`/api/events?id=${ev.id}`)).event;
  ok(`${tag}: saved: Nothing automatic on, attendee emails off`, e.quiet === true && e.attendeeMail === false, JSON.stringify({ quiet: e.quiet, am: e.attendeeMail }));
  await p.goto(view("overview"), { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
  ok(`${tag}: the title line says Nothing automatic`, /nothing automatic/i.test(await p.locator(".bhead h2").innerText()));
  await p.locator(".evband").screenshot({ path: D + `quiet-head-${tag}.png` });
  await p.goto(view("communications"), { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  const sw = p.locator(".mailsw");
  ok(`${tag}: Communications says nothing goes by itself, with no switch to turn attendee emails on`, /Nothing automatic is on for this event, so nothing goes by itself/.test(await sw.innerText()) && await p.locator("#amail").count() === 0, await sw.innerText());
  await sw.screenshot({ path: D + `quiet-comms-${tag}.png` });
  // Off again from Edit event: the fold is open because it's on, and attendee emails can be ticked again.
  await p.goto(view("overview"), { waitUntil: "networkidle" }); await p.waitForTimeout(1000);
  await p.locator("#edit").click(); await p.waitForTimeout(800);
  ok(`${tag}: while on, its fold opens by itself and says On`, await fold.evaluate((d) => d.open) && /Nothing automatic · On/i.test(await fold.locator("summary").innerText()));
  await p.locator("#e-quiet").uncheck(); await p.waitForTimeout(200);
  ok(`${tag}: unticked, attendee emails can be ticked again`, !(await p.locator("#e-amail").isDisabled()));
  await p.locator("#create").click(); await p.waitForTimeout(2000);
  ok(`${tag}: saved off`, (await api(`/api/events?id=${ev.id}`)).event.quiet === false);
  ok(`${tag}: no script errors`, errs.length === 0, errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
