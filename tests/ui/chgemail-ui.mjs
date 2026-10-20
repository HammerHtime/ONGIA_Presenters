const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const OUT = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const r0 = await api("/api/roster");
await api("/api/roster", { method: "PUT", body: JSON.stringify({ members: r0.members.map((m) => m.name === "Peglar Artinian" ? { ...m, desk: true } : m) }) });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
let n = 0;
for (const [w, h, tag] of [[1440, 900, "wide"], [390, 844, "phone"]]) {
  const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 500 });
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" });
  await page.fill('input[type="password"]', "testkey"); await page.keyboard.press("Enter"); await page.waitForTimeout(1200);
  await page.click("#admin"); await page.waitForTimeout(800);
  const row = page.locator(".member", { hasText: "Peglar Artinian" });
  const target = tag === "wide" ? "executiveofficer@ongia.ca" : "exec2@ongia.ca";
  const cur = (await api("/api/roster")).members.find((m) => m.name === "Peglar Artinian").email;
  ok(`${tag}: each row has a Change email button`, await page.locator("[data-chg]").count() >= 15);
  await row.locator("[data-chg]").click();
  ok(`${tag}: it turns into an input holding the current address`, await row.locator(".emedit").inputValue() === cur);
  await page.screenshot({ path: OUT + `chg-edit-${tag}.png` });
  ok(`${tag}: nothing runs off the side`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await row.locator(".emedit").fill("Executiveofficer@ongia.ca".replace("Executiveofficer", tag === "wide" ? "Executiveofficer" : "Exec2"));
  await row.locator("[data-emsave]").click(); await page.waitForTimeout(1000);
  const m = (await api("/api/roster")).members.find((x) => x.name === "Peglar Artinian");
  ok(`${tag}: the new address is saved`, m.email.toLowerCase() === target, m.email);
  ok(`${tag}: his sign-in switch went with him`, m.desk === true);
  ok(`${tag}: no second Peglar was made`, (await api("/api/roster")).members.filter((x) => /Peglar/.test(x.name)).length === 1);
  ok(`${tag}: the row shows the new address`, (await page.locator(".member", { hasText: "Peglar Artinian" }).innerText()).toLowerCase().includes(target));
  // duplicate refused
  await page.locator(".member", { hasText: "Peglar Artinian" }).locator("[data-chg]").click();
  await page.locator(".emedit").fill("president@ongia.ca"); await page.locator("[data-emsave]").click(); await page.waitForTimeout(800);
  ok(`${tag}: an address already on the list is refused`, /already on the list/.test(await page.locator(".toast").innerText().catch(() => "")) && (await api("/api/roster")).members.find((x) => /Peglar/.test(x.name)).email.toLowerCase() === target);
  // cancel
  await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await page.waitForTimeout(800);
  if (!(await page.locator("#admin").count())) { await page.fill('input[type="password"]', "testkey"); await page.keyboard.press("Enter"); await page.waitForTimeout(1000); }
  await page.click("#admin"); await page.waitForTimeout(600);
  await page.locator(".member", { hasText: "Peglar Artinian" }).locator("[data-chg]").click();
  await page.locator("[data-emcancel]").click(); await page.waitForTimeout(300);
  ok(`${tag}: Cancel leaves it alone`, await page.locator(".emedit").count() === 0);
  ok(`${tag}: no page errors`, errs.length === 0, errs.join("|"));
  await page.close();
}
// final state: the real address
await api("/api/roster", { method: "PUT", body: JSON.stringify({ members: (await api("/api/roster")).members.map((m) => /Peglar/.test(m.name) ? { ...m, was: m.email, email: "executiveofficer@ongia.ca" } : m) }) });
await b.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
