// The board review (spec: chief-of-staff/board-review-spec.md; Andrew 24–25 Nov 2026). Made-up directors throughout.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
process.env.DESK_OWNERS = "pres@example.ca";
process.env.COSTING_USERS = "vp@example.ca";
delete process.env.MS_MAIL_FROM; delete process.env.RESEND_API_KEY;
const F = REPO + "netlify/functions/";
const api = (await import(F + "boardreview.mjs")).default;
const S = await import(F + "lib/store.mjs");
const R = await import(F + "lib/review.mjs");
const M = await import(F + "lib/reviewmail.mjs");
const { issueSession } = await import(F + "lib/auth.mjs");
const { todayIso } = await import(F + "lib/deadlines.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const as = (email) => issueSession({ email, name: email.split("@")[0] });
const call = async (who, qs, method = "GET", body) => {
  const headers = { "content-type": "application/json", ...(who === "KEY" ? { "x-admin-key": "testkey" } : who ? { "x-review-key": as(who) } : {}) };
  const r = await api(new Request(`http://x/api/boardreview${qs}`, { method, headers, body: body ? JSON.stringify(body) : undefined }));
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const day = (n) => new Date(Date.parse(`${todayIso()}T12:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

const people = ["pres", "vp", "jh", "d1", "d2", "d3", "d4", "d5", "d6", "newbie"].map((n) => ({ email: `${n}@example.ca`, name: `${n[0].toUpperCase()}${n.slice(1)} Sample` }));
await S.putRoster(people);
const E = (n) => `${n}@example.ca`;

// Who may come in.
ok("the advisors start as Andy Bain and John Healy", JSON.stringify((await R.testersOf()).advisors) === JSON.stringify(["a.bain@ongia.ca", "j.healy@ongia.ca"]));
ok("the starting testers are the president, the VP and John Healy", JSON.stringify((await R.testersOf()).emails) === JSON.stringify(["pres@example.ca", "vp@example.ca", "j.healy@ongia.ca"]));
await R.putTesters({ emails: [E("pres"), E("vp"), E("jh")], open: false, advisors: [] });
ok("a tester gets in", (await call(E("jh"), "")).status === 200);
ok("a director who isn't a tester is refused while it's closed", (await call(E("d1"), "")).status === 403);
ok("the desk's shared key is nobody here", (await call("KEY", "")).status === 401);
ok("no sign-in, no entry", (await call(null, "")).status === 401);
ok("only the president or VP can change the testers", (await call(E("jh"), "?testers=1", "PUT", { open: true })).status === 403);

// Testers-only: a cycle can hold only testers.
const t1 = await call(E("pres"), "?cycle=new", "POST", { year: 2027, selfOpens: day(0), peerOpens: day(7), closes: day(21), directors: [E("pres"), E("vp"), E("jh"), E("d1")], committee: [E("vp"), E("jh")], president: E("pres") });
const tc = await R.getCycle(t1.cycle);
ok("while closed, a cycle keeps only the testers, and is a test", tc && tc.directors.length === 3 && !tc.directors.some((d) => d.email === E("d1")) && tc.test === true, JSON.stringify(t1));
ok("the president can't sit on the committee", (await call(E("pres"), "?cycle=new", "POST", { selfOpens: day(0), peerOpens: day(7), closes: day(21), directors: [E("pres"), E("vp"), E("jh")], committee: [E("pres")], president: E("pres") })).status === 400);
ok("the opening email was tried for each director (no mail transport here)", t1.mail && t1.mail.failed?.length === 3);
await call(E("pres"), `?cycle=${tc.id}`, "DELETE");

// Advisors to the board (Andrew 25 Nov 2026): never reviewed, never reviewing; they can sit on the committee.
await call(E("pres"), "?testers=1", "PUT", { advisors: [E("jh")] });
const ta = await call(E("pres"), "?cycle=new", "POST", { year: 2027, selfOpens: day(0), peerOpens: day(7), closes: day(21), directors: [E("pres"), E("vp"), E("jh")], committee: [E("vp"), E("jh")], president: E("pres") });
const tac = await R.getCycle(ta.cycle);
ok("an advisor is left out of the review, even if picked", tac && tac.directors.length === 2 && !tac.directors.some((d) => d.email === E("jh")), JSON.stringify(ta));
ok("…but can sit on the committee, named", tac.committee.includes(E("jh")) && tac.committeeNames.includes("Jh Sample"));
ok("an advisor on the committee sees the progress, and has no review of their own", Array.isArray((await call(E("jh"), `?cycle=${tac.id}`)).progress) && !(await call(E("jh"), `?cycle=${tac.id}`)).mine);
ok("nobody reviews an advisor", !R.peersOf(tac, E("pres")).some((d) => d.email === E("jh")));
await call(E("pres"), `?cycle=${tac.id}`, "DELETE");
await call(E("pres"), "?testers=1", "PUT", { advisors: [] });

// Open it to the board, then a real-sized cycle: 8 directors, one in their first year.
await call(E("pres"), "?testers=1", "PUT", { open: true });
ok("open: a director on the board list gets in", (await call(E("d1"), "")).status === 200);
const dirs = ["pres", "vp", "jh", "d1", "d2", "d3", "d4", "newbie"].map(E);
const made = await call(E("pres"), "?cycle=new", "POST", { year: 2027, selfOpens: day(0), peerOpens: day(7), closes: day(21), directors: dirs, committee: [E("vp"), E("jh")], president: E("pres"), firstYear: [E("newbie")] });
let c = await R.getCycle(made.cycle);
ok("the cycle has all eight", c.directors.length === 8 && c.test === false);
ok("a first-year director reviews nobody and isn't reviewed", R.peersOf(c, E("newbie")).length === 0 && !R.peersOf(c, E("d1")).some((d) => d.email === E("newbie")));
ok("the president gets the extra questions; nobody else does", R.questionsFor(c, R.directorOf(c, E("pres"))).length === 12 && R.questionsFor(c, R.directorOf(c, E("d1"))).length === 7);
ok("…they follow the role, not the name", R.questionsFor({ ...c, president: E("d1") }, R.directorOf(c, E("d1"))).length === 12 && R.questionsFor({ ...c, president: E("d1") }, R.directorOf(c, E("pres"))).length === 7);

// Week 1: self-reviews. Peers can't rate yet.
const rate7 = (v) => Object.fromEntries(c.questions.director.map((q) => [q.id, v]));
ok("no peer reviews in the self-review week", (await call(E("d1"), `?cycle=${c.id}&peer=${R.keyOf(E("d2"))}`, "POST", { ratings: rate7(4) })).status === 409);
const selfBody = (v) => ({ answers: { delivered: "Ran the spring training.", short: "Missed a meeting." }, ratings: rate7(v), send: true });
ok("sending a self-review needs every self-rating", (await call(E("d1"), `?cycle=${c.id}&self=1`, "POST", { answers: { delivered: "x" }, ratings: {}, send: true })).status === 400);
ok("a self-review sends", (await call(E("d1"), `?cycle=${c.id}&self=1`, "POST", selfBody(5))).status === 200);
ok("…and is then locked", (await call(E("d1"), `?cycle=${c.id}&self=1`, "POST", selfBody(3))).status === 409);
await call(E("d2"), `?cycle=${c.id}&self=1`, "POST", selfBody(4));

// The peer round opens on its date, whoever hasn't done their self-review.
c = { ...c, selfOpens: day(-8), peerOpens: day(-1) }; await R.putCycle(c);
ok("the peer round opens on its date even with self-reviews missing", R.phaseOf(c) === "peer");
const view = await call(E("d3"), `?cycle=${c.id}&peer=${R.keyOf(E("d1"))}`);
ok("a peer sees what the colleague delivered, and nothing else of their self-review", view.delivered === "Ran the spring training." && !JSON.stringify(view).includes("Missed a meeting"), JSON.stringify(view).slice(0, 300));
ok("a colleague with no self-review shows none", (await call(E("d3"), `?cycle=${c.id}&peer=${R.keyOf(E("d4"))}`)).delivered === null);

// Peer reviews of d1: five raters, one says "not enough contact" on preparation.
const raters = ["pres", "vp", "jh", "d2", "d3", "d4"].map(E);
for (const [i, r] of raters.entries()) {
  const ratings = rate7(i < 3 ? 4 : 2); if (i === 5) ratings.prep = "na";
  const out = await call(r, `?cycle=${c.id}&peer=${R.keyOf(E("d1"))}`, "POST", { ratings, comments: { note: `Comment ${i}` } });
  if (out.status !== 200) ok(`rater ${i} sends`, false, JSON.stringify(out));
}
ok("a second review of the same colleague is refused", (await call(E("vp"), `?cycle=${c.id}&peer=${R.keyOf(E("d1"))}`, "POST", { ratings: rate7(1) })).status === 409);
ok("you can't review yourself", (await call(E("d1"), `?cycle=${c.id}&peer=${R.keyOf(E("d1"))}`, "POST", { ratings: rate7(5) })).status === 404);
ok("…nor a first-year director", (await call(E("d1"), `?cycle=${c.id}&peer=${R.keyOf(E("newbie"))}`, "POST", { ratings: rate7(5) })).status === 404);
ok("every question needs an answer, a number or —", (await call(E("d1"), `?cycle=${c.id}&peer=${R.keyOf(E("d2"))}`, "POST", { ratings: { prep: 4 } })).status === 400);

// What's stored: the ratings carry no reviewer at all.
const rateKeys = await S.listMetaKeys(`review:rate:${c.id}:`);
const stored = await Promise.all(rateKeys.map((k) => S.getMeta(k)));
const reviewerKeys = raters.map(R.keyOf);
ok("each rating is stored with no email, name or key of who wrote it", rateKeys.length === 6 && stored.every((r) => { const s = JSON.stringify(r); return !/@/.test(s) && !raters.some((e) => s.includes(e.split("@")[0])) && !reviewerKeys.some((k) => s.includes(k)); }), JSON.stringify(stored[0]));
ok("…and its key names only the colleague rated", rateKeys.every((k) => k.startsWith(`review:rate:${c.id}:${R.keyOf(E("d1"))}:`) && !reviewerKeys.some((rk) => k.endsWith(rk))));

// Progress: names and counts, never answers. The committee and the president see it; a director doesn't.
const prog = await call(E("vp"), `?cycle=${c.id}`);
ok("the committee sees who's done", prog.progress?.find((p) => p.name === "Vp Sample")?.peersSent === 1 && prog.progress.find((p) => p.name === "D1 Sample").self === true);
ok("…with no answers in it", !JSON.stringify(prog.progress).includes("Comment") && !JSON.stringify(prog.progress).includes("ratings"));
ok("the president sees the progress too", Array.isArray((await call(E("pres"), `?cycle=${c.id}`)).progress));
ok("a director doesn't", (await call(E("d2"), `?cycle=${c.id}`)).progress === undefined);

// Reminders stop for anyone finished.
ok("someone with colleagues left is still owed a reminder", (await M.stillToDo(c, R.directorOf(c, E("d2")))) !== null);
const d5 = R.directorOf(c, E("newbie"));
await call(E("newbie"), `?cycle=${c.id}&self=1`, "POST", selfBody(3));
await call(E("newbie"), `?cycle=${c.id}&board=1`, "POST", { ratings: { decisions: 4, chance: 3 }, comment: "More time on strategy." });
ok("a director who has finished gets no more reminders", (await M.stillToDo(c, d5)) === null);
ok("the board questions go once", (await call(E("newbie"), `?cycle=${c.id}&board=1`, "POST", { ratings: { decisions: 4, chance: 3 } })).status === 409);

// Close it. Reports.
c = { ...c, closes: day(-1), peerOpens: day(-7), selfOpens: day(-14) }; await R.putCycle(c);
ok("a director can't read a colleague's report", (await call(E("d2"), `?cycle=${c.id}&report=${R.keyOf(E("d1"))}`)).status === 403);
ok("…nor their own before it's released", (await call(E("d1"), `?cycle=${c.id}&report=${R.keyOf(E("d1"))}`)).status === 403);
ok("…nor the board-wide results", (await call(E("d1"), `?cycle=${c.id}&results=1`)).status === 403);
const rep = (await call(E("vp"), `?cycle=${c.id}&report=${R.keyOf(E("d1"))}`)).report;
const prep = rep?.rows.find((r) => r.id === "prep"), follow = rep?.rows.find((r) => r.id === "follow");
ok("the committee reads it: six raters, an average where five or more rated", rep.raters === 6 && follow.n === 6 && follow.avg === 3, JSON.stringify(follow));
ok("— never counts: five ratings on preparation, averaged without it", prep.n === 5 && prep.avg === 3.2, JSON.stringify(prep));
ok("their own rating sits beside it", follow.self === 5);
ok("comments show, all six, in no fixed order", rep.comments[0].items.length === 6);
ok("the report holds no reviewer", !/@/.test(JSON.stringify(rep.rows)) && !JSON.stringify(rep).includes("Vp Sample"));
const rep2 = (await call(E("vp"), `?cycle=${c.id}&report=${R.keyOf(E("d2"))}`)).report;
ok("with fewer than five raters, no average and no comments", rep2.rows.every((r) => r.avg === null) && rep2.comments.every((x) => x.items.length === 0));
ok("the president reads the board-wide results", (await call(E("pres"), `?cycle=${c.id}&results=1`)).status === 200);
ok("…but not a director's report", (await call(E("pres"), `?cycle=${c.id}&report=${R.keyOf(E("d1"))}`)).status === 403);
ok("only the committee releases", (await call(E("d1"), `?cycle=${c.id}&release=${R.keyOf(E("d1"))}`, "POST")).status === 403);
await call(E("jh"), `?cycle=${c.id}&release=${R.keyOf(E("d1"))}`, "POST");
ok("released: the director reads their own report", (await call(E("d1"), `?cycle=${c.id}&report=${R.keyOf(E("d1"))}`)).status === 200);
ok("…still not a colleague's", (await call(E("d1"), `?cycle=${c.id}&report=${R.keyOf(E("d2"))}`)).status === 403);
await call(E("vp"), `?cycle=${c.id}&notes=${R.keyOf(E("d1"))}`, "PUT", { meetings: "6 of 8", commitments: ["Attend every meeting", "Lead one event"] });
ok("the committee records meetings and commitments", (await call(E("d1"), `?cycle=${c.id}&report=${R.keyOf(E("d1"))}`)).report.commitments.length === 2);

// A sample cycle: made-up names, only for the testers.
const s = await call(E("pres"), "?sample=1", "POST");
ok("a sample is made", !!s.cycle);
ok("a tester sees it", (await call(E("jh"), `?cycle=${s.cycle}`)).sample === true);
ok("a director who isn't a tester doesn't", (await call(E("d1"), `?cycle=${s.cycle}`)).status === 404);
const srep = await call(E("jh"), `?cycle=${s.cycle}&report=${R.keyOf("alex.morgan@example.invalid")}`);
ok("its president's report has the extra questions and averages", srep.report?.rows.length === 12 && srep.report.rows.some((r) => r.avg !== null), JSON.stringify(srep).slice(0, 200));
ok("only the president or VP can delete", (await call(E("jh"), `?cycle=${s.cycle}`, "DELETE")).status === 403);
await call(E("pres"), `?cycle=${s.cycle}`, "DELETE");
ok("deleting removes it and every answer", !(await R.getCycle(s.cycle)) && (await S.listMetaKeys(`review:rate:${s.cycle}:`)).length === 0);

// The emails read right.
const om = M.openMessage(c, R.directorOf(c, E("d1")));
ok("the opening email: self-review first, the date, the peer round, and that ratings are anonymous", /self-review/.test(om.text) && /about 15 minutes/.test(om.text) && /saved without your name/.test(om.text) && !/\n\n\n/.test(om.text) && om.subject === "Board review 2027: your self-review");
ok("a first-year director's says they won't rate or be rated", /first year/.test(M.openMessage(c, d5).text));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
