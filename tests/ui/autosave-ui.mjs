// Saving as you go (Andrew 29 Oct 2026: "I would like the entire app to save as I go and when i make any changes. I don't
// want to always remember to click save at bottom (except when creating a new event)"). Typing saves a moment after it
// stops, without redrawing the card under the cursor; leaving the box saves at once; a save that fails says so on the
// button. Create event stays a button.
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
const mk = async (extra = {}) => (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Autosave ${T}`, city: "Toronto, ON", venue: "Hall", dayOne: shift(20), lastDay: shift(22), invite: false,
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }], ...extra }) })).event;
const ev = await mk();
const rbh = await mk({ title: `RBH Autosave ${T}`, kind: "rbh", province: "QC", invoicePrefix: "AUT", city: "Montreal, QC" });
await api(`/api/sow?event=${rbh.id}&create=1`, { method: "POST", body: JSON.stringify({ from: "standard" }) });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (w, h, hash) => {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true }]);
  p.errs = []; p.on("pageerror", (e) => p.errs.push(String(e)));
  p.on("dialog", (d) => d.accept());
  await p.goto(`${S}/admin.html${hash}`, { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  return p;
};

console.log("— the welcome letter");
let p = await open(1440, 1000, `#event/${ev.id}`);
await p.locator('.etab[data-tab="communications"]').click(); await p.waitForTimeout(1500);
await p.locator("#wl-main-subject").fill(`Welcome to Toronto ${T}`);
await p.waitForTimeout(2600);
let W = await api(`/api/welcome?event=${ev.id}`);
ok("typing in the subject saves it, with no Save pressed", W.versions[0].subject === `Welcome to Toronto ${T}`, W.versions[0].subject);
ok("the Save button now says Saved ✓, and the cursor is still in the box (nothing redrawn)", /Saved ✓/.test(await p.locator("#wl-save").innerText()) && await p.evaluate(() => document.activeElement?.id === "wl-main-subject"), await p.locator("#wl-save").innerText());
ok("the Not saved yet warning goes once it has saved", !(await p.locator("#wlbox [data-unsaved], [data-unsaved]:has-text('Not saved yet')").count()));
ok("a line under it says changes save as you type", /save as you type/i.test(await p.locator("#wl-save").locator("..").innerText()));
// Typed and straight away off to another tab: leaving the box saves it.
await p.locator("#wl-main-body").fill(`Hello {first},\n\nSee you there ${T}.`);
await p.locator('.etab[data-tab="overview"]').click(); await p.waitForTimeout(1500);
W = await api(`/api/welcome?event=${ev.id}`);
ok("typed and off to another tab at once: it is still saved", W.versions[0].body.includes(`See you there ${T}.`), W.versions[0].body.slice(0, 80));
// A save that fails says so where the Save button is, and pressing it tries again.
await p.locator('.etab[data-tab="communications"]').click(); await p.waitForTimeout(500);
await p.route(/\/api\/welcome\?event=[^&]+$/, (r) => (r.request().method() === "PUT" ? r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "The desk is down." }) }) : r.continue()));
await p.locator("#wl-main-subject").fill(`Will not save ${T}`); await p.waitForTimeout(2600);
const bad = await p.locator("#wl-save").innerText();
ok("a save that fails says why on the button, in red", /Couldn't save: The desk is down\./.test(bad) && (await p.locator("#wl-save").getAttribute("data-saved")) === "bad", bad);
await p.locator(".wlcheck").scrollIntoViewIfNeeded().catch(() => {});
await p.locator("#wl-save").scrollIntoViewIfNeeded();
await p.locator("#wl-save").locator("..").screenshot({ path: D + "autosave-failed.png" });
await p.unroute(/\/api\/welcome\?event=[^&]+$/);
await p.locator("#wl-main-subject").fill(`Welcome to Toronto ${T}`); await p.waitForTimeout(2600);
ok("and saves once it can", (await api(`/api/welcome?event=${ev.id}`)).versions[0].subject === `Welcome to Toronto ${T}` && /Saved ✓/.test(await p.locator("#wl-save").innerText()));
await p.locator("#wl-save").locator("..").screenshot({ path: D + "autosave-saved.png" });

console.log("— the food-allergy email and the survey");
if (!(await p.locator("#replyfold").evaluate((d) => d.open))) await p.locator("#replyfold summary").first().click();
await p.waitForTimeout(800);
if (await p.locator("#rp-start").count()) { await p.locator("#rp-start").click(); await p.waitForTimeout(1200); }
await p.locator("#rp-subject").fill(`Food allergies ${T}`);
await p.waitForTimeout(2600);
const R = await api(`/api/reply?event=${ev.id}`);
ok("the food-allergy email's subject saves as typed", R.reply?.subject === `Food allergies ${T}`, R.reply?.subject);
await p.locator('.etab[data-tab="survey"]').click(); await p.waitForTimeout(1500);
if (await p.locator("#sv-start").count()) { await p.locator("#sv-start").click(); await p.waitForTimeout(1500); }
if (await p.locator("#sv-add").count()) {
  await p.locator("#sv-add").click(); await p.waitForTimeout(400);
  await p.locator('#sv-rows [data-sv]:last-child [data-k="title"]').fill(`Opening talk ${T}`); await p.waitForTimeout(2600);
  let sv = await api(`/api/survey?event=${ev.id}`);
  const first = sv.survey.sessions.find((x) => x.title === `Opening talk ${T}`);
  ok("a session added to the survey saves as its title is typed", !!first, JSON.stringify(sv.survey.sessions).slice(0, 200));
  await p.locator('#sv-rows [data-sv]:last-child [data-k="title"]').fill(`Opening talk ${T}!`); await p.waitForTimeout(2600);
  sv = await api(`/api/survey?event=${ev.id}`);
  ok("typing more keeps it the same session (same id, not a second one)", sv.survey.sessions.filter((x) => x.title.startsWith(`Opening talk ${T}`)).length === 1 && sv.survey.sessions.find((x) => x.title === `Opening talk ${T}!`)?.id === first?.id);
} else ok("the survey card is there", false);
ok("no page errors", !p.errs.length, p.errs.join(" | "));
await p.close();

console.log("— Edit event");
p = await open(1440, 1000, `#event/${ev.id}`);
await p.locator("#edit").click(); await p.waitForTimeout(1500);
await p.locator("#e-venue").fill(`Grand Hall ${T}`); await p.waitForTimeout(2600);
ok("an event that exists saves as it is edited", (await api(`/api/events?id=${ev.id}`)).event.venue === `Grand Hall ${T}`);
ok("its button says Saved ✓", /Saved ✓/.test(await p.locator("#create").innerText()), await p.locator("#create").innerText());
await p.locator("#create").click(); await p.waitForTimeout(1500);
ok("pressing it still takes you back to the event", await p.locator('.etab[data-tab="overview"]').count() > 0);
await p.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await p.waitForTimeout(800);
await p.evaluate(() => { location.hash = ""; });
const newBtn = p.locator("#new, [data-new], button:has-text('New event')").first();
if (await newBtn.count()) {
  await newBtn.click(); await p.waitForTimeout(1200);
  const before = (await api("/api/events")).events?.length;
  await p.locator("#e-title").fill(`Never made ${T}`); await p.waitForTimeout(2600);
  ok("a new event is not made by typing: Create event is still the button", /Create event/.test(await p.locator("#create").innerText()) && (await api("/api/events")).events?.length === before);
}
ok("no page errors", !p.errs.length, p.errs.join(" | "));
await p.close();

console.log("— the statement of work");
for (const [w, h, tag] of [[1440, 1000, "wide"], [390, 844, "phone"]]) {
  p = await open(w, h, `#event/${rbh.id}`);
  await p.locator('.etab[data-tab="money"]').click(); await p.waitForTimeout(1200);
  const fold = p.locator("#sowcard"); if (!(await fold.evaluate((d) => d.open))) await fold.locator("summary").first().click();
  const amount = tag === "wide" ? "1234" : "4321";
  await p.locator("#sw-table .ln-est").first().fill(amount); await p.waitForTimeout(2600);
  const sow = (await api(`/api/sow?event=${rbh.id}`)).sow;
  ok(`${tag}: a line's estimate saves as it is typed`, sow.lines[0].estimate === Number(amount), sow.lines[0].estimate);
  ok(`${tag}: the button says Saved ✓`, /Saved ✓/.test(await p.locator("#sw-save").innerText()));
  // A new line keeps its id from one save to the next, so it stays the same line.
  if (tag === "wide") {
    await p.locator("#sw-add").click(); await p.waitForTimeout(1500);
    await p.locator("#sw-table .ln-name").last().fill(`Parking ${T}`); await p.waitForTimeout(2600);
    const one = (await api(`/api/sow?event=${rbh.id}`)).sow.lines.find((l) => l.name === `Parking ${T}`);
    await p.locator("#sw-table .ln-est").last().fill("50"); await p.waitForTimeout(2600);
    const lines = (await api(`/api/sow?event=${rbh.id}`)).sow.lines.filter((l) => l.name === `Parking ${T}`);
    ok(`${tag}: a line added and typed into is saved once, and stays the same line`, !!one && lines.length === 1 && lines[0].id === one.id && lines[0].estimate === 50, JSON.stringify(lines));
  }
  ok(`${tag}: fits, no page errors`, (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) && !p.errs.length, p.errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
