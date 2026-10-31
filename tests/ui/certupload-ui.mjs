// Uploading a certificate design in the app (Andrew 30 Oct 2026): the question "this event only, or a template?", Claude
// placing the words, the editor to drag them, and the design on the event's list (or every event's, as a template);
// Admin › Certificate designs to see them all, change which, or retire one.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const fs = await import("node:fs");
const { execFileSync } = await import("node:child_process");
const D = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const T = Date.now().toString(36);
const mk = async (title) => (await api("/api/events", { method: "POST", body: JSON.stringify({ title, city: "Toronto", dayOne: "2031-11-04", lastDay: "2031-11-06", invite: false, presenters: [],
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }] }) })).event;
const sym = await mk(`Ontario Symposium ${T}`), other = await mk(`Other Training ${T}`);
await fetch(`${S}/api/attendees?event=${sym.id}&csv=1`, { method: "POST", headers: { "x-admin-key": "testkey", "content-type": "text/csv" }, body: `First name,Last name,Email,Organization,Checked in\nJordan,Tremblay,jt.${T}@torontopolice.on.ca,TPS,Yes\n` });
// Where Claude says the words go (the stand-in on 8799), with sample words to lift off.
await fetch("http://127.0.0.1:8799/__set", { method: "POST", body: JSON.stringify({ reply: {
  name: { present: true, box: { x: 0.065, y: 0.4, w: 0.55, h: 0.05 }, font: "bold", sizePt: 34, color: "black", align: "left" },
  agency: { present: true, box: { x: 0.065, y: 0.46, w: 0.6, h: 0.03 }, font: "regular", sizePt: 17, color: "black", align: "left" },
  course: { present: true, box: { x: 0.065, y: 0.6, w: 0.65, h: 0.07 }, font: "bold", sizePt: 20, color: "navy", align: "left" },
  date: { present: true, box: { x: 0.07, y: 0.765, w: 0.2, h: 0.025 }, font: "regular", sizePt: 13, color: "black", align: "left" },
  erase: [{ box: { x: 0.065, y: 0.4, w: 0.3, h: 0.04 }, text: "Your Recipient" }], qr: { box: { x: 0.88, y: 0.04, w: 0.06, h: 0.06 }, onDark: false }, notes: "" } }) });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (email, w, h, hash) => {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, acceptDownloads: true });
  const token = issueSession({ email, name: email });
  await p.addInitScript(([t, who]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(who)); } catch {} }, [token, { email, name: email, canCost: email === "president@ongia.ca" }]);
  p.errs = []; p.on("pageerror", (e) => p.errs.push(String(e))); p.on("dialog", (d) => d.accept());
  await p.goto(`${S}/admin.html${hash}`, { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  return p;
};
const guests = (id) => "#v=" + encodeURIComponent(JSON.stringify({ name: "event", eventId: id, tab: "people", pview: "guests" }));
// Certificates are on Survey & certificates (audit, 30 Oct 2026); the designs open under Change.
const openCerts = async (p) => {
  await p.locator('.etab[data-tab="survey"]').click(); await p.waitForTimeout(400);
  await p.locator('[data-svgo="certs"]').click(); await p.waitForTimeout(1200);
  if (!(await p.locator(".certpick").isVisible())) { await p.locator("#cert-change").click(); await p.waitForTimeout(300); }
  return p.locator("#certsfold");
};

// The lead uploads the Symposium's design from the event.
let p = await open("treasurer@ongia.ca", 1440, 1000, guests(sym.id));
await openCerts(p);
const [chooser] = await Promise.all([p.waitForEvent("filechooser"), p.locator("#cert-upload").click()]);
await chooser.setFiles(REPO + "public/assets/certs/ongia-generic.jpg");
await p.waitForTimeout(600);
const ask = p.locator("dialog[open]");
ok("first it asks: just for this event, or a template", /for one event, or a template/i.test(await ask.innerText()) && /Just for Ontario Symposium/.test(await ask.innerText()), await ask.innerText());
ok("the lead isn't offered the template choice", await ask.locator('[data-scope="any"]').count() === 0);
await ask.locator('[data-scope="event"]').click();
await p.waitForSelector("dialog.designdlg[open]", { timeout: 20000 }); await p.waitForTimeout(800);
const ed = p.locator("dialog.designdlg");
ok("the editor opens with every item placed, showing the words as they'll print", await ed.locator('[data-box="name"]').count() === 1 && /Jordan Tremblay/.test(await ed.locator('[data-box="name"]').innerText()) && /Toronto Police Service/.test(await ed.locator('[data-box="agency"]').innerText()) && /November|06\/11/.test(await ed.locator('[data-box="date"]').innerText()) && await ed.locator('[data-box="qr"]').count() === 1);
ok("and says which sample words it took off", /Took off the sample words: “Your Recipient”/.test(await ed.innerText()));
await ed.screenshot({ path: D + "certupload-editor.png" });
// Drag the name box down 20 pixels; make the agency italic.
const nb = await ed.locator('[data-box="name"]').boundingBox();
await p.mouse.move(nb.x + 40, nb.y + nb.height / 2); await p.mouse.down(); await p.mouse.move(nb.x + 40, nb.y + nb.height / 2 + 20, { steps: 5 }); await p.mouse.up();
const nb2 = await ed.locator('[data-box="name"]').boundingBox();
ok("a box can be dragged", Math.abs(nb2.y - nb.y - 20) < 3, `${nb.y} → ${nb2.y}`);
await ed.locator('[data-row="agency"] [data-seg="agency.font"] [data-v="i"]').click();
ok("the agency switches to italic in the preview", await ed.locator('[data-box="agency"] .dstext.f-i').count() === 1);
await ed.locator("#ds-save").click(); await p.waitForTimeout(1800);
const fold = p.locator("#certsfold");
ok("saved: the Symposium's own design is on its list and picked", /Ontario Symposium/.test(await fold.locator(".certtpl.on").innerText()) && /This event's own design/.test(await fold.locator(".certtpl.on").innerText()), await fold.locator(".certtpl.on").innerText().catch(() => ""));
await fold.screenshot({ path: D + "certupload-list.png" });
const [dl] = await Promise.all([p.waitForEvent("download"), p.locator("[data-certkey]", { hasText: "Jordan Tremblay" }).locator("[data-certpdf]").click()]);
fs.copyFileSync(await dl.path(), "/tmp/certupload-jordan.pdf");
const words = execFileSync("pdftotext", ["/tmp/certupload-jordan.pdf", "-"]).toString().replace(/\s+/g, " ");
ok("Jordan's certificate comes out on the new design", /Jordan Tremblay/.test(words) && /Toronto Police Service/.test(words) && new RegExp(`Ontario Symposium ${T}`).test(words), words.slice(0, 300));
execFileSync("pdftoppm", ["-png", "-r", "70", "/tmp/certupload-jordan.pdf", D + "certupload-pdf"]);
ok("no errors for the lead", !p.errs.length, p.errs.join(" | "));
await p.close();

// Another event doesn't see it.
p = await open("president@ongia.ca", 1440, 1000, guests(other.id));
await openCerts(p);
ok("another event doesn't offer the Symposium's design", !(await p.locator("#certsfold .certtpl").allInnerTexts()).some((t) => /Ontario Symposium/.test(t)));
await p.close();

// Admin › Certificate designs.
for (const [w, h, tag] of [[1440, 1000, "wide"], [390, 844, "phone"]]) {
  p = await open("president@ongia.ca", w, h, "#v=" + encodeURIComponent(JSON.stringify({ name: "admin", tab: "designs" })));
  const card = p.locator(".dcard", { hasText: `Ontario Symposium ${T}` });
  if (tag === "phone") {
    ok(`${tag}: Admin lists the designs: the template saved from Admin, and the retired one`, /Template · any event/.test(await p.locator(".dcard", { hasText: `Webinar template ${T}` }).innerText()) && await p.locator(".agblank .dcard", { hasText: `Ontario Symposium ${T}` }).count() === 1);
    await p.screenshot({ path: D + "certupload-admin-phone.png", fullPage: true });
  }
  if (tag === "wide") {
    ok(`${tag}: Admin lists the design, for its event`, await card.count() === 1 && new RegExp(`For Ontario Symposium ${T}`).test(await card.innerText()));
    await card.locator("[data-dscope]").click(); await p.waitForTimeout(1200);
    ok("Make it a template: now for any event", /Template · any event/.test(await p.locator(".dcard", { hasText: `Ontario Symposium ${T}` }).innerText()));
    const p2 = await open("president@ongia.ca", 1440, 1000, guests(other.id)); await openCerts(p2);
    ok("and the other event now offers it", (await p2.locator("#certsfold .certtpl").allInnerTexts()).some((t) => new RegExp(`Ontario Symposium ${T}`).test(t)));
    await p2.close();
    await p.locator(".dcard", { hasText: `Ontario Symposium ${T}` }).locator("[data-dretire]").click(); await p.waitForTimeout(1200);
    ok("Retire moves it under Retired", await p.locator(".agblank .dcard", { hasText: `Ontario Symposium ${T}` }).count() === 1);
    // Upload from Admin asks which: a template, or one event from a list.
    const [ch2] = await Promise.all([p.waitForEvent("filechooser"), p.locator("#ds-upload").click()]);
    await ch2.setFiles(REPO + "public/assets/certs/ongia-generic.jpg"); await p.waitForTimeout(600);
    ok("uploading from Admin offers a template, or one event picked from a list", await p.locator('dialog[open] [data-scope="any"]').isVisible() && await p.locator("dialog[open] #ds-event option", { hasText: `Other Training ${T}` }).count() === 1);
    await p.locator('dialog[open] [data-scope="any"]').click();
    await p.waitForSelector("dialog.designdlg[open]", { timeout: 20000 });
    await p.locator("#ds-name").fill(`Webinar template ${T}`); await p.locator("#ds-save").click(); await p.waitForTimeout(1500);
    ok("saved as a template from Admin", /Template · any event/.test(await p.locator(".dcard", { hasText: `Webinar template ${T}` }).innerText()));
    await p.screenshot({ path: D + "certupload-admin.png", fullPage: true });
  }
  ok(`${tag}: fits, no errors`, (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) && !p.errs.length, p.errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
