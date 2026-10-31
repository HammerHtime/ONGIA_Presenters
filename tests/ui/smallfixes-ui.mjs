// Four small things from the audit (30 Oct 2026): the survey keeps answers in progress through a reload (in that tab, and
// not once they're sent); 0 to 10 sits on two rows on a phone; a practice event says so across the top; and pdf.js comes
// from the site itself, not from another one.
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
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Small Fixes ${T}`, city: "Toronto, ON", venue: "Hall", dayOne: shift(-3), lastDay: shift(-2), invite: false,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }] }) })).event;
const set = await api(`/api/survey?event=${ev.id}`, { method: "PUT", body: JSON.stringify({ open: true, mode: "end", sendOn: shift(-1),
  sessions: [{ id: "sa", day: ev.dayOne, title: "Following the Money", titleFr: "Suivre l'argent", presenters: ["Jordan Avery"] }] }) });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

// 1 and 2: the survey, on a phone.
let p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
let errs = []; p.on("pageerror", (e) => errs.push(String(e)));
await p.goto(`${S}/f/${set.survey.token}?lang=en`, { waitUntil: "networkidle" }); await p.waitForTimeout(700);
const nps = await p.locator(".nps button").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), w: r.width }; }));
const rows = [...new Set(nps.map((x) => x.top))];
ok("phone: 0 to 10 on two rows, 0–5 then 6–10, each at least 44 pixels wide", nps.length === 11 && rows.length === 2 && nps.filter((x) => x.top === rows[0]).length === 6 && nps.every((x) => x.w >= 44), JSON.stringify(nps));
await p.locator(".nps").screenshot({ path: D + "smallfixes-nps-phone.png" });
await p.locator('[data-star="sa.relevant"][data-v="4"]').click();
await p.locator('[data-choice="overall.nps"][data-v="8"]').click();
await p.locator('[data-text]').first().fill("The case studies were the best part.").catch(() => {});
await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(700);
ok("a reload keeps the answers given so far, and says so", await p.locator('[data-star="sa.relevant"][data-v="4"]').getAttribute("aria-checked") === "true"
  && await p.locator('[data-choice="overall.nps"][data-v="8"]').getAttribute("aria-pressed") === "true" && /Your answers so far are still here/.test(await p.locator("#kept").innerText()));
const typed = await p.locator('[data-text]').first().inputValue().catch(() => null);
ok("typed words come back too", typed === null || typed === "The case studies were the best part.", String(typed));
await p.locator("#lang").click(); await p.waitForTimeout(300);
ok("in French the note is in French", /Les réponses déjà données sont toujours là/.test(await p.locator("#kept").innerText()));
await p.locator("#lang").click(); await p.waitForTimeout(300);
// Another tab (or the next person at a shared computer) starts clean.
const other = await b.newPage({ viewport: { width: 390, height: 844 } });
await other.goto(`${S}/f/${set.survey.token}?lang=en`, { waitUntil: "networkidle" }); await other.waitForTimeout(600);
ok("a new tab starts clean", await other.locator('[data-star="sa.relevant"][data-v="4"]').getAttribute("aria-checked") !== "true" && await other.locator("#kept").count() === 0);
await other.close();
// Once sent, the kept copy goes.
await p.route("**/api/survey?t=*", (r) => r.request().method() === "POST" ? r.fulfill({ status: 200, contentType: "application/json", body: "{}" }) : r.continue());
await p.locator("#send").click(); await p.waitForTimeout(700);
ok("(sent)", /Thank you|Merci/i.test(await p.locator("#root").innerText()), await p.locator("#root").innerText());
await p.unroute("**/api/survey?t=*");
await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(700);
ok("once sent, nothing is kept: a reload is a fresh survey", await p.locator('[data-star="sa.relevant"][data-v="4"]').getAttribute("aria-checked") !== "true" && await p.locator("#kept").count() === 0);
ok("survey: no page errors", !errs.length, errs.join(" | "));
await p.close();

// 3: a practice event.
const made = await api("/api/sandbox?practice=1", { method: "POST", body: "{}" });
const prac = (made.events ?? [])[0];
const open = async (id, w, h) => {
  const pg = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await pg.addInitScript(([t, x]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(x)); } catch {} }, [issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" }), { email: "president@ongia.ca", name: "Andrew Hammond", canCost: true }]);
  pg.errs = []; pg.on("pageerror", (e) => pg.errs.push(String(e)));
  pg.asked = []; pg.on("request", (r) => pg.asked.push(r.url()));
  await pg.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "event", eventId: id })), { waitUntil: "networkidle" }); await pg.waitForTimeout(1500);
  if (await pg.locator("dialog.walk[open]").count()) { await pg.locator("#wclose").click(); await pg.waitForTimeout(400); }
  return pg;
};
for (const [w, h, tag] of [[1440, 1000, "wide"], [390, 844, "phone"]]) {
  p = await open(prac.id, w, h);
  ok(`${tag}: a practice event says so across the top`, await p.locator(".practband").isVisible() && /Practice event\. Made-up people for trying things out\. Nothing on it is ever emailed/.test(await p.locator(".practband").innerText()));
  await p.locator(".evhead").screenshot({ path: D + `smallfixes-practice-${tag}.png` });
  ok(`${tag}: fits, no errors`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth) && !p.errs.length, p.errs.join(" | "));
  await p.close();
}
p = await open(ev.id, 1440, 1000);
ok("a real event has no practice banner", await p.locator(".practband").count() === 0);

// 4: pdf.js from the site itself, drawing a certificate design uploaded as a PDF.
const pdf = Buffer.from(await (await fetch(`${S}/api/certificates?event=${ev.id}&preview=1`, { headers: { "x-admin-key": "testkey" } })).arrayBuffer());
(await import("node:fs")).writeFileSync("/tmp/smallfixes-design.pdf", pdf);
p.on("dialog", (d) => d.accept());
await p.locator('.etab[data-tab="survey"]').click(); await p.waitForTimeout(400);
await p.locator('[data-svgo="certs"]').click(); await p.waitForTimeout(1200);
await p.locator("#cert-change").click(); await p.waitForTimeout(300);
const [chooser] = await Promise.all([p.waitForEvent("filechooser"), p.locator("#cert-upload").click()]);
await chooser.setFiles("/tmp/smallfixes-design.pdf");
await p.waitForTimeout(800);
if (await p.locator('dialog[open] [data-scope="event"]').count()) await p.locator('dialog[open] [data-scope="event"]').click();
await p.waitForSelector("dialog.designdlg[open]", { timeout: 30000 }).catch(() => {});
ok("a PDF design opens in the editor, drawn by pdf.js from the site", await p.locator("dialog.designdlg[open]").count() === 1
  && p.asked.some((u) => u.endsWith("/vendor/pdfjs/pdf.min.js")) && p.asked.some((u) => u.endsWith("/vendor/pdfjs/pdf.worker.min.js")), p.asked.filter((u) => /pdf/.test(u)).join(" "));
ok("and nothing is fetched from another site for it", !p.asked.some((u) => /cdnjs|jsdelivr|unpkg/.test(u)), p.asked.filter((u) => /cdnjs|jsdelivr|unpkg/.test(u)).join(" "));
ok("no errors", !p.errs.length, p.errs.join(" | "));
await p.close();
await api("/api/sandbox?practice=1", { method: "DELETE" });
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
