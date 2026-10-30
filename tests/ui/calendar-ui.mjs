// The year as a calendar (Andrew 30 Oct 2026): Year, Month and List; ONGIA-led navy, RBH teal, other people's conferences
// gold; who's going on every bar (initials on the year, the lead underlined, first names on the month); conferences added
// from the calendar, kept off the events list; no double-booking warnings.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const D = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const roster = (await api("/api/roster")).members;
const T = Date.now().toString(36);
const Y = 2034;   // a year of its own
const who = (re) => roster.find((m) => re.test(m.name));
const andrew = who(/Andrew Hammond/), raj = who(/Raj/), barb = who(/Barb/);
const mk = (title, dayOne, lastDay, board, extra = {}) => api("/api/events", { method: "POST", body: JSON.stringify({ title, city: "Toronto, ON", venue: "Hall", dayOne, lastDay, invite: false, board, ...extra }) });
await mk(`Summit ${T}`, `${Y}-11-07`, `${Y}-11-10`, [{ name: raj.name, email: raj.email, lead: true }, { name: andrew.name, email: andrew.email }]);
await mk(`RBH Week ${T}`, `${Y}-05-08`, `${Y}-05-12`, [{ name: andrew.name, email: andrew.email, lead: true }], { kind: "rbh", province: "QC", invoicePrefix: "RW" });
await api("/api/conferences", { method: "POST", body: JSON.stringify({ title: `Alberta Chiefs ${T}`, from: `${Y}-04-11`, to: `${Y}-04-13`, place: "Calgary, AB", role: "presenting", who: [andrew.email] }) });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (w, h, v) => {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await p.addInitScript(([t, x]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(x)); } catch {} }, [issueSession({ email: andrew.email, name: andrew.name }), { email: andrew.email, name: andrew.name, canCost: true }]);
  p.errs = []; p.on("pageerror", (e) => p.errs.push(String(e))); p.on("dialog", (d) => d.accept());
  await p.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "year", year: Y, ...v })), { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  return p;
};
const row = (p, title) => p.locator(".yrw", { hasText: title });
const colour = (l) => l.evaluate((e) => getComputedStyle(e).backgroundColor);

let p = await open(1440, 1000, { cal: "year" });
ok("Year: every event and conference a row, earliest first", (await p.locator(".yrw:not(.yhd) .yname b").allInnerTexts()).filter((t) => t.includes(T)).join("|") === `Alberta Chiefs ${T}|RBH Week ${T}|Summit ${T}`);
const [cOng, cRbh, cExt] = [await colour(row(p, `Summit ${T}`).locator(".ybar")), await colour(row(p, `RBH Week ${T}`).locator(".ybar")), await colour(row(p, `Alberta Chiefs ${T}`).locator(".ybar"))];
ok("three colours: ONGIA-led navy, RBH teal, conferences gold", cOng === "rgb(26, 47, 94)" && cRbh === "rgb(31, 111, 106)" && cExt === "rgb(184, 146, 42)", JSON.stringify([cOng, cRbh, cExt]));
const sum = await row(p, `Summit ${T}`).innerText();
ok("each bar has its dates and who's going as plain initials, the lead underlined", /Nov 7–10/.test(sum) && /RJ\s*\/\s*AH/.test(sum) && await row(p, `Summit ${T}`).locator(".yini u", { hasText: "RJ" }).count() === 1 && await row(p, `Summit ${T}`).locator(".pc, em").count() === 0, sum);
ok("a conference says Presenting under its name", /Calgary, AB · Presenting/.test(await row(p, `Alberta Chiefs ${T}`).innerText()));
ok("no double-booking warning, though Andrew is on two things", await p.locator(".clash").count() === 0 && !/booked twice/i.test(await p.locator("#root").innerText()));
ok("Show counts each kind", /ONGIA-led\s*\d+/.test(await p.locator(".calside").innerText()) && /External conference\s*1/.test(await p.locator(".calside").innerText()));
await p.locator(".calmain").screenshot({ path: D + "calendar-year.png" });
// Show and Who.
await p.locator('[data-calshow="ext"]').uncheck(); await p.waitForTimeout(900);
ok("unticking External conference hides the conferences", await row(p, `Alberta Chiefs ${T}`).count() === 0 && await row(p, `Summit ${T}`).count() === 1);
await p.locator('[data-calshow="ext"]').check(); await p.waitForTimeout(900);
await p.selectOption("#calwho", raj.email); await p.waitForTimeout(900);
ok("Who: Raj shows only where Raj is going", await row(p, `Summit ${T}`).count() === 1 && await row(p, `RBH Week ${T}`).count() === 0 && await row(p, `Alberta Chiefs ${T}`).count() === 0);
await p.selectOption("#calwho", ""); await p.waitForTimeout(900);
// Add a conference from the calendar.
await p.locator("#addconf").click(); await p.waitForTimeout(400);
await p.fill("#cf-title", `Arizona Gang ${T}`); await p.fill("#cf-from", `${Y}-06-19`); await p.fill("#cf-to", `${Y}-06-22`); await p.fill("#cf-place", "Phoenix, AZ");
await p.locator(`#cf-who [data-who="${andrew.email.toLowerCase()}"]`).click(); await p.locator(`#cf-who [data-who="${barb.email.toLowerCase()}"]`).click();
await p.locator(".confdlg").screenshot({ path: D + "calendar-addconf.png" });
await p.locator("#cf-save").click(); await p.waitForTimeout(1500);
ok("Add a conference puts it on the calendar, attending, with who's going", /Phoenix, AZ · Attending/.test(await row(p, `Arizona Gang ${T}`).innerText()) && /AH\s*\/\s*BK/.test(await row(p, `Arizona Gang ${T}`).innerText()));
const ev = await api("/api/events");
ok("and it is not an event: the events list doesn't have it", !ev.events.some((e) => e.title.includes(`Arizona Gang ${T}`)));
await row(p, `Arizona Gang ${T}`).locator(".yname").click(); await p.waitForTimeout(400);
ok("clicking it opens it to change", (await p.inputValue("#cf-title")) === `Arizona Gang ${T}`);
await p.locator('#cf-role [data-role="presenting"]').click(); await p.locator("#cf-save").click(); await p.waitForTimeout(1500);
ok("changed to presenting", /Presenting/.test(await row(p, `Arizona Gang ${T}`).innerText()));
await row(p, `Arizona Gang ${T}`).locator(".yname").click(); await p.waitForTimeout(400);
await p.locator("#cf-del").click(); await p.waitForTimeout(1500);
ok("Take it off removes it", await row(p, `Arizona Gang ${T}`).count() === 0);
ok("Year: no errors, no sideways scroll", !p.errs.length && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), p.errs.join(" | "));
await p.close();

// Month: first names only.
p = await open(1440, 1000, { cal: "month", month: 11 });
const bar = p.locator(".mbar", { hasText: `Summit ${T}` });
ok("Month: the event spans its days, with first names only, the lead underlined", /Raj, Andrew/.test(await bar.innerText()) && !/Jaswal|Hammond/.test(await bar.innerText()) && await bar.locator("small u", { hasText: "Raj" }).count() === 1, await bar.innerText());
ok("Month: Nov is the month shown", /November/.test(await p.locator(".calnav").innerText()));
await p.locator("#yprev").click(); await p.waitForTimeout(1200);
ok("Month: ‹ goes to October", /October/.test(await p.locator(".calnav").innerText()));
await p.locator(".calmain").screenshot({ path: D + "calendar-month.png" });
await bar.count();
await p.close();

// List, and a phone opening on the list.
p = await open(390, 844, {});
ok("phone: opens on the List, every item with its dates and first names", await p.locator(".calseg .on").innerText() === "List" && /Apr 11–13/.test(await p.locator(".crow", { hasText: `Alberta Chiefs ${T}` }).innerText()) && /Andrew/.test(await p.locator(".crow", { hasText: `Alberta Chiefs ${T}` }).innerText()));
await p.locator(".crow", { hasText: `RBH Week ${T}` }).click(); await p.waitForTimeout(1500);
ok("phone: an event in the list opens it", (await p.locator(".bhead h2").innerText().catch(() => "")).includes(`RBH Week ${T}`));
ok("phone: no errors, no sideways scroll", !p.errs.length && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), p.errs.join(" | "));
await p.close();
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
