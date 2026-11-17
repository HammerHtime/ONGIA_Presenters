// A claim for a presenter (Andrew 17 Nov 2026): presenters send a board member their receipts and the member claims
// for them ("payout goes directly to presenter"). The member builds and sends it; the President and the VP approve it
// as any claim; the VP is told to e-transfer the presenter; the presenter is told it's paid, and the member too.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
delete process.env.ANTHROPIC_API_KEY;
const F = REPO + "netlify/functions/";
const exp = (await import(F + "expenses.mjs")).default;
const roster = (await import(F + "roster.mjs")).default;
const X = await import(F + "lib/expenses.mjs");
const M = await import(F + "lib/expensemail.mjs");
const S = await import(F + "lib/store.mjs");
const { todayIso } = await import(F + "lib/deadlines.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const as = (email, name = email) => ({ "x-expense-key": X.issueExpenseSession({ email, name }), "content-type": "application/json" });
const call = async (url, method = "GET", body, headers) => { const r = await exp(new Request("http://localhost" + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
await roster(new Request("http://localhost/api/roster", { headers: H }));
const day = (n) => todayIso(new Date(Date.now() + n * 86400e3));
const JOHN = as("j.healy@ongia.ca", "John Healy"), PRES = as("president@ongia.ca", "Andrew Hammond"), VP = as("vp_operations@ongia.ca", "Jacqulyn Taylor");

await S.putEvent({ id: "xp-ev", title: "Canadian Forum - Western Symposium", city: "Victoria, BC", dayOne: day(-10), lastDay: day(-9), board: [] });
await S.putPresenter({ id: "p1", eventId: "xp-ev", first: "Parm", last: "Dhesi", email: "parm@example.ca", organization: "Vancouver Police Department", status: "signed",
  review: { ongiaCovers: { transport: true, hotel: true, meals: false, other: false } } });
await S.putPresenter({ id: "p2", eventId: "xp-ev", first: "No", last: "Email", email: "", organization: "Somewhere", status: "signed" });

let r = await call("/api/expenses?presenters=xp-ev", "GET", undefined, JOHN);
ok("a board member sees the event's presenters to pick from", r.status === 200 && r.presenters.map((p) => p.name).join() === "No Email,Parm Dhesi", JSON.stringify(r));

r = await call("/api/expenses?add=noreceipt", "POST", { paidTo: "Harbour Air", date: day(-10), amount: 240, category: 1, purpose: "Flight to Victoria", statement: "Booked by the presenter; receipt lost." }, JOHN);
const C = r.claim.id;
r = await call(`/api/expenses?claim=${C}&for=1`, "PUT", { event: "xp-ev", presenter: "p2" }, JOHN);
ok("a presenter with no email can't be paid, so the claim can't be made theirs (and says how to fix it)", r.status === 409 && /no email address on their agreement/.test(r.error));
r = await call(`/api/expenses?claim=${C}&for=1`, "PUT", { event: "xp-ev", presenter: "p1" }, JOHN);
ok("the claim is made Parm's: name, email, organization, event and what ONGIA covers", r.status === 200 && r.claim.payee.name === "Parm Dhesi" && r.claim.payee.email === "parm@example.ca" && r.claim.payee.eventTitle === "Canadian Forum - Western Symposium" && r.claim.payee.covers.hotel === true, JSON.stringify(r.claim?.payee));
ok("someone else can't change who John's claim is for", (await call(`/api/expenses?claim=${C}&for=1`, "PUT", {}, PRES)).status !== 200);

const mail = M.needsApprovalMail({ claim: await S.getClaim(C), lines: [], checks: null });
ok("the approvers' email names the presenter and who sent it, and what their agreement covers", /Expense claim for Parm Dhesi \(presenter, sent by John Healy\)/.test(mail.subject) && /Their agreement says ONGIA covers transport, hotel\./.test(mail.text), mail.subject + " | " + mail.text.slice(0, 400));

// Through approval as any claim: the President and the VP, never John.
await call(`/api/expenses?claim=${C}&shot=${(await S.listClaimLines(C))[0].id}`, "POST", undefined, JOHN);
const line = (await S.listClaimLines(C))[0];
await exp(new Request(`http://localhost/api/expenses?claim=${C}&shot=${line.id}`, { method: "POST", headers: { "x-expense-key": JOHN["x-expense-key"] }, body: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(300, 3)]) }));
r = await call(`/api/expenses?submit=${C}`, "POST", {}, JOHN);
ok("John sends it; it waits on the President and the VP as any claim", r.status === 200 && r.claim.status === "submitted" && r.claim.slots.map((s) => s.title).join() === "President,VP of Operations", JSON.stringify(r.problems ?? r.claim?.slots));
await call(`/api/expenses?decide=${C}`, "POST", { decision: "approve" }, PRES);
await call(`/api/expenses?decide=${C}`, "POST", { decision: "approve" }, VP);
const toPay = M.toPayMail({ claim: await S.getClaim(C), approvedBy: ["Andrew Hammond", "Jacqulyn Taylor"] });
ok("the VP is told to e-transfer Parm, not John", /by e-transfer to parm@example\.ca \(Parm Dhesi, the presenter\)/.test(toPay.text), toPay.text.slice(0, 500));
r = await call(`/api/expenses?pay=${C}`, "POST", { ref: "CA9XK2", date: day(0) }, VP);
const after = await S.getClaim(C);
ok("paid and locked", r.status === 200 && after.status === "paid");
const paidTo = after.mail.filter((m) => m.what === "paid").map((m) => m.to).sort().join();
ok("Parm is told it's paid, and John too", paidTo === "j.healy@ongia.ca,parm@example.ca", paidTo);
const pm = M.presenterPaidMail({ claim: after, paid: after.paid });
ok("Parm's email: what was paid, to which address, the reference, and who sent it for him; no link to an app he can't open", /Hello Parm,/.test(pm.text) && /\$240\.00/.test(pm.text) && /parm@example\.ca/.test(pm.text) && /CA9XK2/.test(pm.text) && /John Healy sent the claim for you/.test(pm.text) && !/https?:\/\//.test(pm.text.split("--")[0]), pm.text);
const jm = M.paidMail({ claim: after, payer: "Jacqulyn Taylor", paid: after.paid });
ok("John's email says it went to Parm", /paid the expense claim you made for Parm Dhesi/.test(jm.text) && /to parm@example\.ca/.test(jm.text));

const { claimStem } = await import(F + "lib/expensefile.mjs");
ok("it's filed under the presenter's name", /^Dhesi Parm - Expense claim - /.test(claimStem(after.payee.name, after.month)));

// Someone who is neither a presenter nor a board member (Andrew 17 Nov 2026: cups, merchandise): a name and an email.
r = await call("/api/expenses?add=noreceipt", "POST", { paidTo: "Mugs & More", date: day(-3), amount: 180, category: 1, purpose: "Printed cups for the Summit", statement: "Paid in cash at pickup; no receipt." }, JOHN);
const O = r.claim.id;
r = await call(`/api/expenses?claim=${O}&for=1`, "PUT", { other: { name: "Sam Rivers", email: "nope" } }, JOHN);
ok("someone else needs a real email, for the e-transfer", r.status === 400 && /email address/.test(r.error), JSON.stringify(r));
r = await call(`/api/expenses?claim=${O}&for=1`, "PUT", { other: { name: "Sam Rivers", email: "Sam@Example.ca", organization: "Rivers Print Shop" } }, JOHN);
ok("the claim is made Sam's: name, email, business; no event", r.status === 200 && r.claim.payee.kind === "other" && r.claim.payee.email === "sam@example.ca" && r.claim.payee.organization === "Rivers Print Shop" && !r.claim.payee.event, JSON.stringify(r.claim?.payee));
const oc = await S.getClaim(O);
const om = M.needsApprovalMail({ claim: oc, lines: [], checks: null });
ok("the approvers see who it's for, that they're not a presenter or board member, and who sent it", /Expense claim for Sam Rivers \(sent by John Healy\)/.test(om.subject) && /who isn't a presenter or a board member/.test(om.text), om.subject);
const opm = M.presenterPaidMail({ claim: { ...oc, total: 180 }, paid: { ref: "CA77QQ", date: day(0) } });
ok("their paid email: no event, no presenter wording", /ONGIA has paid you/.test(opm.subject) && /\$180\.00/.test(opm.text) && !/presenting|event/i.test(opm.text), opm.text);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
