// ONGIA Expenses from the server's side: who may, who signs off, the app's own sign-in, a claim built line by line
// (receipts Claude reads against a stand-in Anthropic, mileage, no receipt), the running total, and privacy.
const REPO = new URL("../../", import.meta.url).pathname;
import http from "node:http";
process.env.ADMIN_KEY = "testkey";
let reply = null, seen = 0;
const fake = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
    seen++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "x", content: [{ type: "text", text: JSON.stringify(reply) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
  });
});
await new Promise((r) => fake.listen(0, "127.0.0.1", r));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fake.address().port}`;
process.env.ANTHROPIC_API_KEY = "sk-test";
const F = REPO + "netlify/functions/";
const exp = (await import(F + "expenses.mjs")).default;
const bg = (await import(F + "expense-read-background.mjs")).default;
const roster = (await import(F + "roster.mjs")).default;
const events = (await import(F + "events.mjs")).default;
const { issueSession } = await import(F + "lib/auth.mjs");
const { requireAdmin } = await import(F + "lib/http.mjs");
const X = await import(F + "lib/expenses.mjs");
const S = await import(F + "lib/store.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const as = (email, name = email) => ({ "x-expense-key": X.issueExpenseSession({ email, name }), "content-type": "application/json" });
const call = async (url, method = "GET", body, headers) => { const r = await exp(new Request("http://localhost" + url, { method, headers, body: body === undefined ? undefined : body instanceof Uint8Array || Buffer.isBuffer(body) ? body : JSON.stringify(body) })); const ct = r.headers.get("content-type") ?? ""; return { status: r.status, res: r, ...(ct.includes("json") ? await r.json() : {}) }; };
const upload = (who, bytes, extra = "") => call(`/api/expenses?add=receipt${extra}`, "POST", bytes, { "x-expense-key": who["x-expense-key"], "x-file-name": "IMG_0001.jpg" });
const runReader = (claim, line) => bg(new Request(`http://localhost/api/expense-read-background?claim=${claim}&line=${line}`, { method: "POST", headers: H }));
await roster(new Request("http://localhost/api/roster", { headers: H }));   // seeds the board list
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(300, 3)]);
const MEMBER = as("j.healy@ongia.ca", "John Healy"), OTHER = as("d.sullivan@ongia.ca", "Derek Sullivan");
const PRES = as("president@ongia.ca", "Andrew Hammond"), VP = as("vp_operations@ongia.ca"), TRES = as("treasurer@ongia.ca");

console.log("— who signs off");
ok("a board member's claim goes to the President and the Treasurer", X.approversFor("j.healy@ongia.ca").join() === "president,treasurer");
ok("the VP's goes to the President and the Treasurer", X.approversFor("vp_operations@ongia.ca").join() === "president,treasurer");
ok("the President's goes to the VP and the Treasurer", X.approversFor("president@ongia.ca").join() === "vp,treasurer");
ok("the Treasurer's goes to the President and the VP", X.approversFor("Treasurer@ongia.ca").join() === "president,vp");
ok("nobody ever approves their own", ["j.healy@ongia.ca", "vp_operations@ongia.ca", "president@ongia.ca", "treasurer@ongia.ca"].every((e) => !X.approversFor(e).includes(X.roleOf(e))));
ok("the ten categories are the template's, in its order", X.CATEGORIES.length === 10 && X.categoryName(8) === "Travel" && X.categoryName(10) === "Speaker Stipend" && X.categoryName(11) === "");

console.log("— signing in");
const rosterNow = await S.getRoster();
ok("anyone on the board list may claim; someone not on it may not", X.mayClaim("j.healy@ongia.ca", rosterNow) && !X.mayClaim("someone@ongia.ca", rosterNow) && !X.mayClaim("", rosterNow));
ok("the three officers always may", X.mayClaim("treasurer@ongia.ca", []) && X.mayClaim("president@ongia.ca", []) && X.mayClaim("vp_operations@ongia.ca", []));
const tok = MEMBER["x-expense-key"];
ok("an expense session reads back as its person, for 30 days", X.readExpenseSession(tok)?.email === "j.healy@ongia.ca" && X.readExpenseSession(tok, Date.now() + 29 * 86400e3) && !X.readExpenseSession(tok, Date.now() + 31 * 86400e3));
ok("a forged one is refused", !X.readExpenseSession(tok.slice(0, -3) + "abc") && !X.readExpenseSession("x1.e30.zzz"));
ok("an expense session does NOT open the Briefing Room", requireAdmin(new Request("http://localhost/api/events", { headers: { "x-admin-key": tok } })) !== null);
ok("the shared desk key is nobody here", (await call("/api/expenses", "GET", undefined, H)).status === 401);
ok("a Briefing Room session works in the expense app", (await call("/api/expenses", "GET", undefined, { "x-expense-key": issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" }) })).status === 200);
ok("someone signed in but not on the board list is refused, in words", (await call("/api/expenses", "GET", undefined, as("ex.member@ongia.ca"))).status === 403);
ok("without Microsoft set up, signing in says so", (await call("/api/expenses?signin=1", "POST", { idToken: "x", nonce: "y" })).status === 503);

console.log("— an empty start");
let h = await call("/api/expenses", "GET", undefined, MEMBER);
ok("a member with no claim yet: no current claim, the rate, ten categories, their name off the roster", h.status === 200 && h.current === null && h.rate === 0.62 && h.categories.length === 10 && h.me.name === "John Healy" && h.me.title === "Board member" && h.me.officer === false && h.tabs.join() === "claim,past");
ok("it says who will approve", h.approvers.join() === "President,Treasurer");
const day = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const mkEvent = async (extra) => (await (await events(new Request("http://localhost/api/events", { method: "POST", headers: H, body: JSON.stringify({ title: "National Gang Summit", city: "Toronto, ON", venue: "V", dayOne: day(5), lastDay: day(7), invite: false, board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], presenters: [], ...extra }) }))).json()).event;
const evSummit = await mkEvent();
ok("the app offers the Summit as an event a line can name", (await call("/api/expenses", "GET", undefined, MEMBER)).events.some((e) => e.id === evSummit.id && e.title === "National Gang Summit"));
ok("events a line can name: recent and coming, never a practice one", X.eventChoices([{ id: "a", title: "A", dayOne: "2026-11-01" }, { id: "p", title: "P", dayOne: "2026-11-01", practice: true }, { id: "old", title: "Old", dayOne: "2025-01-01" }], "2026-11-03").map((e) => e.id).join() === "a");

console.log("— a receipt, photographed");
reply = { isReceipt: true, vendor: "Delta Hotels", date: "2026-11-09", total: 658.12, tax: 75.71, currency: "CAD", category: 8, what: "Hotel, 3 nights", confidence: "high", notes: null };
let u = await upload(MEMBER, JPEG);
// In-process there is no Netlify to start the background reader, so the start fails and says so (on the site it reads); the test runs the reader by hand.
ok("the photo is kept at once (202) on a new claim", u.status === 202 && u.claim.lines.length === 1 && u.claim.lines[0].file.type === "image/jpeg" && u.claim.status === "draft" && u.claim.canEdit);
ok("when the reader can't start, the line says so in words, not silence", u.claim.lines[0].check.state === "unread" && /Type the details in/.test(u.claim.lines[0].check.why));
const C = u.claim.id, L1 = u.line;
await runReader(C, L1);
let v = (await call(`/api/expenses?claim=${C}`, "GET", undefined, MEMBER)).claim;
let l = v.lines[0];
ok("Claude's reading fills the empty boxes: vendor, date, total, category, what it was", l.paidTo === "Delta Hotels" && l.date === "2026-11-09" && l.amount === 658.12 && l.category === 8 && l.purpose === "Hotel, 3 nights" && l.fromRead.length === 5);
ok("and the line is green: the amount matches the receipt", l.check.state === "match" && l.check.total === 658.12);
ok("the running total is the line", v.sums.total === 658.12 && v.sums.receipts === 1);
ok("nothing is still missing on it", l.problems.length === 0 && v.missing === 0);
// The person picks the event and says what it was for; the amount they keep is the receipt's.
let p = await call(`/api/expenses?claim=${C}&line=${L1}`, "PUT", { paidTo: "Delta Hotels", date: "2026-11-09", amount: 658.12, category: 8, eventId: evSummit.id, purpose: "Hotel for the Summit" }, MEMBER);
l = p.claim.lines[0];
ok("saved: the event is named by its title, and the boxes are now the person's", p.status === 200 && l.eventTitle === "National Gang Summit" && l.purpose === "Hotel for the Summit" && l.fromRead.length === 0 && l.check.state === "match");
p = await call(`/api/expenses?claim=${C}&line=${L1}`, "PUT", { paidTo: "Delta Hotels", date: "2026-11-09", amount: 600, category: 8, eventId: evSummit.id, purpose: "Hotel for the Summit" }, MEMBER);
ok("claiming a different amount: no tick, and it says what the receipt shows", p.claim.lines[0].check.state === "differs" && p.claim.lines[0].check.total === 658.12 && p.claim.sums.total === 600);
await call(`/api/expenses?claim=${C}&line=${L1}`, "PUT", { paidTo: "Delta Hotels", date: "2026-11-09", amount: 658.12, category: 8, eventId: evSummit.id, purpose: "Hotel for the Summit" }, MEMBER);

console.log("— what a person typed is never replaced by what Claude read");
reply = { isReceipt: true, vendor: "Staples", date: "2026-11-11", total: 112.06, tax: 12.89, currency: "CAD", category: 5, what: "Name badges", confidence: "high", notes: null };
u = await upload(MEMBER, JPEG);
const L2 = u.line;
ok("a second photo goes on the same claim", u.claim.id === C && u.claim.lines.length === 2);
// They type before Claude has finished.
await call(`/api/expenses?claim=${C}&line=${L2}`, "PUT", { paidTo: "Staples Toronto", amount: 100, purpose: "Badges" }, MEMBER);
await runReader(C, L2);
l = (await call(`/api/expenses?claim=${C}`, "GET", undefined, MEMBER)).claim.lines.find((x) => x.id === L2);
ok("their vendor, amount and purpose stay; only the empty date and category come from the receipt", l.paidTo === "Staples Toronto" && l.amount === 100 && l.purpose === "Badges" && l.date === "2026-11-11" && l.category === 5 && l.fromRead.sort().join() === "category,date");
ok("and the check says the receipt shows $112.06", l.check.state === "differs" && l.check.total === 112.06);

console.log("— a receipt Claude can't read, or that isn't one");
reply = { isReceipt: false, vendor: null, date: null, total: null, tax: null, currency: null, category: null, what: null, confidence: "low", notes: null };
u = await upload(MEMBER, PNG);
await runReader(C, u.line);
l = (await call(`/api/expenses?claim=${C}`, "GET", undefined, MEMBER)).claim.lines.find((x) => x.id === u.line);
ok("not a receipt: nothing is filled in, it says so, and the line lists what it needs", l.check.state === "notreceipt" && !l.paidTo && l.problems.includes("the amount"));
await call(`/api/expenses?claim=${C}&line=${u.line}`, "DELETE", undefined, MEMBER);
ok("a line can be removed, and its photo goes with it", !(await S.getClaimLine(C, u.line)) && !(await S.getClaimFile("file", C, u.line)));
reply = { isReceipt: true, vendor: "Uber", date: "2026-11-12", total: 38.4, tax: null, currency: "USD", category: 8, what: "Taxi", confidence: "high", notes: "Charged in US dollars." };
u = await upload(MEMBER, JPEG);
await runReader(C, u.line);
l = (await call(`/api/expenses?claim=${C}`, "GET", undefined, MEMBER)).claim.lines.find((x) => x.id === u.line);
ok("a receipt in US dollars still matches, and the check carries the currency so the app can say claim the Canadian amount", l.check.state === "match" && l.check.currency === "USD");
await call(`/api/expenses?claim=${C}&line=${u.line}`, "DELETE", undefined, MEMBER);
const ups = await call(`/api/expenses?add=receipt`, "POST", Buffer.from("hello, not a picture"), { "x-expense-key": MEMBER["x-expense-key"] });
ok("a file that isn't a picture or a PDF is refused, in words", ups.status === 415 && /JPEG or PNG/.test(ups.error));

console.log("— mileage, typed in");
let m = await call("/api/expenses?add=mileage", "POST", { date: "2026-11-10", from: "Barrie", to: "Toronto", km: 312, eventId: evSummit.id, purpose: "Drive to the Summit" }, MEMBER);
l = m.claim.lines.find((x) => x.id === m.line);
ok("312 km at $0.62 is $193.44, paid to the member, under Travel", m.status === 201 && l.amount === 193.44 && l.paidTo === "John Healy" && l.category === 8 && l.rate === 0.62 && l.check.state === "mileage" && l.problems.length === 0);
const L3 = m.line;
process.env.EXPENSE_MILEAGE_RATE = "0.70";
m = await call(`/api/expenses?claim=${C}&line=${L3}`, "PUT", { date: "2026-11-10", from: "Barrie", to: "Toronto", km: 300, purpose: "Drive to the Summit" }, MEMBER);
ok("a change of rate later doesn't change a line already made: 300 km is still at $0.62", m.claim.lines.find((x) => x.id === L3).amount === 186);
delete process.env.EXPENSE_MILEAGE_RATE;
ok("a paid-to typed on a mileage line is ignored: it is always the member", (await call(`/api/expenses?claim=${C}&line=${L3}`, "PUT", { date: "2026-11-10", from: "Barrie", to: "Toronto", km: 312, paidTo: "Someone Else", purpose: "Drive" }, MEMBER)).claim.lines.find((x) => x.id === L3).paidTo === "John Healy");

console.log("— no receipt");
let n = await call("/api/expenses?add=noreceipt", "POST", { paidTo: "Parking machine", date: "2026-11-11", amount: 18, category: 8, purpose: "Parking at the venue" }, MEMBER);
const L4 = n.line;
l = n.claim.lines.find((x) => x.id === L4);
ok("it needs a statement and a card screenshot before it can go", l.problems.join("|") === "a reason there's no receipt|a screenshot of the card statement" && l.check.state === "statement-missing");
// Andrew, 3 Nov 2026: a short reason was taken as none ("Lost it" is 7 characters; the bar was 10).
const reasonNeeded = async (statement) => (await call(`/api/expenses?claim=${C}&line=${L4}`, "PUT", { paidTo: "Parking machine", date: "2026-11-11", amount: 18, category: 8, purpose: "Parking at the venue", statement }, MEMBER)).claim.lines.find((x) => x.id === L4).problems.includes("a reason there's no receipt");
ok("a short reason counts: \"Lost it\"", !(await reasonNeeded("Lost it")));
ok("but two letters, or spaces, don't", (await reasonNeeded("ok")) && (await reasonNeeded("     ")));
ok("what's missing reads as a sentence: \"…, a and b\"", X.andList(["the date", "a reason there's no receipt", "a screenshot"]) === "the date, a reason there's no receipt and a screenshot" && X.andList(["the date"]) === "the date" && X.andList(["a", "b"]) === "a and b");
await call(`/api/expenses?claim=${C}&line=${L4}`, "PUT", { paidTo: "Parking machine", date: "2026-11-11", amount: 18, category: 8, purpose: "Parking at the venue", statement: "The machine printed no receipt. It is on my Visa statement." }, MEMBER);
const sh = await call(`/api/expenses?claim=${C}&shot=${L4}`, "POST", PNG, { "x-expense-key": MEMBER["x-expense-key"], "x-file-name": "visa.png" });
l = sh.claim.lines.find((x) => x.id === L4);
ok("with both, it is complete", sh.status === 200 && l.problems.length === 0 && l.check.state === "statement" && l.shot.name === "visa.png");
ok("a card statement can't be added to a receipt line", (await call(`/api/expenses?claim=${C}&shot=${L1}`, "POST", PNG, { "x-expense-key": MEMBER["x-expense-key"] })).status === 400);
ok("the statement is kept as written", /on my Visa statement/.test(l.statement));

console.log("— the running total");
v = (await call(`/api/expenses?claim=${C}`, "GET", undefined, MEMBER)).claim;
ok("receipts + mileage + no receipt: 658.12 + 100 + 193.44 + 18 = 969.56", v.sums.total === 969.56 && v.sums.lines === 4 && v.sums.receipts === 2 && v.sums.mileage === 1 && v.sums.noreceipt === 1, JSON.stringify(v.sums));
ok("newest first", v.lines.map((x) => x.date).join() === "2026-11-11,2026-11-11,2026-11-10,2026-11-09");
ok("the home screen shows the same claim and total", (await call("/api/expenses", "GET", undefined, MEMBER)).current.sums.total === 969.56);

console.log("— two receipts at the same moment");
const fresh = as("i.artinian@ongia.ca", "Inis Artinian");
reply = { isReceipt: true, vendor: "Tim Hortons", date: "2026-11-12", total: 46.2, tax: null, currency: "CAD", category: 5, what: "Coffee", confidence: "high", notes: null };
const [a, b] = await Promise.all([upload(fresh, JPEG), upload(fresh, JPEG)]);
const both = (await call("/api/expenses", "GET", undefined, fresh)).current;
ok("both land on one new claim, and neither is lost", a.claim.id === b.claim.id && both.lines.length === 2, `${a.claim.id} ${b.claim.id} ${both?.lines.length}`);

console.log("— a photo sent again after the signal dropped");
const resend = (id) => call("/api/expenses?add=receipt", "POST", JPEG, { "x-expense-key": fresh["x-expense-key"], "x-file-name": "a.jpg", "x-upload-id": id });
const r1 = await resend("1b9f0c1e-0000-4000-8000-000000000001"), r2b = await resend("1b9f0c1e-0000-4000-8000-000000000001");
const after = (await call("/api/expenses", "GET", undefined, fresh)).current;
ok("the same upload twice is one line, not two", r1.line === r2b.line && r2b.again === true && after.lines.length === 3, `${after.lines.length}`);
ok("a different photo is a new line", (await resend("1b9f0c1e-0000-4000-8000-000000000002")).line !== r1.line);

console.log("— privacy");
ok("another member cannot open my claim", (await call(`/api/expenses?claim=${C}`, "GET", undefined, OTHER)).status === 403);
ok("nor change a line on it", (await call(`/api/expenses?claim=${C}&line=${L1}`, "PUT", { amount: 1 }, OTHER)).status === 403);
ok("nor see its receipt", (await call(`/api/expenses?claim=${C}&file=${L1}`, "GET", undefined, OTHER)).status === 403);
ok("an officer can't see a claim that hasn't been sent: a draft is the member's own", (await call(`/api/expenses?claim=${C}`, "GET", undefined, PRES)).status === 403);
const f = await call(`/api/expenses?claim=${C}&file=${L1}`, "GET", undefined, MEMBER);
ok("the member gets their receipt back as it was sent", f.status === 200 && f.res.headers.get("content-type") === "image/jpeg" && Buffer.from(await f.res.arrayBuffer()).equals(JPEG));
ok("Derek's home has no claim of John's in it", (await call("/api/expenses", "GET", undefined, OTHER)).current === null);
const th = await call(`/api/expenses?claim=${C}&thumb=${L1}`, "POST", JPEG, { "x-expense-key": MEMBER["x-expense-key"] });
ok("a small picture of the receipt is kept for the list", th.status === 200 && (await call(`/api/expenses?claim=${C}&file=${L1}&kind=thumb`, "GET", undefined, MEMBER)).status === 200);

console.log("— once sent, it can't be changed");
const hdr = await S.getClaim(C);
hdr.status = "submitted"; hdr.submittedAt = new Date().toISOString();
await S.putClaim({ ...hdr });
ok("a line on a sent claim can't be changed or removed", (await call(`/api/expenses?claim=${C}&line=${L1}`, "PUT", { amount: 1 }, MEMBER)).status === 409 && (await call(`/api/expenses?claim=${C}&line=${L1}`, "DELETE", undefined, MEMBER)).status === 409);
ok("and nothing can be added to it", (await upload(MEMBER, JPEG, `&claim=${C}`)).status === 409);
ok("an officer can now see it", (await call(`/api/expenses?claim=${C}`, "GET", undefined, PRES)).status === 200 && (await call(`/api/expenses?claim=${C}&file=${L1}`, "GET", undefined, TRES)).status === 200);
reply = { isReceipt: true, vendor: "VIA Rail", date: "2026-11-20", total: 88, tax: null, currency: "CAD", category: 8, what: "Train", confidence: "high", notes: null };
u = await upload(MEMBER, JPEG);
ok("the next photo starts a new claim", u.status === 202 && u.claim.id !== C && u.claim.lines.length === 1);
h = await call("/api/expenses", "GET", undefined, MEMBER);
ok("home: the new claim is current, the sent one is under past", h.current.id === u.claim.id && h.past.length === 1 && h.past[0].id === C);

console.log("— the board list keeps when someone last used the app");
const rl = await S.getRoster();
rl.find((x) => x.email === "j.healy@ongia.ca").lastExpenseSignIn = "2026-11-03T12:00:00.000Z";
await S.putRoster(rl);
const listed = await (await roster(new Request("http://localhost/api/roster", { headers: H }))).json();
await roster(new Request("http://localhost/api/roster", { method: "PUT", headers: H, body: JSON.stringify({ members: listed.members }) }));
ok("a save on the desk's Board members screen doesn't wipe it", (await S.getRoster()).find((x) => x.email === "j.healy@ongia.ca").lastExpenseSignIn === "2026-11-03T12:00:00.000Z");
ok("a receipt is never kept in the browser's cache", (await call(`/api/expenses?claim=${C}&file=${L1}`, "GET", undefined, MEMBER)).res.headers.get("cache-control") === "no-store");

console.log("— taken off the board list");
const r2 = await S.getRoster();
await S.putRoster(r2.filter((x) => x.email !== "d.sullivan@ongia.ca"));
ok("a session they still hold stops working at once", (await call("/api/expenses", "GET", undefined, OTHER)).status === 403);
await S.putRoster(r2);

fake.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
