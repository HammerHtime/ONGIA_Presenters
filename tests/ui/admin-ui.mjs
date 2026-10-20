// The Admin tab, the logistics sheet check on only some events, dollar boxes on the SOW, and the receipts column.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const D = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const T = Date.now().toString(36);
const mk = async (title, extra = {}) => (await api("/api/events", { method: "POST", body: JSON.stringify({ title, city: "Montreal", venue: "V", dayOne: "2027-02-01", lastDay: "2027-02-05", invite: false, board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], presenters: [], ...extra }) })).event;
const plain = await mk(`Plain ${T}`);
const rbh = await mk(`RBH ${T}`, { kind: "rbh", province: "QC", invoicePrefix: "ITP" });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const as = async (email, vp) => {
  const page = await b.newPage({ viewport: vp, deviceScaleFactor: 2 });
  await page.addInitScript(() => { try { sessionStorage.setItem("ongia-test-alltabs", "1"); } catch {} });   // every tab of the event page shown at once: this file tests the sections, evtabs-ui tests the tabs
  const token = issueSession({ email, name: email });
  await page.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email, name: email, owner: email === "president@ongia.ca", canCost: true }]);
  page.on("dialog", (d) => d.accept()); page.errs = []; page.on("pageerror", (e) => page.errs.push(String(e)));
  await page.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
  return page;
};
const openEvent = async (p, ev) => { await p.locator(`[data-open="${ev.id}"]`).first().evaluate((e) => e.click()); await p.waitForTimeout(1500); };
for (const [w, h, tag] of [[1440, 900, "wide"], [390, 844, "phone"]]) {
  console.log(`— ${tag}`);
  const p = await as("president@ongia.ca", { width: w, height: h });
  // the top bar
  const bar = await p.locator("#bar, header, .topbar").first().innerText().catch(() => "");
  ok(`${tag}: the top bar has an Admin tab and no separate Board members tab`, (await p.locator("#admin").count()) === 1 && (await p.locator("#roster").count()) === 0 && /Admin/.test(await p.locator("#admin").innerText()));
  await p.screenshot({ path: D + `admin-bar-${tag}.png` });
  await p.click("#admin"); await p.waitForTimeout(900);
  ok(`${tag}: it opens on the board list`, /Board members/.test(await p.locator("body").innerText()) && (await p.locator(".member").count()) >= 5 && (await p.locator('[data-atab="board"].on').count()) === 1);
  ok(`${tag}: the owner has a Backup tab beside it`, (await p.locator('[data-atab="backup"]').count()) === 1);
  await p.locator('[data-atab="backup"]').click(); await p.waitForTimeout(1000);
  ok(`${tag}: the Backup tab shows the backup (here: not set up, because there are no Microsoft credentials in the test)`, /Nightly backup/.test(await p.locator("body").innerText()) && (await p.locator("#backupline").count()) === 1 && (await p.locator("#bk-now").count()) === 1);
  await p.screenshot({ path: D + `admin-backup-${tag}.png` });
  await p.locator('[data-atab="board"]').click(); await p.waitForTimeout(800);
  ok(`${tag}: back to the board list`, (await p.locator(".member").count()) >= 5);
  ok(`${tag}: fits the screen`, await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await p.click("#back"); await p.waitForTimeout(800);
  ok(`${tag}: the home page has no backup line`, (await p.locator("#backupline").count()) === 0);

  // sheet check: off on an ordinary event, switchable
  await openEvent(p, plain);
  ok(`${tag}: an ordinary event has no logistics sheet check on its page`, (await p.locator('details[data-fold="sec-sheet"]').count()) === 0);
  const set = p.locator("#evsettings"); if (!(await set.evaluate((d) => d.open))) await set.locator("summary").first().click();
  ok(`${tag}: its settings say the check is off, and offer to turn it on`, /Logistics sheet check/.test(await set.innerText()) && (await p.locator("#sheet-on").count()) === 1);
  await p.click("#sheet-on"); await p.waitForTimeout(2000);
  ok(`${tag}: turned on, the section appears`, (await p.locator('details[data-fold="sec-sheet"]').count()) === 1 && (await api(`/api/events?id=${plain.id}`)).event.sheetCheck === true);
  const set2 = p.locator("#evsettings"); if (!(await set2.evaluate((d) => d.open))) await set2.locator("summary").first().click();
  await p.click("#sheet-off"); await p.waitForTimeout(2000);
  ok(`${tag}: and turned off again, it goes`, (await p.locator('details[data-fold="sec-sheet"]').count()) === 0);
  await p.click("#back").catch(() => {}); await p.waitForTimeout(500);
  ok(`${tag}: no page errors`, p.errs.length === 0, p.errs.join("|"));
  await p.close();
}
// an event with a sheet already uploaded shows the check without being switched on
const withSheet = await mk(`HasSheet ${T}`);
const cells = [["Master block", "Guest name", "Check-in", "Check-out"], ["Yes", "Test Person", "2027-02-01", "2027-02-04"]];
const up = await api(`/api/sheetcheck?event=${withSheet.id}&baseline=1`, { method: "PUT", body: JSON.stringify({ fileName: "sheet.xlsx", cells }) });
console.log(up.error ? `  (note: baseline upload said: ${up.error})` : "");

console.log("— SOW dollars and the receipts column");
const sow = (await api(`/api/sow?event=${rbh.id}&create=1`, { method: "POST", body: JSON.stringify({ from: "standard" }) })).sow;
const p = await as("president@ongia.ca", { width: 1440, height: 1000 });
await openEvent(p, rbh);
const f = p.locator('details[data-fold="sec-sow"]'); if (!(await f.evaluate((d) => d.open))) await f.locator("summary").first().click(); await p.waitForTimeout(400);
const row = (name) => p.locator(`#sw-table tr:has(.ln-name[value="${name}"])`);
ok("estimate boxes are text boxes with a $ placeholder, not number spinners", (await row("Hotel").locator(".ln-est").getAttribute("type")) === "text" && /\$/.test(await row("Hotel").locator(".ln-est").getAttribute("placeholder")));
await row("Hotel").locator(".ln-est").fill("15000"); await p.locator("#sw-title").click();
ok("typing 15000 and leaving the box shows $15,000.00", (await row("Hotel").locator(".ln-est").inputValue()) === "$15,000.00");
await row("Dinners").locator(".ln-est").fill("$3,250.5"); await p.locator("#sw-title").click();
ok("typing $3,250.5 shows $3,250.50", (await row("Dinners").locator(".ln-est").inputValue()) === "$3,250.50");
await row("Dinners").locator(".ln-est").click();
ok("clicking back in shows the plain number to edit", (await row("Dinners").locator(".ln-est").inputValue()) === "3250.5");
await p.locator("#sw-title").click();
ok("the totals use the numbers: subtotal $18,250.50", /\$18,250\.50/.test(await p.locator("#sw-sums").innerText()), await p.locator("#sw-sums").innerText());
await p.fill("#sw-dep", "1000"); await p.locator("#sw-title").click();
ok("the deposit box is a dollar box too", (await p.locator("#sw-dep").inputValue()) === "$1,000.00");
await row("Via Rail Train Tickets").locator(".ln-est").fill("abc"); await p.locator("#sw-title").click();
ok("letters mean nothing: the box is left empty", (await row("Via Rail Train Tickets").locator(".ln-est").inputValue()) === "");
await p.click("#sw-save"); await p.waitForTimeout(1500);
const saved = (await api(`/api/sow?event=${rbh.id}`)).sow;
ok("saved as plain numbers", saved.lines.find((l) => l.name === "Hotel").estimate === 15000 && saved.lines.find((l) => l.name === "Dinners").estimate === 3250.5 && saved.deposit === 1000);
await openEvent(p, rbh).catch(() => {});
await p.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
await openEvent(p, rbh);
const f3 = p.locator('details[data-fold="sec-sow"]'); if (!(await f3.evaluate((d) => d.open))) await f3.locator("summary").first().click(); await p.waitForTimeout(400);
ok("after a reload the amounts show as dollars", (await row("Hotel").locator(".ln-est").inputValue()) === "$15,000.00" && (await row("Dinners").locator(".ln-est").inputValue()) === "$3,250.50");
ok("with no receipts there is no Receipts so far column", (await p.locator("#sw-table th.rcv").count()) === 0);
// a receipt against Hotel, and one against Other
const dr = async (name) => { const r = await fetch(`${S}/api/receipts?event=${rbh.id}`, { method: "POST", headers: { "x-admin-key": H["x-admin-key"], "x-file-name": name }, body: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]) }); return (await r.json()).drafts.at(-1); };
const L = Object.fromEntries(saved.lines.map((l) => [l.name, l.id]));
// Make Hotel an at-cost line, as in Andrew's SOW (the standard sheet has it as a fixed fee)
await api(`/api/sow?event=${rbh.id}`, { method: "PUT", body: JSON.stringify({ lines: saved.lines.map((l) => (l.name === "Hotel" ? { ...l, type: "cost" } : l)), taxes: saved.taxes }) });
const conf = (d, body) => fetch(`${S}/api/receipts?event=${rbh.id}&confirm=${d.id}`, { method: "POST", headers: H, body: JSON.stringify({ paidBy: "president@ongia.ca", ...body }) }).then((r) => r.json());
await conf(await dr("h.jpg"), { lineId: L.Hotel, vendor: "Humaniti Hotel", date: "2027-02-01", amount: 2476.18 });
await conf(await dr("d1.jpg"), { lineId: L.Dinners, vendor: "Le Bistro", date: "2027-02-02", amount: 24.75 });
await conf(await dr("d2.jpg"), { lineId: L.Dinners, vendor: "Le Bistro 2", date: "2027-02-03", amount: 3300 });
await conf(await dr("o.jpg"), { lineId: "other", otherNote: "Taxi", vendor: "Taxi", date: "2027-02-03", amount: 41.5 });
await p.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
await openEvent(p, rbh);
const f4 = p.locator('details[data-fold="sec-sow"]'); if (!(await f4.evaluate((d) => d.open))) await f4.locator("summary").first().click(); await p.waitForTimeout(400);
ok("with receipts there is a Receipts so far column beside the estimate", (await p.locator("#sw-table th.rcv").count()) === 1);
const hotel = await row("Hotel").locator("td.rcv").innerText(), din = await row("Dinners").locator("td.rcv").innerText(), oth = await p.locator("tr.oth td.rcv").innerText();
ok("Hotel (an at-cost line, estimated $15,000): $2,476.18 in 1 receipt, $12,523.82 left", /\$2,476\.18/.test(hotel) && /1 receipt/.test(hotel) && /\$12,523\.82 left/.test(hotel), hotel);
ok("Dinners: $3,324.75 in 2 receipts, which is $74.25 over the $3,250.50 estimate, and said in red", /\$3,324\.75/.test(din) && /2 receipts/.test(din) && /\$74\.25 over/.test(din) && await row("Dinners").locator(".rcl.over").count() === 1, din);
ok("Other has its receipts too", /\$41\.50/.test(oth) && /1 receipt/.test(oth), oth);
ok("a line with no receipts shows a dash", /–/.test(await row("AV").locator("td.rcv").innerText()));
ok("the running total is under the table: $5,842.43 so far against the $18,250.50 of at-cost estimates", /Receipts so far, before tax: \$5,842\.43/.test(await p.locator(".rctot").innerText()) && /\$18,250\.50/.test(await p.locator(".rctot").innerText()), await p.locator(".rctot").innerText());
await p.screenshot({ path: D + "admin-sow-receipts.png", fullPage: true });
ok("no page errors", p.errs.length === 0, p.errs.join("|"));
await p.close();
await b.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
