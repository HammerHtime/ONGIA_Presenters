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
// Days are Toronto days, as the desk counts them (todayIso), not UTC: from 7 or 8 p.m. in Toronto the UTC date is already
// tomorrow, so "yesterday" would be today and the event would rightly still be Coming up. TEST_NOW (any Date.parse-able
// time) fakes the clock here and in the page, to check the evening window on demand.
const { todayIso } = await import(new URL("../../netlify/functions/lib/deadlines.mjs", import.meta.url));
const NOW = process.env.TEST_NOW ? Date.parse(process.env.TEST_NOW) : null;
const iso = (n) => new Date(Date.parse(todayIso(NOW == null ? new Date() : new Date(NOW))) + n * 864e5).toISOString().slice(0, 10);
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Downloads test ${T}`, city: "Toronto, ON", dayOne: iso(-2), lastDay: iso(-1), invite: false,
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }],
  presenters: [{ first: "Dana", last: "Sample", email: `dana.${T}@example.ca`, organization: "Windsor Police Service" }, { first: "Lee", last: "Other", email: `lee.${T}@example.ca`, organization: "OPP" }] }) })).event;
// The edges, so the list is checked on its own fixtures and not on whatever else happens to be in the store.
const mk = async (name, dayOne, lastDay) => (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Downloads ${name} ${T}`, city: "Toronto, ON", dayOne, lastDay, invite: false, board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }] }) })).event;
const endsToday = await mk("ends today", iso(-1), iso(0)), later = await mk("later", iso(5), iso(5));
const edgeIn = await mk("ended 30 days ago", iso(-32), iso(-30)), edgeOut = await mk("ended 31 days ago", iso(-31), iso(-31));

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errs = [];
const a = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
a.on("pageerror", (e) => errs.push(String(e)));
if (NOW != null) await a.clock.setFixedTime(NOW);
await a.addInitScript(() => { sessionStorage.setItem("ongia-admin-key", "testkey"); });
await a.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await a.waitForTimeout(1500);
const nav = a.locator("#downloadsnav");
ok("Downloads is in the left nav", await nav.count() === 1);
await a.evaluate(() => document.getElementById("downloadsnav").click()); await a.waitForTimeout(1500);
const chosen = await a.locator("#dl-ev").inputValue();
const all = (await api("/api/events")).events.filter((e) => !e.project && e.kind !== "project" && !e.practice && e.dayOne);
const today = iso(0), end = (e) => e.lastDay || e.dayOne;
const next = all.filter((e) => end(e) >= today).sort((x, y) => x.dayOne.localeCompare(y.dayOne))[0];
ok("it opens on the next event", !next || chosen === next.id, `${chosen} vs ${next?.id}`);
const order = await a.evaluate(() => [...document.querySelectorAll("#dl-ev optgroup")].map((g) => [g.label, [...g.querySelectorAll("option")].map((o) => o.value)]));
const days = Object.fromEntries(all.map((e) => [e.id, e.dayOne]));
const coming = order.find(([l]) => l === "Coming up")?.[1] ?? [], held = order.find(([l]) => l === "Just held")?.[1] ?? [];
ok("Coming up first, soonest first", order[0]?.[0] === "Coming up" && coming.every((id, i) => !i || days[coming[i - 1]] <= days[id]), JSON.stringify(order).slice(0, 300));
// Held = finished before today (Toronto) and its last day within the last 30 days, as downloadEvents() counts it.
const ends = Object.fromEntries(all.map((e) => [e.id, end(e)]));
const heldWant = all.filter((e) => end(e) < today && end(e) >= iso(-30)).map((e) => e.id).sort();
ok("then Just held, latest first, nothing older than 30 days", held.includes(ev.id) && JSON.stringify([...held].sort()) === JSON.stringify(heldWant) && held.every((id, i) => !i || days[held[i - 1]] >= days[id]),
  JSON.stringify({ today, held: held.map((id) => [id, days[id], ends[id]]), want: heldWant }).slice(0, 400));
ok("an event ending today (Toronto) is still Coming up, ahead of a later one", coming.includes(endsToday.id) && coming.indexOf(endsToday.id) < coming.indexOf(later.id), JSON.stringify({ today, coming }));
ok("ended 30 days ago is held (by its last day, though it began 32 days ago); 31 days ago is not listed", held.includes(edgeIn.id) && !held.includes(edgeOut.id) && !coming.includes(edgeOut.id));
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
