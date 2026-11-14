// More than one expense claim on the go at once, from the server's side (Andrew 14 Nov 2026).
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


// More than one claim on the go (Andrew 14 Nov 2026: "I want to have that ability to have more than one I am working on.
// but everything still needs to save the same way. Saves to server as soon as I add a receipt").
const W = (who, id) => ({ ...who, "x-working-claim": id });
let a = await mileage(DEREK, 50);
const A = a.claim.id;
let h = await call("/api/expenses?new=1", "POST", undefined, W(DEREK, A));
const B = h.working;
ok("Another claim starts a second, empty one, and puts it in front", h.current.id === B && B !== A && h.current.lines.length === 0 && h.others.length === 1 && h.others[0].id === A, JSON.stringify({ cur: h.current?.id, B, others: h.others }));
ok("the first is listed to switch back to, with its line and total", h.others[0].lines === 1 && h.others[0].sum === 31, JSON.stringify(h.others[0]));
ok("asking again while the new one is empty gives that same one, not a third", (await call("/api/expenses?new=1", "POST", undefined, W(DEREK, A))).working === B);
// A line added without naming the claim lands on the one being worked on, saved at once.
let m = await mileage(W(DEREK, B), 10);
ok("what's added goes on the claim on screen, saved on the server at once", m.claim.id === B && (await S.listClaimLines(B)).length === 1 && (await S.listClaimLines(A)).length === 1);
ok("switching: home with the first named shows the first, the second beside it", (await home(W(DEREK, A))).current.id === A && (await home(W(DEREK, A))).others[0].id === B);
ok("with none named (another phone), the newest is in front and the other is still there", [B, A].includes((await home(DEREK)).current.id) && (await home(DEREK)).others.length === 1);
// Send the first: the second comes to the front.
await call(`/api/expenses?claim=${A}&line=${a.line}`, "PUT", { category: 8, purpose: "Drive to the training", date: day(-2), from: "Barrie", to: "Toronto", km: 50 }, DEREK);
const sent = await call(`/api/expenses?submit=${A}`, "POST", {}, W(DEREK, A));
ok("sending one leaves the other in front, still open", sent.status === 200 && (await home(W(DEREK, A))).current.id === B, JSON.stringify(sent.problems ?? sent.error));
// The cap.
for (let i = 0; i < 6; i++) { const n = await call("/api/expenses?new=1", "POST", undefined, DEREK); if (n.working) await mileage(W(DEREK, n.working), 5); }
ok("up to six open at once; a seventh is refused with why", (await call("/api/expenses?new=1", "POST", undefined, DEREK)).status === 409);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
