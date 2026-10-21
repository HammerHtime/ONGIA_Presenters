// New event (redesign step 4): three ways to start (Wix, copy a past event, blank), the essentials first and the rest
// under More options, and a Getting ready card on the new event until it is set up. Also: the way back sits at the top
// left of the page, and the email list is switched off in the desk.
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
// The event to copy: its own board, slot, deadlines, RBH settings, presenter option and hotel.
const src = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Copy Source Forum ${T}`, city: "Victoria, BC", venue: "Sample Hotel Victoria", dayOne: shift(-200), lastDay: shift(-200), invite: false,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }, { name: "Barb Konkle", email: "secretary@ongia.ca" }],
  sessionMinutes: 45, offsets: { agreement: 60, draft: 40, final: 20 }, talkOnFile: true,
  hotel: { name: "Sample Hotel Victoria", contact: "groups@sample-hotel.example.ca" } }) })).event;
await api(`/api/events?id=${src.id}&rbh=1`, { method: "PUT", body: JSON.stringify({ kind: "rbh", province: "BC", invoicePrefix: "CFAOC" }) });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1440, 1000, "wide"], [390, 844, "phone"]]) {
  console.log(`— ${tag}`);
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 500 });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true, canCost: true }]);
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  p.on("dialog", (d) => d.accept());
  await p.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await p.waitForTimeout(900);
  ok(`${tag}: the home page has no email rows or email wording`, (await p.locator("#queue .ibrow, .qmail").count()) === 0 && !/email\b/.test(await p.locator(".qcounts").innerText()), await p.locator(".qcounts").innerText());
  await p.click("#newevent"); await p.waitForTimeout(900);
  ok(`${tag}: three ways to start`, (await p.locator(".starts .start").count()) === 3 && /From your website/.test(await p.locator(".starts").innerText()) && /Copy a past event/.test(await p.locator(".starts").innerText()) && /Start blank/.test(await p.locator(".starts").innerText()));
  ok(`${tag}: the way back is at the top left of the page, not in the bar`, (await p.locator("#root > .crumbs #cancel").count()) === 1 && (await p.locator("#barright #cancel").count()) === 0);
  const order = await p.evaluate(() => { const at = (sel) => [...document.querySelectorAll("#root *")].indexOf(document.querySelector(sel)); return { board: at("#bdrop"), more: at(".morehead"), rbh: at("#e-rbh"), mins: at("#e-mins") }; });
  ok(`${tag}: the board comes before More options, and the RBH settings and slot come after it`, order.board < order.more && order.more < order.rbh && order.more < order.mins, JSON.stringify(order));
  await p.click("#cp-pick"); await p.waitForTimeout(900);
  await p.locator(`[data-copyev="${src.id}"]`).click(); await p.waitForTimeout(1500);
  const val = (sel) => p.locator(sel).inputValue();
  ok(`${tag}: copying fills the slot and how far ahead the deadlines fall`, (await val("#e-mins")) === "45" && (await val("#off-agreement")) === "60" && (await val("#off-final")) === "20", JSON.stringify([await val("#e-mins"), await val("#off-agreement")]));
  ok(`${tag}: and the board and lead`, /Raj Jaswal\s*lead/.test(await p.locator("#bsum").innerText()) && /Barb Konkle/.test(await p.locator("#bsum").innerText()), await p.locator("#bsum").innerText());
  ok(`${tag}: and the RBH settings, the presenter option and the hotel`, await p.locator("#e-rbh").isChecked() && (await val("#e-prov")) === "BC" && (await val("#e-prefix")) === "CFAOC" && await p.locator("#e-talkfile").isChecked() && (await val("#e-hotel")) === "Sample Hotel Victoria");
  ok(`${tag}: but not the title or the dates`, (await val("#e-title")) === "" && (await val("#e-day1")) === "");
  ok(`${tag}: it says what was copied`, /Copied from Copy Source Forum/.test(await p.locator("#cp-chosen").innerText()));
  await p.screenshot({ path: `${D}newevent-copied-${tag}.png`, fullPage: true });
  await p.fill("#e-title", `Copied Forum ${tag} ${T}`); await p.fill("#e-day1", shift(150)); await p.fill("#e-last", shift(150));
  await p.click("#create"); await p.waitForTimeout(2500);
  const made = (await api("/api/events")).events.find((e) => e.title === `Copied Forum ${tag} ${T}`);
  const full = made ? (await api(`/api/events?id=${made.id}`)).event : null;
  ok(`${tag}: the new event is made with what was copied`, !!full && full.sessionMinutes === 45 && full.offsets?.agreement === 60 && full.kind === "rbh" && full.province === "BC" && full.talkOnFile === true && full.hotel?.name === "Sample Hotel Victoria" && full.board.some((m) => m.lead && m.name === "Raj Jaswal"), JSON.stringify(full).slice(0, 300));
  // Getting ready.
  const rc = p.locator("#readycard");
  ok(`${tag}: the new event opens with a Getting ready card`, await rc.isVisible() && /Getting ready/.test(await rc.innerText()));
  ok(`${tag}: done and to-do items, each to-do with its button`, /Lead board member: Raj Jaswal/.test(await rc.innerText()) && /Add presenters/.test(await rc.innerText()) && (await rc.locator("[data-readyadd]").count()) === 1 && /Hotel: Sample Hotel Victoria/.test(await rc.innerText()), await rc.innerText());
  ok(`${tag}: an RBH event's card includes starting the statement of work`, /statement of work/i.test(await rc.innerText()));
  await p.screenshot({ path: `${D}newevent-ready-${tag}.png`, fullPage: false });
  ok(`${tag}: the event page's way back is at the top left too`, (await p.locator("#root > .crumbs #back").count()) === 1);
  await p.locator('[data-tab="communications"]').click(); await p.waitForTimeout(200);
  ok(`${tag}: Communications has the attendee email switch but no email list`, (await p.locator("#amail").count()) === 1 && (await p.locator("#inbox").count()) === 0);
  await p.locator('[data-tab="overview"]').click(); await p.waitForTimeout(200);
  await p.click("#readyhide"); await p.waitForTimeout(300);
  ok(`${tag}: Hide this takes it away`, (await p.locator("#readycard").count()) === 0);
  await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  ok(`${tag}: and it stays hidden`, (await p.locator("#readycard").count()) === 0);
  await p.click("#readyshow"); await p.waitForTimeout(300);
  ok(`${tag}: Show Getting ready brings it back`, await p.locator("#readycard").isVisible());
  ok(`${tag}: nothing scrolls sideways`, !(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)));
  ok(`${tag}: no page errors`, errs.length === 0, errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
