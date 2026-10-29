// The Sandbox (Andrew 29 Oct 2026): the event budget tried on the 2026 Summit's numbers, push buttons that go green,
// saved on its own and never touching a real event.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const D = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const money = (t) => Number(String(t).replace(/[^0-9.\-−]/g, "").replace("−", "-"));
await api("/api/roster");
await fetch(S + "/api/sandbox", { method: "DELETE", headers: H });
const eventsBefore = (await api("/api/events")).events.length;

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (w, h, email = "president@ongia.ca", name = "Andrew Hammond", extra = { owner: true, canCost: true }) => {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const token = issueSession({ email, name });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email, name, ...extra }]);
  p.errs = []; p.on("pageerror", (e) => p.errs.push(String(e))); p.on("dialog", (d) => d.accept());
  await p.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
  return p;
};
const tile = (p, k) => p.locator(".sbt").filter({ has: p.locator(".k", { hasText: new RegExp(`^${k}`, "i") }) }).first();

console.log("— on a laptop");
let p = await open(1440, 1000);
ok("the top bar has a Sandbox button", await p.locator("#sandboxnav").isVisible());
await p.locator("#sandboxnav").click(); await p.waitForTimeout(1500);
ok("the first visit asks how people register, the Summit's answers filled in", await p.locator(".sbxq").isVisible() && (await p.locator('.sbxq [data-yn="community"].on').innerText()) === "Yes");
// Memberships stay No; virtual off for a moment shows its box closes.
await p.locator('.sbxq [data-yn="virtual"][data-v="0"]').click();
ok("No closes that kind's price box", await p.locator('.sbxq [data-box="virtual"]').isHidden());
await p.locator('.sbxq [data-yn="virtual"][data-v="1"]').click();
ok("Yes opens it again, with its prices", await p.locator('.sbxq [data-box="virtual"]').isVisible());
await p.locator("#q-done").click(); await p.waitForTimeout(1500);
ok("it says nothing here touches a real event", /nothing here touches a real event/i.test(await p.locator(".sbxhead").innerText()));
ok("twelve tiles: profit, revenue, expenses, break-even, registrations, room nights and the rest", (await p.locator(".sbt").count()) === 12);
const revenue = money(await tile(p, "Revenue").locator(".v").innerText());
ok("the Summit's tickets come to $220,593 after HST", /\$220,593 after HST/.test(await tile(p, "Revenue").innerText()), await tile(p, "Revenue").innerText());
const roomsBefore = money(/rooms (\S+)/.exec(await tile(p, "Expenses").innerText())[1]);
ok("rooms: the green nights × $205 + 13% HST and 8.5% MAT", Math.abs(roomsBefore - 176 * 205 * 1.085 * 1.13) < 1, String(roomsBefore));

// Tap a night: green, and the rooms follow.
const cell = p.locator("[data-night]:not(.on)").first();
const key = await cell.getAttribute("data-night");
await cell.click(); await p.waitForTimeout(400);
ok("tapping a night turns it green", await p.locator(`[data-night="${key}"]`).evaluate((e) => e.classList.contains("on")));
const roomsAfter = money(/rooms (\S+)/.exec(await tile(p, "Expenses").innerText())[1]);
const who = key.split("|")[0];
const paysAgency = await p.locator(`[data-pays="${who}|agency"]`).evaluate((e) => e.classList.contains("on"));
ok("and the rooms in the budget go up by one night (unless their agency pays)", paysAgency ? roomsAfter === roomsBefore : Math.abs(roomsAfter - roomsBefore - 205 * 1.085 * 1.13) < 1, `${roomsBefore} → ${roomsAfter}`);
// Who pays: Their agency pays takes it out of the budget.
await p.locator(`[data-pays="${who}|agency"]`).click(); await p.waitForTimeout(400);
ok("Their agency pays: the button fills, and the room leaves the budget", await p.locator(`[data-pays="${who}|agency"]`).evaluate((e) => e.classList.contains("on")) && money(/rooms (\S+)/.exec(await tile(p, "Expenses").innerText())[1]) < roomsAfter);
// + adds a night before.
const nightsBefore = await p.locator(".ng thead th .d").count();
await p.locator('[data-more="before"]').click(); await p.waitForTimeout(400);
ok("+ adds a night before the first", (await p.locator(".ng thead th .d").count()) === nightsBefore + 1);
// A meal: tap cycles Not served → Team → Everyone.
const mealKey = "2026-11-09|dinner";
const m = () => p.locator(`.mp [data-meal="${mealKey}"]`).first();
ok("Monday's dinner starts not served", /—/.test(await m().innerText()));
await m().click(); await p.waitForTimeout(300);
ok("tap: the team", /Team/i.test(await m().innerText()));
await m().click(); await p.waitForTimeout(300);
ok("tap again: everyone", /Everyone/i.test(await m().innerText()));
await m().click(); await p.waitForTimeout(300);
ok("and again: not served", /—/.test(await m().innerText()));
await p.locator(`[data-setamt="${mealKey}"]`).click(); await p.waitForTimeout(300);
await p.locator(`[data-flat="${mealKey}"]`).fill("1800"); await p.locator(`[data-flat="${mealKey}"]`).press("Tab"); await p.waitForTimeout(500);
ok("$ makes it a set amount, typed in", /Set amount/i.test(await p.locator(`[data-flat="${mealKey}"]`).locator("..").innerText()) && (await p.locator(`[data-flat="${mealKey}"]`).inputValue()) === "1800");
// A number you set: the profit follows.
const profit0 = money(await tile(p, "Profit").locator(".v").innerText());
await p.locator('[data-k="reg.inPerson.price"]').fill("649"); await p.locator('[data-k="reg.inPerson.price"]').press("Tab"); await p.waitForTimeout(600);
ok("raising the in-person price raises the profit", money(await tile(p, "Profit").locator(".v").innerText()) > profit0);
ok("Prices include HST: No takes the HST off nothing", await p.locator('[data-flag="pricesIncludeHst"][data-v="0"]').click().then(() => p.waitForTimeout(400)).then(async () => !/after HST/.test(await tile(p, "Revenue").innerText())));
await p.waitForTimeout(1200);
const saved = (await api("/api/sandbox")).budget;
ok("it all saves by itself", saved?.reg?.inPerson?.price === 649 && saved.meals.cells[mealKey] === 1800 && saved.pricesIncludeHst === false && saved.hotel.before === 3, JSON.stringify({ price: saved?.reg?.inPerson?.price, meal: saved?.meals?.cells?.[mealKey] }));
await p.screenshot({ path: D + "sandbox-wide.png", fullPage: true });
ok("no page errors", !p.errs.length, p.errs.join(" | "));
await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(1500);
ok("it's there next time, without asking the questions again", !(await p.locator(".sbxq").count()) && (await p.locator('[data-k="reg.inPerson.price"]').inputValue()) === "649");
await p.locator("#sbx-reset").click(); await p.waitForTimeout(1500);
ok("Start over brings back the spreadsheet's numbers and asks the questions again", await p.locator(".sbxq").isVisible() && (await api("/api/sandbox")).budget === null);
await p.locator("#q-done").click(); await p.waitForTimeout(800);
ok("no event was made or changed", (await api("/api/events")).events.length === eventsBefore);
await p.close();

console.log("— on a phone");
p = await open(390, 844);
await p.locator("#sandboxnav").click().catch(async () => { await p.evaluate(() => { view = { name: "sandbox" }; render(); }); });
await p.waitForTimeout(1500);
if (await p.locator(".sbxq").count()) { await p.locator(".sbxq").screenshot({ path: D + "sandbox-questions-phone.png" }); await p.locator("#q-done").click(); await p.waitForTimeout(800); }
ok("phone: the tiles, two across, and nothing wider than the screen", (await p.locator(".sbt").count()) === 12 && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await p.screenshot({ path: D + "sandbox-phone.png", fullPage: true });
ok("phone: no page errors", !p.errs.length, p.errs.join(" | "));
await p.close();

console.log("— someone else");
p = await open(1280, 900, "treasurer@ongia.ca", "Raj Jaswal", {});
ok("a board member who isn't the president or VP has no Sandbox button", !(await p.locator("#sandboxnav").count()));
await p.close();
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
