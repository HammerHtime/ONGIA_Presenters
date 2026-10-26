// The Website card on a CFAOC event's Settings tab (Andrew 22 Oct 2026): only on those events and only for the president
// and VP; the fields save; "Update website" shows what would change, Cancel sends nothing, Publish makes one commit,
// and pressing again says nothing has changed. It runs its own desk (port 8797) against a stand-in GitHub (8796).
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const D = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8797", GH = "http://127.0.0.1:8796", H = { "x-admin-key": "testkey", "content-type": "application/json" };
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };

const seedFile = path.join(mkdtempSync(path.join(tmpdir(), "ghseed-")), "seed.json");
writeFileSync(seedFile, JSON.stringify({ "events.json": JSON.stringify({ site: {}, content: {}, events: [{ slug: "victoria", city: "Victoria", date: "2026-11-24", startTime: "08:00", endTime: "16:30",
  registerUrl: "https://www.ongia.org/event-details/cfaoc", venue: { name: "Delta Ocean Pointe", street: "100 Harbour Road", postalCode: "V9A 0G1" }, hotel: { name: "Delta Ocean Pointe", rate: "$249" },
  speakers: [{ name: "Old Speaker", org: "Somewhere" }], agenda: [{ time: "08:00", end: "08:30", title: "Coffee service and pastries" }] }], i18n: { fr: { events: { victoria: { agenda: [{ time: "08:00", end: "08:30", title: "Café et viennoiseries" }] } } } } }) }));
const gh = spawn(process.execPath, [REPO + "tests/fake-github.mjs", "8796", "github_pat_ui", seedFile], { stdio: "ignore" });
const desk = spawn(process.execPath, [REPO + "scripts/dev-server.mjs", "8797"], { cwd: REPO, stdio: "ignore",
  env: { ...process.env, ADMIN_KEY: "testkey", CFAOC_GITHUB_TOKEN: "github_pat_ui", CFAOC_GITHUB_API: GH, RESEND_API_KEY: "", MS_MAIL_FROM: "", WIX_API_KEY: "" } });
const up = async (u) => { for (let i = 0; i < 60; i++) { try { if ((await fetch(u)).status < 500) return; } catch {} await new Promise((r) => setTimeout(r, 250)); } throw new Error(`${u} did not start`); };
try {
  await up(S + "/admin.html"); await up(GH + "/__state");
  const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
  await api("/api/roster");
  const T = Date.now().toString(36);
  const mk = async (title, people) => (await api("/api/events", { method: "POST", body: JSON.stringify({ title, city: "Victoria, BC", venue: "Delta Ocean Pointe", dayOne: "2026-11-24", lastDay: "2026-11-24", invite: false,
    board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], presenters: people.map(([f, l]) => ({ first: f, last: l, email: `${f.toLowerCase()}.${T}@example.ca`, organization: "Sample Police Service" })) }) })).event;
  const W = await mk(`Canadian Forum Against Organized Crime Western Symposium ${T}`, [["Jenny", "Sample"], ["Pat", "Private"], ["Nora", "Notyet"]]);
  const O = await mk(`Gang Awareness Day ${T}`, [["Al", "Other"]]);
  const PW = (await api(`/api/events?id=${W.id}`)).presenters;
  const sign = async (p, pub) => fetch(`${S}/api/agreement?t=${p.token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ first: p.first, last: p.last, email: p.email, phone: "4165550100", organization: "Sample Police Service",
    talk: `${p.first}'s talk`, bio: `${p.first} has worked in criminal intelligence for twenty years. `.repeat(3), outline: "An outline.", travel: "no", hotel: "no", expenses: { transport: "no", meals: "no", other: "no", otherText: "" }, copyright: true, noInvestigation: true, termsAccepted: true,
    media: { photo: { internal: "yes", public: "no" }, materials: { internal: "yes", public: "no" }, summary: { internal: "yes", public: pub }, bio: { internal: "yes", public: pub } }, sensitive: "no", signature: `${p.first} ${p.last}`, agreed: true, language: "en" }) });
  await sign(PW.find((p) => p.first === "Jenny"), "yes");
  await sign(PW.find((p) => p.first === "Pat"), "no");

  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const open = async (vp, who = { email: "president@ongia.ca", name: "Andrew Hammond", owner: true, canCost: true }) => {
    const page = await b.newPage({ viewport: vp, deviceScaleFactor: 2 });
    const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    const token = issueSession({ email: who.email, name: who.name });
    await page.addInitScript(([t, w]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(w)); } catch {} }, [token, who]);
    await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await page.waitForTimeout(700);
    return { page, errs };
  };
  const settings = async (page, id) => { await page.locator(`[data-open="${id}"]`).first().click(); await page.waitForTimeout(1200); await page.locator('.etab[data-tab="settings"]').click(); await page.waitForTimeout(1200); };

  for (const [tag, vp] of [["phone", { width: 390, height: 844 }], ["wide", { width: 1280, height: 900 }]]) {
    const { page, errs } = await open(vp);
    await settings(page, O.id);
    ok(`${tag}: an ordinary event has no Website card`, (await page.locator("#websync").count()) === 0);
    await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await page.waitForTimeout(700);
    await settings(page, W.id);
    ok(`${tag}: the CFAOC event has the Website card`, (await page.locator("#websync").count()) === 1);
    const card = () => page.locator("#websync").innerText();
    ok(`${tag}: it lists who goes on the website and who does not, and why`, /Jenny Sample/.test(await card()) && /Pat Private \(said no to public use\)/.test(await card()) && (tag === "phone" ? /Nora Notyet \(has not signed yet\)/ : /Nora Notyet[\s\S]*not signed: name only/i).test(await card()), (await card()).slice(0, 600));
    ok(`${tag}: fits the screen`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    if (tag === "phone") {
      await page.fill("#ws-page", "victoria"); await page.click("#ws-save"); await page.waitForTimeout(700);
      await page.click("#ws-fill"); await page.waitForTimeout(1200);
      ok(`${tag}: bringing over the website fills the times, address and program`, (await page.inputValue("#ws-startTime")) === "08:00" && (await page.inputValue("#ws-street")) === "100 Harbour Road" && (await page.locator("[data-wsrow]").count()) === 1);
      await page.click("#ws-addrow"); await page.waitForTimeout(300);
      const row = page.locator("[data-wsrow]").last();
      await row.locator('[data-k="time"]').fill("08:30"); await row.locator('[data-k="end"]').fill("09:15");
      await row.locator('[data-k="presenter"]').selectOption({ label: "Jenny Sample" });
      await page.locator("#webfold").screenshot({ path: D + "website-card-phone.png" });
      const before = (await (await fetch(GH + "/__state")).json()).head;
      await page.click("#ws-go"); await page.waitForTimeout(1500);
      const sum = await page.locator("#wsdlg").innerText();
      ok(`${tag}: Update website shows what would change before anything is sent`, /1 new presenter: Jenny Sample/.test(sum) && /taken off the website: Old Speaker/.test(sum) && /Program/.test(sum) && /No French yet for Jenny Sample/.test(sum), sum);
      await page.screenshot({ path: D + "website-summary-phone.png" });
      await page.locator("#wsdlg button[value=cancel]").click(); await page.waitForTimeout(800);
      ok(`${tag}: Cancel sends nothing`, (await (await fetch(GH + "/__state")).json()).head === before);
      await page.click("#ws-go"); await page.waitForTimeout(1500);
      await page.click("#wsdlg-go"); await page.waitForTimeout(2000);
      const st = await (await fetch(GH + "/__state")).json();
      const file = JSON.parse(st.files["desk/victoria.json"] ?? "{}");
      ok(`${tag}: Publish makes one commit naming the event and who pressed`, st.head !== before && /Western Symposium/.test(st.message) && /Andrew Hammond/.test(st.message), st.message);
      ok(`${tag}: the website gets Jenny, her talk on the program, and nobody who said no`, file.event?.speakers?.map((s) => s.name).join() === "Jenny Sample" && file.event.agenda[1].title === "Jenny's talk" && !JSON.stringify(file).includes("Private") && !JSON.stringify(file).includes("@example.ca"), JSON.stringify(file).slice(0, 300));
      ok(`${tag}: the card says when it was last sent, with a link to the change`, /Last sent to the website/.test(await card()));
      await page.click("#ws-go"); await page.waitForTimeout(1500);
      ok(`${tag}: pressing again: nothing has changed, and no Publish button`, /Nothing has changed/.test(await page.locator("#wsdlg").innerText()) && await page.locator("#wsdlg-go").isHidden());
      await page.locator("#wsdlg button[value=cancel]").click();
      ok(`${tag}: and no second commit`, (await (await fetch(GH + "/__state")).json()).head === st.head);
      // Shown before signing, name and organization only (Andrew 26 Oct 2026).
      await page.locator('[data-wsearly]').first().click(); await page.waitForTimeout(1500);
      ok(`${tag}: "Show before they sign" puts Nora in the list, marked name only`, /Nora Notyet[\s\S]*not signed: name only/i.test(await card()) && (await page.locator('[data-wsearly]').count()) === 0, (await card()).slice(0, 900));
      await page.locator('[data-wsp] summary', { hasText: "Nora Notyet" }).click(); await page.waitForTimeout(300);
      await page.locator('[data-wsp]', { hasText: "Nora Notyet" }).screenshot({ path: D + "website-early-phone.png" });
      await page.click("#ws-go"); await page.waitForTimeout(1500);
      ok(`${tag}: the summary says she is new and shown with name and organization only`, /1 new presenter: Nora Notyet/.test(await page.locator("#wsdlg").innerText()) && /not signed yet, shown with name and organization only/.test(await page.locator("#wsdlg").innerText()), await page.locator("#wsdlg").innerText());
      await page.locator("#wsdlg button[value=cancel]").click();
    } else await page.locator("#webfold").screenshot({ path: D + "website-card-wide.png" });
    ok(`${tag}: no page errors`, errs.length === 0, errs.join(" | "));
    await page.close();
  }
  // A board member who is not the president or VP does not see the card.
  const { page } = await open({ width: 1280, height: 900 }, { email: "treasurer@ongia.ca", name: "Raj Jaswal" });
  await settings(page, W.id);
  ok("a board member who is not the president or VP does not see the Website card", (await page.locator("#websync").count()) === 0);
  await b.close();
} catch (e) { fail++; console.log("  FAIL", e.message); }
finally { desk.kill(); gh.kill(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
