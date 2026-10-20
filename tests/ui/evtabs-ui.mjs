// The event page in tabs (redesign step 2): Overview (to do, coming up, who does what, the checklist), People, Program,
// Logistics, Money (RBH events only), Communications, Settings. The tab is in the address; Back still leaves the event.
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
const mk = async (title, extra = {}) => (await api("/api/events", { method: "POST", body: JSON.stringify({ title, city: "Toronto", venue: "Hall", dayOne: shift(120), lastDay: shift(121), invite: false,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }, { name: "Barb Konkle", email: "secretary@ongia.ca" }],
  presenters: [["Rev", "Iewer"], ["Never", "Sent"]].map(([f, l]) => ({ first: f, last: l, email: `${f.toLowerCase()}.${l.toLowerCase()}.${T}@example.ca`, organization: "Org" })), ...extra }) })).event;
const answers = (p) => ({ first: p.first, last: p.last, email: p.email, phone: "4165550100", organization: "Org", talk: "T", bio: "word ".repeat(40), outline: "O", travel: "no", hotel: "no", expenses: { transport: "no", meals: "no", other: "no", otherText: "" }, copyright: true, noInvestigation: true, termsAccepted: true, media: { photo: { internal: "yes", public: "yes" }, materials: { internal: "yes", public: "no" }, summary: { internal: "yes", public: "yes" } }, sensitive: "no", signature: `${p.first} ${p.last}`, agreed: true, language: "en" });
const A = await mk(`Tabs Summit ${T}`);
const PA = (await api(`/api/events?id=${A.id}`)).presenters;
const rev = PA.find((p) => p.first === "Rev");
await fetch(`${S}/api/agreement?t=${rev.token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(answers(rev)) });
const R = await mk(`RBH Tabs Forum ${T}`);
await api(`/api/events?id=${R.id}&rbh=1`, { method: "PUT", body: JSON.stringify({ kind: "rbh", province: "ON" }) });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (vp, hash = "") => {
  const page = await b.newPage({ viewport: vp, deviceScaleFactor: 2 });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await page.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true, canCost: true }]);
  page.errs = []; page.on("pageerror", (e) => page.errs.push(String(e)));
  page.on("dialog", (d) => d.accept());
  await page.goto(`${S}/admin.html${hash}`, { waitUntil: "networkidle" }); await page.waitForTimeout(900);
  return page;
};
const tabs = (p) => p.locator(".etab").allInnerTexts();
const shown = (p) => p.locator(".etabp:not([hidden])").getAttribute("data-panel");
for (const [w, h, tag] of [[1440, 1000, "wide"], [390, 844, "phone"]]) {
  console.log(`— ${tag}`);
  const p = await open({ width: w, height: h });
  await p.locator(`[data-open="${A.id}"]`).click(); await p.waitForTimeout(1500);
  const names = (await tabs(p)).map((t) => t.replace(/\s*\d+$/, "").trim());
  ok(`${tag}: the event has its tabs, in order, and no Money tab on an ordinary event`, names.join(",") === "Overview,People,Program,Logistics,Communications,Settings", names.join(","));
  ok(`${tag}: it opens on Overview`, (await shown(p)) === "overview");
  const ov = await p.locator('.etabp[data-panel="overview"]').innerText();
  ok(`${tag}: Overview has To do on this event, Coming up, Who does what and the checklist`, /To do on this event/.test(ov) && /Coming up/.test(ov) && /Who does what/.test(ov) && /Your checklist/.test(ov));
  ok(`${tag}: To do lists the agreement to review, with its button`, /Review agreement · Rev Iewer/.test(ov) && (await p.locator('.etabp[data-panel="overview"] [data-goreview]').count()) === 1, ov.slice(0, 400));
  ok(`${tag}: Who does what names the lead and the rest of the board`, /Lead: Raj Jaswal/.test(ov) && /Board on this event: Barb Konkle/.test(ov));
  ok(`${tag}: the header carries the key numbers`, /0 of 2 agreements signed/.test(await p.locator(".evhead .kp").innerText()), await p.locator(".evhead .kp").innerText());
  ok(`${tag}: the People tab carries a count of what needs you there`, /People\s*\d+/.test((await tabs(p))[1]), (await tabs(p))[1]);
  ok(`${tag}: the presenters are not on the Overview`, !(await p.locator('details[data-fold="sec-presenters"]').isVisible()));
  if (tag === "wide") await p.screenshot({ path: D + "evtabs-overview-wide.png", fullPage: true }); else await p.screenshot({ path: D + "evtabs-overview-phone.png", fullPage: true });

  await p.locator('[data-tab="people"]').click(); await p.waitForTimeout(300);
  ok(`${tag}: People shows the presenters, volunteers and who is coming`, (await shown(p)) === "people" && await p.locator('details[data-fold="sec-presenters"]').isVisible() && await p.locator('details[data-fold="sec-volunteers"]').isVisible());
  ok(`${tag}: the tab is in the address`, /tab%22%3A%22people|"tab":"people"/.test(decodeURIComponent(p.url())) || /people/.test(decodeURIComponent(p.url())), p.url());
  if (tag === "wide") await p.screenshot({ path: D + "evtabs-people-wide.png" }); else await p.screenshot({ path: D + "evtabs-people-phone.png" });
  await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(1200);
  ok(`${tag}: a refresh stays on People`, (await shown(p)) === "people");
  await p.locator('[data-tab="logistics"]').click(); await p.waitForTimeout(200);
  ok(`${tag}: Logistics shows the hotel rooms`, (await shown(p)) === "logistics" && await p.locator('details[data-fold="sec-hotel"]').isVisible());
  await p.locator('[data-tab="settings"]').click(); await p.waitForTimeout(200);
  ok(`${tag}: Settings shows the event settings and the delete button`, await p.locator("#evsettings").isVisible() && await p.locator("#delevent").isVisible());
  await p.locator('[data-tab="overview"]').click(); await p.waitForTimeout(200);
  await p.goBack(); await p.waitForTimeout(1200);
  ok(`${tag}: Back after switching tabs leaves the event for the home page`, (await p.locator("#queue").count()) === 1, p.url());
  await p.goForward(); await p.waitForTimeout(1500);
  await p.locator('.etabp[data-panel="overview"] [data-goreview]').click(); await p.waitForTimeout(1200);
  ok(`${tag}: Review on the to-do row opens the agreement`, /Rev Iewer/.test(await p.locator("#root").innerText()) && (await p.locator(".etab").count()) === 0);
  // A blocked event (no upload link locally): the fix button takes you to Settings.
  await p.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await p.waitForTimeout(900);
  await p.locator(`[data-open="${A.id}"]`).click(); await p.waitForTimeout(1500);
  const fix = p.locator('[data-fix="mklink"]');
  if (await fix.count()) { await fix.click(); await p.waitForTimeout(800); ok(`${tag}: a blocked event's fix button opens the Settings tab`, (await shown(p)) === "settings"); }
  // RBH: a Money tab for the president, with the SOW.
  await p.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await p.waitForTimeout(900);
  await p.locator(`[data-open="${R.id}"]`).click(); await p.waitForTimeout(1800);
  const rn = (await tabs(p)).map((t) => t.replace(/\s*\d+$/, "").trim());
  ok(`${tag}: an RBH event adds a Money tab for the president`, rn.includes("Money"), rn.join(","));
  await p.locator('[data-tab="money"]').click(); await p.waitForTimeout(300);
  ok(`${tag}: Money holds the SOW`, await p.locator('details[data-fold="sec-sow"]').isVisible());
  ok(`${tag}: no page errors`, p.errs.length === 0, p.errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
