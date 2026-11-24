// Audit, section 1 (Andrew 24 Nov 2026: "go on section 1"): the background jobs take only the site's own key, not a board
// member's sign-in; renaming the filed claims is the President's or the VP's; a view-only member can't send expense links;
// "today" is Toronto's date; the verify page's date in French.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const F = REPO + "netlify/functions/";
const { issueSession } = await import(F + "lib/auth.mjs");
const { requireInternal } = await import(F + "lib/http.mjs");
const { todayIso } = await import(F + "lib/deadlines.mjs");
const S = await import(F + "lib/store.mjs");
const { readdirSync, readFileSync } = await import("node:fs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const req = (key) => new Request("http://x/api/whatever-background", { method: "POST", headers: { "x-admin-key": key } });

ok("the site's own key starts a background job", requireInternal(req("testkey")) === null);
ok("a board member's sign-in does not", requireInternal(req(issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" }))) === "Not authorized.");
ok("nor no key, nor a wrong one", requireInternal(req("")) && requireInternal(req("nope")));
const bg = readdirSync(F).filter((f) => f.endsWith("-background.mjs"));
const loose = bg.filter((f) => { const s = readFileSync(F + f, "utf8"); return /requireAdmin\(req\)/.test(s) || !/requireInternal\(req\)/.test(s); });
ok(`all ${bg.length} background jobs check for the site's key only`, bg.length >= 18 && !loose.length, loose.join(", "));
const lead = (await import(F + "agenda-read-background.mjs")).default;
const r = await lead(req(issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" })));
ok("and one, called with a sign-in, says no", r.status === 401);

const rename = (await import(F + "expense-rename.mjs")).default;
const asM = (email) => ({ "x-admin-key": issueSession({ email, name: email }) });
let x = await rename(new Request("http://x/api/expense-rename", { method: "POST", headers: asM("s.hammond@ongia.ca") }));
ok("renaming every claim's files: refused to another board member", x.status === 403, String(x.status));
x = await rename(new Request("http://x/api/expense-rename", { method: "GET", headers: asM("s.hammond@ongia.ca") }));
ok("…who can still look at what it would do", x.status === 200);
x = await rename(new Request("http://x/api/expense-rename", { method: "POST", headers: asM("president@ongia.ca") }));
ok("the President can", x.status === 200, String(x.status));

ok("today is Toronto's date: 11:30 pm on Nov 30 is still Nov 30 there", todayIso(new Date("2026-12-01T04:30:00Z")) === "2026-11-30");
for (const f of ["reports.mjs", "lib/ongiayear.mjs", "lib/yearend.mjs", "lib/history.mjs", "lib/appreciation.mjs"]) {
  ok(`${f}: no UTC "today"`, !/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/.test(readFileSync(F + f, "utf8")));
}

const verifySrc = readFileSync(F + "verify.mjs", "utf8");
ok("the verify page is given the date in French too", /dateFr: formatLong\(rec\.date, "fr"/.test(verifySrc));
const certmail = readFileSync(F + "lib/certmail.mjs", "utf8");
ok("the French certificate email links to the French page", /verifyFr = `\$\{verify\}&lang=fr`/.test(certmail) && /esc\(verifyFr\)/.test(certmail));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
