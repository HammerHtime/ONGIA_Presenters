// The welcome card lists the registrations a letter can't greet by name, and the email itself reads "Hello," for them
// (Andrew 28 Oct 2026: a test welcome letter opened "Hello D22,").
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
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Names ${T}`, city: "Toronto, ON", venue: "Hall", dayOne: shift(14), lastDay: shift(14), invite: false,
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }] }) })).event;
// The guest list, as a CSV (the way in without Wix). The first on it is who a preview is made out to.
const put = await fetch(`${S}/api/attendees?event=${ev.id}&csv=1`, { method: "POST", headers: { "x-admin-key": "testkey", "content-type": "text/csv" },
  body: `First Name,Last Name,Email,Guest Status\nD22,,d22.${T}@example.ca,Attending\nari,Lane,ari.${T}@example.ca,Attending\n` });
console.log("   the guest list:", put.status, JSON.stringify(await put.json()).slice(0, 160));

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1440, 1000, "wide"], [390, 844, "phone"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true }]);
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(`${S}/admin.html#event/${ev.id}`, { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  await p.locator('.etab[data-tab="communications"]').click(); await p.waitForTimeout(1200);
  const box = p.locator("#wlbox");
  const note = await box.innerText();
  ok(`${tag}: the card says one registration has no usable first name`, /1 registration doesn't have a usable first name, so their letter opens with just "Hello,"/.test(note), put?.status + " " + note.slice(0, 300));
  await box.locator("details.note summary").click(); await p.waitForTimeout(200);
  ok(`${tag}: and names it, with the email, to fix in Wix`, /"D22" · d22\./.test(await box.locator("details.note").innerText()));
  await box.locator("details.note").screenshot({ path: D + `firstname-note-${tag}.png` });
  await box.locator("[data-wlsee]").first().click(); await p.waitForTimeout(1500);
  const mail = await p.frameLocator("#wl-frame").locator("body").innerText();
  ok(`${tag}: the email made out to that person opens "Hello,"`, /(^|\n)Hello,\s*\n/.test(mail) && !/D22/.test(mail), mail.slice(0, 200));
  await p.locator("#wldlg").screenshot({ path: D + `firstname-email-${tag}.png` });
  ok(`${tag}: fits the screen, no page errors`, (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) && !errs.length, errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
