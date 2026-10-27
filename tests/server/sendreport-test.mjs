// Emails to attendees go out on the server and the officers hear about any that did not (Andrew 27 Oct 2026: "Is this
// going to be a problem when we send out 400 welcome emails? Is there way for this to run in the background and just
// alert me when some emails dont send").
const REPO = new URL("../../", import.meta.url).pathname;
process.env.RESEND_API_KEY = "test-key";
process.env.APP_URL = "https://events.example.org";
process.env.ADMIN_KEY = "testkey";
process.env.OFFICERS_TO = "president@ongia.ca";
delete process.env.MS_MAIL_FROM;
const F = REPO + "netlify/functions/";
const mails = [], started = [];
let backgroundUp = true;
const surveyRunner = (await import(F + "survey-send-background.mjs")).default;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith("https://api.resend.com/")) {
    const p = JSON.parse(init.body);
    if (String(p.to).includes("bounce@")) return new Response(JSON.stringify({ message: "The recipient's address is not valid." }), { status: 422, headers: { "content-type": "application/json" } });
    mails.push({ to: [].concat(p.to).join(","), subject: p.subject, html: p.html, text: p.text });
    return new Response(JSON.stringify({ id: "m" + mails.length }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (u.includes("/api/survey-send-background")) {
    started.push(u);
    if (!backgroundUp) return new Response("no", { status: 502 });
    await surveyRunner(new Request(u, init));
    return new Response(null, { status: 202 });
  }
  throw new Error("unexpected fetch " + u);
};
const { putEvent, getEvent, putAttendees, getMeta, putMeta } = await import(F + "lib/store.mjs");
const { reportSends } = await import(F + "lib/sendreport.mjs");
const { runLetterRounds } = await import(F + "lib/sendletters.mjs");
const tick = (await import(F + "survey-tick.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const reports = () => mails.filter((m) => /^\[Desk\] Some attendee emails did not go/.test(m.subject));

// The report itself.
ok("when everything went, nobody is emailed", !(await reportSends("the test", [{ title: "Summit", what: "The welcome letter", sent: 400, failed: 0 }])).told && !reports().length);
await reportSends("the test", [{ title: "Summit", what: "The welcome letter", sent: 398, failed: 2, trouble: [{ email: "x@example", why: "not valid" }, { email: "y@example.ca", why: "mailbox full" }] }]);
const r1 = reports()[0];
ok("when some did not go, the officers get one email naming who and why", r1?.to === "president@ongia.ca" && /398 sent/.test(r1.html) && /2 could not be sent/.test(r1.html) && /x@example \(not valid\)/.test(r1.html) && /mailbox full/.test(r1.text), JSON.stringify(r1));
await reportSends("the test", [{ title: "Summit", what: "The survey", blocked: ["The survey has no sessions to rate."] }]);
ok("a round held back is reported, with why", /held back, so nobody got it: The survey has no sessions to rate/.test(reports()[1]?.html));

// A welcome letter whose day comes with nothing saved on the Communications tab is reported, not skipped quietly.
await putEvent({ id: "w", title: "Calgary Training", city: "Calgary", dayOne: "2026-11-20", lastDay: "2026-11-20", board: [], attendeeMail: true,
  tasks: [{ id: "t1", what: "Welcome letter sent to attendees", daysBefore: 7, auto: "welcome", due: "2026-11-13" }] });
await putAttendees("w", { people: [{ key: "a", first: "Ari", email: "ari@example.ca", status: "ATTENDING" }] });
const early = await runLetterRounds([await getEvent("w")], { today: "2026-11-10", pace: async () => {} });
ok("before its day, an unsaved welcome letter is not reported", !early.find((r) => r.kind === "welcome")?.warn, JSON.stringify(early));
const late = await runLetterRounds([await getEvent("w")], { today: "2026-11-14", pace: async () => {} });
const wl = late.find((r) => r.kind === "welcome");
ok("on or after its day, it is: due but not saved, with the day it was due", /isn't saved on the event's Communications tab/.test(wl?.warn ?? "") && /13 Nov 2026/.test(wl.warn), JSON.stringify(late));

// The survey: the 15-minute check hands the sending to the background run, which reports the address that bounced.
const sessions = [{ id: "s1", day: "2026-11-09", title: "Following the Money", presenters: ["Jordan Avery"] }];
await putEvent({ id: "ngs", title: "National Gang Summit", city: "Toronto, ON", dayOne: "2026-11-09", lastDay: "2026-11-09", board: [], attendeeMail: true,
  schedule: [{ date: "2026-11-09", start: "08:30", end: "16:00" }], survey: { token: "tok12345678", open: true, mode: "end", sendOn: "2020-01-01", sessions } });
await putAttendees("ngs", { people: ["a", "b", "c", "bounce"].map((k) => ({ key: k, first: k, email: `${k}@example.ca`, status: "ATTENDING" })) });
mails.length = 0;
const first = await (await tick()).text();
const surveys = mails.filter((m) => !/^\[Desk\]/.test(m.subject));
ok("with a survey due, the check starts the background run", first === "started" && started.length === 1, first);
ok("which sends it to everyone it can", surveys.length === 3 && ["a", "b", "c"].every((k) => surveys.some((m) => m.to === `${k}@example.ca`)), JSON.stringify(surveys.map((m) => m.to)));
ok("and emails the officers about the one that bounced", reports().length === 1 && /bounce@example\.ca/.test(reports()[0].html) && /The survey/.test(reports()[0].html), JSON.stringify(reports()));
ok("when it is done, the next check may start again", !(await getMeta("survey-sending"))?.at);
await putMeta("survey-sending", { at: new Date().toISOString(), hop: 0 });
ok("while a run is going, the check leaves it be", (await (await tick()).text()) === "already sending" && started.length === 1);
await putMeta("survey-sending", { at: null });

// Nobody left to send to (the bounced address aside, which stays owed): a check with nothing due does nothing.
await putAttendees("ngs", { people: ["a", "b", "c"].map((k) => ({ key: k, first: k, email: `${k}@example.ca`, status: "ATTENDING", sent: ["survey:end"] })) });
const quiet = await (await tick()).text();
ok("with everyone sent, the check does nothing", quiet === "ok" && started.length === 1, quiet);

// If the background run cannot be started, the check sends what it can itself, as before.
await putAttendees("ngs", { people: [{ key: "d", first: "d", email: "d@example.ca", status: "ATTENDING" }] });
backgroundUp = false; mails.length = 0;
await tick();
ok("if the background run can't start, the check sends it itself", mails.some((m) => m.to === "d@example.ca") && !(await getMeta("survey-sending"))?.at);

// The background run takes only the desk's key.
ok("the survey's background run refuses anyone without the desk's key", (await surveyRunner(new Request("http://x/api/survey-send-background", { method: "POST" }))).status === 401);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
