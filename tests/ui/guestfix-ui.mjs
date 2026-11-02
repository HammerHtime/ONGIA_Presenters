// "Correct names and agencies" on the Guests card (Andrew 3 Nov 2026): a registration form's .xlsx, read in the browser,
// gives names and organizations to people already on the list, and they stay. Fake people throughout.
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
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[390, 844, "phone"], [1440, 900, "wide"]]) {
  const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: "Summit " + tag, city: "Toronto", dayOne: "2031-05-04", lastDay: "2031-05-06", invite: false, presenters: [],
    board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }] }) })).event;
  // As Wix left them: one partner with no organization, one with no name either.
  await fetch(`${S}/api/attendees?event=${ev.id}&csv=1`, { method: "POST", headers: { "x-admin-key": "testkey", "content-type": "text/csv" },
    body: `First name,Last name,Email,Organization\nAvery,Stone,avery.stone@helpers.example.org,\n,,rfield@schools.example.ca,\n` });
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, acceptDownloads: true });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await p.addInitScript(([t]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify({ email: "president@ongia.ca", name: "Andrew Hammond" })); } catch {} }, [token]);
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "event", eventId: ev.id, tab: "people", pview: "guests" })), { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  ok(`${tag}: the Guests card has Correct names and agencies`, await p.locator("#g-fix").isVisible());
  await p.locator("#g-fixfile").setInputFiles(D + "guestfix-form.xlsx");
  await p.waitForTimeout(2000);
  const said = await p.locator("body").innerText();
  ok(`${tag}: it says what it did, and who in the sheet isn't on the list`, /2 agencies and 1 name corrected/.test(said) && /not on this list: Jordan Vale/.test(said), said.match(/corrected[^\n]*/)?.[0]);
  await p.waitForTimeout(2000);
  const list = await p.locator("body").innerText();
  ok(`${tag}: the list shows the organization and the name`, /Helpers Youth Services/.test(list) && /Example DSB/.test(list) && /Rowan/.test(list));
  ok(`${tag}: corrected rows are marked`, await p.locator(".pill", { hasText: "corrected" }).count() === 2);
  const reg = await (await fetch(`${S}/api/certificates?event=${ev.id}&csv=registration`, { headers: { "x-admin-key": "testkey" } })).text();
  ok(`${tag}: the registration download carries them`, /"Field","Rowan","Example DSB"/.test(reg) && /"Stone","Avery","Helpers Youth Services"/.test(reg), reg.slice(0, 300));
  ok(`${tag}: nobody from the sheet was added`, !/Vale/.test(reg));
  // One person, on their row.
  const row = p.locator("tr.grow", { hasText: "Avery" });
  await row.locator("[data-gfixone]").click(); await p.waitForTimeout(300);
  const form = row.locator(".gfxform");
  ok(`${tag}: Correct on a row opens their name and organization`, await form.locator("input").count() === 3 && (await form.locator("input").nth(2).inputValue()) === "Helpers Youth Services");
  await form.locator("input").nth(2).fill("Helpers Youth Services of Niagara");
  await form.locator("button", { hasText: "Save" }).click(); await p.waitForTimeout(2500);
  ok(`${tag}: saving shows it on the list`, /Helpers Youth Services of Niagara/.test(await p.locator("body").innerText()));
  const reg2 = await (await fetch(`${S}/api/certificates?event=${ev.id}&csv=registration`, { headers: { "x-admin-key": "testkey" } })).text();
  ok(`${tag}: and in the download`, /"Stone","Avery","Helpers Youth Services of Niagara"/.test(reg2));
  // The download says what it holds, beside the button.
  await p.locator("details.dlmenu summary").click(); await p.waitForTimeout(200);
  const [dl] = await Promise.all([p.waitForEvent("download"), p.locator('[data-glist="registration"]').click()]);
  await p.waitForTimeout(800);
  const said2 = await p.locator("#g-said").innerText();
  ok(`${tag}: the registration list downloads and says what it holds`, /registration-list\.csv$/.test(dl.suggestedFilename()) && /Downloaded 2 people\. Everyone has a name\. Everyone has an agency\. Nobody is registered twice\./.test(said2), said2);
  ok(`${tag}: no script errors`, errs.length === 0, errs.join(" | "));
  const card = p.locator("#g-fix").locator("xpath=ancestor::div[contains(@class,\"card\")][1]");
  await card.scrollIntoViewIfNeeded(); await card.screenshot({ path: D + `guestfix-${tag}.png` });
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
