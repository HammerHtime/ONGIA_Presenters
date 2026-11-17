// Fill in and sign a hotel contract from Edit event (Andrew 17 Nov 2026). A made-up contract is uploaded the normal way;
// the box offers "Fill in and sign" with the form of payment and Bonvoy; Claude (stood in) names the lines; the signed
// copy downloads. The original stays. 390 wide and wide, nothing sideways.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const CS = await import(REPO + "netlify/functions/lib/contractsign.mjs");
const PDFDocument = (await import("pdfkit")).default;
const fs = await import("node:fs");
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
const D = new URL(".", import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const pdf = await new Promise((res) => {
  const d = new PDFDocument({ size: "LETTER", margin: 54 }); const ch = []; d.on("data", (c) => ch.push(c)); d.on("end", () => res(Buffer.concat(ch)));
  d.font("Helvetica").fontSize(10);
  for (const t of ["GROUP SALES AGREEMENT", "[ ] Credit card (We accept all major credit cards)", "[ ] Company check or Electronic Funds Transfer", ...Array.from({ length: 16 }, (_, i) => `Clause ${i + 1}. Usual words.`),
    "MARRIOTT BONVOY EVENTS", "[ ] The Contact is eligible to receive Points or Miles.", "Member Name ______________________", "Marriott Bonvoy Membership Number ______________________",
    "Approved and authorized by ONGIA:", "Name: (Print) ______________________", "Signature: (Sign) ______________________", "Title: (Print) ______________________", "Date: ______________________"]) d.text(t).moveDown(0.4);
  d.end();
});
const lines = await CS.pdfLines(pdf);
const id = (re) => lines.find((l) => re.test(l.text))?.id ?? null;
await fetch("http://127.0.0.1:8799/__set", { method: "POST", body: JSON.stringify({ reply: { bonvoyEligible: id(/is eligible/), memberName: id(/Member Name/), bonvoyNumber: id(/Membership Number/), bonvoyEmail: null,
  signName: id(/^Name: \(Print\)/), signature: id(/^Signature/), signTitle: id(/^Title/), signDate: id(/^Date:/), esignBox: null, payment: null, initials: [],
  paymentOptions: [{ line: id(/Credit card/), kind: "card" }, { line: id(/Company check/), kind: "cheque" }], notes: "" } }) });

await api("/api/roster");
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: "Regina Training Symposium", city: "Regina, SK", dayOne: "2031-10-05", lastDay: "2031-10-07", invite: false, presenters: [],
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }] }) })).event;
await fetch(`${S}/api/contract?event=${ev.id}`, { method: "POST", headers: { "x-admin-key": "testkey", "x-file-name": "test-contract.pdf" }, body: pdf });

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[390, 844, "phone"], [1280, 900, "wide"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, acceptDownloads: true });
  await p.addInitScript(([t]) => { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify({ email: "president@ongia.ca", name: "Andrew Hammond" })); }, [issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" })]);
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "edit", eventId: ev.id })), { waitUntil: "networkidle" }); await p.waitForTimeout(2500);
  // The box is in the folded "Hotel and room block" section.
  await p.evaluate(() => document.getElementById("ct-body")?.closest("details")?.setAttribute("open", ""));
  await p.waitForTimeout(300);
  const box = p.locator("#ct-body");
  await box.scrollIntoViewIfNeeded();
  if (tag === "phone") {
    ok(`${tag}: the contract box offers Fill in and sign, with the form of payment and Bonvoy`, await box.locator('[data-ct="sign"]').isVisible() && await box.locator("#ct-pay").isVisible() && await box.locator("#ct-bonvoy").isChecked(), (await box.innerText()).slice(0, 400));
    await box.locator("#ct-pay").selectOption("card");
    p.once("dialog", (d) => d.accept());
    await box.locator('[data-ct="sign"]').click();
    let done = false;
    for (let i = 0; i < 20 && !done; i++) { await p.waitForTimeout(1000); done = await box.locator('[data-ct="signed"]').count() > 0; }
    ok(`${tag}: Claude fills it in; it says what it put on, and to check it then send it yourself`, done && /Signed/.test(await box.innerText()) && /Check it, then send it to the hotel yourself/.test(await box.innerText()), (await box.innerText()).slice(0, 500));
  } else ok(`${tag}: once signed, the box says so`, await box.locator('[data-ct="signed"]').isVisible());
  const [dl] = await Promise.all([p.waitForEvent("download"), box.locator('[data-ct="signed"]').click()]);
  const f = await dl.path();
  const txt = (await import("node:child_process")).execFileSync("pdftotext", ["-layout", f, "-"]).toString();
  ok(`${tag}: the signed copy has his name, title and the form of payment ticked`, / - signed \d{4}-\d{2}-\d{2}\.pdf$/.test(dl.suggestedFilename()) && /Andrew Hammond/.test(txt) && /President/.test(txt), dl.suggestedFilename());
  const orig = Buffer.from(await (await fetch(`${S}/api/contract?event=${ev.id}&file=1`, { headers: { "x-admin-key": "testkey" } })).arrayBuffer());
  ok(`${tag}: the original contract is untouched`, orig.equals(pdf));
  ok(`${tag}: nothing scrolls sideways`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  if (D) await box.screenshot({ path: D + `contractsign-${tag}.png` });
  ok(`${tag}: no script errors`, !errs.length, errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
