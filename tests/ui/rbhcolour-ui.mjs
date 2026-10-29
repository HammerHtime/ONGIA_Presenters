// RBH events in one colour on the events list (Andrew 29 Oct 2026: "I would like all the RBH events (in the events list
// page) to stand out or be one colour so they stand out to me").
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
const shift = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const mk = async (title, extra = {}) => (await api("/api/events", { method: "POST", body: JSON.stringify({ title, city: "Montreal, QC", venue: "Hotel", dayOne: shift(30), lastDay: shift(32), invite: false,
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }], ...extra }) })).event;
const rbh = await mk(`RBH ITP Colour ${T}`, { kind: "rbh", province: "QC", invoicePrefix: "COL" });
const plain = await mk(`Gang Awareness Colour ${T}`);

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1440, 1000, "wide"], [390, 844, "phone"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const token = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email: "president@ongia.ca", name: "Andrew Hammond", owner: true }]);
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(`${S}/admin.html`, { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  const look = (id) => p.evaluate((id) => { const tr = document.querySelector(`tr.evrow[data-open="${id}"]`); if (!tr) return null;
    const box = innerWidth > 760 ? tr.querySelector("td") : tr, cs = getComputedStyle(box);
    return { rbh: tr.classList.contains("rbh"), attn: tr.classList.contains("attn"), bg: cs.backgroundColor, edge: cs.borderLeftColor }; }, id);
  const a = await look(rbh.id), c = await look(plain.id);
  ok(`${tag}: the RBH event's tile is tinted in its own colour; the other event's is not`, a?.rbh && !c?.rbh && a.bg === "rgb(227, 241, 239)" && a.bg !== c.bg, JSON.stringify({ a, c }));
  ok(`${tag}: its edge is the RBH colour, or red while it needs you`, a.edge === (a.attn ? "rgb(163, 51, 40)" : "rgb(31, 111, 106)"), JSON.stringify(a));
  await p.locator(`tr.evrow[data-open="${rbh.id}"]`).scrollIntoViewIfNeeded();
  await p.screenshot({ path: D + `rbh-colour-${tag}.png` });
  ok(`${tag}: fits the screen, no page errors`, (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) && !errs.length, errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
