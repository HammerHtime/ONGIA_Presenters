// Emailing certificates from Survey & certificates (Andrew 31 Oct 2026, from the mock-up he approved): Email everyone
// asks first and says who it leaves out; anyone checked in without a certificate is issued theirs; each row's Email
// column says what happened; a failure is shown on the row and under Show them, never lost. This test server has no
// Resend key, so every send here is "couldn't send: not set up", which is the path that must be loud. The other
// statuses (emailed, downloaded, bounced) are shown from made-up data.
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
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Cert Mail ${T}`, city: "Toronto, ON", dayOne: "2031-06-02", lastDay: "2031-06-03", invite: false, presenters: [],
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }] }) })).event;
await fetch(`${S}/api/attendees?event=${ev.id}&csv=1`, { method: "POST", headers: { "x-admin-key": "testkey", "content-type": "text/csv" },
  body: `First name,Last name,Email,Organization,Checked in\nJordan,Tremblay,jt.${T}@example.ca,TPS,Yes\nSam,Okafor,so.${T}@example.ca,OPP,Yes\nAlex,Martin,am.${T}@example.ca,Peel Police,\n` });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const open = async (w, h, fake) => {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await p.addInitScript(([t, x]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(x)); } catch {} }, [issueSession({ email: "treasurer@ongia.ca", name: "Raj Jaswal" }), { email: "treasurer@ongia.ca", name: "Raj Jaswal" }]);
  p.errs = []; p.on("pageerror", (e) => p.errs.push(String(e)));
  if (fake) await p.route(`**/api/certificates?event=${ev.id}`, async (r) => { const res = await r.fetch(); const j = await res.json(); for (const x of j.people) if (x.cert && fake[x.first]) x.cert.mail = fake[x.first]; r.fulfill({ json: j }); });
  await p.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "event", eventId: ev.id, tab: "survey", svw: "certs" })), { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  return p;
};

let p = await open(1440, 1000);
const row = (n) => p.locator("[data-certkey]", { hasText: n });
ok("before anything: no certificate yet, so nothing to say in the Email column", /—/.test(await row("Jordan Tremblay").innerText()));
let asked = "";
p.once("dialog", (d) => { asked = d.message(); d.accept(); });
await p.locator("#cert-mail").click(); await p.waitForTimeout(3500);
ok("Email everyone asks first: how many, from where, where replies go, who's issued first, who's left out", /Email 2 people their certificate\?/.test(asked) && /certificates@send\.ongia\.ca/.test(asked) && /ongiaevents@ongia\.ca/.test(asked)
  && /2 checked in don't have a certificate yet; they're issued theirs first/.test(asked) && !/no email address/.test(asked), asked);
const C = await api(`/api/certificates?event=${ev.id}`);
ok("the two checked in were issued certificates; Alex (not checked in) wasn't", C.people.filter((x) => x.cert).length === 2 && !C.people.find((x) => x.first === "Alex").cert);
ok("on this server nothing can be sent, and each row says so plainly", /Couldn't send/i.test(await row("Jordan Tremblay").innerText()) && /isn't set up/.test(await row("Jordan Tremblay").innerText()) && /Couldn't send/i.test(await row("Sam Okafor").innerText()), await row("Jordan Tremblay").innerText());
ok("the message under the buttons says how many couldn't go, with Show them", /2 couldn't be sent/.test(await p.locator("#cert-said").innerText()) && /Emailed 0 of 2/.test(await p.locator(".certset").innerText()), await p.locator("#cert-said").innerText());
await p.locator('.certmailsum [data-certcut="mailbad"]').click(); await p.waitForTimeout(500);
ok("Show them lists just the two that couldn't go", await p.locator("[data-certkey]").count() === 2 && /Bounced or couldn't send 2/.test(await p.locator(".certseg").innerText()));
await p.locator('[data-certcut="in"]').click(); await p.waitForTimeout(400);
// One person, from the ••• menu.
await row("Jordan Tremblay").locator(".certmore summary").click();
ok("••• offers Email it", /Email it/.test(await row("Jordan Tremblay").locator("[data-certmail1]").innerText()));
asked = ""; p.once("dialog", (d) => { asked = d.message(); d.accept(); });
await row("Jordan Tremblay").locator("[data-certmail1]").click(); await p.waitForTimeout(1500);
ok("…and asks first, naming the person and the address", new RegExp(`Email Jordan Tremblay their certificate, at jt\\.${T}@example\\.ca\\?`).test(asked), asked);
// The sample.
await p.locator("#cert-sample").click(); await p.waitForTimeout(1200);
ok("Email me a sample says plainly when email isn't set up here", /isn't set up/.test(await p.locator(".toast, #toast").last().innerText().catch(() => "")), await p.locator(".toast, #toast").last().innerText().catch(() => "(no toast)"));
ok("no errors", !p.errs.length, p.errs.join(" | "));
await p.close();

// Each status, as it reads (made-up data). Alex's certificate is issued anyway, for a third row.
await fetch(`${S}/api/certificates?event=${ev.id}&pdf=${encodeURIComponent(C.people.find((x) => x.first === "Alex").key)}&anyway=1`, { headers: H });
const fake = { Jordan: { sentAt: "2031-06-04T14:00:00", downloadedAt: "2031-06-05T09:30:00" }, Sam: { sentAt: "2031-06-04T14:00:00" }, Alex: { sentAt: "2031-06-04T14:00:00", bounced: "Mailbox does not exist" } };
for (const [w, h, tag] of [[1440, 1000, "wide"], [390, 844, "phone"]]) {
  p = await open(w, h, fake);
  await p.locator('[data-certcut="all"]').click(); await p.waitForTimeout(400);
  const r2 = (n) => p.locator("[data-certkey]", { hasText: n });
  ok(`${tag}: Downloaded 5 Jun, Emailed 4 Jun · not downloaded yet, Bounced with the reason`, /Downloaded 5 Jun/i.test(await r2("Jordan").innerText()) && /Emailed 4 Jun/i.test(await r2("Sam").innerText()) && /Not downloaded yet/.test(await r2("Sam").innerText())
    && /Bounced/i.test(await r2("Alex").innerText()) && /Mailbox does not exist/.test(await r2("Alex").innerText()));
  ok(`${tag}: the summary: emailed 2 of 3, downloaded 1, 1 bounced`, /Emailed 2 of 3 · downloaded 1 · 1 bounced or couldn't send/.test(await p.locator(".certmailsum").innerText()), await p.locator(".certmailsum").innerText());
  await p.locator("#certsfold").screenshot({ path: D + `certmail-${tag}.png` });
  ok(`${tag}: fits, no errors`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth) && !p.errs.length, p.errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
