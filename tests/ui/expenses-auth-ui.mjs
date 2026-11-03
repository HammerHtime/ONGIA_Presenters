// ONGIA Expenses' Microsoft sign-in, end to end against a stand-in Microsoft. Microsoft knows the desk's page as the
// way back, so the reply comes to /admin.html, which must hand it straight to /expenses and do nothing with it itself.
// Named *auth-ui.mjs so the test runner gives it port 8799 for the stand-in Microsoft, as it does the desk's sign-in test.
const REPO = new URL("../../", import.meta.url).pathname;
import { register } from "node:module";
register(REPO + "scripts/mock-hooks.mjs", import.meta.url);
const OUT = new URL(".", import.meta.url).pathname;
const MS = await import("./fake-ms.mjs");
await new Promise((r) => MS.server.listen(8799, "127.0.0.1", r));
Object.assign(process.env, { MS_AUTHORITY: "http://127.0.0.1:8799", MS_TENANT_ID: MS.TENANT, MS_SIGNIN_CLIENT_ID: MS.CLIENT, ADMIN_KEY: "testkey" });
process.argv[2] = "8794";
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await import(REPO + "scripts/dev-server.mjs");
await new Promise((r) => setTimeout(r, 700));
const S = "http://127.0.0.1:8794";
await fetch(`${S}/api/roster`, { headers: { "x-admin-key": "testkey" } });   // seeds the board list

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, hgt, tag] of [[390, 844, "phone"], [1280, 860, "wide"]]) {
  const page = await br.newPage({ viewport: { width: w, height: hgt }, deviceScaleFactor: 2, isMobile: w < 500 });
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  console.log(`— ${tag}`);
  // John Healy has no desk access (the desk turns him away), but he is on the board, so he may claim expenses.
  MS.state.email = "j.healy@ongia.ca"; MS.state.name = "John Healy";
  await page.goto(`${S}/expenses`, { waitUntil: "networkidle" });
  await page.waitForSelector("#ms");
  ok(`${tag}: signed out, it opens on Sign in with Microsoft`, /Sign in with your ONGIA Microsoft account/.test(await page.textContent("#root")) && await page.isHidden("#tabs"));
  await page.screenshot({ path: OUT + `exp-signin-${tag}.png` });
  await page.click("#ms");
  await page.waitForSelector("#running", { timeout: 10000 });
  ok(`${tag}: Microsoft was told to come back by the desk's address, the one it knows`, MS.state.lastAuthorize?.redirect_uri === `${S}/admin.html`);
  ok(`${tag}: and the app is where you land, with the address cleaned up`, new URL(page.url()).pathname === "/expenses" && !page.url().includes("code="), page.url());
  ok(`${tag}: signed in as John: My claim, his initials`, (await page.textContent("#title")) === "My claim" && (await page.textContent("#me")) === "JH");
  ok(`${tag}: the desk did not sign itself in on the way through`, await page.evaluate(() => !sessionStorage.getItem("ongia-admin-key")));
  ok(`${tag}: the session is kept on the phone (not lost when the app is closed) and is an expense one, not a desk one`, await page.evaluate(() => (localStorage.getItem("ongia-exp-session") || "").startsWith("x1.")));
  ok(`${tag}: the sign-in record is cleared`, await page.evaluate(() => !localStorage.getItem("ongia-xms")));
  const deskTry = await page.evaluate(async () => (await fetch("/api/events", { headers: { "x-admin-key": localStorage.getItem("ongia-exp-session") } })).status);
  ok(`${tag}: the expense session can't open the desk`, deskTry === 401);
  await page.reload({ waitUntil: "networkidle" }); await page.waitForSelector("#running");
  ok(`${tag}: opening the app again needs no sign-in`, (await page.textContent("#title")) === "My claim");
  await page.click("#me"); await page.click("#signout"); await page.waitForSelector("#ms");
  ok(`${tag}: sign out returns to the sign-in screen`, await page.evaluate(() => !localStorage.getItem("ongia-exp-session")));
  MS.state.email = "stranger@ongia.ca"; MS.state.name = "Stranger";
  await page.click("#ms"); await page.waitForSelector(".say.bad", { timeout: 10000 });
  ok(`${tag}: after signing out, Microsoft is asked for the account picker`, MS.state.lastAuthorize?.prompt === "select_account");
  ok(`${tag}: someone not on the board sees why, in words`, /stranger@ongia\.ca isn't on ONGIA's board list/.test(await page.textContent(".say.bad")));
  await page.screenshot({ path: OUT + `exp-refused-${tag}.png` });
  MS.state.cancel = true; await page.click("#ms"); await page.waitForSelector(".say.bad"); MS.state.cancel = false;
  ok(`${tag}: cancelling at Microsoft gives a plain message, back in the app`, /User declined to consent\./.test(await page.textContent(".say.bad")) && !/Trace ID/.test(await page.textContent(".say.bad")) && new URL(page.url()).pathname === "/expenses");

  // The desk's own sign-in is untouched, even with an old, abandoned expense sign-in left in storage.
  await page.evaluate(() => localStorage.setItem("ongia-xms", JSON.stringify({ verifier: "v", state: "an-old-one", nonce: "n", at: Date.now() })));
  MS.state.email = "president@ongia.ca"; MS.state.name = "Andrew Hammond";
  await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await page.waitForSelector("#ms");
  await page.click("#ms");
  await page.waitForSelector(".evcard, .empty", { timeout: 10000 });
  // The "Signed in as" line can fill in just after the events do: wait for it rather than read it the same moment.
  await page.waitForFunction(() => /Signed in as/.test(document.getElementById("whoami")?.textContent ?? ""), null, { timeout: 5000 }).catch(() => {});
  ok(`${tag}: the desk's own sign-in still lands on the desk`, new URL(page.url()).pathname === "/admin.html" && /Signed in as Andrew Hammond/.test(await page.textContent("#whoami")));
  ok(`${tag}: no script errors`, errs.length === 0, errs.join("; "));
  await page.close();
}
await br.close();
MS.server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
