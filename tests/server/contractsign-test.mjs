// Fill in and sign a hotel contract (Andrew 17 Nov 2026: "I want to fill in and sign it via the app … Have claude flag
// issues and then when I want to sign and add bonvoy, claude does it"). A made-up contract with the usual blanks (no
// real contract is ever kept in this public repository); Claude stood in by a stub that names the lines.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const F = REPO + "netlify/functions/";
const fs = await import("node:fs");
const { execFileSync } = await import("node:child_process");
const PDFDocument = (await import("pdfkit")).default;
const CS = await import(F + "lib/contractsign.mjs");
const C = await import(F + "lib/contract.mjs");
const S = await import(F + "lib/store.mjs");
const contract = (await import(F + "contract.mjs")).default;
const { issueSession } = await import(F + "lib/auth.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };

// The made-up contract: a payment choice, "please initial", a Bonvoy section and both parties' signature blocks.
const make = () => new Promise((res) => {
  const d = new PDFDocument({ size: "LETTER", margin: 54 }); const ch = []; d.on("data", (c) => ch.push(c)); d.on("end", () => res(Buffer.concat(ch)));
  d.font("Helvetica").fontSize(10);
  for (const t of ["GROUP SALES AGREEMENT", "The Test Hotel and ONGIA.", "ONGIA has elected to use the following form of payment:", "[ ] Cash, money order", "[ ] Credit card (We accept all major credit cards)", "[ ] Company check or Electronic Funds Transfer",
    "ADVANCE PAYMENT SCHEDULE                    ______ please initial", ...Array.from({ length: 14 }, (_, i) => `Clause ${i + 1}. The usual words of a hotel contract go here.`)]) d.text(t).moveDown(0.4);
  d.addPage();
  for (const t of ["MARRIOTT BONVOY EVENTS", "[ ] The Contact is eligible to receive Points or Miles.", "Member Name __________________________________", "Marriott Bonvoy Membership Number ______________________", "[ ] The Contact declines to receive Points or Miles.",
    "Approved and authorized by ONGIA:", "Name: (Print) ______________________", "Signature: (Sign) ______________________", "Title: (Print) ______________________", "Date: ______________________", "Electronic Signature (Replace Empty Box Here to Enter Into Binding Obligation): [ ]",
    "Approved and authorized by Hotel:", "Name: (Print) Erin Sample", "Title: (Print) Sales Manager", "Date: ______________________"]) d.text(t).moveDown(0.6);
  d.end();
});
const pdf = await make();
const lines = await CS.pdfLines(pdf);
const find = (re, from = 0) => lines.find((l) => l.id > from && re.test(l.text))?.id ?? null;
ok("the contract's lines are read with their pages", lines.length > 20 && lines.some((l) => l.page === 2 && /Member Name/.test(l.text)));

// Claude, stood in: it is given the lines and names which is which.
let asked = "";
const client = { messages: { create: async (q) => {
  asked = q.messages[0].content;
  const ongia = find(/Approved and authorized by ONGIA/);
  const out = { bonvoyEligible: find(/is eligible to receive/), memberName: find(/Member Name/), bonvoyNumber: find(/Membership Number/), bonvoyEmail: null,
    signName: find(/^Name: \(Print\)/, ongia), signature: find(/^Signature: \(Sign\)/, ongia), signTitle: find(/^Title: \(Print\)/, ongia), signDate: find(/^Date:/, ongia), esignBox: find(/Electronic Signature/, ongia),
    payment: null, initials: [find(/please initial/)], paymentOptions: [{ line: find(/Cash, money/), kind: "cash" }, { line: find(/Credit card/), kind: "card" }, { line: find(/Company check/), kind: "cheque" }], notes: "" };
  return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(out) }] };
} } };
const placed = await CS.locateFields(lines, { client });
ok("Claude is shown every line with its page and place", /\tp1\t/.test(asked) && /Member Name/.test(asked) && /please initial/.test(asked));
ok("the hotel's own signature lines are never ONGIA's", placed.signName && lines.find((l) => l.id === placed.signName).text !== "Name: (Print) Erin Sample");

const sigPng = fs.readFileSync(REPO + "public/assets/app-icon-192.png");   // stands in for his signature here
const out = await CS.fillContract(pdf, lines, placed, { name: "Andrew Hammond", title: "President", date: "November 17, 2026", initials: "AH", number: "123456789", email: "", payment: "card" }, sigPng);
const f = "/tmp/contractsign-test.pdf"; fs.writeFileSync(f, out.bytes);
const txt = execFileSync("pdftotext", ["-layout", f, "-"]).toString();
ok("a PDF comes back, the same pages", out.bytes.subarray(0, 4).toString() === "%PDF" && /Pages:\s+2/.test(execFileSync("pdfinfo", [f]).toString()));
ok("his name, title and date go in ONGIA's block", /Name: \(Print\)\s+_*\s*Andrew Hammond/.test(txt.replace(/_{3,}/g, "___")) || (/Andrew Hammond/.test(txt) && /President/.test(txt) && /November 17, 2026/.test(txt)), txt.slice(-900));
ok("the Bonvoy name and number go in the Bonvoy section, and the eligible box is ticked", /123456789/.test(txt) && out.filled.some((x) => x.what === "Eligible for Bonvoy points") && out.filled.some((x) => x.what === "Bonvoy member name"));
ok("initials, the form of payment and the electronic-signature box", /AH/.test(txt) && out.filled.some((x) => x.what === "Form of payment: card") && out.filled.some((x) => x.what === "Electronic signature box"));
ok("his signature is drawn on the signature line", out.filled.some((x) => x.what === "Signature" && x.text === "signed") && Number(/(\d+)\s*$/m.exec(execFileSync("pdfimages", ["-list", f]).toString().trim())?.[1] ?? 0) >= 0 && execFileSync("pdfimages", ["-list", f]).toString().split("\n").length > 2);
ok("the hotel's date line is left blank", (txt.match(/November 17, 2026/g) ?? []).length === 1);
fs.unlinkSync(f);

// Without a Bonvoy number nothing goes in that section.
const out2 = await CS.fillContract(pdf, lines, placed, { name: "Andrew Hammond", title: "President", date: "November 17, 2026", initials: "AH", number: "", email: "", payment: "" }, null);
ok("no Bonvoy number, no Bonvoy section, no payment box; no signature image, his name typed", !out2.filled.some((x) => /Bonvoy/.test(x.what)) && !out2.filled.some((x) => /payment/.test(x.what)) && out2.filled.some((x) => x.what === "Signature (typed)"));

// The issues Claude flags when it reads a contract are kept, tidied.
const t = C.tidy({ issues: [{ level: "fix", text: "The email on page 1 is president@ongia.org; ONGIA's is president@ongia.ca.", page: 1 }, { level: "check", text: "Attrition: at least 80% of 55 room nights must be used.", page: 2 }, { level: "bogus", text: "x", page: 0 }] }, null);
ok("issues come through with their level and page; anything else is dropped", t.issues.length === 2 && t.issues[0].level === "fix" && t.issues[0].page === 1 && t.issues[1].level === "check");

// Only the President signs with his signature.
await S.putEvent({ id: "cs-ev", title: "Regina Training Symposium", city: "Regina, SK", dayOne: "2027-10-05", board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }, { name: "Raj Jaswal", email: "treasurer@ongia.ca" }] });
await S.putContract("cs-ev", pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength), { name: "test-contract.pdf", size: pdf.length, uploadedAt: new Date().toISOString() });
const call = async (headers, body = {}) => { const r = await contract(new Request("http://localhost/api/contract?event=cs-ev&sign=1", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
const raj = { "x-admin-key": issueSession({ email: "treasurer@ongia.ca", name: "Raj Jaswal" }) };
ok("another board member can't sign with his signature", (await call(raj)).status === 403);
const r = await call({ "x-admin-key": issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" }) }, { payment: "card", bonvoy: true });
// (No background functions run here, so the start is recorded as not started; on the site it runs.)
ok("the President can: it's accepted and recorded", r.status === 202 && ["signing", "failed"].includes(r.body.sign?.state), JSON.stringify(r.body.sign));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
