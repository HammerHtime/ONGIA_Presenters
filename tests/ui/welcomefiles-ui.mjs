// Attachments on the welcome letter, on the event's Communications tab (Andrew 27 Oct 2026): add several PDFs at
// once, see them in the email preview, remove one; on a phone too. An event with one group has nothing to tick, so
// they go with the letter at once. (The ticks for two groups are in tests/server/welcomefiles-test.mjs: this local
// server cannot be given a second Wix group.)
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const { writeFileSync, mkdtempSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const D = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const T = Date.now().toString(36);
const shift = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `National Gang Summit ${T}`, city: "Toronto", venue: "Hall", dayOne: shift(40), lastDay: shift(43), invite: false,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }] }) })).event;
const dir = mkdtempSync(tmpdir() + "/wf-");
for (const n of ["Parking map", "Hotel and venue"]) writeFileSync(`${dir}/${n}.pdf`, `%PDF-1.4\n${n}\n%%EOF`);

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (vp) => {
  const page = await b.newPage({ viewport: vp, deviceScaleFactor: 2 });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await page.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true }]);
  page.errs = []; page.on("pageerror", (x) => page.errs.push(String(x)));
  page.on("dialog", (d) => d.accept());
  await page.goto(`${S}/admin.html#event/${ev.id}`, { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
  await page.locator('.etab[data-tab="communications"]').click(); await page.waitForTimeout(800);
  await page.evaluate(() => { const d = document.getElementById("welcomefold"); if (d) d.open = true; }); await page.waitForTimeout(1200);
  return page;
};
const files = async () => (await api(`/api/welcome?event=${ev.id}`)).files;

const p = await open({ width: 1440, height: 1000 });
ok("the welcome letter has an Other attachments box", /Other attachments/.test(await p.locator("#wlbox").innerText()));
await p.locator("#wl-files").setInputFiles([`${dir}/Parking map.pdf`, `${dir}/Hotel and venue.pdf`]); await p.waitForTimeout(2500);
ok("two PDFs added at once", (await p.locator("[data-wfrow]").count()) === 2 && (await files()).length === 2);
ok("with one group there is nothing to tick: both go with the letter", (await p.locator("[data-wftick]").count()) === 0 && (await files()).every((f) => f.main));
ok("the size so far is shown against 3 MB", /This letter: \d+ KB of 3 MB attached/.test(await p.locator("#wlbox").innerText()));
await p.locator('[data-wlsee="main"]').click(); await p.waitForTimeout(1200);
ok("the email preview lists both", /Attached: Parking map\.pdf, Hotel and venue\.pdf/.test(await p.locator("#wld-note").innerText()), await p.locator("#wld-note").innerText());
await p.locator('#wldlg button[value="close"]').click(); await p.waitForTimeout(300);
await p.locator("[data-wfrow]").first().scrollIntoViewIfNeeded();
await p.screenshot({ path: D + "welcome-attachments-wide.png" });
await p.locator("[data-wfrow]").nth(1).locator("[data-wfdel]").click(); await p.waitForTimeout(1200);
ok("Remove takes one off", (await p.locator("[data-wfrow]").count()) === 1 && (await files()).length === 1);
ok("no page errors", p.errs.length === 0, p.errs.join(" | "));
await p.close();

const ph = await open({ width: 390, height: 844 });
await ph.locator("[data-wfrow]").first().scrollIntoViewIfNeeded();
ok("phone: nothing runs off the side", await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await ph.screenshot({ path: D + "welcome-attachments-phone.png" });
ok("phone: no page errors", ph.errs.length === 0, ph.errs.join(" | "));
await ph.close();
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
