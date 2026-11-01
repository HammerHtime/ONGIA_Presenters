// Admin › RBH reports (Andrew 31 Oct 2026, from the mock-up he approved): a tab listing every RBH training of the year
// with where its Executive Summary and infographic stand, and the year-end card: the year's figures, the two figures typed
// in once a year, Make the year-end reports, and the two year-end documents. A year whose trainings are still to come
// can't be made yet; one with reports made is shown from made-up data. Readable at 390 wide, with no sideways scroll.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const T = Date.now().toString(36);
const YEAR = "2033";
const mk = async (title, dayOne, extra = {}) => (await api("/api/events", { method: "POST", body: JSON.stringify({ title, city: "Montréal, QC", dayOne, lastDay: dayOne, invite: false, presenters: [],
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }], kind: "rbh", province: "QC", invoicePrefix: "YE", ...extra }) })).event;
const a = await mk(`RBH ITP Week ${T}`, `${YEAR}-02-08`);
const b2 = await mk(`RBH Halifax ${T}`, `${YEAR}-06-07`);
await mk(`Ontario Symposium ${T}`, `${YEAR}-03-01`, { kind: "" });

const asAndrew = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (w, h, fake) => {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await p.addInitScript(([t, x]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(x)); } catch {} }, [asAndrew, { email: "president@ongia.ca", name: "Andrew Hammond" }]);
  p.errs = []; p.on("pageerror", (e) => p.errs.push(String(e)));
  if (fake) await p.route(`**/api/reports?list=1*`, async (r) => { const res = await r.fetch(); const j = await res.json(); fake(j); r.fulfill({ json: j }); });
  await p.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "admin", tab: "rbh", year: YEAR })), { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
  return p;
};

let p = await open(1280, 1000);
ok("Admin has an RBH reports tab, selected", /RBH reports/.test(await p.locator(".atab.on").innerText()));
ok("the year chips include this year's trainings' year, selected", await p.locator(`[data-rbhyear="${YEAR}"].solid`).count() === 1);
const body = await p.locator("#root").innerText();
ok("the list holds the two RBH trainings, not the other kind", body.includes(`RBH ITP Week ${T}`) && body.includes(`RBH Halifax ${T}`) && !body.includes(`Ontario Symposium ${T}`));
ok("trainings still to come say so in both report columns", /Not yet held/i.test(await p.locator("tr", { hasText: `RBH Halifax ${T}` }).innerText()));
ok("a year with nothing held yet can't be made, and says why", await p.locator("#ye-make").count() === 0 && new RegExp(`once an RBH training in ${YEAR} has taken place`).test(body));
ok("the year-end card names the OneDrive folder", body.includes(`RBH/Year end ${YEAR}`));
// The two figures typed in once a year.
await p.fill("#ye-members", "6000"); await p.fill("#ye-campaigns", "10"); await p.click("#ye-save"); await p.waitForTimeout(1200);
const inputs = (await api(`/api/reports?list=1&year=${YEAR}`)).inputs;
ok("members and campaigns are saved, and the estimate shows", inputs.members === 6000 && inputs.campaigns === 10 && /About 60,000 emails/.test(await p.locator("#ye-est").innerText()), JSON.stringify(inputs));
// A training's name opens its Survey tab.
await p.locator(`[data-rbhev="${a.id}"].rbhname`).click(); await p.waitForTimeout(1500);
ok("a training's name opens that event's Survey tab", await p.evaluate(() => JSON.parse(decodeURIComponent(location.hash.slice(3))).tab) === "survey" && (await p.locator("#root").innerText()).includes(`RBH ITP Week ${T}`));
ok("no page errors", p.errs.length === 0, p.errs.join(" | "));
await p.close();

// From made-up data: one training with both reports made, the year-end with figures, one report made and filed.
const fake = (j) => {
  const row = j.rows.find((r) => r.id === a.id);
  Object.assign(row, { held: true, answered: 38, invited: 52, half: true });
  row.reports.exec = { ...row.reports.exec, version: { n: 3, at: `${YEAR}-02-20T15:00:00Z`, answered: 38, invited: 52 }, final: true, filed: { en: { url: "https://sp/e.pdf", folderUrl: "https://sp/Survey" }, fr: { url: "https://sp/f.pdf" } } };
  row.reports.info = { ...row.reports.info, version: { n: 2, at: `${YEAR}-02-19T15:00:00Z`, answered: 36, invited: 52 } };
  Object.assign(j.facts, { trainings: 2, held: 1, upcoming: 1, attendees: 46, attendanceBasis: "checked in", agencyCount: 21, newAgencies: 8, provinceCount: 4, survey: { answered: 38, invited: 52, rate: 73, quality: 95 } });
  j.yearend.reports.exec = { ...j.yearend.reports.exec, version: { n: 1, at: `${YEAR}-12-30T15:00:00Z`, answered: 38, invited: 52 }, filed: { en: { url: "https://sp/ye-e.pdf" }, fr: { url: "https://sp/ye-f.pdf" } } };
};
p = await open(1280, 1000, fake);
const itp = await p.locator("tr", { hasText: `RBH ITP Week ${T}` }).innerText();
ok("a training with reports: version, when, English and Français, final, its folder", /Version 3/i.test(itp) && /Version 2/i.test(itp) && /English/.test(itp) && /Français/.test(itp) && /Final/i.test(itp) && /Survey folder/.test(itp) && /38 of 52/.test(itp), itp);
const card = await p.locator(".ye").innerText();
ok("the year-end card shows the year's figures", /46\s*people trained/i.test(card) && /21\s*agencies/i.test(card) && /8 new this year/.test(card) && /95%/.test(card), card);
ok("a year with a training held offers Make them again once one is made", /Make them again/.test(await p.locator("#ye-make").innerText()));
ok("the made year-end report has its links and OneDrive copies; the other says not made yet", /Version 1/i.test(card) && /In OneDrive/.test(card) && /Not made yet/i.test(card) && /Ask for a change/.test(card));
await p.screenshot({ path: new URL("./rbhreports-desk.png", import.meta.url).pathname, fullPage: true });
// The year-end report opens in the same viewer as a training's, with its pages and the chat; it has no "every RBH report" box.
const PDF = REPO + "tests/server/zed.pdf";
const yeState = { year: Number(YEAR), answered: 38, invited: 52, held: 1, folder: `RBH/Year end ${YEAR}`, reports: {
  exec: { name: { en: "Executive Summary", fr: "Sommaire exécutif" }, made: true, current: 1, final: false, building: null, error: null, version: { n: 1, at: `${YEAR}-12-30T15:00:00Z`, answered: 38, invited: 52 },
    versions: [{ n: 1, at: `${YEAR}-12-30T15:00:00Z`, answered: 38 }], requests: [], chat: [], filed: null, newSince: 0 },
  info: { name: { en: "Infographic", fr: "Infographie" }, made: false, current: 0, final: false, building: null, error: null, version: null, versions: [], requests: [], chat: [], filed: null, newSince: 0 } } };
let pdfAsked = "";
await p.route(`**/api/reports?yearend=${YEAR}`, (r) => r.fulfill({ json: yeState }));
await p.route(`**/api/reports?yearend=${YEAR}&kind=exec&lang=*&pdf=1*`, (r) => { pdfAsked = r.request().url(); r.fulfill({ path: PDF, contentType: "application/pdf" }); });
await p.locator('[data-yeopen="exec|en"]', { hasText: "Ask for a change" }).click(); await p.waitForTimeout(2500);
const dlg = p.locator("dialog.repdlg");
ok("Ask for a change opens the year-end report in the viewer, with its pages", await dlg.count() === 1 && /Executive Summary/.test(await dlg.locator("#rp-title").innerText()) && await dlg.locator("canvas.rppage").count() > 0 && /yearend=/.test(pdfAsked), pdfAsked);
ok("the viewer offers the chat but not 'keep for every RBH report'", await dlg.locator("#rp-text").count() === 1 && await dlg.locator("#rp-always").count() === 0);
await dlg.locator("[data-rplang=fr]").click(); await p.waitForTimeout(1200);
ok("Français shows the French one", /lang=fr/.test(pdfAsked), pdfAsked);
await dlg.locator("#rp-close").click(); await p.waitForTimeout(1200);
ok("closing it brings the list back", await p.locator("dialog.repdlg").count() === 0 && await p.locator(".ye").count() === 1);
ok("no page errors", p.errs.length === 0, p.errs.join(" | "));
await p.close();

p = await open(390, 900, fake);
ok("at 390 wide, nothing scrolls sideways", !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
const cellLabels = await p.evaluate(() => [...document.querySelectorAll(".rbhl td[data-l='Executive Summary'], .rbhl td[data-l='Infographic']")].map((td) => getComputedStyle(td, "::before").content));
ok("on a phone each stacked line says which report it is", cellLabels.includes('"Executive Summary"') && cellLabels.includes('"Infographic"'), JSON.stringify(cellLabels));
await p.screenshot({ path: new URL("./rbhreports-phone.png", import.meta.url).pathname, fullPage: true });
ok("no page errors", p.errs.length === 0, p.errs.join(" | "));
await p.close();
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
