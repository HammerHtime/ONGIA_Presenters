// The backup line on the desk's home page, in each state, on a phone and a wide screen. The /api/backups answers are stubbed in the browser.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const D = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788";
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();
const info = { folder: "ONGIA Desk Backups", schedule: "4:00 America/Vancouver", configured: true };
const good = { history: [{ at: hoursAgo(9), ok: true, size: 12.4 * 1048576, name: "ongia-desk-backup-2026-10-20.zip" }, { at: hoursAgo(33), ok: false, error: "SharePoint said no" }], state: "done", lastGoodAt: hoursAgo(9), finishedAt: hoursAgo(9), name: "ongia-desk-backup-2026-10-20.zip", size: 12.4 * 1048576, blobs: 214, codeFiles: 102, verified: true, folderUrl: "https://sp.example/folder" };
const states = {
  good: { ...info, status: good },
  none: { ...info, status: null },
  running: { ...info, status: { ...good, state: "running", startedAt: hoursAgo(0.01), by: "Andrew Hammond" } },
  failed: { ...info, status: { ...good, state: "failed", error: "SharePoint said no", finishedAt: hoursAgo(1) } },
  stale: { ...info, status: { ...good, lastGoodAt: hoursAgo(40) } },
  nocode: { ...info, status: { ...good, codeFiles: 0, codeFound: false } },
  unconfigured: { ...info, configured: false, status: null },
};
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (vp, answer, email = "president@ongia.ca") => {
  const page = await b.newPage({ viewport: vp, deviceScaleFactor: 2 });
  const token = issueSession({ email, name: "Andrew Hammond" });
  await page.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email, name: "Andrew Hammond", owner: true, canCost: true }]);
  page.calls = [];
  await page.route("**/api/backups", (route) => {
    const req = route.request(); page.calls.push(req.method()); if (req.method() === "POST") page.started = true;
    if (answer === 403) return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "The backups are for the desk owners." }) });
    if (req.method() === "POST") return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify(states.running) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(page.started ? states.running : answer) });
  });
  page.errs = []; page.on("pageerror", (e) => page.errs.push(String(e)));
  await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
  page.home = true;
  if (answer !== 403) { await page.click("#admin"); await page.waitForTimeout(800); await page.locator('[data-atab="backup"]').click(); await page.waitForTimeout(1200); }
  return page;
};
for (const [w, h, tag] of [[1440, 900, "wide"], [390, 844, "phone"]]) {
  console.log(`— ${tag}`);
  let p = await open({ width: w, height: h }, states.good);
  let t = await p.locator("#backupline").innerText();
  ok(`${tag}: a good backup shows when, the size, the counts and that it was checked`, /Nightly backup/.test(t) && /Last good backup/.test(t) && /12\.4 MB/.test(t) && /214 records \+ 102 code files/.test(t) && /checked/.test(t), t);
  ok(`${tag}: it is not red, and there is a link to the folder and a Back up now button`, !(await p.locator("#backupline .hstrip").evaluate((e) => e.classList.contains("bad"))) && (await p.locator('#backupline a[href="https://sp.example/folder"]').count()) === 1 && await p.locator("#bk-now").isEnabled());
  ok(`${tag}: it has a history of the runs and the retention note`, /History/.test(await p.locator("body").innerText()) && (await p.locator("#backuphist li").count()) >= 1 && /first of each month/.test(await p.locator("body").innerText()));
  ok(`${tag}: fits the screen`, await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await p.locator("#backupline").scrollIntoViewIfNeeded(); await p.screenshot({ path: D + `bk-good-${tag}.png` });
  await p.click("#bk-now"); await p.waitForTimeout(800);
  ok(`${tag}: Back up now asks the server to start one`, p.calls.includes("POST"));
  ok(`${tag}: and the line says it is backing up, with the button off`, /Backing up now/.test(await p.locator("#backupline").innerText()) && await p.locator("#bk-now").isDisabled());
  ok(`${tag}: no page errors`, p.errs.length === 0, p.errs.join("|"));
  await p.close();
  for (const [name, re, red] of [["none", /No backup yet/, false], ["running", /Backing up now.*Andrew Hammond/s, false], ["failed", /last backup failed: SharePoint said no/, true], ["stale", /over a day ago/, true], ["nocode", /code NOT included/, false], ["unconfigured", /Backups can't run/, true]]) {
    p = await open({ width: w, height: h }, states[name]);
    t = await p.locator("#backupline").innerText();
    ok(`${tag}: ${name}: says so`, re.test(t), t);
    ok(`${tag}: ${name}: is ${red ? "red" : "not red"}`, (await p.locator("#backupline .hstrip").evaluate((e) => e.classList.contains("bad"))) === red);
    if (name === "failed" || name === "unconfigured") await p.screenshot({ path: D + `bk-${name}-${tag}.png` });
    await p.close();
  }
  p = await open({ width: w, height: h }, 403, "treasurer@ongia.ca");
  ok(`${tag}: the home page no longer carries the backup`, (await p.locator("#backupline").count()) === 0);
  await p.click("#admin"); await p.waitForTimeout(800);
  ok(`${tag}: someone who is not an owner has the Admin tab with the board list, and no Backup tab`, (await p.locator('[data-atab="board"]').count()) === 1 && (await p.locator('[data-atab="backup"]').count()) === 0 && /Board members/.test(await p.locator("body").innerText()));
  await p.close();
}
await b.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
