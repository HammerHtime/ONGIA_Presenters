// The event page layout (Andrew 21 Oct 2026) and the audit's screen changes: headshots in the list, reviewing side by
// side with one confirmation and "Approve & open next", removing someone who never signed in one step, the SharePoint
// folder above More options, and the volunteer explanation in one line.
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
const answers = (p) => ({ first: p.first, last: p.last, email: p.email, phone: "4165550100", organization: "Org", talk: "A sample talk", bio: "word ".repeat(40), outline: "O", travel: "no", hotel: "no",
  expenses: { transport: "no", meals: "no", other: "no", otherText: "" }, copyright: true, noInvestigation: true, termsAccepted: true,
  media: { photo: { internal: "yes", public: "yes" }, materials: { internal: "yes", public: "no" }, summary: { internal: "yes", public: "yes" }, bio: { internal: "yes", public: "yes" } }, sensitive: "no", signature: `${p.first} ${p.last}`, agreed: true, language: "en" });
// A plain 8×8 PNG stands in for a photo.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC", "base64");
const mk = async (tag) => {
  const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Layout Forum ${tag} ${T}`, city: "Toronto", venue: "Hall", dayOne: shift(90), lastDay: shift(91), invite: false,
    board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }],
    presenters: [["Ann", "First"], ["Ben", "Second"], ["Cal", "Never"]].map(([f, l]) => ({ first: f, last: l, email: `${f.toLowerCase()}.${tag}.${T}@example.ca`, organization: "Org" })) }) })).event;
  const P = (await api(`/api/events?id=${ev.id}`)).presenters;
  const by = (f) => P.find((p) => p.first === f);
  for (const f of ["Ann", "Ben"]) await fetch(`${S}/api/agreement?t=${by(f).token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(answers(by(f))) });
  await fetch(`${S}/api/headshot?t=${by("Ann").token}`, { method: "POST", headers: { "content-type": "image/png", "x-file-name": "ann.png" }, body: PNG });
  return { ev, by };
};

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1440, 1000, "wide"], [390, 844, "phone"]]) {
  console.log(`— ${tag}`);
  const { ev, by } = await mk(tag);
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 500 });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true, canCost: true }]);
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  let dialogs = 0; p.on("dialog", (d) => { dialogs++; d.accept(); });
  const go = async (v) => { await p.goto(`${S}/admin.html#v=${encodeURIComponent(JSON.stringify(v))}`, { waitUntil: "networkidle" }); await p.waitForTimeout(1500); };

  // Headshots in the list.
  await go({ name: "event", eventId: ev.id, tab: "people" });
  await p.waitForTimeout(800);
  // A tile that needs you says so, in colour.
  const t0 = p.locator(".etile").first();
  ok(`${tag}: the agreements tile is flagged Needs you while agreements wait for review`, /attn|behind/.test(await t0.getAttribute("class")) && /Needs you|Past due/i.test(await t0.innerText()), await t0.innerText());
  await p.locator('[data-tab="overview"]').click(); await p.waitForTimeout(200);
  await t0.click(); await p.waitForTimeout(500);
  ok(`${tag}: clicking it opens People, cut to the ones that need you`, (await p.locator(".etabp:not([hidden])").getAttribute("data-panel")) === "people" && /Needs me/.test(await p.locator(".fchip.on").innerText()) && (await p.locator("tr.prow:not([hidden])").count()) >= 1, await p.locator(".fchip.on").innerText().catch(() => ""));
  await p.locator(".etile", { hasText: "Wix registrations" }).click(); await p.waitForTimeout(400);
  ok(`${tag}: the Wix tile opens Who's coming`, (await p.locator("[data-pseg].on").getAttribute("data-pseg")) === "guests");
  await p.locator(".etile", { hasText: "Hotel" }).first().click(); await p.waitForTimeout(400);
  ok(`${tag}: the hotel tile opens the hotel list on Logistics`, (await p.locator(".etabp:not([hidden])").getAttribute("data-panel")) === "logistics" && await p.locator('details[data-fold="sec-hotel"]').isVisible());
  await go({ name: "event", eventId: ev.id, tab: "people", pview: "presenters", filter: "all" });
  ok(`${tag}: a presenter with a photo shows it in the list`, (await p.locator("tr.prow", { hasText: "Ann First" }).locator(".pav img").count()) === 1);
  ok(`${tag}: one without shows their initials`, (await p.locator("tr.prow", { hasText: "Cal Never" }).locator(".pav").innerText()).trim() === "CN");
  ok(`${tag}: the talk title is not in the row (it is in the panel)`, !/A sample talk/.test(await p.locator("tr.prow", { hasText: "Ann First" }).innerText()));
  ok(`${tag}: nothing scrolls sideways`, !(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)));
  if (tag === "wide") {
    await p.screenshot({ path: `${D}layout-people-${tag}.png` });
    for (const width of [1440, 1180, 1024]) {
      await p.setViewportSize({ width, height: 900 }); await p.waitForTimeout(200);
      const dims = await p.locator(".ptwrap").evaluate((e) => [e.scrollWidth, e.clientWidth, [...e.querySelectorAll("th")].map((t) => Math.round(t.getBoundingClientRect().width)).join(",")]);
      ok(`${tag}: at ${width} wide the presenter table fits, with nothing to scroll sideways`, dims[0] <= dims[1] + 1, JSON.stringify(dims));
    }
    await p.setViewportSize({ width: w, height: h });
  }

  // The lead can be changed from the side column.
  await p.locator('[data-tab="overview"]').click(); await p.waitForTimeout(200);
  await p.click("#leadchange"); await p.waitForTimeout(200);
  const pick = await p.locator("#leadpick option").evaluateAll((o) => o.map((x) => ({ v: x.value, t: x.textContent })).filter((x) => x.v && !/Andrew Hammond/.test(x.t)));
  await p.selectOption("#leadpick", pick[0].v); await p.click("#leadsave"); await p.waitForTimeout(1800);
  const after = (await api(`/api/events?id=${ev.id}`)).event;
  ok(`${tag}: the lead can be changed from Lead and folder`, after.reviewer?.email === pick[0].v && after.board.find((m) => m.lead)?.email === pick[0].v && after.board.some((m) => m.email === "president@ongia.ca" && !m.lead), JSON.stringify(after.board));
  ok(`${tag}: and the band shows the new lead`, new RegExp(`Lead: ${pick[0].t.trim()}`).test(await p.locator(".evband").innerText()));
  await api(`/api/events?id=${ev.id}&lead=1`, { method: "PUT", body: JSON.stringify({ email: "president@ongia.ca" }) });
  // Finished checklist jobs sink to the bottom.
  await go({ name: "event", eventId: ev.id });
  const jobs = () => p.locator('.etabp[data-panel="overview"] .job .what').allInnerTexts();
  const first = (await jobs())[0];
  await p.locator('.etabp[data-panel="overview"] .job [data-tick]').first().check(); await p.waitForTimeout(1800);
  const now = await jobs();
  const firstDone = await p.locator('.etabp[data-panel="overview"] .job.done').first().locator(".what").innerText();
  ok(`${tag}: a ticked checklist job moves below the ones still to do`, now[0] !== first && firstDone === first && (await p.locator('.etabp[data-panel="overview"] .job:not(.done):not(.na) ~ .job.done').count()) >= 0 && await p.evaluate(() => { const js = [...document.querySelectorAll('.etabp[data-panel="overview"] .job')]; const i = js.findIndex((j) => j.classList.contains("done")); return i > 0 && js.slice(i).every((j) => j.classList.contains("done") || j.classList.contains("na")); }), now.slice(0, 3).join(" | "));
  await go({ name: "event", eventId: ev.id, tab: "people" });

  // Removing someone who never signed: one "are you sure?".
  await p.locator("tr.prow", { hasText: "Cal Never" }).locator(".pn").click(); await p.waitForTimeout(500);
  await p.locator("#pdrawer [data-edit]").click(); await p.waitForTimeout(300);
  await p.click("#pe-remove"); await p.waitForTimeout(300);
  ok(`${tag}: removing someone who never signed asks once, with no reason or DELETE`, await p.locator("#prm").isVisible() && !(await p.locator("#prm-full").isVisible()) && !(await p.isDisabled("#prm-go")) && /never signed/.test(await p.locator("#prm-what").innerText()));
  await p.click("#prm-go"); await p.waitForTimeout(1500);
  ok(`${tag}: and removes them`, !(await api(`/api/events?id=${ev.id}`)).presenters.some((x) => x.first === "Cal"));
  // Someone who signed still takes the reason and DELETE.
  await go({ name: "event", eventId: ev.id, tab: "people", person: by("Ben").id });
  await p.locator("#pdrawer [data-edit]").click(); await p.waitForTimeout(300);
  await p.click("#pe-remove"); await p.waitForTimeout(300);
  ok(`${tag}: someone who signed still needs a reason and DELETE`, await p.locator("#prm-full").isVisible() && await p.isDisabled("#prm-go"));
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);

  // Reviewing: side by side on a computer, one confirmation, then the next one waiting.
  await go({ name: "review", eventId: ev.id, presenterId: by("Ann").id });
  ok(`${tag}: with another waiting, the button says Approve & open next`, /Approve & open next \(1 left\)/.test(await p.locator("#approve").innerText()), await p.locator("#approve").innerText());
  if (tag === "wide") {
    const [a, d] = await p.locator(".rvgrid > .card").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left));
    ok(`${tag}: the decision sits beside the submission`, d > a + 300, `${a} ${d}`);
  }
  ok(`${tag}: what you are approving shows right above the button`, await p.evaluate(() => { const r = document.getElementById("readback"), b = document.getElementById("approve"); return !!r && !!(r.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) && /ONGIA will cover/.test(r.textContent); }));
  await p.locator("#r-attest").check();
  if (tag === "wide") await p.screenshot({ path: `${D}layout-review-${tag}.png`, fullPage: true });
  dialogs = 0;
  await p.click("#approve"); await p.waitForTimeout(3000);
  ok(`${tag}: approving asks nothing more (no pop-up)`, dialogs === 0, String(dialogs));
  ok(`${tag}: and opens the next one waiting`, /Ben Second/.test(await p.locator("#root h2").first().innerText()) && /Approve & issue final/.test(await p.locator("#approve").innerText()), await p.locator("#root h2").first().innerText());
  ok(`${tag}: the first is approved`, (await api(`/api/events?id=${ev.id}`)).presenters.find((x) => x.first === "Ann")?.status === "approved");

  // The SharePoint folder sits above More options; the volunteer note is one line.
  await go({ name: "edit", eventId: ev.id });
  ok(`${tag}: Edit event shows the SharePoint folder above More options`, await p.evaluate(() => { const f = document.getElementById("e-folder"), m = document.querySelector(".morehead"); return !!f && !!m && !!(f.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING) && !f.closest("details"); }));
  await go({ name: "event", eventId: ev.id, tab: "people", pview: "volunteers" });
  const how = p.locator(".howit");
  ok(`${tag}: the volunteer explanation is one line, with How it works`, await how.isVisible() && /How it works/.test(await how.innerText()) && !/good standing/.test(await how.innerText()));
  await how.locator("summary").click(); await p.waitForTimeout(200);
  ok(`${tag}: How it works opens the full explanation`, /good standing/.test(await how.innerText()));
  ok(`${tag}: no page errors`, errs.length === 0, errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
