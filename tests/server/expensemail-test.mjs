// ONGIA Expenses' emails as they go out (Andrew, 3 Nov 2026): from "ONGIA Expenses", not the speakers' mailbox; the
// officers' subject is "Expense claim for {name}"; the approvers get the items and amounts one to a line and Review;
// nothing more after the first approval; the VP gets "approved by the President and the VP of Operations, ready to be paid" (the approvers are the
// President and the VP since Andrew 13 Nov 2026).
// A stand-in for Resend catches each message as the real flow sends it.
process.env.ADMIN_KEY = "testkey";
process.env.RESEND_API_KEY = "test-key";
process.env.APP_URL = "https://events.example.org";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.MS_MAIL_FROM;
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.resend.com/")) {
    const p = JSON.parse(init.body);
    sent.push({ to: p.to.join(), from: p.from, replyTo: p.reply_to, subject: p.subject, html: p.html, text: p.text });
    return new Response(JSON.stringify({ id: "r" + sent.length }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(url, init);
};
const REPO = new URL("../../", import.meta.url).pathname;
const F = REPO + "netlify/functions/";
const exp = (await import(F + "expenses.mjs")).default;
const roster = (await import(F + "roster.mjs")).default;
const X = await import(F + "lib/expenses.mjs");
const S = await import(F + "lib/store.mjs");
const { todayIso } = await import(F + "lib/deadlines.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const as = (email, name = email) => ({ "x-expense-key": X.issueExpenseSession({ email, name }), "content-type": "application/json" });
const call = async (url, method = "GET", body, headers) => { const r = await exp(new Request("http://localhost" + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
await roster(new Request("http://localhost/api/roster", { headers: { "x-admin-key": "testkey" } }));
const day = (n) => todayIso(new Date(Date.now() + n * 86400e3));
const JOHN = as("j.healy@ongia.ca", "John Healy"), PRES = as("president@ongia.ca", "Andrew Hammond"), TRES = as("treasurer@ongia.ca", "Raj Jaswal"), VP = as("vp_operations@ongia.ca", "Jacqulyn Taylor");
const since = (k) => sent.slice(k);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(300, 3)]);
const upload = (url, who) => exp(new Request("http://localhost" + url, { method: "POST", headers: { "x-expense-key": who["x-expense-key"] }, body: PNG }));

console.log("— sent: one email to each approver");
let m = await call("/api/expenses?add=mileage", "POST", { date: day(-3), from: "Barrie", to: "Toronto", km: 100, purpose: "Drive to the training" }, JOHN);
const C = m.claim.id;
await call(`/api/expenses?add=noreceipt&claim=${C}`, "POST", { paidTo: "Speaker Stipend", date: day(-2), amount: 250, category: 10, purpose: "Stipend" }, JOHN);
const gp = await call(`/api/expenses?add=noreceipt&claim=${C}`, "POST", { paidTo: "Green P", date: day(-1), amount: 18, category: 8, purpose: "Parking", statement: "The machine gave no receipt." }, JOHN);
await upload(`/api/expenses?claim=${C}&shot=${gp.line}`, JOHN);
let k = sent.length;
const s = await call(`/api/expenses?submit=${C}`, "POST", {}, JOHN);
ok("the claim goes", s.claim?.status === "submitted", JSON.stringify(s).slice(0, 200));
const ask = since(k);
ok("two emails, one to the President and one to the VP", ask.map((x) => x.to).sort().join() === "president@ongia.ca,vp_operations@ongia.ca", JSON.stringify(ask.map((x) => x.to)));
ok("from ONGIA Expenses on send.ongia.ca, not the speakers' mailbox", ask.every((x) => x.from === "ONGIA Expenses <expenses@send.ongia.ca>"), ask[0]?.from);
ok("subject: Expense claim for John Healy", ask.every((x) => x.subject === "Expense claim for John Healy"), ask[0]?.subject);
ok("a reply goes to John, not to the sending address", ask.every((x) => x.replyTo === "j.healy@ongia.ca"));
const a = ask[0]?.text ?? "";
ok("John Healy has submitted an expense claim for the following: each item on its own line with its amount, oldest first, and the total", /John Healy has submitted an expense claim for the following:\n\nMileage: Barrie to Toronto   \$62\.00\nSpeaker Stipend   \$250\.00\nGreen P   \$18\.00   \?\nTotal   \$330\.00/.test(a), a);
ok("…mileage and the stipend have no receipt to check, so no mark; the card statement's amount isn't confirmed: ? in amber, with a key", /<td[^>]*>\?<\/td>|>\?<\/span>/.test(ask[0].html) && /#8a5d0c/.test(ask[0].html) && /\? couldn't be verified/.test(a) && !/#a33328|#2f6b4f/.test(ask[0].html));
ok("Waiting on approval from President Andrew Hammond and VP of Operations Jacqulyn Taylor", /Waiting on approval from President Andrew Hammond and VP of Operations Jacqulyn Taylor\./.test(a), a);
ok("Review, straight to the claim", new RegExp(`Review: https://events\\.example\\.org/expenses#claim=${C}`).test(a) && />Review</.test(ask[0].html));
ok("the claim keeps that both went", (await S.getClaim(C)).mail.filter((x) => x.what === "to approve" && x.ok).length === 2);

console.log("— the marks beside each amount (Andrew, 3 Nov 2026: a green check when the receipt and the claim agree, a red x if something is off)");
{
  const M = await import(F + "lib/expensemail.mjs");
  const L = (paidTo, amount, check) => ({ kind: "receipt", paidTo, date: "2026-11-02", amount, check });
  ok("the receipt says the same amount: ✓", M.markOf(L("Esso", 52, { state: "match", total: 52 })) === "ok");
  ok("it says another amount, or the picture isn't a receipt: ✗", M.markOf(L("Esso", 52, { state: "differs", total: 25 })) === "bad" && M.markOf(L("Esso", 52, { state: "notreceipt" })) === "bad");
  ok("the same number but in US dollars, a card statement, an unread receipt: ? (not confirmed, never a red x)", ["open", "open", "open"].join() === [M.markOf(L("Delta", 100, { state: "match", total: 100, currency: "USD" })), M.markOf({ kind: "noreceipt", amount: 9, check: { state: "statement" } }), M.markOf(L("Esso", 52, { state: "unread" }))].join());
  ok("mileage and a stipend: no mark", M.markOf({ kind: "mileage", check: { state: "mileage" } }) === "" && M.markOf({ kind: "noreceipt", check: { state: "stipend" } }) === "");
  const e = M.needsApprovalMail({ claim: { id: "m-1", owner: { name: "John Healy" }, month: "November 2026", total: 77 }, lines: [L("Esso", 52, { state: "match", total: 52 }), L("Staples", 25, { state: "differs", total: 52 })], waitingOn: ["President Andrew Hammond"] });
  ok("in the email: ✓ in green beside the match, ✗ in red beside the other, and a key saying what each means", /Esso   \$52\.00   ✓\uFE0E\nStaples   \$25\.00   ✗\uFE0E\nTotal   \$77\.00/.test(e.text) && /background:#2f6b4f;color:#ffffff[^>]*>✓/.test(e.html) && /background:#a33328;color:#ffffff[^>]*>✗/.test(e.html) && /Claude verified the amount against the receipt/.test(e.text) && /doesn't match the receipt/.test(e.text) && !/couldn't be verified/.test(e.text), e.text);
}

console.log("— the first approval: no email");
k = sent.length;
await call(`/api/expenses?decide=${C}`, "POST", { decision: "approve" }, PRES);
ok("the President approves; nobody is emailed (the VP already has it)", since(k).length === 0, JSON.stringify(since(k).map((x) => x.to)));

console.log("— both approved: the VP to pay, John told");
k = sent.length;
await call(`/api/expenses?decide=${C}`, "POST", { decision: "approve" }, VP);
const pay = since(k).find((x) => x.to === "vp_operations@ongia.ca"), told = since(k).find((x) => x.to === "j.healy@ongia.ca");
ok("the VP: Expense claim for John Healy, from ONGIA Expenses, a reply to John", pay?.subject === "Expense claim for John Healy" && pay.from === "ONGIA Expenses <expenses@send.ongia.ca>" && pay.replyTo === "j.healy@ongia.ca", JSON.stringify(pay && { s: pay.subject, f: pay.from, r: pay.replyTo }));
ok("…The expense claim for John Healy has been approved by the President and the VP of Operations and is ready to be paid", /The expense claim for John Healy has been approved by the President and the VP of Operations and is ready to be paid\./.test(pay?.text ?? ""), pay?.text);
ok("…how much, to whom, and Record the payment to the claim", /\$330\.00 by e-transfer to j\.healy@ongia\.ca/.test(pay?.text ?? "") && new RegExp(`Record the payment: https://events\\.example\\.org/expenses#claim=${C}`).test(pay?.text ?? ""));
ok("…and short: no list of items, no paragraph of instructions", !/Mileage: Barrie/.test(pay?.text ?? "") && (pay?.text ?? "").split("\n").filter((l) => l.trim()).length <= 7, pay?.text);
ok("John: approved, a reply going to the VP who pays it", told?.subject === "Your " + (await S.getClaim(C)).month + " expense claim is approved" && /approved by the President and the VP of Operations/.test(told.text) && told.replyTo === "vp_operations@ongia.ca", JSON.stringify(told && { s: told.subject, r: told.replyTo }));

console.log("— paid");
ok("a typo'd number is refused in Andrew's word for it", /transaction number/.test((await call(`/api/expenses?pay=${C}`, "POST", { ref: "x" }, VP)).error ?? ""));
k = sent.length;
const p = await call(`/api/expenses?pay=${C}`, "POST", { ref: "CA7Kx2Pq9TmR" }, VP);
ok("a transaction number pays and locks it", p.claim?.status === "paid");
const paid = since(k)[0];
ok("John is told, with the transaction number, a reply going to the VP", paid?.to === "j.healy@ongia.ca" && /Transaction number: CA7Kx2Pq9TmR/.test(paid.text) && paid.replyTo === "vp_operations@ongia.ca", paid?.text);

console.log("— a test claim: one email, to the one who made it");
const BK = as("b.konkle@ongia.ca", "Barb Konkle");
m = await call("/api/expenses?add=noreceipt&test=1", "POST", { paidTo: "Barb Konkle", date: day(-1), amount: 250, category: 10, purpose: "Practice stipend" }, BK);
k = sent.length;
await call(`/api/expenses?submit=${m.claim.id}`, "POST", {}, BK);
const t = since(k);
ok("one 'to approve' email, to her, [TEST] in the subject", t.length === 1 && t[0].to === "b.konkle@ongia.ca" && t[0].subject === "[TEST] Expense claim for Barb Konkle", JSON.stringify(t.map((x) => [x.to, x.subject])));
ok("…saying it waits on the President and the VP, both her", /Waiting on approval from the President and the VP of Operations \(both you, for practice\)\./.test(t[0]?.text ?? ""), t[0]?.text);

console.log("— with no Resend key, the email still goes the usual way");
delete process.env.RESEND_API_KEY;
const { sendExpenseMail } = await import(F + "lib/mail.mjs");
const none = await sendExpenseMail({ to: "j.healy@ongia.ca", subject: "x", html: "x", text: "x" });
ok("no key and no Microsoft mailbox here: skipped and said so, not thrown", none.skipped === true && /No email transport/.test(none.reason), JSON.stringify(none));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
