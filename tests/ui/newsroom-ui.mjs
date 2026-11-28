// The Newsroom tab (Andrew 28 Nov 2026): a sample night run through the real desk with Claude stood in for, then the
// library like an inbox (story beside the list on a computer, full screen with Back on a phone), search as you type,
// Copy, keywords, the Control room's nights, and the president alone sees it. 1440 and 390 wide. Names are made up.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const D = process.env.SHOTS ? process.env.SHOTS + "/" : null;
const S = "http://127.0.0.1:8788";
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const PRES = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
const api = async (p, i = {}, k = PRES) => fetch(S + p, { ...i, headers: { "x-admin-key": k, "content-type": "application/json", ...(i.headers ?? {}) } });

// Claude, stood in for: one official release found, picked, written, checked and edited.
const draft = {
  headline: "Three handguns, one 3D-printed, found in Brampton home search", summary: "Peel police found three handguns in a Brampton home. Two adults are charged.",
  commentary: "Printed guns carry no serial number and turn up well beyond one city.",
  captions: { linkedin: "Peel police found three handguns, one of them 3D-printed, in a Brampton home. Two adults are charged.\n\nPrinted guns carry no serial number to trace. #ONGIA #GhostGuns #Peel", instagram: "Three handguns, one 3D-printed, found in Brampton. Link in bio. #ONGIA #GhostGuns", x: "Three handguns, one 3D-printed, found in Brampton https://www.peelpolice.ca/news/123 #ONGIA" },
  image: { kicker: "SEIZURE · BRAMPTON, ON", headline: "Three handguns, one 3D-printed", figures: [{ value: "3", label: "handguns" }, { value: "2", label: "charged" }], view: "Printed guns carry no serial number and turn up well beyond one city.", source: "Peel Regional Police news release" },
  keywords: { where: ["Brampton", "Ontario", "Canada"], agency: ["Peel Regional Police"], crime: ["guns"], specifics: ["ghost gun"], outcome: ["seizure", "charges"], people: ["adult"] },
  hashtags: ["#ONGIA", "#GhostGuns"], facts: [{ id: "f1", statement: "Police seized three handguns, 3 in all, one 3D-printed", kind: "number", sourceName: "Peel Regional Police", sourceUrl: "https://www.peelpolice.ca/news/123" }, { id: "f2", statement: "2 adults were charged", kind: "charge", sourceName: "Peel Regional Police", sourceUrl: "https://www.peelpolice.ca/news/123" }],
  comparisons: [], namesInSources: ["Casey Lindqvist"], photo: { url: "", description: "" }, andrewComment: "Why are the guns getting harder to trace?\n\nI see it in every province. #ONGIA",
};
await fetch("http://127.0.0.1:8799/__set", { method: "POST", body: JSON.stringify({ reply: { tools: {
  report_items: { items: [{ title: "Peel Regional Police seize three handguns, one 3D-printed, in Brampton", url: "https://www.peelpolice.ca/news/123", outlet: "Peel Regional Police", published: new Date().toISOString(), snippet: "Two adults charged.", official: true }] },
  choose: { picks: [{ n: 1, type: "guns", why: "ghost guns in the GTA", goodNews: false, bigPicture: false, significant: true, agency: "Peel Regional Police", city: "Brampton", province: "ON", project: "", details: ["handguns"] }], updates: [], skipped: [] },
  submit_draft: draft,
  submit_check: { facts: draft.facts.map((f) => ({ id: f.id, verdict: "confirmed", corrected: "", sourceUrl: f.sourceUrl, note: "" })), captions: draft.captions, image: draft.image, headline: draft.headline, summary: draft.summary, commentary: draft.commentary, andrewComment: draft.andrewComment },
  submit_edit: { captions: draft.captions, view: draft.image.view, headline: draft.headline, summary: draft.summary, commentary: draft.commentary, andrewComment: draft.andrewComment },
} } }) });
await api("/api/newsroom", { method: "PUT", body: JSON.stringify({ sources: { feeds: [], officialSites: [{ name: "Peel Regional Police", domain: "peelpolice.ca", province: "ON" }], newsQueries: [] } }) });
const vpTry = await api("/api/newsroom", {}, issueSession({ email: "vp_operations@ongia.ca", name: "VP" }));
ok("the VP is turned away by the server", vpTry.status === 403);
const started = await api("/api/newsroom?run=1", { method: "POST", body: JSON.stringify({ mode: "sample" }) });
ok("Run a sample starts in the background", started.status === 202);
for (let i = 0; i < 40; i++) { const h = await (await api("/api/newsroom")).json(); if (!h.running && h.nights?.[0]?.finishedAt) break; await new Promise((r) => setTimeout(r, 500)); }
const idx = (await (await api("/api/newsroom?index=1")).json()).stories;
ok("the sample night wrote one story into the library", idx.length >= 1 && idx[0].mode === "sample", JSON.stringify(idx).slice(0, 200));

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1440, 1000, "wide"], [390, 844, "phone"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: D ? 2 : 1 });
  await p.addInitScript(([t]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify({ email: "president@ongia.ca", name: "Andrew Hammond", owner: true, canCost: true })); } catch {} }, [PRES]);
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(`${S}/admin.html#v=${encodeURIComponent(JSON.stringify({ name: "newsroom" }))}`, { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
  ok(`${tag}: the Newsroom opens with its three tabs`, (await p.locator(".nrseg button").allInnerTexts()).join("|") === "Stories|Trends|Control room");
  ok(`${tag}: the summary line says it is off, samples only`, /Off · samples only/.test(await p.locator("#nr-sum summary").innerText()));
  const row = p.locator(".nrrow").first();
  ok(`${tag}: the story's tile: date, type, city, Sample, headline`, /Guns & gangs/.test(await row.innerText()) && /Brampton, ON/.test(await row.innerText()) && /Sample/.test(await row.innerText()) && /3D-printed/.test(await row.innerText()));
  ok(`${tag}: a tile is tight (${tag === "phone" ? "two lines, under 64px" : "inbox tile, under 100px"})`, (await row.boundingBox()).height < (tag === "phone" ? 64 : 100), String((await row.boundingBox()).height));
  ok(`${tag}: the filters sit on one row`, await p.evaluate(() => new Set([...document.querySelectorAll(".nrfilt > *")].map((e) => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2))).size === 1));
  ok(`${tag}: the tab names fit on one line`, await p.evaluate(() => [...document.querySelectorAll(".nrseg button")].every((b) => b.getBoundingClientRect().height < 40)));
  if (tag === "wide") {
    ok("wide: the story opens beside the list", await p.locator("#nr-pane h2").isVisible() && /Three handguns/.test(await p.locator("#nr-pane h2").innerText()));
    if (D) await p.screenshot({ path: D + "newsroom-wide.png" });
  } else {
    ok("phone: the story pane is hidden until a tile is tapped", !(await p.locator("#nr-pane h2").isVisible().catch(() => false)));
    if (D) await p.screenshot({ path: D + "newsroom-phone-list.png" });
    await row.click(); await p.waitForTimeout(700);
    ok("phone: tapping opens it full screen, with Back", await p.locator("#nr-pane h2").isVisible() && await p.locator("#nr-back").isVisible() && !(await p.locator(".nrlist").isVisible()));
    if (D) await p.screenshot({ path: D + "newsroom-phone-story.png", fullPage: true });
  }
  const pane = p.locator("#nr-pane");
  ok(`${tag}: the LinkedIn caption shows, with no header or label`, /Peel police found three handguns/.test(await pane.locator("#nr-cap").innerText()) && !/Summary:|ONGIA Lens/.test(await pane.innerText()));
  await pane.locator('[data-nrcap="x"]').click();
  ok(`${tag}: the X tab switches the caption`, /peelpolice\.ca/.test(await pane.locator("#nr-cap").innerText()));
  ok(`${tag}: the comment for Andrew is there with its own Copy`, /harder to trace/.test(await pane.innerText()) && await pane.locator("#nr-copyc").count() === 1);
  ok(`${tag}: each statement carries its check result`, (await pane.locator(".nrfc b.nrv-confirmed").count()) === 2);
  ok(`${tag}: the post image loads`, await pane.locator(".nrsplit img").evaluate((i) => i.complete && i.naturalWidth === 1080));
  ok(`${tag}: the made-up name from the source is nowhere on the page`, !/Lindqvist/.test(await p.content()));
  ok(`${tag}: nothing scrolls sideways`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  if (tag === "wide") {
    await pane.locator("#nr-kadd").fill("Project Example"); await pane.locator("#nr-kadd").press("Enter"); await p.waitForTimeout(600);
    ok("wide: a keyword added by hand is saved", /Project Example/.test(await pane.locator("#nr-kw").innerText()) && (await (await api(`/api/newsroom?story=${idx[0].id}`)).json()).story.keywords.specifics.includes("Project Example"));
    await p.fill("#nr-q", "peel ghost"); await p.waitForTimeout(200);
    ok("wide: search narrows as you type, with a count ('peel ghost')", /1 story/.test(await p.locator("#nr-n").innerText()));
    await p.fill("#nr-q", "winnipeg"); await p.waitForTimeout(200);
    ok("wide: and says so when nothing matches", /0 stories/.test(await p.locator("#nr-n").innerText()) && /No story matches/.test(await p.locator("#nr-rows").innerText()));
    await p.fill("#nr-q", "");
    await p.locator('[data-nrtab="control"]').click(); await p.waitForTimeout(900);
    ok("wide: the Control room: off, stories a night, Buffer not connected", /off: nothing runs on its own/.test(await p.locator(".nrcard").first().innerText()) && await p.locator("#nr-min").inputValue() === "5" && /Not connected yet/.test(await p.locator(".nrcard").first().innerText()));
    const night = p.locator("[data-nrnight]").first();
    ok("wide: the night's line: Sample, 1 written, its cost", /Sample · 1 written · \$\d/.test(await night.locator("summary").innerText()), await night.locator("summary").innerText());
    await night.locator("summary").click(); await p.waitForTimeout(800);
    ok("wide: opened, the night shows what was picked and why", /Picked · 1/i.test(await night.innerText()) && /ghost guns in the GTA/.test(await night.innerText()));
    if (D) await p.screenshot({ path: D + "newsroom-control.png", fullPage: true });
    await p.locator('[data-nrtab="trends"]').click(); await p.waitForTimeout(700);
    ok("wide: Trends says its counts are ONGIA's stories, samples left out", /not official statistics/.test(await p.locator("#nr-body").innerText()) && /Samples are left out/.test(await p.locator("#nr-body").innerText()));
  }
  ok(`${tag}: no script errors`, !errs.length, errs.join(" | "));
  await p.close();
}
// The VP's desk has no Newsroom in the menu.
const q = await b.newPage({ viewport: { width: 1440, height: 900 } });
const VP = issueSession({ email: "vp_operations@ongia.ca", name: "VP Ops" });
await q.addInitScript(([t]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify({ email: "vp_operations@ongia.ca", name: "VP Ops", owner: true, canCost: true })); } catch {} }, [VP]);
await q.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await q.waitForTimeout(800);
ok("the VP's menu has no Newsroom", (await q.locator("#newsnav").count()) === 0);
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
