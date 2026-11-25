// ONGIA Board › Review (spec: chief-of-staff/board-review-spec.md; Andrew 25 Nov 2026), driven as the testers would use it.
// The sample review is all made-up names; the test review holds only the three testers, as it would on the live site.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const { issueReviewSession } = await import(REPO + "netlify/functions/lib/review.mjs");
const D = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };

// The three testers on the board list (the president, the VP and John Healy), plus one director who isn't a tester.
const r0 = (await api("/api/roster")).members ?? [];
const need = [["president@ongia.ca", "Andrew Hammond"], ["vp_operations@ongia.ca", "Jacqulyn Taylor"], ["j.healy@ongia.ca", "John Healy"], ["d.sample@ongia.ca", "Dana Sample"]];
const members = [...r0]; for (const [email, name] of need) if (!members.some((m) => m.email === email)) members.push({ name, email });
// Each person's profile (Andrew 25 Nov 2026): "Annual 360 review?" ticked for the president, the VP and a director;
// John Healy, an advisor, is left unticked. The president and the VP marked by role.
const role = { "president@ongia.ca": "president", "vp_operations@ongia.ca": "vp" };
await api("/api/roster", { method: "PUT", body: JSON.stringify({ members: members.map((m) => ({ ...m, role: role[m.email] ?? "", review: ["president@ongia.ca", "vp_operations@ongia.ca", "d.sample@ongia.ca"].includes(m.email), firstYear: false })) }) });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (vp, { desk, review } = {}) => {
  const page = await b.newPage({ viewport: vp, deviceScaleFactor: 2 });
  await page.addInitScript(([d, r]) => { try { if (d) sessionStorage.setItem("ongia-admin-key", d); if (r) localStorage.setItem("ongia-rv-session", r); } catch {} }, [desk ?? "", review ?? ""]);
  page.errs = []; page.on("pageerror", (e) => page.errs.push(String(e)));
  page.popups = []; page.on("dialog", (d) => { page.popups.push(d.message()); d.accept(); });
  return page;
};
const go = async (p, hash = "") => { await p.goto(`${S}/board.html${hash}`, { waitUntil: "networkidle" }); await p.waitForTimeout(700); };
const desk = (email, name) => issueSession({ email, name });
const PHONE = { width: 390, height: 844 }, WIDE = { width: 1200, height: 900 };

// Someone who isn't a tester: refused.
let p = await open(PHONE, { review: issueReviewSession({ email: "d.sample@ongia.ca", name: "Dana Sample" }) });
await go(p);
ok("a director who isn't a tester is refused while it's in testing", /isn't open to you/.test(await p.locator("main").innerText()), await p.locator("main").innerText());
await p.close();

// The president, through the desk's own sign-in in this tab: the sample.
p = await open(PHONE, { desk: desk("president@ongia.ca", "Andrew Hammond") });
await go(p);
ok("the president gets in with the desk's sign-in, and sees it's in testing", /Testing: only the testers can see this/.test(await p.locator("main").innerText()));
await p.locator("summary", { hasText: "Run a review" }).click();
await p.locator("#sample").click(); await p.waitForTimeout(1500);
let text = await p.locator("main").innerText();
ok("a sample opens: made-up names, closed, every director's progress", /every name and answer here is made up/.test(text) && /Alex Morgan/.test(text) && /Robin Ashe/.test(text), text.slice(0, 400));
ok("progress shows who is done, never answers", /Done ✓/.test(text) && !/Brings new sponsors/.test(text));
ok("nothing scrolls sideways on a phone", !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
await p.screenshot({ path: `${D}boardreview-progress-phone.png`, fullPage: true });
await p.locator(".row", { hasText: "Alex Morgan" }).locator("a", { hasText: "Report" }).click(); await p.waitForTimeout(1000);
text = await p.locator("main").innerText();
ok("the president's report: 12 questions, averages, comments with no names, the facts, the self-review", (await p.locator(".bar").count()) === 12 && /Runs meetings well/.test(text) && /in random order, no names/.test(text) && /board meetings/.test(text) && /Self-review/.test(text), text.slice(0, 500));
ok("…and the committee's part: meetings, commitments", await p.locator("#mt").count() === 1);
await p.screenshot({ path: `${D}boardreview-report-phone.png`, fullPage: true });
await p.locator("a.back").click(); await p.waitForTimeout(800);
await p.locator("a", { hasText: "Board-wide results" }).click(); await p.waitForTimeout(1000);
text = await p.locator("main").innerText();
ok("board-wide results: no individual scores, the board as a whole", /Board-wide/.test(text) && /board as a whole/i.test(text) && !/Alex Morgan/.test(text), text.slice(0, 500));
ok("no page errors (president)", p.errs.length === 0, p.errs.join(" | "));
await p.close();

// The VP starts a test review: only the three testers can be in it.
p = await open(WIDE, { desk: desk("vp_operations@ongia.ca", "Jacqulyn Taylor") });
await go(p, "#/new");
text = (await p.locator("main").innerText()).replace(/\s+/g, " ");
ok("who's in it comes from the profiles: the two testers ticked, not the director who isn't a tester", /In the review · 2/i.test(text) && /Andrew Hammond President/.test(text) && /Jacqulyn Taylor VP/.test(text) && !/Dana Sample/.test(text), text.slice(0, 500));
ok("John, unticked, is under Not in the review, and can be on the committee", /Not in the review John Healy not in the review/i.test(text) && await p.locator('[data-cm="j.healy@ongia.ca"]').count() === 1);
ok("the VP starts on the committee; the president can't be on it", await p.locator('[data-cm="vp_operations@ongia.ca"]').isChecked() && await p.locator('[data-cm="president@ongia.ca"]').isDisabled());
await p.locator('[data-cm="j.healy@ongia.ca"]').check();
// The review counts days in Toronto, as the server does.
const day = (n) => new Date(Date.now() + n * 86400e3).toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
await p.locator("#d1").fill(day(0)); await p.locator("#d2").fill(day(7)); await p.locator("#d3").fill(day(21));
await p.screenshot({ path: `${D}boardreview-new-wide.png`, fullPage: true });
await p.locator("#go").click(); await p.waitForTimeout(1500);
ok("it asks before emailing the directors", p.popups.some((m) => /email the 2 directors/.test(m)), p.popups.join(" | "));
text = await p.locator("main").innerText();
ok("the test review opens on the self-review week", /A test review/.test(text) && /self-review week/.test(text) && /Your self-review/.test(text), text.slice(0, 300));
const cid = decodeURIComponent((await p.evaluate(() => location.hash)).split("/")[2]);
await p.close();

// John Healy, with the review's own sign-in (no desk), on the committee: the progress, and no review of his own.
p = await open(PHONE, { review: issueReviewSession({ email: "j.healy@ongia.ca", name: "John Healy" }) });
await go(p, `#/c/${cid}`);
text = await p.locator("main").innerText();
ok("John, an advisor on the committee, sees the progress and has nothing to fill in", /Progress/i.test(text) && !/Your self-review/.test(text) && /Andrew Hammond/.test(text), text.slice(0, 400));
ok("no page errors (John)", p.errs.length === 0, p.errs.join(" | "));
await p.close();

// The VP, through the desk: her self-review on a phone.
p = await open(PHONE, { desk: desk("vp_operations@ongia.ca", "Jacqulyn Taylor") });
await go(p, `#/c/${cid}/self`);
await p.locator('textarea[data-a="delivered"]').fill("Reviewed every contract this year; drafted the conflict-of-interest policy.");
for (const q of ["prep", "follow", "beyond", "voice", "decide", "trust", "ambassador"]) await p.locator(`[data-q="${q}"][data-v="4"]`).click();
ok("the scale says what each number means", /4 · Strong: does this well consistently/.test(await p.locator('[data-w="prep"]').innerText()));
ok("44px tap targets on a phone", (await p.locator('[data-q="prep"][data-v="4"]').boundingBox()).height >= 44);
await p.screenshot({ path: `${D}boardreview-self-phone.png`, fullPage: true });
await p.locator("#send").click(); await p.waitForTimeout(1500);
ok("sent: it says thank you and when the peer round comes", p.popups.some((m) => /can't be changed/.test(m)) && /Sent/.test(await p.locator("main").innerText()));
ok("no page errors (VP's self-review)", p.errs.length === 0, p.errs.join(" | "));
await p.close();

// The peer round: a review with past dates, then the president reviews the VP.
const sid = cid;
await fetch(`${S}/api/boardreview?cycle=${encodeURIComponent(sid)}`, { headers: { "x-review-key": issueReviewSession({ email: "president@ongia.ca", name: "Andrew Hammond" }) } });
const { getCycle, putCycle, keyOf } = await import(REPO + "netlify/functions/lib/review.mjs");
// The test server keeps its records in its own process, so the dates move through a second sample-free route: re-create with past dates.
p = await open(WIDE, { desk: desk("vp_operations@ongia.ca", "Jacqulyn Taylor") });
await go(p, "#/new");
await p.locator('[data-cm="j.healy@ongia.ca"]').check();
await p.locator("#d1").fill(day(-8)); await p.locator("#d2").fill(day(-1)); await p.locator("#d3").fill(day(10));
await p.locator("#go").click(); await p.waitForTimeout(1500);
const pid = decodeURIComponent((await p.evaluate(() => location.hash)).split("/")[2]);
await p.close();
p = await open(PHONE, { desk: desk("president@ongia.ca", "Andrew Hammond") });
await go(p, `#/c/${pid}`);
text = await p.locator("main").innerText();
ok("in the peer round, each colleague has Start", /Jacqulyn Taylor/.test(text) && await p.locator(`a[href="#/c/${pid}/peer/${keyOf("vp_operations@ongia.ca")}"]`).count() === 1, text.slice(0, 400));
await p.locator(`a[href="#/c/${pid}/peer/${keyOf("vp_operations@ongia.ca")}"]`).click(); await p.waitForTimeout(1000);
text = await p.locator("main").innerText();
ok("reviewing a colleague: the facts, what they delivered (none yet), 7 questions, the warning on comments", /on the desk/.test(text) && /No self-review submitted/.test(text) && (await p.locator(".q .scale").count()) === 7 && /Leave out details that would identify you/.test(text), text.slice(0, 500));
await p.locator('[data-q="prep"][data-v="5"]').click(); await p.locator('[data-q="follow"][data-v="na"]').click();
await p.locator('textarea[data-c="note"]').fill("Always quick with advice.");
await p.locator("#save").click(); await p.waitForTimeout(800);
ok("Save and come back keeps it on this device only", /Saved here, not sent/.test(await p.locator("main").innerText()));
const serverHasDraft = await p.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("ongia-rv-draft:")));
ok("…the draft is in this browser", serverHasDraft);
await p.locator(`a[href="#/c/${pid}/peer/${keyOf("vp_operations@ongia.ca")}"]`).click(); await p.waitForTimeout(1000);
ok("…and comes back when reopened", await p.locator('[data-q="prep"][data-v="5"].on').count() === 1 && /Always quick/.test(await p.locator('textarea[data-c="note"]').inputValue()));
await p.locator("#send").click(); await p.waitForTimeout(600);
ok("sending with questions unanswered says which", /Answer "Beyond meetings"/.test(await p.locator(".toast").innerText()));
for (const q of ["beyond", "voice", "decide", "trust", "ambassador"]) await p.locator(`[data-q="${q}"][data-v="4"]`).click();
await p.screenshot({ path: `${D}boardreview-peer-phone.png`, fullPage: true });
await p.locator("#send").click(); await p.waitForTimeout(1500);
ok("sent: back on the list as Sent, the draft gone", /Sent/.test(await p.locator(".row", { hasText: "Jacqulyn Taylor" }).first().innerText()) && !(await p.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("ongia-rv-draft:")))));
ok("no page errors (peer)", p.errs.length === 0, p.errs.join(" | "));
await p.close();

// The VP turns the review on for the board, then off again: asked, and logged.
p = await open(WIDE, { desk: desk("vp_operations@ongia.ca", "Jacqulyn Taylor") });
await go(p, "#/testers");
ok("the testers are listed", (await p.locator("[data-rm]").count()) === 3);
await p.locator("#open").check(); await p.waitForTimeout(800);
ok("opening it to the board asks first and says who did it", p.popups.some((m) => /Open the review to the whole board/.test(m)) && /Opened by vp_operations@ongia.ca/.test(await p.locator("main").innerText()));
await p.locator("#open").uncheck(); await p.waitForTimeout(800);
await p.close();

await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
