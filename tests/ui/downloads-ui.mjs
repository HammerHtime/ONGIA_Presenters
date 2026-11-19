// Downloads in the left nav (Andrew 19 Nov 2026: "We have a reports and then maybe downloads on the left-hand side,
// but we still keep the button to export or download on each page as well … keep everything tight"). One event at a
// time, one line per file, Download or why not yet. 390 wide.
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
const D = new URL(".", import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const T = Date.now().toString(36);
const iso = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Downloads test ${T}`, city: "Toronto, ON", dayOne: iso(-2), lastDay: iso(-1), invite: false,
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }],
  presenters: [{ first: "Dana", last: "Sample", email: `dana.${T}@example.ca`, organization: "Windsor Police Service" }, { first: "Lee", last: "Other", email: `lee.${T}@example.ca`, organization: "OPP" }] }) })).event;

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errs = [];
const a = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
a.on("pageerror", (e) => errs.push(String(e)));
await a.addInitScript(() => { sessionStorage.setItem("ongia-admin-key", "testkey"); });
await a.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await a.waitForTimeout(1500);
const nav = a.locator("#downloadsnav");
ok("Downloads is in the left nav", await nav.count() === 1);
await a.evaluate(() => document.getElementById("downloadsnav").click()); await a.waitForTimeout(1500);
const chosen = await a.locator("#dl-ev").inputValue();
const held = (await api("/api/events")).events.find((e) => e.id === chosen);
ok("it opens on an event just held", held && held.dayOne === iso(-2), chosen);
if (chosen !== ev.id) { await a.selectOption("#dl-ev", ev.id); await a.waitForTimeout(1500); }
const body = await a.locator("#root").innerText();
ok("grouped: People, Program, Venue, Survey", ["PEOPLE", "PROGRAM", "VENUE", "SURVEY"].every((g) => body.toUpperCase().includes(g)));
ok("no contract: says None uploaded, no button", /None uploaded/.test(body) && /Not signed yet/.test(body));
ok("the presenters sheet has a Download", await a.locator(".dlrow", { hasText: "Presenters: name and agency" }).locator("button").count() === 1);
ok("a file it can't give yet says why instead of a button", /No survey/.test(body) && await a.locator(".dlrow", { hasText: "Results summary" }).locator("button").count() === 0);
ok("every row is one line, about 38px", await a.evaluate(() => [...document.querySelectorAll(".dlrow")].every((r) => r.getBoundingClientRect().height <= 42)));
ok("nothing scrolls sideways", await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
const [dl] = await Promise.all([a.waitForEvent("download", { timeout: 8000 }), a.locator(".dlrow", { hasText: "Presenters: name and agency" }).locator("button").click()]);
ok("Download saves the presenters sheet", /\.xlsx$/.test(dl.suggestedFilename()), dl.suggestedFilename());
if (D) await a.screenshot({ path: D + "downloads.png", fullPage: true });
await a.setViewportSize({ width: 1280, height: 900 }); await a.waitForTimeout(300);
ok("on a computer the 'for' label shows", await a.locator(".dlrow .dlf").first().isVisible());
ok("no script errors", !errs.length, errs.join(" | "));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
