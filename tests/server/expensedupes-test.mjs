// The same receipt claimed twice (Andrew 9 Nov 2026: "a check against all the receipts in the database to make sure that
// it's not a resubmit of the same receipt. I need a check and balance."). Every line against every sent claim, anyone's.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
delete process.env.ANTHROPIC_API_KEY;
const F = REPO + "netlify/functions/";
const exp = (await import(F + "expenses.mjs")).default;
const roster = (await import(F + "roster.mjs")).default;
const X = await import(F + "lib/expenses.mjs");
const D = await import(F + "lib/expensedupes.mjs");
const S = await import(F + "lib/store.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const as = (email, name = email) => ({ "x-expense-key": X.issueExpenseSession({ email, name }), "content-type": "application/json" });
const call = async (url, method = "GET", body, headers) => { const r = await exp(new Request("http://localhost" + url, { method, headers, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) })); const ct = r.headers.get("content-type") ?? ""; return { status: r.status, ...(ct.includes("json") ? await r.json() : {}) }; };
await roster(new Request("http://localhost/api/roster", { headers: H }));
const { todayIso } = await import(F + "lib/deadlines.mjs");
const day = (n) => todayIso(new Date(Date.now() + n * 86400e3));
const png = (fill) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(300, fill)]);
const JOHN = as("j.healy@ongia.ca", "John Healy"), DEREK = as("d.sullivan@ongia.ca", "Derek Sullivan"), PRES = as("president@ongia.ca", "Andrew Hammond");
const upload = (who, bytes, name, extra = "") => call(`/api/expenses?add=receipt${extra}`, "POST", bytes, { "x-expense-key": who["x-expense-key"], "content-type": "image/png", "x-file-name": name });
const fill = (who, claim, line, f) => call(`/api/expenses?claim=${claim}&line=${line}`, "PUT", { category: 8, purpose: "Flight to the training", ...f }, who);
const lineOf = (claim, id) => claim.lines.find((l) => l.id === id);

console.log("— unit: what counts as the same receipt");
ok("'AIR CANADA - YYZ' and 'Air Canada' are the same place; 'Esso' and 'Tim Hortons' aren't", D.similarPlace("AIR CANADA - YYZ", "Air Canada") && !D.similarPlace("Esso", "Tim Hortons") && !D.similarPlace("Delta Hotels", "Marriott Hotel"));
ok("the same photo is 'same'", D.matchOf({ hash: "abc" }, { hash: "abc" })?.level === "same");
ok("the same booking number, amount or place agreeing, is 'same'", D.matchOf({ ref: "ab-12c4x", amount: 412.5, paidTo: "Air Canada" }, { ref: "AB12C4X", amount: 99, paidTo: "Air Canada" })?.level === "same");
ok("a short number (a table number, say) isn't enough", D.matchOf({ ref: "12", amount: 1, paidTo: "A" }, { ref: "12", amount: 2, paidTo: "B" }) === null);
ok("same amount, day and place is 'likely'", D.matchOf({ paidTo: "Air Canada", date: "2026-10-02", amount: 412.5 }, { paidTo: "AIR CANADA", date: "2026-10-02", amount: 412.5 })?.level === "likely");
ok("a different day, or amount, is not", D.matchOf({ paidTo: "Air Canada", date: "2026-10-02", amount: 412.5 }, { paidTo: "Air Canada", date: "2026-10-03", amount: 412.5 }) === null && D.matchOf({ paidTo: "Air Canada", date: "2026-10-02", amount: 412.5 }, { paidTo: "Air Canada", date: "2026-10-02", amount: 412.51 }) === null);
ok("the same drive on the same day is 'likely'", D.matchOf({ kind: "mileage", date: "2026-10-02", amount: 62, from: "Barrie", to: "Toronto" }, { kind: "mileage", date: "2026-10-02", amount: 62, from: "barrie", to: "toronto" })?.level === "likely");

console.log("— John sends a receipt; Derek uploads the same photo");
const A = png(7);
let j = await upload(JOHN, A, "aircanada.png");
const JC = j.claim.id, JL = j.line;
await fill(JOHN, JC, JL, { paidTo: "Air Canada", date: day(-5), amount: 412.5 });
let sj = await call(`/api/expenses?submit=${JC}`, "POST", {}, JOHN);
ok("John's claim goes, nothing flagged", sj.status === 200 && !lineOf(sj.claim, JL).dupe, JSON.stringify(sj.problems ?? sj.error));
ok("its receipt is fingerprinted and in the index", (await S.getClaimLine(JC, JL)).file.hash === D.hashOf(A) && (await S.getMeta("expdupes")).claims[JC].lines[0].hash === D.hashOf(A));

let d = await upload(DEREK, A, "IMG_2231.png");
const DC = d.claim.id, DL = d.line;
await fill(DEREK, DC, DL, { paidTo: "Air Canada", date: day(-5), amount: 412.5 });
let dv = (await call(`/api/expenses?claim=${DC}`, "GET", undefined, DEREK)).claim;
ok("Derek sees it on the line, straight away: already claimed on John's claim", lineOf(dv, DL).dupe?.level === "same" && /^John Healy's .*claim$/.test(lineOf(dv, DL).dupe.where) && lineOf(dv, DL).dupe.why === "the same photo or PDF", JSON.stringify(lineOf(dv, DL).dupe));
let sd = await call(`/api/expenses?submit=${DC}`, "POST", {}, DEREK);
ok("and he can't send it, told why", sd.status === 409 && sd.problems.some((p) => /Air Canada .* is already on John Healy's .*claim: the same photo or PDF\. Remove it from this claim\./.test(p)), JSON.stringify(sd.problems));

console.log("— a different photo, same flight: a likely resubmit");
await call(`/api/expenses?claim=${DC}&line=${DL}`, "DELETE", undefined, DEREK);
d = await upload(DEREK, png(9), "boarding.png");
const DL2 = d.line;
await fill(DEREK, DC, DL2, { paidTo: "AIR CANADA - YYZ", date: day(-5), amount: 412.5 });
dv = (await call(`/api/expenses?claim=${DC}`, "GET", undefined, DEREK)).claim;
ok("flagged as may already be claimed", lineOf(dv, DL2).dupe?.level === "likely" && lineOf(dv, DL2).dupe.why === "the same amount, the same day, the same place", JSON.stringify(lineOf(dv, DL2).dupe));
sd = await call(`/api/expenses?submit=${DC}`, "POST", {}, DEREK);
ok("it can still be sent: the approvers decide", sd.status === 200, JSON.stringify(sd.problems));
const chk = (await call(`/api/expenses?claim=${DC}`, "GET", undefined, PRES)).claim.checks;
ok("the President's check says so, naming John's claim", chk.ok === false && chk.notes.some((n) => /AIR CANADA - YYZ, .*\$412\.50: may already be claimed on John Healy's .*claim \(the same amount, the same day, the same place\)\./.test(n)), JSON.stringify(chk.notes));
const jv = (await call(`/api/expenses?claim=${JC}`, "GET", undefined, PRES)).claim;
ok("and John's own claim now shows Derek's as the possible twin", lineOf(jv, JL).dupe?.level === "likely" && /Derek Sullivan's/.test(lineOf(jv, JL).dupe.where));

console.log("— the same photo twice on one claim");
let t = await upload(JOHN, png(11), "a.png");
const TC = t.claim.id;
await fill(JOHN, TC, t.line, { paidTo: "Esso", date: day(-3), amount: 60 });
const t2 = await upload(JOHN, png(11), "a-copy.png");
await fill(JOHN, TC, t2.line, { paidTo: "Esso", date: day(-3), amount: 60 });
const tv = (await call(`/api/expenses?claim=${TC}`, "GET", undefined, JOHN)).claim;
ok("the second is already on this claim", tv.lines.filter((l) => l.dupe?.level === "same" && l.dupe.where === "this claim").length === 1, JSON.stringify(tv.lines.map((l) => l.dupe)));
await call(`/api/expenses?claim=${TC}`, "DELETE", undefined, JOHN);

console.log("— test claims, and a claim withdrawn");
const tt = await upload(DEREK, A, "try.png", "&test=1");
await fill(DEREK, tt.claim.id, tt.line, { paidTo: "Air Canada", date: day(-5), amount: 412.5 });
const ttv = (await call(`/api/expenses?claim=${tt.claim.id}`, "GET", undefined, DEREK)).claim;
ok("a test claim isn't compared with real ones", !lineOf(ttv, tt.line).dupe, JSON.stringify(lineOf(ttv, tt.line).dupe));
// Derek's claim is sent back and he withdraws it: its receipts are free to go again.
await call(`/api/expenses?decide=${DC}`, "POST", { decision: "reject", comment: "That's John's flight." }, PRES);
ok("Derek withdraws his sent-back claim", (await call(`/api/expenses?claim=${DC}`, "DELETE", undefined, DEREK)).status === 200);
const jv2 = (await call(`/api/expenses?claim=${JC}`, "GET", undefined, PRES)).claim;
ok("and John's line is no longer flagged", !lineOf(jv2, JL).dupe && !(await S.getMeta("expdupes")).claims[DC]);

console.log("— receipts sent before this check: the index is built and fingerprinted from them");
const line = await S.getClaimLine(JC, JL); delete line.file.hash; await S.putClaimLine(JC, line);
await S.putMeta("expdupes", null);
const idx = await D.dupeIndex();
ok("the first look builds it from every sent claim, and works out the old receipt's fingerprint", idx.built && idx.claims[JC]?.lines[0].hash === D.hashOf(A) && (await S.getClaimLine(JC, JL)).file.hash === D.hashOf(A));
const again = await upload(DEREK, A, "again.png");
const av = (await call(`/api/expenses?claim=${again.claim.id}`, "GET", undefined, DEREK)).claim;
ok("so the old receipt is caught too", lineOf(av, again.line).dupe?.level === "same");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
