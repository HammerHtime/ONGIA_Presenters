// Hotel rooms: "Other" for a comped room (another association, a dignitary), always with who they are.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const OUT = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => { const r = await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } }); return { http: r.status, ...(await r.json()) }; };
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const T = Date.now().toString(36);
const mk = async (tag) => (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Other Rooms ${tag} ${T}`, city: "Toronto", venue: "Delta Hotels", dayOne: "2026-11-09", lastDay: "2026-11-12", invite: false,
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }] }) })).event;

// The server: Other needs a word saying who they are.
const e0 = await mk("api");
let r = await api(`/api/rooming?event=${e0.id}`, { method: "PUT", body: JSON.stringify({ guests: [{ name: "Pat Sample", type: "Other", checkIn: "2026-11-08", checkOut: "2026-11-10", billing: "ONGIA" }] }) });
ok("the server refuses Other with no word on who they are, and says why", r.http >= 400 && /say who they are/i.test(r.error ?? ""), JSON.stringify(r).slice(0, 200));
r = await api(`/api/rooming?event=${e0.id}`, { method: "PUT", body: JSON.stringify({ guests: [{ name: "Pat Sample", type: "Other", checkIn: "2026-11-08", checkOut: "2026-11-10", billing: "ONGIA", note: "Sample Police Association" }] }) });
const row = (await api(`/api/rooming?event=${e0.id}`)).rows?.find((x) => x.name === "Pat Sample");
ok("with it, the room is kept as Other, with who they are", r.http === 200 && row?.type === "Other" && row?.organization === "Sample Police Association", JSON.stringify(row));

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1440, 900, "wide"], [390, 844, "phone"]]) {
  console.log(`— ${tag}`);
  const ev = await mk(tag);
  const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 500 });
  await page.addInitScript(() => { try { sessionStorage.setItem("ongia-test-alltabs", "1"); } catch {} });
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" });
  await page.fill('input[type="password"]', "testkey"); await page.keyboard.press("Enter"); await page.waitForTimeout(1200);
  await page.goto(`${S}/admin.html#event/${ev.id}`, { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
  await page.evaluate(() => { document.querySelector(".bar").style.position = "static"; document.querySelectorAll('details[data-fold="sec-hotel"], details:has(#rg-name)').forEach((d) => { d.open = true; }); });
  await page.waitForTimeout(200);
  ok(`${tag}: Other is one of the types`, (await page.$$eval("#rg-type option", (o) => o.map((x) => x.textContent))).includes("Other"));
  ok(`${tag}: no "who they are" box until Other is picked`, !(await page.locator("#rg-desc").isVisible()));
  await page.fill("#rg-name", "Lee Example");
  await page.selectOption("#rg-type", "Other"); await page.waitForTimeout(150);
  ok(`${tag}: picking Other asks who they are`, await page.locator("#rg-desc").isVisible());
  const opts = (id) => page.$$eval(`#${id} option`, (o) => o.map((x) => x.value).filter(Boolean));
  await page.selectOption("#rg-in", (await opts("rg-in"))[1]); await page.selectOption("#rg-out", (await opts("rg-out")).at(-1));
  await page.click("#rg-add"); await page.waitForTimeout(400);
  ok(`${tag}: adding with it empty is stopped, saying what to write`, /Say who they are/.test(await page.innerText("#rg-said")) && !(await api(`/api/rooming?event=${ev.id}`)).rows.some((x) => x.name === "Lee Example"));
  await page.fill("#rg-desc", "Visiting dignitary, Sample City");
  await page.screenshot({ path: OUT + `other-form-${tag}.png` });
  await page.click("#rg-add"); await page.waitForTimeout(1500);
  const saved = (await api(`/api/rooming?event=${ev.id}`)).rows.find((x) => x.name === "Lee Example");
  ok(`${tag}: then it is added as Other, with who they are`, saved?.type === "Other" && /Visiting dignitary/.test(saved?.organization ?? ""), JSON.stringify(saved));
  const room = page.locator("label.room", { hasText: "Lee Example" });
  ok(`${tag}: the hotel list shows them as Other, with who they are`, /Other/.test(await room.innerText()) && /Visiting dignitary/.test(await room.innerText()), await room.innerText().catch(() => ""));
  await room.locator("[data-gedit]").click(); await page.waitForTimeout(300);
  ok(`${tag}: changing the room calls the note "Who they are (required)"`, /Who they are \(required\)/i.test(await page.innerText('label[for="ge-note"]')));
  await page.screenshot({ path: OUT + `other-edit-${tag}.png` });
  ok(`${tag}: no page errors`, errs.length === 0, errs.join(" | "));
  await page.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
