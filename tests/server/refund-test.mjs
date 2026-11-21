// A refund on an expense claim (Andrew 21 Nov 2026: "I cancelled one of my Air Canada flights that was refunded to my
// credit card. I need to … show that I was refunded so it minuses that amount from one of my claims"; the flight was on a
// claim already paid). A Refund line names the paid line it reverses, is kept below zero, and comes off the total.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
delete process.env.ANTHROPIC_API_KEY;
const F = REPO + "netlify/functions/";
const exp = (await import(F + "expenses.mjs")).default;
const roster = (await import(F + "roster.mjs")).default;
const X = await import(F + "lib/expenses.mjs");
const M = await import(F + "lib/expensemail.mjs");
const P = await import(F + "lib/expensepdf.mjs");
const FI = await import(F + "lib/expensefile.mjs");
const S = await import(F + "lib/store.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const as = (email, name = email) => ({ "x-expense-key": X.issueExpenseSession({ email, name }), "content-type": "application/json" });
const call = async (url, method = "GET", body, headers) => { const r = await exp(new Request("http://localhost" + url, { method, headers, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) })); const j = await r.json().catch(() => ({})); return { status: r.status, ...j }; };
await roster(new Request("http://localhost/api/roster", { headers: H }));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(300, 3)]);
const { todayIso } = await import(F + "lib/deadlines.mjs");
const day = (n) => todayIso(new Date(Date.now() + n * 86400e3));
const JOHN = as("j.healy@ongia.ca", "John Healy");

console.log("— the flight, claimed and paid");
const fl = await call(`/api/expenses?add=noreceipt`, "POST", { paidTo: "Air Canada", date: day(-30), amount: 650, category: 8, purpose: "Flight to the Summit", statement: "Booked online; the charge is on my Visa." }, JOHN);
const C1 = fl.claim.id;
await call(`/api/expenses?claim=${C1}&shot=${fl.line}`, "POST", PNG, { "x-expense-key": JOHN["x-expense-key"] });
const c1 = await S.getClaim(C1); Object.assign(c1, { status: "paid", month: "October 2026", sentAt: new Date(Date.now() - 20 * 864e5).toISOString() }); await S.putClaim(c1);

console.log("— the refund, on a new claim");
const list = await call(`/api/expenses?refundable=1`, "GET", undefined, JOHN);
const flight = list.lines?.find((l) => l.paidTo === "Air Canada");
ok("the paid flight is offered as what a refund can be of, labelled", !!flight && /^Air Canada, \w+ \d+, \$650\.00, October 2026 claim$/.test(flight.label), JSON.stringify(list.lines));
const mi = await call(`/api/expenses?add=mileage`, "POST", { date: day(-2), from: "Barrie", to: "Toronto", km: 1000, purpose: "Drive to the training" }, JOHN);
const C2 = mi.claim.id;
ok("a new claim, not the paid one", C2 !== C1);
const rf = await call(`/api/expenses?add=noreceipt&claim=${C2}`, "POST", { refund: true, refundOf: { claimId: flight.claimId, lineId: flight.lineId, label: flight.label }, paidTo: "Air Canada", date: day(-3), amount: 650, category: 8, purpose: "Refund of the cancelled flight", statement: "Refunded to my Visa when the flight was cancelled." }, JOHN);
await call(`/api/expenses?claim=${C2}&shot=${rf.line}`, "POST", PNG, { "x-expense-key": JOHN["x-expense-key"] });
const line = await S.getClaimLine(C2, rf.line);
ok("typed as 650, kept as −650, a refund, naming the flight", line.amount === -650 && line.refund === true && line.refundOf?.label === flight.label, JSON.stringify(line));
let view = (await call(`/api/expenses?claim=${C2}`, "GET", undefined, JOHN)).claim;
ok("the claim's total takes it off: 1000 km × $0.66 − $650 = $10", view.sums.total === 10 && view.sums.refunds === 1 && view.sums.refunded === 650, JSON.stringify(view.sums));
ok("the refund line needs nothing more", !view.lines.find((l) => l.id === rf.line).problems.length, JSON.stringify(view.lines.find((l) => l.id === rf.line).problems));

console.log("— a claim can't come to less than nothing");
await call(`/api/expenses?claim=${C2}&line=${rf.line}`, "PUT", { refund: true, amount: 900, paidTo: "Air Canada", date: day(-3), category: 8, purpose: "Refund of the cancelled flight", statement: "Refunded to my Visa when the flight was cancelled." }, JOHN);
let s = await call(`/api/expenses?submit=${C2}`, "POST", {}, JOHN);
ok("refunds over the expenses stop it, and say so with the minus", s.status === 409 && s.problems?.some((p) => /The refunds come to more than the expenses, so the total is −\$240\.00/.test(p)), JSON.stringify(s.problems ?? s));
ok("what it refunds is kept when only the amount changes", (await S.getClaimLine(C2, rf.line)).refundOf?.label === flight.label);
await call(`/api/expenses?claim=${C2}&line=${rf.line}`, "PUT", { refund: true, amount: 650, paidTo: "Air Canada", date: day(-3), category: 8, purpose: "Refund of the cancelled flight", statement: "Refunded to my Visa when the flight was cancelled." }, JOHN);
s = await call(`/api/expenses?submit=${C2}`, "POST", {}, JOHN);
ok("with the refund at $650 it goes, total $10", s.status === 200 && s.claim.status === "submitted" && (await S.getClaim(C2)).total === 10, JSON.stringify(s.problems ?? s.error ?? ""));
ok("a refund is never offered as something to refund", !(await call(`/api/expenses?refundable=1`, "GET", undefined, JOHN)).lines.some((l) => l.lineId === rf.line));

console.log("— what the approvers and the files say");
const claim = await S.getClaim(C2), lines = (await call(`/api/expenses?claim=${C2}`, "GET", undefined, as("president@ongia.ca", "Andrew Hammond"))).claim.lines;
const mail = M.needsApprovalMail({ claim, lines, checks: null, waitingOn: [] });
const text = mail.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
ok("the approval email lists Refund: Air Canada at −$650.00 and a total of $10.00", /Refund: Air Canada −\$650\.00/.test(text) && /Total \$10\.00/.test(text), text.slice(0, 600));
ok("the filed description says it's a refund of the flight", /^Refund of Air Canada, .*October 2026 claim: Refund of the cancelled flight/.test(FI.purposeOf(lines.find((l) => l.refund))));
const pdf = await P.claimPdf({ claim, lines, signers: [] });
ok("the claim PDF builds", pdf && pdf.length > 1000);
ok("the amount formatter writes a minus", X.dollars(-650) === "−$650.00" && X.dollars(650) === "$650.00");
ok("a refund email read by Claude matches the size of the refund", X.receiptCheck({ kind: "receipt", file: { id: "f" }, amount: -650 }, { state: "done", found: { total: 650, isReceipt: true } }).state === "match");
ok("a plain expense still can't be below zero", X.cleanLine("noreceipt", { amount: -20 }).amount === 20 && X.lineProblems({ kind: "noreceipt", amount: 0 }).includes("the amount"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
