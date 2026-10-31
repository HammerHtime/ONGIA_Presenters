// The Survey tab (Andrew 27 Oct 2026): the survey set-up on its own tab, a session renamed at the last minute, and the
// results: the downloads, Claude's read, the infographic (editable, PNG and PDF, English and French) and the seven
// social media squares.
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
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Survey Summit ${T}: Gangs & Youth`, city: "Calgary, AB", venue: "Hall", dayOne: shift(-3), lastDay: shift(-2), invite: false,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }] }) })).event;
const q = `/api/survey?event=${ev.id}`;
const set = await api(q, { method: "PUT", body: JSON.stringify({ open: true, mode: "end", sendOn: shift(-1), sessions: [
  { id: "sa", day: ev.dayOne, title: "Following the Money", titleFr: "Suivre l'argent", presenters: ["Jordan Avery"] },
  { id: "sb", day: ev.lastDay, title: "Ghost Guns", presenters: ["Sam Ortiz"] }] }) });
const tok = set.survey.token;
const stars = (n) => Object.fromEntries(["relevant", "knowledge", "expectations", "expert", "engaging", "delivery"].map((k) => [k, n]));
const said = "The financial investigations session changed how my unit will approach our next file.";
for (const [i, [agency, province, n]] of [["TPS", "ON", 5], ["RCMP", "BC", 4], ["Royal Canadian Mounted Police", "AB", 5], ["Calgary Police Service", "AB", 3]].entries())
  await fetch(`${S}/api/survey?t=${tok}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ part: "end", lang: i === 1 ? "fr" : "en",
    about: { agency, province, years: i, before: 0, again: 0, heard: 1 },
    sessions: { sa: { ...stars(n), rebook: 0, ...(i === 0 ? { comment: said } : {}) }, sb: { ...stars(Math.max(2, n - 1)), rebook: 1 } },
    overall: { quality: n, pace: 1, confidence: n, variety: 4, practical: n, venue: 5, av: 4, registration: 5, food: 3, length: 1, nps: 7 + i, topics: "Drill music", ...(i === 2 ? { present: 0 } : {}) },
    ...(i === 2 ? { contact: { name: "Pat Sample", email: "pat@example.ca", topic: "Youth outreach" } } : {}) }) });
await fetch("http://127.0.0.1:8799/__set", { method: "POST", body: JSON.stringify({ reply: { summary: "Well received: 4.3 of 5 overall.", liked: [{ point: "Financial investigations", evidence: "4.8/5" }],
  improve: [{ point: "Food", evidence: "3/5" }], presenters: [{ session: "Ghost Guns", note: "Lower than the rest" }], nextTime: ["Drill music"],
  quotes: [{ text: said, about: "Following the Money" }, { text: "A wonderful event everyone loved.", about: "overall" }] } }) });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (vp) => {
  const page = await b.newPage({ viewport: vp, deviceScaleFactor: 1, acceptDownloads: true });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await page.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true }]);
  page.errs = []; page.on("pageerror", (e) => page.errs.push(String(e)));
  page.on("dialog", (d) => d.accept());
  await page.goto(`${S}/admin.html#event/${ev.id}`, { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
  return page;
};
const bytesOf = async (p, click) => { const [d] = await Promise.all([p.waitForEvent("download", { timeout: 30000 }), click()]); const chunks = []; for await (const c of await d.createReadStream()) chunks.push(c); return { name: d.suggestedFilename(), buf: Buffer.concat(chunks) }; };

const p = await open({ width: 1440, height: 1000 });
await p.locator('.etab[data-tab="communications"]').click(); await p.waitForTimeout(500);
ok("the survey is no longer on Communications", !(await p.locator("#svbox").isVisible().catch(() => false)));
await p.locator('.etab[data-tab="survey"]').click(); await p.waitForTimeout(1500);
ok("the event has a Survey tab with the set-up and the results, the results open once answers are in", await p.locator("#rsbox").isVisible() && await p.locator('[data-svpart="setup"]').count() === 1 && await p.locator("#svbox").count() === 1);
ok("the results say how many answered", /4 answers from 4 people/.test(await p.locator("#rsbox").innerText()), (await p.locator("#rsbox").innerText()).slice(0, 120));

// A last-minute swap: rename the session and change the presenter; the answers already given stay with it.
await p.locator('[data-svpart="setup"]').click(); await p.waitForTimeout(300);   // the sessions are under Setup
await p.locator('[data-sv="1"] [data-k="title"]').fill("Ghost Guns and 3D Printers");
await p.locator('[data-sv="1"] [data-k="presenters"]').fill("Riley Chen");
await p.locator("#sv-save").click(); await p.waitForTimeout(1200);
const after = (await api(q)).survey.sessions.find((s) => s.id === "sb");
ok("a session's title and presenter can be changed after answers are in", after.title === "Ghost Guns and 3D Printers" && after.presenters.join() === "Riley Chen", JSON.stringify(after));
const R = (await api(`${q}&results=1`)).results;
ok("and its answers stay with it under the new name", R.sessions.find((s) => s.id === "sb").n === 4 && R.sessions.find((s) => s.id === "sb").title === "Ghost Guns and 3D Printers");

await p.locator('[data-svpart="results"]').click(); await p.waitForTimeout(300);   // the downloads are under Results
const pdf = await bytesOf(p, () => p.locator('[data-rsdl="summary"]').click());
ok("Download: the summary PDF", pdf.buf.slice(0, 5).toString() === "%PDF-" && /survey-summary\.pdf$/.test(pdf.name), pdf.name);
const xl = await bytesOf(p, () => p.locator('[data-rsdl="answers"]').click());
ok("Download: every answer as Excel", xl.buf.slice(0, 2).toString() === "PK" && /\.xlsx$/.test(xl.name));
ok("the would-be presenter's list is offered apart", /1 interested in presenting/.test(await p.locator('[data-rsdl="presenters"]').innerText()));

await p.locator("#rs-analyse").click(); await p.waitForTimeout(2500);
const read = await p.locator("#rsbox").innerText();
ok("Claude's read is shown, with only word-for-word quotes", /Well received/.test(read) && read.includes(said) && !/wonderful/.test(read), read.slice(0, 300));

await p.locator("#rs-info").click(); await p.waitForTimeout(2500);
const frame = p.frameLocator("#rs-frame");
ok("the infographic opens, editable", await frame.locator("#art").isVisible() && (await p.evaluate(() => document.getElementById("rs-frame").contentDocument.designMode)) === "on");
ok("it leads with the event, Calgary and the quote", /SURVEY SUMMIT/i.test(await frame.locator("#art").innerText()) && (await frame.locator("#art").innerText()).includes(said));
await p.screenshot({ path: D + "survey-infographic-wide.png" });
const png = await bytesOf(p, () => p.locator("#rs-png").click());
ok("Download PNG: a real picture, twice the width for sharpness", png.buf.slice(1, 4).toString() === "PNG" && png.buf.readUInt32BE(16) === 2160, `${png.buf.readUInt32BE(16)}`);
const ipdf = await bytesOf(p, () => p.locator("#rs-pdf").click());
ok("Download PDF: one tall page", ipdf.buf.slice(0, 5).toString() === "%PDF-" && /\/Count 1\b/.test(ipdf.buf.toString("latin1")));
await p.locator('#rsdlg button[value="close"]').click(); await p.waitForTimeout(300);

await p.locator('[data-rslang="fr"]').click(); await p.waitForTimeout(300);
await p.locator("#rs-info").click(); await p.waitForTimeout(2500);
ok("in French", /QUALITÉ GLOBALE|Qualité globale/.test(await frame.locator("#art").innerText()));
await p.locator('#rsdlg button[value="close"]').click(); await p.waitForTimeout(300);
const zip = await bytesOf(p, () => p.locator("#rs-social").click());
const names = [...zip.buf.toString("latin1").matchAll(/PK\x03\x04[\s\S]{26}([0-9a-z-]+\.png)/g)].map((m) => m[1]);
ok("social media: one square per section, in a .zip, in the language picked", names.length === 7 && names.every((n) => /-fr\.png$/.test(n)), names.join(" "));
// The link to share by hand, and clearing a trial run's answers (Andrew 27 Oct 2026).
ok("the survey's own link is there to share, without the preview flag", /\/f\/[a-z0-9]+$/i.test(await p.locator("#sv-share").inputValue()), await p.locator("#sv-share").inputValue());
await p.evaluate(() => { window.prompt = () => "clear"; });
await p.locator("#rs-clear").click(); await p.waitForTimeout(1500);
const cleared = (await api(`${q}&results=1`)).results;
ok("Clear all answers empties the results, and keeps the sessions", cleared.responses === 0 && (await api(q)).survey.sessions.length === 2 && !(await api(`${q}&results=1`)).analysis, JSON.stringify(cleared).slice(0, 100));
ok("and the card says there are none", /0 answers/.test(await p.locator("#rsbox").innerText()));
ok("no page errors", p.errs.length === 0, p.errs.join(" | "));
await p.close();

const ph = await open({ width: 390, height: 844 });
await ph.locator('.etab[data-tab="survey"]').click(); await ph.waitForTimeout(1500);
await ph.locator('[data-svpart="results"]').click(); await ph.waitForTimeout(300);
await ph.locator("#resultsfold").scrollIntoViewIfNeeded();
const wide = await ph.evaluate(() => document.documentElement.scrollWidth);
ok("phone: the results fit the screen", wide <= 392, `${wide}`);
await ph.screenshot({ path: D + "survey-results-phone.png" });
ok("phone: no page errors", ph.errs.length === 0, ph.errs.join(" | "));
await ph.close();
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
