// Who is emailed what: the lead, the president and the VP, not every board member on the event.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
process.env.RESEND_API_KEY = "test-key";          // real sends go through Resend's API; fetch is replaced below to capture them
delete process.env.MS_MAIL_FROM;
const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.resend.com/")) {
    const p = JSON.parse(init.body);
    sent.push({ to: p.to, subject: p.subject, attachments: (p.attachments ?? []).length });
    return new Response(JSON.stringify({ id: "m" + sent.length }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error("unexpected fetch " + url);
};
const F = REPO + "netlify/functions/";
const events = (await import(F + "events.mjs")).default;
const agreement = (await import(F + "agreement.mjs")).default;
const review = (await import(F + "review.mjs")).default;
const volunteers = (await import(F + "volunteers.mjs")).default;
const volunteer = (await import(F + "volunteer.mjs")).default;
const roster = (await import(F + "roster.mjs")).default;
const { listPresenters, getEvent, putEvent } = await import(F + "lib/store.mjs");
const { agreementRecipients } = await import(F + "lib/mail.mjs");
const { runReminders } = await import(F + "lib/reminders.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (h, url, method = "GET", body, headers = H) => { const r = await h(new Request("http://localhost" + url, { method, headers, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
const set = (to) => [...to].map((x) => x.toLowerCase()).sort().join(",");
const LEAD = "treasurer@ongia.ca", PRES = "president@ongia.ca", VP = "vp_operations@ongia.ca";
const lastTo = (re) => sent.filter((m) => re.test(m.subject)).at(-1);
await call(roster, "/api/roster");

const ev = (await call(events, "/api/events", "POST", { title: "Big Event", city: "Toronto", dayOne: "2026-11-09", lastDay: "2026-11-12", invite: false,
  board: [{ name: "Raj Jaswal", email: LEAD, lead: true }, { name: "John Healy", email: "j.healy@ongia.ca" }, { name: "Barb Konkle", email: "b.konkle@ongia.ca" }, { name: "Andrew Hammond", email: PRES }],
  presenters: [{ first: "Dana", last: "Presenter", email: "dana@example.ca", organization: "Test Police" }] })).event;
ok("the event has four board members on it: the lead, two others, and the president", ev.board.length === 4 && ev.notify.length === 3);

console.log("— the rule");
ok("the lead, the president and the VP, once each", set(agreementRecipients(ev)) === set([LEAD, PRES, VP]), JSON.stringify(agreementRecipients(ev)));
ok("a volunteer lead is added for a volunteer, and only for a volunteer", set(agreementRecipients({ ...ev, volunteerLead: { email: "j.healy@ongia.ca" } }, { volunteer: true })) === set([LEAD, PRES, VP, "j.healy@ongia.ca"]) && set(agreementRecipients({ ...ev, volunteerLead: { email: "j.healy@ongia.ca" } })) === set([LEAD, PRES, VP]));
ok("addresses are not repeated whatever their case", agreementRecipients({ reviewer: { email: "President@ongia.ca" }, contact: { email: "president@ongia.ca" } }).length === 2);
process.env.OFFICERS_TO = "a@x.ca;b@x.ca";
ok("OFFICERS_TO changes the president and VP", set(agreementRecipients(ev)) === set([LEAD, "a@x.ca", "b@x.ca"]));
delete process.env.OFFICERS_TO;

console.log("— a presenter's agreement");
const [dana] = await listPresenters(ev.id);
const answers = { first: "Dana", last: "Presenter", email: "dana@example.ca", phone: "4165550100", organization: "Test Police", talk: "T", bio: "word ".repeat(40), outline: "An outline.",
  travel: "no", hotel: "no", expenses: { transport: "no", meals: "no", other: "no", otherText: "" }, copyright: true, noInvestigation: true, termsAccepted: true,
  media: { photo: { internal: "yes", public: "yes" }, materials: { internal: "yes", public: "no" }, summary: { internal: "yes", public: "yes" }, bio: { internal: "yes", public: "yes" } }, sensitive: "no", signature: "Dana Presenter", agreed: true, language: "en" };
let r = await call(agreement, `/api/agreement?t=${dana.token}`, "POST", answers, { "content-type": "application/json" });
ok("she signs", r.status === 200, JSON.stringify(r));
let m = lastTo(/Ready for review/);
ok("'Ready for review' goes to the lead, the president and the VP: not to Healy or Konkle", m && set(m.to) === set([LEAD, PRES, VP]), JSON.stringify(m));
const p2 = (await listPresenters(ev.id))[0];
r = await call(review, `/api/review?event=${ev.id}&presenter=${p2.id}&action=approve`, "POST", { approverName: "Raj Jaswal", attest: true, covers: {} });
ok("it is approved", r.ok === true, JSON.stringify(r));
m = lastTo(/^Final:/);
ok("the 'Final' notice goes to the lead, the president and the VP only", m && set(m.to) === set([LEAD, PRES, VP]), JSON.stringify(m));
m = lastTo(/Your signed presenter agreement/);
ok("the presenter's own copy goes to the presenter alone, with the PDF attached", m && set(m.to) === set(["dana@example.ca"]) && m.attachments === 1, JSON.stringify(m));
ok("nothing about this agreement went to the other board members", !sent.some((x) => x.to.some((a) => /healy|konkle/i.test(a))), JSON.stringify(sent.map((x) => x.to)));

console.log("— a volunteer's agreement");
await call(volunteers, `/api/volunteers?event=${ev.id}&lead=1`, "PUT", { email: "j.healy@ongia.ca" });
await call(volunteers, `/api/volunteers?event=${ev.id}`, "POST", { invite: false, volunteers: [{ first: "Vic", last: "Nohotel", email: "vic@example.ca", organization: "OPP" }, { first: "Val", last: "Hotel", email: "val@example.ca", organization: "OPP" }] });
const vols = (await call(volunteers, `/api/volunteers?event=${ev.id}`)).volunteers;
const sign = (v, accommodation) => call(volunteer, `/api/volunteer?t=${v.token}`, "POST", { first: v.first, last: v.last, email: v.email, phone: "4165550111", organization: "OPP", accommodation, termsAccepted: true, standing: true, signature: `${v.first} ${v.last}`, agreed: true, language: "en" }, { "content-type": "application/json" });
const volTo = set([LEAD, PRES, VP, "j.healy@ongia.ca"]);
await sign(vols.find((x) => x.first === "Vic"), "no");
m = lastTo(/^Signed: Vic Nohotel/);
ok("a volunteer who needs no room: the notice goes to the lead, the volunteer lead, the president and the VP, not Konkle", m && set(m.to) === volTo && !m.to.includes("b.konkle@ongia.ca"), JSON.stringify(m));
m = lastTo(/Your signed volunteer agreement/);
ok("and their own copy goes to the volunteer alone, with the PDF attached", m && set(m.to) === set(["vic@example.ca"]) && m.attachments === 1, JSON.stringify(m));
const val = vols.find((x) => x.first === "Val");
await sign(val, "yes");
m = lastTo(/Ready for review: Val Hotel/);
ok("a volunteer who needs a room: 'Ready for review' goes to the same four", m && set(m.to) === volTo, JSON.stringify(m));
r = await call(volunteers, `/api/volunteers?event=${ev.id}&id=${val.id}&action=approve`, "POST", { approverName: "Raj Jaswal", hotel: { need: "yes", from: "2026-11-08", to: "2026-11-10", pays: "ONGIA" } });
m = lastTo(/^Signed: Val Hotel/);
ok("once approved, the notice goes to the same four", r.ok && m && set(m.to) === volTo, JSON.stringify(m));
ok("no volunteer email went to Konkle", !sent.some((x) => x.to.includes("b.konkle@ongia.ca")));

console.log("— the overdue-agreements email");
const due = new Date(Date.now() + 80 * 86400000).toISOString().slice(0, 10);          // agreements were due about ten days ago (whatever weekend or holiday moves the date)
const evo = (await call(events, "/api/events", "POST", { title: "Overdue Event", city: "Ottawa", dayOne: due, lastDay: due, invite: false,
  board: [{ name: "Raj Jaswal", email: LEAD, lead: true }, { name: "John Healy", email: "j.healy@ongia.ca" }, { name: "Barb Konkle", email: "b.konkle@ongia.ca" }],
  presenters: [{ first: "Late", last: "Presenter", email: "late@example.ca", organization: "Test" }] })).event;
// The board's overdue email goes on the 3rd, 10th, 17th… day after the agreement deadline: put this one exactly 3 days past.
// Counted from the desk's own today (Eastern), as the reminders are: a UTC date is a day ahead in the evening.
{ const { todayIso } = await import(F + "lib/deadlines.mjs");
  const e = await getEvent(evo.id); e.deadlines = { ...e.deadlines, agreement: new Date(Date.parse(todayIso()) - 3 * 86400000).toISOString().slice(0, 10) }; await putEvent(e); }
const plan = (await runReminders({ dry: true, origin: "http://x", onlyEvent: evo.id })).results.filter((x) => x.kind === "board");
ok("an overdue-agreements email is planned", plan.length === 1, JSON.stringify(plan));
ok("it goes to the lead, the president and the VP, not the rest of the board on the event", plan[0] && set(plan[0].to.split(/,\s*/)) === set([LEAD, PRES, VP]), plan[0]?.to);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
