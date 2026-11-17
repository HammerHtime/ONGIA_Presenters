// RBH's sponsorship report (Andrew 17 Nov 2026): "RBH presented" ticked on an ONGIA event's Edit event page (never on an
// RBH event), and Reports › RBH › Sponsorship listing those events with the typed-in figures and the digital reach.
// Readable at 390 wide, with no sideways scroll.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const T = Date.now().toString(36), YEAR = "2034";
const mk = async (title, city, dayOne, extra = {}) => (await api("/api/events", { method: "POST", body: JSON.stringify({ title, city, dayOne, lastDay: dayOne, invite: false, presenters: [],
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }], ...extra }) })).event;
const regina = await mk(`Prairie Symposium ${T}`, "Regina, SK", `${YEAR}-05-05`);
await mk(`RBH ITP ${T}`, "Montréal, QC", `${YEAR}-02-08`, { kind: "rbh", province: "QC", invoicePrefix: "SP" });

const asAndrew = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (w, h, v) => {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await p.addInitScript(([t, x]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(x)); } catch {} }, [asAndrew, { email: "president@ongia.ca", name: "Andrew Hammond" }]);
  p.errs = []; p.on("pageerror", (e) => p.errs.push(String(e)));
  await p.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify(v)), { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
  return p;
};
const D = process.env.SHOTS || "";

// Edit event: the box under RBH, ticked and saved.
let p = await open(1280, 1000, { name: "edit", eventId: regina.id });
const det = p.locator("details.settings", { has: p.locator("#e-rbhpres") });
ok("Edit event has RBH presented, under RBH, unticked", await p.locator("#e-rbhpres").count() === 1 && !(await p.locator("#e-rbhpres").isChecked()));
await det.locator("summary").click();
ok("ticking This is an RBH event hides it (RBH's own events are counted in the other report)", await (async () => { await p.check("#e-rbh"); const h = await p.locator("#e-rbhpres-row").isHidden(); await p.uncheck("#e-rbh"); return h && await p.locator("#e-rbhpres-row").isVisible(); })());
await p.check("#e-rbhpres");
if (D) await det.screenshot({ path: D + "/sp-edit.png" });
await p.locator("button", { hasText: /^Save/ }).first().click(); await p.waitForTimeout(1500);
const saved = (await api(`/api/events?id=${regina.id}`)).event;
ok("saved on the event", saved.rbhPresented === true && saved.kind !== "rbh", JSON.stringify({ rbhPresented: saved.rbhPresented, kind: saved.kind }));
await p.close();
p = await open(1280, 1000, { name: "event", eventId: regina.id });
ok("the event's header says RBH presented", /RBH presented/i.test(await p.locator(".bhead h2").first().innerText().catch(() => "")), await p.locator("h2").first().innerText().catch(() => ""));
await p.close();

// Reports › RBH › Sponsorship at phone width.
p = await open(390, 844, { name: "reports", sub: "rbh", year: YEAR });
ok("RBH reports opens on the trainings report, with a Sponsorship switch", await p.locator('[data-rbhtrack=""].solid').count() === 1 && await p.locator('[data-rbhtrack="sponsor"]').count() === 1);
await p.click('[data-rbhtrack="sponsor"]'); await p.waitForTimeout(1500);
const body = await p.locator("#root").innerText();
ok("Sponsorship lists the ONGIA event ticked RBH presented, not the RBH training", body.includes(`Prairie Symposium ${T}`) && !body.includes(`RBH ITP ${T}`), body.slice(0, 600));
ok("its card names the sponsorship report and its own folder", /sponsorship report/i.test(body) && body.includes(`RBH/Year end ${YEAR}/Sponsorship`));
await p.fill("#ye-members", "6000"); await p.fill("#ye-campaigns", "4"); await p.fill("#ye-reach", "12000"); await p.click("#ye-save"); await p.waitForTimeout(1500);
const inp = (await api(`/api/reports?list=1&year=${YEAR}&track=sponsor`)).inputs, other = (await api(`/api/reports?list=1&year=${YEAR}`)).inputs;
ok("its figures are saved to the sponsorship report only, with the digital reach", inp.members === 6000 && inp.campaigns === 4 && inp.reach === 12000 && other.members == null, JSON.stringify({ inp, other }));
ok("the switch stays on Sponsorship after saving", await p.locator('[data-rbhtrack="sponsor"].solid').count() === 1);
ok("nothing scrolls sideways at 390", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), String(await p.evaluate(() => document.documentElement.scrollWidth)));
if (D) await p.screenshot({ path: D + "/sp-390.png", fullPage: true });
ok("no script errors", !p.errs.length, p.errs.join(" | "));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
