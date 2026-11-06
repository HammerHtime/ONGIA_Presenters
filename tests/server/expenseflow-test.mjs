// ONGIA Expenses, stages 2 and 3 from the server's side: a claim sent, sent back with a reason, sent again, approved by
// two people, paid by the VP (which locks it), unlocked with a reason; officers handing off their approvals while away
// (never two sign-offs by one person, never the claimant); test claims and deleting them.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
delete process.env.ANTHROPIC_API_KEY;
const F = REPO + "netlify/functions/";
const exp = (await import(F + "expenses.mjs")).default;
const roster = (await import(F + "roster.mjs")).default;
const X = await import(F + "lib/expenses.mjs");
const M = await import(F + "lib/expensemail.mjs");
const S = await import(F + "lib/store.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const as = (email, name = email) => ({ "x-expense-key": X.issueExpenseSession({ email, name }), "content-type": "application/json" });
const call = async (url, method = "GET", body, headers) => { const r = await exp(new Request("http://localhost" + url, { method, headers, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) })); const ct = r.headers.get("content-type") ?? ""; return { status: r.status, ...(ct.includes("json") ? await r.json() : {}) }; };
await roster(new Request("http://localhost/api/roster", { headers: H }));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(300, 3)]);
// Days as Toronto counts them, as the app does: just after midnight UTC it is still yesterday in Toronto.
const { todayIso } = await import(F + "lib/deadlines.mjs");
const day = (n) => todayIso(new Date(Date.now() + n * 86400e3));
const JOHN = as("j.healy@ongia.ca", "John Healy"), DEREK = as("d.sullivan@ongia.ca", "Derek Sullivan");
const PRES = as("president@ongia.ca", "Andrew Hammond"), VP = as("vp_operations@ongia.ca", "Jacqulyn Taylor"), TRES = as("treasurer@ongia.ca", "Raj Jaswal"), PEG = as("executiveofficer@ongia.ca", "Peglar Artinian");
const mileage = (who, km = 100, extra = "") => call(`/api/expenses?add=mileage${extra}`, "POST", { date: day(-2), from: "Barrie", to: "Toronto", km, purpose: "Drive to the training" }, who);
const home = (who, extra = "") => call(`/api/expenses${extra}`, "GET", undefined, who);
const claimOf = (id, who) => call(`/api/expenses?claim=${id}`, "GET", undefined, who).then((r) => r.claim);
const decide = (id, who, decision, comment) => call(`/api/expenses?decide=${id}`, "POST", { decision, comment }, who);

console.log("— sending a claim");
let m = await mileage(JOHN, 312);
const C = m.claim.id;
let n = await call(`/api/expenses?add=noreceipt&claim=${C}`, "POST", { paidTo: "Green P", date: day(-1), amount: 18, category: 8, purpose: "Parking" }, JOHN);
const NL = n.line;
let s = await call(`/api/expenses?submit=${C}`, "POST", {}, JOHN);
ok("a line still missing things stops it, and says which", s.status === 409 && s.problems.some((p) => /Green P .* still needs a reason there's no receipt and a screenshot of the card statement/.test(p)), JSON.stringify(s));
await call(`/api/expenses?claim=${C}&line=${NL}`, "PUT", { paidTo: "Green P", date: day(3), amount: 18, category: 8, purpose: "Parking", statement: "No receipt from the machine; it is on my Visa." }, JOHN);
await call(`/api/expenses?claim=${C}&shot=${NL}`, "POST", PNG, { "x-expense-key": JOHN["x-expense-key"] });
s = await call(`/api/expenses?submit=${C}`, "POST", {}, JOHN);
ok("a date that hasn't come yet stops it (a day's grace for further east)", s.status === 409 && s.problems.some((p) => /hasn't come yet/.test(p)));
await call(`/api/expenses?claim=${C}&line=${NL}`, "PUT", { paidTo: "Green P", date: day(-1), amount: 18, category: 8, purpose: "Parking", statement: "No receipt from the machine; it is on my Visa." }, JOHN);
s = await call(`/api/expenses?submit=${C}`, "POST", {}, JOHN);
ok("complete, it goes: waiting for the President and the Treasurer", s.status === 200 && s.claim.status === "submitted" && s.claim.slots.map((x) => `${x.title}:${x.name}`).join() === "President:Andrew Hammond,Treasurer:Raj Jaswal", JSON.stringify(s.claim?.slots));
ok("its total and month are kept on it: 312 km × $0.62 + $18 = $211.44", s.claim.sums.total === 211.44 && (await S.getClaim(C)).total === 211.44 && /\d{4}$/.test((await S.getClaim(C)).month));
ok("once sent John can't change it", (await call(`/api/expenses?claim=${C}&line=${NL}`, "PUT", { amount: 1 }, JOHN)).status === 409);
ok("each approver was emailed (here no mail is set up, so it's recorded as not sent, for the officers to see)", (await S.getClaim(C)).mail.filter((x) => x.what === "to approve").map((x) => x.to).sort().join() === "president@ongia.ca,treasurer@ongia.ca" && (await claimOf(C, PRES)).mailFailed.length === 2);
ok("John doesn't see the email detail", (await claimOf(C, JOHN)).mailFailed.length === 0);

console.log("— who sees it");
let hp = await home(PRES), ht = await home(TRES), hv = await home(VP), hpeg = await home(PEG), hj = await home(JOHN);
ok("it waits on the President and the Treasurer", hp.toApprove.some((c) => c.id === C) && ht.toApprove.some((c) => c.id === C));
ok("the VP isn't asked to approve it, but sees it under all claims", !hv.toApprove.some((c) => c.id === C) && hv.all.some((c) => c.id === C && c.words === "Waiting for approval"));
ok("the officers have the To approve and All claims tabs; John and Peglar don't", hp.tabs.join() === "claim,past,approve,all" && hv.tabs.join() === "claim,past,approve,all" && hj.tabs.join() === "claim,past" && hpeg.tabs.join() === "claim,past");
ok("John's home: nothing being built, the sent claim under past, waiting", hj.current === null && hj.past[0].id === C && hj.past[0].words === "Waiting for approval");
ok("another board member can't open it", (await call(`/api/expenses?claim=${C}`, "GET", undefined, DEREK)).status === 403);
ok("Peglar can't either, while he isn't standing in for anyone", (await call(`/api/expenses?claim=${C}`, "GET", undefined, PEG)).status === 403);
const chk = (await claimOf(C, PRES)).checks;
ok("the approver gets Claude's check with it, in sentences", chk.summary.join(". ") === "Mileage is at $0.62 a kilometre. The line with no receipt has a reason and the card statement", JSON.stringify(chk.summary));
// Andrew, 3 Nov 2026: a card statement's amount can't be confirmed; it is flagged for the approvers, and the claim still goes.
ok("…and the no-receipt amount is flagged as not confirmed, not passed as checked", chk.ok === false && chk.notes.length === 1 && chk.notes[0] === "Green P: no receipt, so $18.00 isn't confirmed. Check it against the card statement.", JSON.stringify(chk.notes));

console.log("— approving, and sending back");
ok("John can't approve his own", (await decide(C, JOHN, "approve")).status === 403);
ok("nor can the VP: it isn't hers to sign", (await decide(C, VP, "approve")).status === 403);
let d = await decide(C, PRES, "approve");
ok("the President approves: one of two, still waiting for the Treasurer", d.status === 200 && d.claim.status === "submitted" && d.claim.slots.find((x) => x.role === "president").done && !d.claim.slots.find((x) => x.role === "treasurer").done);
ok("and can't approve twice", (await decide(C, PRES, "approve")).status === 403);
ok("it leaves the President's To approve", !(await home(PRES)).toApprove.some((c) => c.id === C));
ok("sending back needs a reason", (await decide(C, TRES, "reject", "")).status === 400);
d = await decide(C, TRES, "reject", "Parking was covered by the venue. Please take it off.");
ok("the Treasurer sends it back with the reason; the President's approval is cleared", d.status === 200 && d.claim.status === "rejected" && d.claim.rejected.comment.startsWith("Parking was covered") && d.claim.slots.every((x) => !x.done));
hj = await home(JOHN);
ok("John's home: it's in front of him again, with the reason, and he can change it", hj.current?.id === C && hj.current.status === "rejected" && /venue/.test(hj.current.rejected.comment) && hj.current.canEdit);
ok("John was emailed", (await S.getClaim(C)).mail.some((x) => x.what === "sent back" && x.to === "j.healy@ongia.ca"));
ok("it no longer waits on anyone", !(await home(PRES)).toApprove.some((c) => c.id === C) && !(await home(TRES)).toApprove.some((c) => c.id === C));
await call(`/api/expenses?claim=${C}&line=${NL}`, "DELETE", undefined, JOHN);
s = await call(`/api/expenses?submit=${C}`, "POST", {}, JOHN);
ok("John takes the parking off and sends it again: $193.44, both sign-offs fresh", s.claim.status === "submitted" && s.claim.sums.total === 193.44 && s.claim.slots.every((x) => !x.done) && (await S.getClaim(C)).round === 2);
ok("the history tells the story", (await S.getClaim(C)).history.map((x) => x.what).join() === "sent,approved,sent back,sent again");

console.log("— approved, then paid by the VP");
await decide(C, TRES, "approve");
d = await decide(C, PRES, "approve");
ok("both approve: approved", d.claim.status === "approved" && d.claim.slots.every((x) => x.done));
ok("John is told, and the VP is asked to pay", (await S.getClaim(C)).mail.some((x) => x.what === "approved" && x.to === "j.healy@ongia.ca") && (await S.getClaim(C)).mail.some((x) => x.what === "to pay" && x.to === "vp_operations@ongia.ca"));
ok("it is on the VP's To pay list", (await home(VP)).toPay.some((c) => c.id === C));
ok("the VP records payments, not the Treasurer or the President", (await call(`/api/expenses?pay=${C}`, "POST", { ref: "C1Ag4Yqu34yB" }, TRES)).status === 403 && /Jacqulyn Taylor records the payments/.test((await call(`/api/expenses?pay=${C}`, "POST", { ref: "C1Ag4Yqu34yB" }, PRES)).error));
ok("a reference that isn't one is refused", (await call(`/api/expenses?pay=${C}`, "POST", { ref: "x" }, VP)).status === 400);
let p = await call(`/api/expenses?pay=${C}`, "POST", { ref: "C1Ag 4Yqu34yB", date: day(0) }, VP);
ok("the VP pays: paid and locked, the reference kept without its space", p.status === 200 && p.claim.status === "paid" && p.claim.paid.ref === "C1Ag4Yqu34yB" && p.claim.paid.by.name === "Jacqulyn Taylor");
ok("John is told it's paid", (await S.getClaim(C)).mail.some((x) => x.what === "paid" && x.to === "j.healy@ongia.ca"));
ok("paid twice? no", (await call(`/api/expenses?pay=${C}`, "POST", { ref: "ABCD1234" }, VP)).status === 409);
ok("John's past claim says paid", (await home(JOHN)).past.find((c) => c.id === C).words === "Paid");

console.log("— unlocking");
ok("the Treasurer can't unlock it", (await call(`/api/expenses?unlock=${C}`, "POST", { reason: "Wrong number typed" }, TRES)).status === 403);
ok("the President needs a reason", (await call(`/api/expenses?unlock=${C}`, "POST", { reason: "" }, PRES)).status === 400);
let u = await call(`/api/expenses?unlock=${C}`, "POST", { reason: "The reference number was typed wrong." }, PRES);
ok("unlocked: back to approved, the old payment kept in the history, the VP told", u.claim.status === "approved" && !u.claim.paid && (await S.getClaim(C)).history.at(-1).paid.ref === "C1Ag4Yqu34yB" && (await S.getClaim(C)).mail.some((x) => x.what === "unlocked" && x.to === "vp_operations@ongia.ca"));
p = await call(`/api/expenses?pay=${C}`, "POST", { ref: "C1Ag4Yqu34yC" }, VP);
ok("and paid again with the right number", p.claim.status === "paid" && p.claim.paid.ref === "C1Ag4Yqu34yC");

console.log("— the VP's own claim");
m = await mileage(VP, 50);
const VC = m.claim.id;
s = await call(`/api/expenses?submit=${VC}`, "POST", {}, VP);
ok("it goes to the President and the Treasurer", s.claim.slots.map((x) => x.role).join() === "president,treasurer");
await decide(VC, PRES, "approve"); await decide(VC, TRES, "approve");
p = await call(`/api/expenses?pay=${VC}`, "POST", { ref: "VPOWN1234" }, VP);
ok("once both have approved, she records her own e-transfer (Andrew's call)", p.claim.status === "paid");

console.log("— handing off: the rules, without a server");
const T = day(0);
const away = (to, backup = "", from = T, until = day(10)) => ({ to, backup, from, until });
const P = "president@ongia.ca", V = "vp_operations@ongia.ca", R = "treasurer@ongia.ca", PG = "executiveofficer@ongia.ca", J = "j.healy@ongia.ca";
const who = (owner, aways, decided) => X.holders(owner, aways, T, decided).map((x) => x.email).join();
ok("Raj away, Jacqulyn standing in: a board member's claim goes to Andrew and Jacqulyn", who("d.sullivan@ongia.ca", { treasurer: away(V, PG) }) === `${P},${V}`);
ok("…the President's claim: the VP's alone, so Raj being away doesn't touch it", who(P, { treasurer: away(V, PG) }) === `${V}`);
ok("…Jacqulyn's own claim: not to her, to Peglar", who(V, { treasurer: away(V, PG) }) === `${P},${PG}`);
ok("Andrew away to Jacqulyn: Raj's claim (Andrew and Jacqulyn sign it) goes to Jacqulyn and Peglar", who(R, { president: away(V, PG) }) === `${PG},${V}`);
ok("Andrew and Raj both away, both to Jacqulyn: a board member's claim is Jacqulyn and Raj's second person, never Jacqulyn twice", who("d.sullivan@ongia.ca", { president: away(V, PG), treasurer: away(V, J) }) === `${V},${J}`);
ok("a stand-in who is away themselves is passed over", who("d.sullivan@ongia.ca", { president: away(V, PG), vp: away(R) }) === `${PG},${R}`);
ok("with no one who can take it, it stays with the officer (and says so)", (() => { const h = X.holders(R, { president: away(V) }, T); return h.find((x) => x.role === "president").email === P && h.find((x) => x.role === "president").stuck; })());
ok("John standing in can't sign off his own claim: it goes to the second person", who(J, { president: away(J, PG) }) === `${PG},${R}`);
ok("a hand-off that's over: the officer again", who("d.sullivan@ongia.ca", { treasurer: away(V, PG, day(-10), day(-1)) }) === `${P},${R}`);
ok("a sign-off already given stays with whoever gave it, hand-off or not", who("d.sullivan@ongia.ca", { treasurer: away(V, PG) }, { treasurer: { email: R } }) === `${P},${R}`);
ok("payments: the VP; while she's away, her stand-in; on the stand-in's own claim, her second person", X.payerOf("d.sullivan@ongia.ca", {}, T).email === V && X.payerOf("d.sullivan@ongia.ca", { vp: away(P, R) }, T).email === P && X.payerOf(P, { vp: away(P, R) }, T).email === R);
const names = { [P]: "Andrew Hammond", [V]: "Jacqulyn Taylor", [R]: "Raj Jaswal", [PG]: "Peglar Artinian", [J]: "John Healy" };
const prev = X.awayPreview("president", away(V, PG), {}, T, (e) => names[e] ?? e);
ok("the preview Andrew sees before saving: who takes which", prev.map((r) => `${r.label} → ${names[r.email]}`).join(" | ") === "Board members' claims → Jacqulyn Taylor | Jacqulyn Taylor's claims → Peglar Artinian | Raj Jaswal's claims → Peglar Artinian", prev.map((r) => `${r.label} → ${r.email}`).join(" | "));
const prevVP = X.awayPreview("vp", away(P, R), {}, T, (e) => names[e] ?? e);
ok("the VP's preview includes the payments", prevVP.some((r) => r.label === "Recording payments" && r.email === P) && prevVP.some((r) => r.label === "Paying Andrew Hammond's own claims"));
ok("the stand-in has to be an executive, not yourself", !!X.cleanAway("treasurer", { to: "d.sullivan@ongia.ca", until: day(5) }).problem && !!X.cleanAway("treasurer", { to: R, until: day(5) }).problem && !X.cleanAway("treasurer", { to: J, until: day(5) }).problem);
ok("the second person can't be you or the stand-in", !!X.cleanAway("treasurer", { to: V, backup: V, until: day(5) }).problem && !!X.cleanAway("treasurer", { to: V, backup: R, until: day(5) }).problem);
ok("dates: up to 60 days, the last day not before the first, not already over", !!X.cleanAway("president", { to: V, from: T, until: day(70) }).problem && !!X.cleanAway("president", { to: V, from: day(5), until: day(2) }).problem && !!X.cleanAway("president", { to: V, from: day(-9), until: day(-2) }).problem && !X.cleanAway("president", { to: V, from: day(2), until: day(16) }).problem);

console.log("— handing off, in the app");
m = await mileage(DEREK, 80);
const DC = m.claim.id;
await call(`/api/expenses?submit=${DC}`, "POST", {}, DEREK);
ok("only that officer or the President can set one", (await call(`/api/expenses?away=president`, "PUT", { to: V, until: day(5) }, TRES)).status === 403 && (await call(`/api/expenses?away=treasurer`, "PUT", { to: V, until: day(5) }, DEREK)).status === 403);
let a = await call(`/api/expenses?away=treasurer`, "PUT", { to: PG, backup: J, until: day(14) }, TRES);
ok("Raj hands off to Peglar for two weeks", a.status === 200 && a.away.treasurer.toName === "Peglar Artinian" && a.away.treasurer.inForce);
ok("Peglar is told, with one claim waiting for him now; John as the second person too", (await S.getAway("treasurer")).mail.map((x) => x.to).join() === `${PG},${J}`);
const peg = await home(PEG);
ok("Peglar now has To approve, with Derek's claim in it, as the Treasurer's stand-in", peg.tabs.includes("approve") && peg.toApprove.some((c) => c.id === DC && c.as === "for the Treasurer") && peg.standingIn[0].title === "Treasurer");
ok("and it's gone from Raj's list", !(await home(TRES)).toApprove.some((c) => c.id === DC));
ok("Raj himself can't approve it while it's handed off", (await decide(DC, TRES, "approve")).status === 403);
d = await decide(DC, PEG, "approve");
ok("Peglar approves, recorded as him for the Treasurer", (await S.getClaim(DC)).signed_treasurer.name === "Peglar Artinian" && (await S.getClaim(DC)).signed_treasurer.for === "Treasurer");
const back = await call(`/api/expenses?away=treasurer`, "DELETE", undefined, TRES);
ok("I'm back answers with the hand-off gone (not as it was a moment before)", back.away.treasurer === null);
ok("Raj is back: the hand-off is gone, Peglar's approval stands", !(await S.getAway("treasurer")) && (await claimOf(DC, TRES)).slots.find((x) => x.role === "treasurer").name === "Peglar Artinian");
d = await decide(DC, PRES, "approve");
ok("approved with Peglar for the Treasurer", d.claim.status === "approved");
a = await call(`/api/expenses?away=vp`, "PUT", { to: P, backup: R, until: day(3) }, PRES);
ok("Andrew can set one for Jacqulyn if she forgot", a.status === 200 && a.away.vp.toName === "Andrew Hammond");
ok("while she's away, Andrew records the payment", (await home(PRES)).toPay.some((c) => c.id === DC) && (await call(`/api/expenses?pay=${DC}`, "POST", { ref: "STANDIN99" }, VP)).status === 403);
p = await call(`/api/expenses?pay=${DC}`, "POST", { ref: "STANDIN99" }, PRES);
ok("Andrew pays it as her stand-in", p.claim.status === "paid" && p.claim.paid.for === "VP of Operations");
await call(`/api/expenses?away=vp`, "DELETE", undefined, PRES);
const pv = await call(`/api/expenses?awaypreview=president&to=${V}&backup=${PG}&until=${day(5)}`, "GET", undefined, PRES);
ok("the app's preview answers with names", pv.rows[0].name === "Jacqulyn Taylor" && pv.rows.length === 3);

console.log("— test claims");
m = await mileage(JOHN, 10, "&test=1");
const TC = m.claim.id;
ok("in test mode, a separate claim marked TEST", m.claim.test === true && /-t\d+$/.test(TC));
await mileage(JOHN, 20);
ok("John's real claim and test claim stay apart", (await home(JOHN)).current.test === false && (await home(JOHN, "?test=1")).current.id === TC);
await call(`/api/expenses?submit=${TC}`, "POST", {}, JOHN);
const mail = M.needsApprovalMail({ claim: { ...(await S.getClaim(TC)), sums: { mileage: 1 } }, lines: await S.listClaimLines(TC), checks: { ok: true } });
ok("its emails say [TEST] and say it's a test", mail.subject === "[TEST] Expense claim for John Healy" && /Test claim\. Every step comes back to you/.test(mail.text), mail.subject);
ok("only the President can delete the test claims", (await call(`/api/expenses?purge=tests`, "POST", {}, TRES)).status === 403);
ok("only the President can mark one", (await call(`/api/expenses?marktest=${DC}`, "POST", { on: true }, TRES)).status === 403);
await call(`/api/expenses?marktest=${DC}`, "POST", { on: true }, PRES);
let pg = await call(`/api/expenses?purge=tests`, "POST", {}, PRES);
ok("the President deletes them: John's test claim, and Derek's he marked", pg.status === 200 && pg.purged.claims === 2 && !(await S.getClaim(TC)) && !(await S.getClaim(DC)));
ok("its lines and card statements went with it", (await S.listClaimLines(TC)).length === 0 && (await S.listClaimLines(DC)).length === 0);
ok("real claims stay", !!(await S.getClaim(C)) && (await home(JOHN)).current.test === false);
const JD = (await home(JOHN)).current.id;
ok("John can delete his own draft", (await call(`/api/expenses?claim=${JD}`, "DELETE", undefined, JOHN)).status === 200 && !(await S.getClaim(JD)));
ok("but not a claim once it's approved or paid", (await call(`/api/expenses?claim=${C}`, "DELETE", undefined, JOHN)).status === 403);

console.log("— Claude's check for the approver");
const L = (x) => ({ kind: "receipt", paidTo: "Delta", date: "2026-11-02", amount: 100, check: { state: "match", total: 100 }, ...x });
let ch = X.claimChecks([L(), L({ paidTo: "Staples", amount: 90, check: { state: "differs", total: 112.06 } })], { month: "November 2026" });
ok("a receipt that says something else is named", !ch.ok && /Staples: the receipt says \$112\.06, and \$90\.00 is claimed/.test(ch.notes[0]));
ch = X.claimChecks([L()], { month: "November 2026", earlier: [L()] });
ok("the same thing claimed before is named", /claimed before/.test(ch.notes[0]));
ch = X.claimChecks([L({ date: "2026-08-15" })], { month: "November 2026" });
ok("a date more than two months back is named; last month's isn't", /more than two months before November 2026/.test(ch.notes[0]) && X.claimChecks([L({ date: "2026-10-12" })], { month: "November 2026" }).ok);
ch = X.claimChecks([L({ check: { state: "match", total: 100, currency: "USD" } })], { month: "November 2026" });
ok("US dollars are named", /in USD/.test(ch.notes[0]));

console.log("— the emails say what happened");
const cl = { id: "abc-1", owner: { name: "John Healy", email: J }, month: "November 2026", total: 193.44, sums: { receipts: 2, mileage: 1 } };
const items = [{ kind: "receipt", paidTo: "Staples", date: "2026-11-04", amount: 63.06 }, { kind: "mileage", from: "Barrie", to: "Toronto", date: "2026-11-01", amount: 117.18 }, { kind: "receipt", paidTo: "Delta Hotels Toronto Airport & Conference Centre", date: "2026-11-02", amount: 13.2 }];
let e = M.needsApprovalMail({ claim: cl, lines: items, checks: { ok: false, notes: ["x", "y"] }, waitingOn: ["President Andrew Hammond", "Jacqulyn Taylor for the Treasurer"], acting: "Treasurer", until: day(14) });
ok("to approve (Andrew, 3 Nov 2026): subject Expense claim for John Healy, who sent it, the items by date, one line each with the amount, the total", e.subject === "Expense claim for John Healy" && /John Healy has submitted an expense claim for the following:\n\nMileage: Barrie to Toronto   \$117\.18\nDelta Hotels Toronto Airport…   \$13\.20\nStaples   \$63\.06\nTotal   \$193\.44/.test(e.text), e.text);
ok("…what's flagged, who it waits on, standing in, and Review to the claim", /Two things are flagged to check/.test(e.text) && /Waiting on approval from President Andrew Hammond and Jacqulyn Taylor for the Treasurer\./.test(e.text) && /standing in for the Treasurer until/.test(e.text) && /Review: \S*\/expenses#claim=abc-1/.test(e.text) && />Review</.test(e.html));
ok("…and in the HTML the items are a table, not a paragraph", /<table role="presentation"[^>]*table-layout:fixed/.test(e.html) && !/<p[^>]*><table/.test(e.html));
e = M.toPayMail({ claim: cl, approvedBy: ["the President", "the Treasurer"] });
ok("to pay: Expense claim for John Healy, approved by the President and the Treasurer, ready to be paid, how much to whom", e.subject === "Expense claim for John Healy" && /The expense claim for John Healy has been approved by the President and the Treasurer and is ready to be paid\./.test(e.text) && /\$193\.44 by e-transfer to j\.healy@ongia\.ca/.test(e.text) && /Record the payment: /.test(e.text));
e = M.sentBackMail({ claim: cl, by: "Raj Jaswal (Treasurer)", comment: "Parking was covered." });
ok("sent back: by whom, the note, what to do", /Raj Jaswal \(Treasurer\) sent back/.test(e.text) && /Parking was covered/.test(e.text) && e.subject === "Your November 2026 expense claim was sent back");
e = M.paidMail({ claim: cl, payer: "Jacqulyn Taylor", paid: { ref: "C1Ag4Yqu34yB", date: "2026-11-06" } });
ok("paid: who, when, the transaction number", /Jacqulyn Taylor paid your November 2026 expense claim, \$193\.44, by e-transfer on Fri 6 Nov 2026/.test(e.text) && /Transaction number: C1Ag4Yqu34yB/.test(e.text), e.text);
e = M.handoffMail({ from: "Raj Jaswal", title: "Treasurer", d: { from: "2026-11-05", until: "2026-11-19" }, waiting: 2 });
ok("hand-off: who, what, the dates, how many are waiting", /Raj Jaswal is away from Thu 5 Nov 2026 to Thu 19 Nov 2026 and has handed you the Treasurer's expense approvals/.test(e.text) && /Two claims are waiting/.test(e.text));
e = M.handoffMail({ from: "Raj Jaswal", title: "Treasurer", d: { from: "2026-11-05", until: "2026-11-19" }, isBackup: true, standIn: "Jacqulyn Taylor" });
ok("the second person's subject doesn't call them the stand-in", /^If Jacqulyn Taylor can't take one: the Treasurer's approvals/.test(e.subject) && /it comes to you instead/.test(e.text));

console.log("— practice: a test claim comes back to the one who made it (Andrew, 3 Nov 2026)");
{
  const BK = as("b.konkle@ongia.ca", "Barb Konkle"), me = "b.konkle@ongia.ca";
  const yday = new Date(Date.now() - 86400e3).toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
  ok("routing: practice sends every sign-off and the payment to the maker", X.holders(me, {}, undefined, {}, { practice: true }).every((x) => x.email === me && x.practice) && X.payerOf(me, {}, undefined, { practice: true }).email === me);
  const made = await call("/api/expenses?add=noreceipt&test=1", "POST", { paidTo: "Barb Konkle", date: yday, amount: 250, category: 10, purpose: "Practice stipend" }, BK);
  const TC = made.claim.id;
  ok("made in test mode, it's a test claim", made.claim.test === true);
  const sub = await call(`/api/expenses?submit=${TC}`, "POST", {}, BK);
  ok("sent: both sign-offs are hers, marked practice", sub.claim?.status === "submitted" && sub.claim.slots.length === 2 && sub.claim.slots.every((x) => x.email === me && x.practice), JSON.stringify(sub.claim?.slots ?? sub));
  ok("the 'to approve' emails go to her, none to the officers", (await S.getClaim(TC)).mail.filter((x) => x.what === "to approve").every((x) => x.to === me));
  const home = await call("/api/expenses", "GET", undefined, BK);
  ok("it waits in her own To approve, and she gets the tab", home.toApprove?.some((c) => c.id === TC) && home.tabs.includes("approve"));
  ok("…and not in the President's or the Treasurer's stand-in's", !(await call("/api/expenses", "GET", undefined, PRES)).toApprove.some((c) => c.id === TC) && !(await call("/api/expenses", "GET", undefined, PEG)).toApprove.some((c) => c.id === TC));
  const d1 = await call(`/api/expenses?decide=${TC}`, "POST", { decision: "approve" }, BK);
  ok("she approves once, as the first role; the second still waits on her, as practice", d1.claim.status === "submitted" && d1.claim.slots.filter((x) => x.done).length === 1 && d1.claim.can.decide?.practice === true);
  const d2 = await call(`/api/expenses?decide=${TC}`, "POST", { decision: "approve" }, BK);
  ok("…approves again, as the second: approved, and the payment is hers to record", d2.claim.status === "approved" && d2.claim.can.pay && d2.claim.payer.practice);
  ok("the VP isn't asked to pay it; the 'to pay' email is hers", !(await call("/api/expenses", "GET", undefined, VP)).toPay.some((c) => c.id === TC) && (await S.getClaim(TC)).mail.filter((x) => x.what === "to pay").every((x) => x.to === me));
  const pd = await call(`/api/expenses?pay=${TC}`, "POST", { ref: "TEST123" }, BK);
  ok("a pretend reference locks it, paid", pd.claim?.status === "paid" && pd.claim.paid.ref === "TEST123", JSON.stringify(pd).slice(0, 200));
  ok("the history says the approvals were practice", (await S.getClaim(TC)).history.filter((h) => h.what === "approved").every((h) => /for practice/.test(h.as)));
  const real = await call("/api/expenses?add=noreceipt", "POST", { paidTo: "Barb Konkle", date: yday, amount: 250, category: 10, purpose: "Real stipend" }, BK);
  const rs = await call(`/api/expenses?submit=${real.claim.id}`, "POST", {}, BK);
  ok("a real claim from her still goes to two real approvers, never to her", rs.claim?.status === "submitted" && rs.claim.slots.every((x) => x.email !== me && !x.practice), JSON.stringify(rs.claim?.slots));
  ok("one 'to approve' email, not one per role: both sign-offs are hers", (await S.getClaim(TC)).mail.filter((x) => x.what === "to approve").length === 1);
  const am = M.needsApprovalMail({ claim: { ...made.claim, test: true, owner: { name: "Barb Konkle" }, total: 250 }, lines: [], checks: null, waitingOn: ["the President", "the Treasurer"], practice: true });
  ok("the practice email says it waits on the President and the Treasurer, both her, and that every step comes back to her", /Waiting on approval from the President and the Treasurer \(both you, for practice\)/.test(am.text) && /Every step comes back to you/.test(am.text), am.text);
}

console.log("— a test claim's lines onto the real claim, without uploading again (Andrew 6 Nov 2026)");
{
  const DS = as("d.sullivan@ongia.ca", "Derek Sullivan");
  const t1 = await call("/api/expenses?add=receipt&test=1", "POST", PNG, { ...DS, "content-type": "image/png", "x-file-name": "aircanada1.png" });
  const TCx = t1.claim.id;
  await call(`/api/expenses?add=receipt&claim=${TCx}`, "POST", PNG, { ...DS, "content-type": "image/png", "x-file-name": "aircanada2.png" });
  await call(`/api/expenses?add=receipt&claim=${TCx}`, "POST", PNG, { ...DS, "content-type": "image/png", "x-file-name": "aircanada3.png" });
  await call("/api/expenses?add=receipt", "POST", PNG, { ...DS, "content-type": "image/png", "x-file-name": "aircanada4.png" });
  const realBefore = (await home(DS)).current;
  ok("three on the test claim, one on the real claim", (await S.listClaimLines(TCx)).length === 3 && realBefore.lines.length === 1);
  ok("someone else can't move them", (await call(`/api/expenses?claim=${TCx}&toreal=1`, "POST", {}, JOHN)).status >= 403);
  const mv = await call(`/api/expenses?claim=${TCx}&toreal=1`, "POST", {}, DS);
  const real = (await home(DS)).current;
  ok("moved: all four on the real claim, which isn't a test", mv.status === 200 && mv.moved === 3 && real.id === realBefore.id && real.lines.length === 4 && !real.test, JSON.stringify(mv).slice(0, 200));
  const files = await Promise.all((await S.listClaimLines(real.id)).map((l) => S.getClaimFile("file", real.id, l.id)));
  ok("each receipt came with it, nothing to upload again", files.every((f) => f && f.bytes.byteLength === PNG.length) && files.map((f) => f.name).sort().join() === "aircanada1.png,aircanada2.png,aircanada3.png,aircanada4.png", JSON.stringify(files.map((f) => f?.name)));
  ok("the emptied test claim is gone", !(await S.getClaim(TCx)) && (await S.listClaimLines(TCx)).length === 0);
  ok("a real claim can't be 'moved to real'", (await call(`/api/expenses?claim=${real.id}&toreal=1`, "POST", {}, DS)).status === 409);
}

console.log("— one receipt's Test data box unticked: just that one moves");
{
  const BK2 = as("b.konkle@ongia.ca", "Barb Konkle");
  const a = await call("/api/expenses?add=receipt&test=1", "POST", PNG, { ...BK2, "content-type": "image/png", "x-file-name": "one.png" });
  const TCy = a.claim.id;
  await call(`/api/expenses?add=receipt&claim=${TCy}`, "POST", PNG, { ...BK2, "content-type": "image/png", "x-file-name": "two.png" });
  const [l1] = (await S.listClaimLines(TCy)).filter((l) => l.file?.name === "one.png");
  const one = await call(`/api/expenses?claim=${TCy}&toreal=1&line=${l1.id}`, "POST", {}, BK2);
  const realB = (await home(BK2)).current;
  ok("only that receipt moved; the other stays on the test claim, still in test mode", one.status === 200 && one.moved === 1 && !one.emptied && one.current?.id === TCy && realB.lines.length === 1 && (await S.listClaimLines(TCy)).length === 1, JSON.stringify(one).slice(0, 160));
  ok("its receipt came with it", (await S.getClaimFile("file", realB.id, realB.lines[0].id))?.name === "one.png");
  const [l2] = await S.listClaimLines(TCy);
  const last = await call(`/api/expenses?claim=${TCy}&toreal=1&line=${l2.id}`, "POST", {}, BK2);
  ok("the last one: the test claim goes, and it's back on the real claim", last.emptied === true && !(await S.getClaim(TCy)) && (await home(BK2)).current.lines.length === 2);
}

console.log("— the President's own claim: to the VP alone (Andrew 6 Nov 2026)");
{
  const pm = await mileage(PRES, 50);
  const PC = pm.claim.id;
  const ps = await call(`/api/expenses?submit=${PC}`, "POST", {}, PRES);
  ok("it waits on the VP and nobody else", ps.status === 200 && ps.claim.slots.map((x) => `${x.title}:${x.name}`).join() === "VP of Operations:Jacqulyn Taylor", JSON.stringify(ps.claim?.slots));
  ok("the Treasurer isn't asked", !(await home(TRES)).toApprove.some((c) => c.id === PC));
  const pd = await decide(PC, VP, "approve");
  ok("once the VP approves, it's approved and waits on payment", pd.status === 200 && (await S.getClaim(PC)).status === "approved", JSON.stringify(pd).slice(0, 200));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
