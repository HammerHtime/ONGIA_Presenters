// "Download to Excel" for the presenters (Andrew 19 Nov 2026: "not just on a line on its own … fits the design"). On a
// computer it ends the Presenters / Volunteers / Who's coming row and only shows for Presenters; on a phone it shares
// the search box's line. Either way it saves the name-and-agency sheet.
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H } })).json();
const D = new URL(".", import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const iso = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const names = [["Lloyd", "Plomp", "Alberta Gaming, Liquor and Cannabis"], ["Sandra", "Lloyd", "RCMP"], ["Sean", "Kirby", "Winnipeg Police Service"], ["Luc", "Seguin", "CFSEU-BC"], ["Marco", "Greco", "Government of British Columbia"], ["Jason", "Ebert", "RCMP FPPR-DOC"], ["Melissa", "Tarsitano", "Lipkus Law"]];
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Excel button ${Date.now().toString(36)}`, city: "Victoria, BC", dayOne: iso(5), invite: false,
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }], presenters: names.map(([f, l, o], i) => ({ first: f, last: l, organization: o, email: `${f}.${i}@example.ca` })) }) })).event;
const url = `${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "event", eventId: ev.id, tab: "people" }));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errs = [];
const open = async (w, h) => {
  const a = await b.newPage({ viewport: { width: w, height: h }, acceptDownloads: true });
  a.on("pageerror", (e) => errs.push(String(e)));
  await a.addInitScript(() => { try { sessionStorage.setItem("ongia-admin-key", "testkey"); } catch {} });
  await a.goto(url, { waitUntil: "networkidle" }); await a.waitForTimeout(2000);
  return a;
};
const top = async (a, sel) => Math.round((await a.locator(sel).boundingBox()).y);

let a = await open(1280, 900);
const btn = a.locator(".pxl:visible");
ok("one button, called Download to Excel", await btn.count() === 1 && (await btn.innerText()).trim() === "Download to Excel");
ok("on a computer it sits on the Presenters / Volunteers / Who's coming row", Math.abs(await top(a, ".pxl-w") - await top(a, ".pseg")) <= 4);
ok("…at the right-hand end of it", (await a.locator(".pxl-w").boundingBox()).x > (await a.locator(".pseg").boundingBox()).x + (await a.locator(".pseg").boundingBox()).width + 100);
ok("no line of its own under the search", await a.locator(".ptools .pxl:visible").count() === 0);
const [dl] = await Promise.all([a.waitForEvent("download", { timeout: 8000 }), btn.click()]);
ok("it saves the presenters sheet", /\.xlsx$/.test(dl.suggestedFilename()), dl.suggestedFilename());
await a.locator('[data-pseg="volunteers"]').click(); await a.waitForTimeout(200);
ok("Volunteers: the button goes", await a.locator(".pxl:visible").count() === 0);
await a.locator('[data-pseg="presenters"]').click(); await a.waitForTimeout(200);
ok("Presenters: it comes back", await a.locator(".pxl:visible").count() === 1);
await a.close();

a = await open(390, 844);
ok("on a phone it shares the search box's line", Math.abs(await top(a, ".pxl-n") - await top(a, "#pfind")) <= 4 && await a.locator(".pxl:visible").count() === 1);
ok("the search hint isn't cut off", await a.evaluate(() => { const i = document.getElementById("pfind"); const c = document.createElement("canvas").getContext("2d"); const s = getComputedStyle(i); c.font = `${s.fontSize} ${s.fontFamily}`; return c.measureText(i.placeholder).width <= i.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight); }));
ok("nothing scrolls sideways", await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
const [dl2] = await Promise.all([a.waitForEvent("download", { timeout: 8000 }), a.locator(".pxl-n").click()]);
ok("…and saves the same sheet", /\.xlsx$/.test(dl2.suggestedFilename()));
await a.close();
ok("no script errors", !errs.length, errs.join(" | "));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
