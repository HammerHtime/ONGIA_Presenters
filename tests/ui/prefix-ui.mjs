// The invoice prefix box follows the title (ITP / CFAOC / RBH) until someone types their own.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const S = "http://127.0.0.1:8788";
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
await page.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true, canCost: true }]);
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await page.waitForTimeout(800);
await page.click("#newevent"); await page.waitForTimeout(800);
await page.locator("details", { hasText: "RBH event" }).locator("summary").first().click();
ok("an empty new event shows RBH", (await page.locator("#e-prefix").inputValue()) === "RBH");
await page.fill("#e-title", "ENCRO 2026"); ok("ENCRO → RBH", (await page.locator("#e-prefix").inputValue()) === "RBH");
await page.fill("#e-title", "RBH ITP Training - February 2027"); ok("an ITP title → ITP", (await page.locator("#e-prefix").inputValue()) === "ITP");
await page.fill("#e-title", "Canadian Forum Against Organized Crime"); ok("the forum → CFAOC", (await page.locator("#e-prefix").inputValue()) === "CFAOC");
await page.fill("#e-prefix", "XYZ"); await page.fill("#e-title", "ENCRO again");
ok("once typed by hand, it stays", (await page.locator("#e-prefix").inputValue()) === "XYZ");
ok("the hint says the rule", /RBH for the rest/.test(await page.locator("body").innerText()));
ok("no page errors", errs.length === 0, errs.join("|"));
await b.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
