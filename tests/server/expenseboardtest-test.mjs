// The board's test of ONGIA Expenses (Andrew 3 Nov 2026: "test this with a bunch of the other board members ... then I
// can just clear all the data and all the receipts that have been used until the day I tell you as test data"). While
// the President's switch is on, every claim sent is marked BOARD TEST, in the app and its emails, and filed with the
// test claims; Clear deletes every claim made up to the day he picks, from everyone. Made-up claims, no real email.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
delete process.env.ANTHROPIC_API_KEY;
const F = REPO + "netlify/functions/";
const exp = (await import(F + "expenses.mjs")).default;
const roster = (await import(F + "roster.mjs")).default;
const X = await import(F + "lib/expenses.mjs");
const M = await import(F + "lib/expensemail.mjs");
const XF = await import(F + "lib/expensefile.mjs");
const S = await import(F + "lib/store.mjs");
const { todayIso } = await import(F + "lib/deadlines.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const as = (email, name = email) => ({ "x-expense-key": X.issueExpenseSession({ email, name }), "content-type": "application/json" });
const call = async (url, method = "GET", body, headers) => { const r = await exp(new Request("http://localhost" + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })); const ct = r.headers.get("content-type") ?? ""; return { status: r.status, ...(ct.includes("json") ? await r.json() : {}) }; };
await roster(new Request("http://localhost/api/roster", { headers: { "x-admin-key": "testkey" } }));
const day = (n) => todayIso(new Date(Date.now() + n * 86400e3));
const JOHN = as("j.healy@ongia.ca", "John Healy"), DEREK = as("d.sullivan@ongia.ca", "Derek Sullivan");
const PRES = as("president@ongia.ca", "Andrew Hammond"), TRES = as("treasurer@ongia.ca", "Raj Jaswal");
const mileage = (who) => call("/api/expenses?add=mileage", "POST", { date: day(-1), from: "Barrie", to: "Toronto", km: 100, purpose: "Drive to the training" }, who);
const home = (who) => call("/api/expenses", "GET", undefined, who);

console.log("— the switch");
ok("off to start: no board test", (await home(PRES)).boardTest === null);
ok("only the President can turn it on", (await call("/api/expenses?boardtest=1", "POST", { on: true }, TRES)).status === 403);
let h = await call("/api/expenses?boardtest=1", "POST", { on: true }, PRES);
ok("the President turns it on, and everyone's app knows since when", h.boardTest?.on === true && !!h.boardTest.since && (await home(JOHN)).boardTest?.on === true);

console.log("— a claim sent while it's on");
const j = (await mileage(JOHN)).claim;
ok("a claim started now is marked as a board test", j.trial === true && !j.test);
const sent = await call(`/api/expenses?submit=${j.id}`, "POST", {}, JOHN);
ok("sent, it goes to the real people, marked", sent.claim?.status === "submitted" && sent.claim.trial === true && sent.claim.slots.map((x) => x.name).join() === "Andrew Hammond,Jacqulyn Taylor", JSON.stringify(sent.claim?.slots));
ok("…and the President's To approve shows it as a board test", (await home(PRES)).toApprove.find((c) => c.id === j.id)?.trial === true);
const stored = await S.getClaim(j.id);
const ask = M.needsApprovalMail({ claim: stored, lines: [], waitingOn: ["Andrew Hammond"] });
ok("its emails say BOARD TEST in the subject, and that no money is sent", /^\[BOARD TEST\] /.test(ask.subject) && /Board test\. This claim is part of testing the app, so no money is sent\./.test(ask.text.replace(/\s+/g, " ")), ask.subject);
const pay = M.toPayMail({ claim: stored, approvedBy: ["the President", "the VP of Operations"] });
ok("…and the one asking the VP to pay it says to send no money and type any transaction number", /^\[BOARD TEST\] /.test(pay.subject) && /Don't send any money: type any transaction number, like TEST123/.test(pay.text.replace(/\s+/g, " ")), pay.text);
// It is filed with the test claims, never in the year's folders.
let filedTo = "";
const drive = { children: async () => [], ensure: async (p) => { filedTo = p; throw new Error("stop here"); } };
await XF.fileClaim({ claim: stored, docs: {}, drive }).catch(() => {});
ok("filed under Test claims, not the year's folder", filedTo.includes(XF.TEST_FOLDER), filedTo);
// A claim started before the switch went on is marked when it's sent.
await call("/api/expenses?boardtest=1", "POST", { on: false }, PRES);
const d = (await mileage(DEREK)).claim;
ok("turned off: a new claim is a real one", d.trial === false && (await home(DEREK)).boardTest === null);
await call("/api/expenses?boardtest=1", "POST", { on: true }, PRES);
const ds = await call(`/api/expenses?submit=${d.id}`, "POST", {}, DEREK);
ok("…but sent while it's on again, it's marked", ds.claim?.trial === true);

console.log("— clearing it");
await call("/api/expenses?boardtest=1", "POST", { on: false }, PRES);
// One made "tomorrow" (as if after the day picked) must stay.
const keep = (await mileage(DEREK)).claim;
const k = await S.getClaim(keep.id); k.createdAt = new Date(Date.now() + 2 * 86400e3).toISOString(); await S.putClaim(k);
// And one real one, never marked, made today: the preview says so before anything is deleted.
const real = (await mileage(JOHN)).claim;
ok("only the President can see or clear", (await call(`/api/expenses?clearpreview=${day(0)}`, "GET", undefined, TRES)).status === 403 && (await call("/api/expenses?clear=1", "POST", { date: day(0) }, TRES)).status === 403);
ok("a day still to come can't be picked", (await call(`/api/expenses?clearpreview=${day(2)}`, "GET", undefined, PRES)).status === 400);
const pv = await call(`/api/expenses?clearpreview=${day(0)}`, "GET", undefined, PRES);
ok("the preview says how many, whose, and how many aren't marked as tests", pv.claims >= 3 && pv.people.includes("John Healy") && pv.people.includes("Derek Sullivan") && pv.real >= 1, JSON.stringify(pv));
ok("…and nothing is deleted by looking", !!(await S.getClaim(j.id)) && !!(await S.getClaim(real.id)));
const cl = await call("/api/expenses?clear=1", "POST", { date: day(0) }, PRES);
ok("Clear deletes every claim made up to that day, from everyone", cl.status === 200 && cl.cleared.claims === pv.claims && !(await S.getClaim(j.id)) && !(await S.getClaim(d.id)) && !(await S.getClaim(real.id)), JSON.stringify(cl.cleared));
ok("…with their lines", (await S.listClaimLines(j.id)).length === 0);
ok("…but not one made after it", !!(await S.getClaim(keep.id)));
ok("John's app is empty of them: nothing to approve, nothing sent", !(await home(PRES)).toApprove.some((c) => [j.id, d.id].includes(c.id)) && !(await home(JOHN)).past.length);
await S.deleteClaimAll(keep.id, X.whoKey("d.sullivan@ongia.ca"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
