// A presenter's per diem (Andrew 17 Nov 2026): "presenters have a per diem ... match the amounts submitted against the
// per diem limits, but I don't need you to prevent the entry. I just need you to flag it for the approvers." Board
// members have none. The rates change quarterly, so the President or the VP sets them; driving is at the km rate.
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

// The rates he gave, until someone changes them.
let r = await call("/api/expenses", "GET", undefined, JOHN);
ok("the meal rates Andrew gave: breakfast $29.95, lunch $30.55, dinner $62.70; kilometres are not part of the per diem", r.perDiem.breakfast === 29.95 && r.perDiem.lunch === 30.55 && r.perDiem.dinner === 62.7 && r.perDiem.km === undefined, JSON.stringify(r.perDiem));
ok("a board member can't change them", r.canSetPerDiem === false && (await call("/api/expenses?perdiem=1", "PUT", { lunch: 99 }, JOHN)).status === 403);
r = await call("/api/expenses?perdiem=1", "PUT", { breakfast: "29.95", lunch: "abc", dinner: "62.70", km: "0.66" }, PRES);
ok("a rate that isn't an amount is refused, saying which", r.status === 400 && /Lunch/.test(r.error), JSON.stringify(r));

await S.putEvent({ id: "pd-ev", title: "Ontario November Symposium", city: "Windsor, ON", dayOne: day(-6), lastDay: day(-5), board: [] });
await S.putPresenter({ id: "p1", eventId: "pd-ev", first: "Dana", last: "Sample", email: "dana@example.ca", organization: "Windsor Police Service", status: "signed" });

// John's own claim first: a dinner over $62.70 is not flagged, and his driving is at the board rate.
r = await call("/api/expenses?add=noreceipt", "POST", { paidTo: "The Keg", date: day(-5), amount: 80, category: 8, purpose: "Dinner", meal: "dinner", statement: "Receipt lost.", }, JOHN);
const OWN = r.claim.id;
ok("a board member's claim has no per diem: a big dinner isn't flagged", r.claim.perDiem === null && !r.claim.lines[0].overPerDiem && !(r.claim.checks?.notes ?? []).some((n) => /per diem/.test(n)), JSON.stringify(r.claim.checks));
r = await call(`/api/expenses?add=mileage&claim=${OWN}`, "POST", { date: day(-6), km: 100, from: "London", to: "Windsor", purpose: "Drive" }, JOHN);
ok("his driving is at the board's rate", r.claim.lines.find((l) => l.kind === "mileage").rate === X.mileageRate(), JSON.stringify(r.claim.lines.map((l) => l.rate)));

// Now made for a presenter: the same lines are held to the per diem, and the driving moves to $0.66.
r = await call(`/api/expenses?claim=${OWN}&for=1`, "PUT", { event: "pd-ev", presenter: "p1" }, JOHN);
const mi = r.claim.lines.find((l) => l.kind === "mileage");
ok("made Dana's: her driving stays at ONGIA's one mileage rate, the same as a board member's", mi.rate === X.mileageRate() && mi.amount === X.money(100 * X.mileageRate()) && r.claim.rate === X.mileageRate() && r.claim.perDiem.km === undefined, JSON.stringify(mi));
ok("and the $80 dinner is flagged, $17.30 over, on the line itself", r.claim.lines.find((l) => l.meal === "dinner")?.overPerDiem?.over === 17.3, JSON.stringify(r.claim.lines));
const C = OWN;
r = await call(`/api/expenses?add=noreceipt&claim=${C}`, "POST", { paidTo: "Tim Hortons", date: day(-5), amount: 12.4, category: 8, purpose: "Breakfast", meal: "breakfast", statement: "No receipt." }, JOHN);
r = await call(`/api/expenses?add=noreceipt&claim=${C}`, "POST", { paidTo: "Earls", date: day(-6), amount: 30.55, category: 8, purpose: "Lunch", meal: "lunch", statement: "No receipt." }, JOHN);
const lines = r.claim.lines;
ok("a breakfast under and a lunch exactly at the rate are not flagged", !lines.find((l) => l.meal === "breakfast").overPerDiem && !lines.find((l) => l.meal === "lunch").overPerDiem);
const flagNote = (r.claim.checks?.notes ?? []).find((n) => /per diem/.test(n));
ok("Claude's check names the meal, the amount, how far over and the rate, and leaves it to the approvers", /The Keg.*\$80\.00 for dinner, \$17\.30 over the \$62\.70 per diem\. Up to you whether to allow it\./.test(flagNote ?? ""), flagNote);
const kegId = lines.find((l) => l.paidTo === "The Keg").id;
ok("the line is lit up for the approvers with a short reason", /Over the dinner per diem by \$17\.30/.test(r.claim.checks.flags[kegId] ?? ""), JSON.stringify(r.claim.checks.flags));

// Not refused: it goes, and the approvers see it.
for (const l of await S.listClaimLines(C)) if (l.kind === "noreceipt") await exp(new Request(`http://localhost/api/expenses?claim=${C}&shot=${l.id}`, { method: "POST", headers: { "x-expense-key": JOHN["x-expense-key"] }, body: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(300, 3)]) }));
r = await call(`/api/expenses?submit=${C}`, "POST", {}, JOHN);
ok("the claim still sends: over the per diem never stops it", r.status === 200 && r.claim.status === "submitted", JSON.stringify(r.problems ?? r.error));
r = await call(`/api/expenses?claim=${C}`, "GET", undefined, PRES);
ok("the President sees the flag and the per diem on Dana's claim", r.claim.perDiem?.dinner === 62.7 && /Over the dinner per diem/.test(r.claim.checks.flags[kegId] ?? ""));
const { shownLines, checksFor } = await import(F + "lib/expenseview.mjs");
const claim = await S.getClaim(C), shown = await shownLines(claim);
const mail = M.needsApprovalMail({ claim, lines: shown, checks: await checksFor(claim, shown) });
ok("the approvers' email names it: the place, the meal, how far over and the limit", /Over the per diem: The Keg, dinner \$80\.00, \$17\.30 over the \$62\.70 limit/.test(mail.text), mail.text.slice(0, 900));

// The quarter changes: the VP raises dinner to $85; the same claim is now within it.
r = await call("/api/expenses?perdiem=1", "PUT", { breakfast: "30", lunch: "$31.00", dinner: "85", km: "0.68" }, VP);
ok("the VP can change the rates, and who did is kept", r.status === 200 && r.perDiem.dinner === 85 && r.perDiem.lunch === 31 && r.perDiem.km === undefined && r.perDiem.setBy === "Jacqulyn Taylor", JSON.stringify(r.perDiem));
r = await call(`/api/expenses?claim=${C}`, "GET", undefined, PRES);
ok("held to the new rates, nothing is over now; the check says the meals are within it", !(r.claim.checks.notes ?? []).some((n) => /per diem/.test(n)) && r.claim.checks.summary.some((s) => /All 3 meals are within the per diem/.test(s)), JSON.stringify(r.claim.checks));

// Claude's reading says which meal a food receipt was.
ok("Claude is asked which meal a receipt was, and what it says is kept", X.tidyRead({ isReceipt: true, meal: "lunch" }).meal === "lunch" && X.tidyRead({ isReceipt: true, meal: "brunch" }).meal === null);
const v = X.viewLine({ kind: "receipt", file: { name: "a.jpg" }, meal: "" }, { state: "done", found: { isReceipt: true, total: 40, meal: "dinner" } });
ok("a meal read off the receipt fills the box, marked as read; one the person set is never replaced", v.meal === "dinner" && v.fromRead.includes("meal") && X.viewLine({ kind: "receipt", file: {}, meal: "none" }, { state: "done", found: { isReceipt: true, meal: "dinner" } }).meal === "none");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
