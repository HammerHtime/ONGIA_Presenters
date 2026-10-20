// Microsoft sign-in for the desk, end to end against a stand-in Microsoft.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
import { register } from "node:module";
register(REPO + "scripts/mock-hooks.mjs", import.meta.url);
const OUT = new URL(".", import.meta.url).pathname;
const MS = await import("./fake-ms.mjs");
await new Promise((r) => MS.server.listen(8799, "127.0.0.1", r));
Object.assign(process.env, { MS_AUTHORITY: "http://127.0.0.1:8799", MS_TENANT_ID: MS.TENANT, MS_SIGNIN_CLIENT_ID: MS.CLIENT, ADMIN_KEY: "testkey" });
process.argv[2] = "8793";
const F = REPO + "netlify/functions/";
const A = await import(F + "lib/auth.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const rejects = async (p, re) => { try { await p; return "accepted"; } catch (e) { return re.test(e.message) ? true : e.message; } };

console.log("— checking Microsoft's answer");
const good = MS.idToken(MS.claimsFor({ nonce: "n1" }));
ok("a genuine token for this app and tenant is accepted", (await A.verifyIdToken(good, "n1")).email === "president@ongia.ca");
ok("wrong nonce is refused", await rejects(A.verifyIdToken(good, "other"), /doesn't match this sign-in/) === true);
ok("another app's token is refused", await rejects(A.verifyIdToken(MS.idToken(MS.claimsFor({ nonce: "n", aud: "someone-else" })), "n"), /different app/) === true);
ok("another tenant's token is refused", await rejects(A.verifyIdToken(MS.idToken(MS.claimsFor({ nonce: "n", tid: "99999999-0000-0000-0000-000000000000", iss: "http://127.0.0.1:8799/99999999-0000-0000-0000-000000000000/v2.0" })), "n"), /outside ONGIA/) === true);
ok("an expired token is refused", await rejects(A.verifyIdToken(MS.idToken(MS.claimsFor({ nonce: "n", exp: Math.floor(Date.now() / 1000) - 3600 })), "n"), /expired/) === true);
ok("a token signed by some other key is refused", await rejects(A.verifyIdToken(MS.idToken(MS.claimsFor({ nonce: "n" }), MS.otherKey), "n"), /signature/) === true);
const [h, b] = good.split(".");
const tampered = `${h}.${Buffer.from(JSON.stringify({ ...MS.claimsFor({ nonce: "n1" }), preferred_username: "intruder@ongia.ca" })).toString("base64url")}.${good.split(".")[2]}`;
ok("a token with the account changed is refused", await rejects(A.verifyIdToken(tampered, "n1"), /signature/) === true);
ok("an unsigned token is refused", await rejects(A.verifyIdToken(`${Buffer.from('{"alg":"none"}').toString("base64url")}.${b}.`, "n1"), /signed the way/) === true);

console.log("— desk sessions");
const s = A.issueSession({ email: "Raj@ONGIA.ca", name: "Raj" });
ok("a session names its person, lower-cased", A.readSession(s)?.email === "raj@ongia.ca");
ok("a session is refused after 12 hours", A.readSession(s, Date.now() + 12.1 * 3600e3) === null);
const [t, body, mac] = s.split(".");
const forged = `${t}.${Buffer.from(JSON.stringify({ e: "president@ongia.ca", n: "x", x: Date.now() + 1e7 })).toString("base64url")}.${mac}`;
ok("a session edited to someone else is refused", A.readSession(forged) === null);
const real = process.env.ADMIN_KEY; process.env.ADMIN_KEY = "a-new-key";
ok("changing ADMIN_KEY ends every session", A.readSession(s) === null);
process.env.ADMIN_KEY = real;

await import(REPO + "scripts/dev-server.mjs");
await new Promise((r) => setTimeout(r, 700));
const S = "http://127.0.0.1:8793";
const call = (p, key, init = {}) => fetch(S + p, { ...init, headers: { "content-type": "application/json", ...(key ? { "x-admin-key": key } : {}), ...(init.headers ?? {}) } });
const signIn = async (email, name, nonce = "nn") => { MS.state.email = email; MS.state.name = name;
  return call("/api/auth", null, { method: "POST", body: JSON.stringify({ idToken: MS.idToken(MS.claimsFor({ nonce, preferred_username: email, name })), nonce }) }); };

console.log("— who gets in");
const cfg = await (await call("/api/auth")).json();
ok("the sign-in screen is told where Microsoft is", cfg.microsoft?.client === MS.CLIENT && cfg.microsoft.authority.endsWith(MS.TENANT) && cfg.keyLogin === true);
let r = await signIn("raj@ongia.ca", "Raj Jaswal");
ok("a board member without the switch on is turned away, with the reason", r.status === 403 && /isn't on the desk's sign-in list/.test((await r.json()).error));
r = await signIn("stranger@gmail.com", "Stranger");
ok("someone not on the board is turned away", r.status === 403);
r = await signIn("President@ongia.ca", "Andrew Hammond");
const me = await r.json();
ok("the president always gets in", r.status === 200 && me.session?.startsWith("s1.") && me.who.owner === true, JSON.stringify(me));
ok("…and the session opens the desk", (await call("/api/events", me.session)).status === 200);
ok("a made-up session does not", (await call("/api/events", "s1.abc.def")).status === 401);
ok("the old key still works for now", (await call("/api/events", "testkey")).status === 200);
let ro = await (await call("/api/roster", me.session)).json();
ok("the president can change desk access", ro.canGrant === true && ro.owners.includes("president@ongia.ca"));
await signIn("president@ongia.ca", "Andrew Hammond");
ro = await (await call("/api/roster", me.session)).json();
ok("the president's sign-in is recorded on the list", !!ro.members.find((m) => m.email === "president@ongia.ca").lastSignIn);
ro.members.find((m) => m.email === "treasurer@ongia.ca").desk = true;
r = await call("/api/roster", me.session, { method: "PUT", body: JSON.stringify({ members: ro.members }) });
ok("the president turns on Raj's access", (await r.json()).members.find((m) => m.email === "treasurer@ongia.ca").desk === true);
r = await signIn("treasurer@ongia.ca", "Raj");
const raj = await r.json();
ok("Raj can now sign in", r.status === 200 && raj.who.owner === false && raj.who.name === "Raj Jaswal", JSON.stringify(raj));
ro = await (await call("/api/roster", raj.session)).json();
ok("Raj cannot change desk access", ro.canGrant === false);
ro.members.forEach((m) => { m.desk = true; });
ro.members.find((m) => m.email === "treasurer@ongia.ca").phone = "416-555-0199";
r = await (await call("/api/roster", raj.session, { method: "PUT", body: JSON.stringify({ members: ro.members }) })).json();
ok("Raj's save keeps everyone's access as it was, but his phone number goes in", r.members.filter((m) => m.desk).length === 1 && r.members.find((m) => m.email === "treasurer@ongia.ca").phone === "416-555-0199");
const who = await (await call("/api/auth?me=1", raj.session)).json();
ok("the desk can ask who is signed in", who.who?.email === "treasurer@ongia.ca");

console.log("— in the browser");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, hgt, tag] of [[1440, 900, "wide"], [390, 844, "phone"]]) {
  const page = await br.newPage({ viewport: { width: w, height: hgt }, deviceScaleFactor: 2, isMobile: w < 500 });
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  MS.state.email = "president@ongia.ca"; MS.state.name = "Andrew Hammond";
  await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" });
  await page.waitForSelector("#ms");
  await page.screenshot({ path: OUT + `signin-${tag}.png`, fullPage: true });
  ok(`${tag}: the Microsoft button leads, the key is tucked away`, await page.isVisible("#ms") && !(await page.isVisible("#k")));
  await page.click("#ms");
  await page.waitForSelector(".evcard, .empty", { timeout: 8000 });
  ok(`${tag}: back from Microsoft and on the desk, with the address cleaned up`, !page.url().includes("code=") && page.url().endsWith("/admin.html"), page.url());
  ok(`${tag}: it says who is signed in`, /Signed in as Andrew Hammond \(president@ongia\.ca\)/.test(await page.textContent("#whoami")));
  ok(`${tag}: nothing runs off the side`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.click("#admin"); await page.waitForSelector(".deskline");
  await page.screenshot({ path: OUT + `roster-${tag}.png`, fullPage: true });
  ok(`${tag}: the president's row says always`, /Desk access: always/.test(await page.textContent(".board")));
  if (tag === "wide") {
    const idx = await page.$$eval(".member", (els) => els.findIndex((e) => /b\.konkle/.test(e.textContent)));
    await page.check(`[data-desk="${idx}"]`); await page.waitForTimeout(600);
    ok("ticking Barb's box saves it", /Barb Konkle can now sign in/.test(await page.textContent("body")));
  }
  ok(`${tag}: the roster fits`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.click("#signout"); await page.waitForSelector("#ms");
  ok(`${tag}: sign out returns to the sign-in screen`, (await page.textContent("#whoami")).trim() === "");
  // A review link opened while signed out lands on that review after signing in.
  MS.state.email = "treasurer@ongia.ca"; MS.state.name = "Raj";
  await page.goto(`${S}/admin.html#event/none-such`, { waitUntil: "networkidle" });
  await page.click("#ms");
  await page.waitForSelector(".bad, .evcard", { timeout: 8000 });
  ok(`${tag}: after a sign-out, Microsoft is asked to show the account picker`, MS.state.lastAuthorize?.prompt === "select_account");
  ok(`${tag}: a link opened before signing in is where you land after`, /Something went wrong|not found|No such/i.test(await page.textContent("#root")), await page.textContent("#root"));
  await page.click("#signout");
  MS.state.email = "j.healy@ongia.ca"; MS.state.name = "John Healy";
  await page.click("#ms"); await page.waitForSelector(".bad");
  ok(`${tag}: someone without access sees why`, /j\.healy@ongia\.ca isn't on the desk's sign-in list/.test(await page.textContent(".bad")));
  await page.screenshot({ path: OUT + `refused-${tag}.png`, fullPage: true });
  MS.state.cancel = true; await page.click("#ms"); await page.waitForSelector(".bad"); MS.state.cancel = false;
  ok(`${tag}: cancelling at Microsoft gives a plain message`, /User declined to consent\./.test(await page.textContent(".bad")) && !/Trace ID/.test(await page.textContent(".bad")));
  await page.click(".keyalt summary"); await page.fill("#k", "testkey"); await page.click("#go");
  await page.waitForSelector(".evcard, .empty");
  ok(`${tag}: the desk key still works as a fallback`, /Signed in with the desk key/.test(await page.textContent("#whoami")));
  ok(`${tag}: no script errors`, errs.length === 0, errs.join("; "));
  await page.close();
}
await br.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
