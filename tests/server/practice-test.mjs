// Practice events from the Sandbox (Andrew 30 Oct 2026): an RBH ITP week with 12 made-up attendees who all answered, and a
// symposium with people checked in for certificates. Made-up addresses no mail can reach, never emailed, removed in one go.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
process.env.COSTING_USERS = "president@ongia.ca,vp_operations@ongia.ca";
process.env.RESEND_API_KEY = "re_test";
const F = REPO + "netlify/functions/";
let sentMail = 0;
globalThis.fetch = async (url) => { if (String(url).includes("resend")) { sentMail++; return Response.json({ id: "x" }); } throw new Error("unexpected fetch " + url); };
const { getAttendees, getSurveyResponses, getMeta, listEvents } = await import(F + "lib/store.mjs");
const { issueSession } = await import(F + "lib/auth.mjs");
const { factsFor, halfBack } = await import(F + "lib/reports.mjs");
const { sendMail } = await import(F + "lib/mail.mjs");
const { issue, certSettings } = await import(F + "lib/certs.mjs");
const sandbox = (await import(F + "sandbox.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const call = async (method, who = issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" })) => {
  const r = await sandbox(new Request("http://x/api/sandbox?practice=1", { method, headers: { "x-admin-key": who, "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined }));
  return { status: r.status, body: await r.json() };
};

ok("only the president and the VP can make them", (await call("POST", issueSession({ email: "member@ongia.ca", name: "Board Member" }))).status === 403);
let out = await call("POST");
ok("two practice events are made", out.status === 200 && out.body.events.length === 2, JSON.stringify(out.body));
const all = await listEvents();
const itp = all.find((e) => e.practice && e.kind === "rbh"), sym = all.find((e) => e.practice && e.kind !== "rbh");
ok("an RBH ITP week and a symposium, both marked practice, Andrew as lead", /ITP Week/.test(itp?.title) && itp.province === "QC" && /Symposium/.test(sym?.title) && itp.board[0].email === "president@ongia.ca");
const ip = (await getAttendees(itp.id)).people, sp = (await getAttendees(sym.id)).people;
ok("12 attendees on the ITP week, all checked in and sent the survey", ip.length === 12 && ip.every((p) => p.checkedIn && p.sent.includes("survey:end")));
ok("every address is a made-up one no mail can reach", [...ip, ...sp].every((p) => p.email.endsWith("@practice.invalid")));
ok("all 12 answered the survey, some in French, with comments", (await getSurveyResponses(itp.id)).length === 12 && (await getSurveyResponses(itp.id)).some((r) => r.lang === "fr"));
const f = await factsFor(itp);
ok("so the reports are ready to make: 12 of 12 back", f.answered === 12 && f.invited === 12 && halfBack(f) && f.comments.length >= 5);
ok("the symposium: 24 registered, 20 checked in, 16 answered", sp.length === 24 && sp.filter((p) => p.checkedIn).length === 20 && (await getSurveyResponses(sym.id)).length === 16);

// Nothing is ever sent to them.
const r1 = await sendMail({ to: ip[0].email, subject: "x", html: "x", text: "x" });
ok("the mailer refuses a practice address", r1.skipped && sentMail === 0, JSON.stringify(r1));
await sendMail({ to: [ip[0].email, "real.person@ongia.ca"], subject: "x", html: "x", text: "x" });
ok("and drops it from a list that also has a real one", sentMail === 1);

// Making them again replaces them; removing takes everything, certificates included.
const p0 = { key: sp[0].key, email: sp[0].email };
const rec = await issue(sym, p0, { name: "Practice Person", agency: "TPS", settings: certSettings(sym) });
out = await call("POST");
const again = (await listEvents()).filter((e) => e.practice);
ok("made again: still just two, fresh ones", again.length === 2 && !again.some((e) => e.id === itp.id));
ok("the old ones' certificates went with them", !(await getMeta(`certs:code:${rec.code}`)));
out = await call("DELETE");
ok("Remove them: none left, nor their answers", out.body.events.length === 0 && !(await listEvents()).some((e) => e.practice) && (await getSurveyResponses(again[0].id)).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
