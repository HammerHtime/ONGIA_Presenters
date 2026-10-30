// Certificates and the attendee downloads on Who's coming (Andrew 30 Oct 2026): pick the design, the date (the event's
// last day unless changed), preview, and download anyone's certificate; Download the list gives the registration list
// and the certificate program's list. The lead sees it; another board member on the event does not.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const fs = await import("node:fs");
const { execFileSync } = await import("node:child_process");
const D = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const T = Date.now().toString(36);
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: "National Gang Summit", city: "Toronto", dayOne: "2031-05-04", lastDay: "2031-05-06", invite: false, presenters: [],
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }, { name: "Other Member", email: "member@ongia.ca" }] }) })).event;
// A sign-in sheet from the door: two checked in, one not.
await fetch(`${S}/api/attendees?event=${ev.id}&csv=1`, { method: "POST", headers: { "x-admin-key": "testkey", "content-type": "text/csv" },
  body: `First name,Last name,Email,Organization,Checked in\nJordan,Tremblay,jt.${T}@torontopolice.on.ca,TPS,Yes\nSam,Okafor,so.${T}@opp.ca,OPP - Gang Unit,Yes\nAlex,Martin,am.${T}@peelpolice.ca,Peel Police,\n` });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (email, w, h) => {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, acceptDownloads: true });
  const token = issueSession({ email, name: email });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email, name: email }]);
  p.errs = []; p.on("pageerror", (e) => p.errs.push(String(e)));
  await p.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "event", eventId: ev.id, tab: "people", pview: "guests" })), { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  return p;
};

const other = await open("member@ongia.ca", 1440, 1000);
ok("another board member on the event sees no Certificates and no Download the list", await other.locator("#certsfold").count() === 0 && await other.locator(".dlmenu").count() === 0);
await other.close();

for (const [w, h, tag] of [[1440, 1000, "wide"], [390, 844, "phone"]]) {
  const p = await open("treasurer@ongia.ca", w, h);
  // Download the list.
  await p.locator(".dlmenu > summary").click();
  ok(`${tag}: Download the list offers the registration list and the certificate program's list`, await p.locator('[data-glist="registration"]').isVisible() && await p.locator('[data-glist="certificate"]').isVisible());
  if (tag === "wide") await p.locator(".dlmenu").screenshot({ path: D + "certs-dlmenu.png" }).catch(() => {});
  const [reg] = await Promise.all([p.waitForEvent("download"), p.locator('[data-glist="registration"]').click()]);
  const regText = fs.readFileSync(await reg.path(), "utf8");
  ok(`${tag}: the registration list downloads, sorted by last name, with official agency names`, reg.suggestedFilename() === "national-gang-summit-registration-list.csv" && /"Martin","Alex","Peel Regional Police"/.test(regText) && regText.indexOf("Martin") < regText.indexOf("Okafor"), regText);
  await p.locator(".dlmenu > summary").click();
  const [cl] = await Promise.all([p.waitForEvent("download"), p.locator('[data-glist="certificate"]').click()]);
  const clText = fs.readFileSync(await cl.path(), "utf8");
  ok(`${tag}: the certificate program's list has only the two checked in, with the last day`, clText.trim().split("\n").length === 3 && /"Jordan","Tremblay","Toronto Police Service",.*"National Gang Summit","06\/05\/2031"/.test(clText) && !/Martin/.test(clText), clText);

  // Certificates.
  const fold = p.locator("#certsfold");
  if (!(await fold.getAttribute("open"))) await fold.locator("summary").click();
  await p.waitForTimeout(1200);
  ok(`${tag}: the Summit's own design is picked, the date is the last day`, await p.locator('.certtpl.on input[value="national-gang-summit"]').count() === 1 && (await p.locator("#cert-date").inputValue()) === "2031-05-06");
  ok(`${tag}: the two checked in are listed with their official agencies`, await p.locator("[data-certkey]").count() === 2 && /Ontario Provincial Police/.test(await fold.innerText()) && /Toronto Police Service/.test(await fold.innerText()));
  if (tag === "wide") {
    await fold.screenshot({ path: D + "certs-wide.png" });
    // Download Jordan's certificate and read it.
    const row = p.locator("[data-certkey]", { hasText: "Jordan Tremblay" });
    const [dl] = await Promise.all([p.waitForEvent("download"), row.locator("[data-certpdf]").click()]);
    const file = await dl.path(); fs.copyFileSync(file, "/tmp/certs-jordan.pdf");
    const words = execFileSync("pdftotext", ["-layout", "/tmp/certs-jordan.pdf", "-"]).toString();
    ok("Download PDF gives Jordan's certificate: name, official agency, the last day", dl.suggestedFilename() === "Jordan Tremblay - certificate.pdf" && /Jordan Tremblay/.test(words) && /Toronto Police Service/.test(words) && /06\/05\/2031/.test(words), words.slice(0, 200));
    await p.waitForTimeout(1200);
    ok("and it now shows its number", /No\. [A-Z0-9]{4}-[A-Z0-9]{4}/.test(await p.locator("[data-certkey]", { hasText: "Jordan Tremblay" }).innerText()));
    // Change the date; then back.
    await p.locator("#cert-date").fill("2031-05-07"); await p.locator("#cert-date").dispatchEvent("change"); await p.waitForTimeout(1200);
    ok("the date can be changed, and says so", (await p.locator("#cert-date").inputValue()) === "2031-05-07" && await p.locator("#cert-dateback").isVisible());
    await p.locator("#cert-dateback").click(); await p.waitForTimeout(1200);
    ok("Use the last day puts it back", (await p.locator("#cert-date").inputValue()) === "2031-05-06" && await p.locator("#cert-dateback").count() === 0);
    // The generic design asks for the course.
    await p.locator('.certtpl:has(input[value="generic"])').click(); await p.waitForTimeout(1200);
    ok("the generic design adds the course, filled with the event's title", await p.locator("#cert-course").isVisible() && (await p.locator("#cert-course").inputValue()) === "National Gang Summit");
    await p.locator('.certtpl:has(input[value="national-gang-summit"])').click(); await p.waitForTimeout(1200);
    // Everyone coming.
    await p.locator('[data-certcut="all"]').click(); await p.waitForTimeout(500);
    ok("Everyone coming shows Alex too, not checked in, still downloadable", await p.locator("[data-certkey]").count() === 3 && /Not checked in/i.test(await p.locator("[data-certkey]", { hasText: "Alex Martin" }).innerText()));
    // Preview opens a PDF in a new tab.
    const [tab] = await Promise.all([p.context().waitForEvent("page"), p.locator("#cert-preview").click()]);
    ok("Preview a PDF opens one", !!tab); await tab.close().catch(() => {});
    // Verify page for Jordan's number.
    const code = /No\. ([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(await p.locator("[data-certkey]", { hasText: "Jordan Tremblay" }).innerText())?.[1];
    const vp = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await vp.goto(`${S}/verify.html?c=${code}`, { waitUntil: "networkidle" }); await vp.waitForTimeout(600);
    const vt = await vp.locator("#box").innerText();
    ok("the verify page (what the QR code opens) confirms it, with Add to LinkedIn", /genuine ONGIA certificate/.test(vt) && /Jordan Tremblay/.test(vt) && /Toronto Police Service/.test(vt) && /May 6, 2031/.test(vt) && await vp.locator("a.li").isVisible(), vt);
    await vp.screenshot({ path: D + "certs-verify.png", fullPage: true });
    await vp.goto(`${S}/verify.html?c=ZZZZ-ZZZZ`, { waitUntil: "networkidle" }); await vp.waitForTimeout(600);
    ok("a made-up number is not genuine", /no certificate with this number/i.test(await vp.locator("#box").innerText()));
    await vp.close();
  } else {
    await fold.screenshot({ path: D + "certs-phone.png" });
  }
  ok(`${tag}: fits, no errors`, (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) && !p.errs.length, p.errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
