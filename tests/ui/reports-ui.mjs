// Reports on an RBH event's Survey tab (Andrew 30 Oct 2026): make the executive summary, open it (English or French),
// ask Claude for a change in the viewer and see it rebuilt, then mark it final. A non-RBH event has no Reports card.
const REPO = new URL("../../", import.meta.url).pathname;
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
const mk = async (title, extra = {}) => (await api("/api/events", { method: "POST", body: JSON.stringify({ title, city: "Montréal, QC", venue: "Hall", dayOne: shift(-5), lastDay: shift(-2), invite: false,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], ...extra }) })).event;
const ev = await mk(`Illicit Trade ${T}`, { kind: "rbh", province: "QC", invoicePrefix: "IT" });
const plain = await mk(`Plain Training ${T}`);
for (const e of [ev, plain]) {
  const set = await api(`/api/survey?event=${e.id}`, { method: "PUT", body: JSON.stringify({ open: true, mode: "end", sendOn: shift(-1), sessions: [{ id: "sa", day: e.dayOne, title: "Field visits", titleFr: "Visites sur le terrain", presenters: ["Jordan Avery"] }] }) });
  const stars = (n) => Object.fromEntries(["relevant", "knowledge", "expectations", "expert", "engaging", "delivery"].map((k) => [k, n]));
  for (const [i, n] of [5, 5, 4, 5].entries())
    await fetch(`${S}/api/survey?t=${set.survey.token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ part: "end", lang: i === 1 ? "fr" : "en",
      about: { agency: "TPS", province: "QC", years: i, before: 0, again: 0, heard: 1 }, sessions: { sa: { ...stars(n), rebook: 0, ...(i === 0 ? { comment: "Both field tours closed the loop for me." } : {}) } },
      overall: { quality: n, pace: 1, confidence: n, variety: 4, practical: n, venue: 5, av: 4, registration: 5, food: 3, length: 1, nps: 9, topics: "Court testimony" } }) });
}
// What Claude writes (the stand-in on 8799 answers every request with this; each report reads the parts it needs).
await fetch("http://127.0.0.1:8799/__set", { method: "POST", body: JSON.stringify({ reply: {
  glance: ["This summary presents the post-training survey results."], context: [], notes: [{ id: "quality", note: "Strong" }], strengths: ["The field visits stood out."], quotes: [{ commentId: 1, about: "Field visits" }],
  areas: [{ title: "Vape identification", text: "Lowest score." }], topicsIntro: "", topics: ["Court testimony"], recommendations: ["Keep the field visits."], extra: [{ title: "The Akwesasne visit", paragraphs: ["First time on the program."] }],
  tagline: "A strong result.", lockIn: [{ head: "Field visits.", text: "Keep them." }], buildNext: [], quote: { commentId: 1, about: "Field visits" }, wantNext: ["Court testimony"],
  reply: "Added a section on the Akwesasne visit." } }) });

// A UTF-8 setting, as any Mac or iPad has: without one the browser saves "Sommaire exécutif.pdf" as "download".
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" } });
const open = async (id, w, h) => {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, acceptDownloads: true });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", canCost: true }]);
  p.errs = []; p.on("pageerror", (e) => p.errs.push(String(e))); p.on("dialog", (d) => d.accept());
  await p.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "event", eventId: id, tab: "survey" })), { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  return p;
};
const until = async (p, fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await p.waitForTimeout(500); } return false; };

let p = await open(plain.id, 1440, 1000);
ok("a non-RBH event's Survey tab has no Reports card", await p.locator("#reportsfold").count() === 0);
await p.close();

p = await open(ev.id, 1440, 1000);
const card = p.locator("#reportsfold");
ok("an RBH event's Survey tab leads with Reports: the executive summary and the infographic", await card.count() === 1 && /Executive Summary/.test(await card.innerText()) && /Sommaire exécutif/.test(await card.innerText()) && /Infographic/.test(await card.innerText()) && /4 surveys back/.test(await card.innerText()), await card.innerText());
await card.locator('[data-rpbuild="exec"]').click();
ok("Make it now: Claude writes it", await until(p, async () => /version 1/.test(await card.innerText())), await card.innerText());
ok("then it lists English and Français to open", await card.locator('[data-rpopen="exec|en"]').isVisible() && await card.locator('[data-rpopen="exec|fr"]').isVisible() && /Updates each night/.test(await card.innerText()));
await card.screenshot({ path: D + "reports-card.png" });

// The viewer: the pages, then a change asked of Claude.
await card.locator('[data-rpopen="exec|en"]').click();
const dlg = p.locator("dialog.repdlg");
ok("the viewer opens the summary's pages", await until(p, async () => (await dlg.locator("canvas.rppage").count()) >= 1, 20000) && /Executive Summary/.test(await dlg.locator("#rp-title").innerText()));
await dlg.locator("#rp-text").fill("Add a section on the Akwesasne visit");
await dlg.locator("#rp-send").click();
ok("the request shows in the chat, and Claude gets to work", /Add a section on the Akwesasne visit/.test(await dlg.locator("#rp-chat").innerText()));
ok("Claude says what it changed, and it's rebuilt as version 2", await until(p, async () => /Added a section on the Akwesasne visit/.test(await dlg.locator("#rp-chat").innerText()) && /version 2/.test(await dlg.locator("#rp-chat").innerText())), await dlg.locator("#rp-chat").innerText());
ok("the change is listed, kept on every rebuild", /Your changes, kept on every rebuild/.test(await dlg.locator("#rp-reqs").innerText()) && /Akwesasne/.test(await dlg.locator("#rp-reqs").innerText()));
await p.waitForTimeout(1500);
await dlg.screenshot({ path: D + "reports-viewer.png" });
await dlg.locator('[data-rplang="fr"]').click();
ok("Français shows the French version", await until(p, async () => /Sommaire exécutif/.test(await dlg.locator("#rp-title").innerText()) && (await dlg.locator("canvas.rppage").count()) >= 1));
const [dl] = await Promise.all([p.waitForEvent("download"), dlg.locator("#rp-dl").click()]);
ok("Download gives the French PDF", /Sommaire exécutif\.pdf$/.test(dl.suggestedFilename()), dl.suggestedFilename());
await dlg.locator("#rp-close").click(); await p.waitForTimeout(1200);
await card.locator('[data-rpfinal="exec|1"]').click(); await p.waitForTimeout(1200);
ok("Mark as final: it says so, and offers to resume", /Final/.test(await card.innerText()) && await card.locator('[data-rpfinal="exec|0"]').count() === 1);
ok("no errors", !p.errs.length, p.errs.join(" | "));
await p.close();

// On a phone.
p = await open(ev.id, 390, 844);
await p.locator('[data-rpopen="exec|en"]').click();
await until(p, async () => (await p.locator("dialog.repdlg canvas.rppage").count()) >= 1, 20000);
await p.screenshot({ path: D + "reports-viewer-phone.png" });
ok("phone: the viewer fits, the chat is below the pages", (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) && await p.locator("#rp-text").count() === 1 && !p.errs.length, p.errs.join(" | "));
await p.close();
// Practice events from the Sandbox (Andrew 30 Oct 2026): make them, open the ITP week, its reports are ready to make.
p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" }), { email: "president@ongia.ca", name: "Andrew Hammond", canCost: true, owner: true }]);
p.on("dialog", (d) => d.accept()); const perrs = []; p.on("pageerror", (e) => perrs.push(String(e)));
await p.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "sandbox" })), { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
if (await p.locator("dialog.walk[open], dialog.sbxq[open]").count()) await p.keyboard.press("Escape");
await p.locator("#practicebtn").click(); await p.waitForTimeout(800);
await p.locator("#pr-make").click();
ok("Sandbox › Practice events makes the ITP week and the symposium", await until(p, async () => (await p.locator("[data-popen]").count()) === 2));
await p.locator("[data-popen]", { hasText: "ITP Week" }).click(); await p.waitForTimeout(1800);
ok("the ITP week is marked Practice", /Practice/.test(await p.locator(".bhead h2, .evband h2").first().innerText()));
await p.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "event", eventId: (await api("/api/sandbox?practice=1")).events.find((e) => e.kind === "rbh").id, tab: "survey" })), { waitUntil: "networkidle" }); await p.waitForTimeout(1800);
ok("its Survey tab shows 12 of 12 surveys back, ready for the reports", /12 of 12 surveys back \(100%\)/.test(await p.locator("#reportsfold").innerText()), await p.locator("#reportsfold").innerText());
ok("the surveys back fill green, deepening toward all of them back: the full bar ends deep green", await p.evaluate(() => { const i = document.querySelector(".rpbar i"); const bg = getComputedStyle(i).backgroundImage; return /linear-gradient/.test(bg) && /47, 107, 79/.test(bg) && /^(\d+)%$/.test(i.style.getPropertyValue("--rpfull")); }));
ok("no errors in the Sandbox", !perrs.length, perrs.join(" | "));
await p.close();
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
