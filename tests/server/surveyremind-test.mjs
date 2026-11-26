// Survey reminders (Andrew 14 Nov 2026): "the second business day post-conference ... if training finishes on a Thursday,
// Friday would be 1, and then Monday would be the 2nd. And then 1 week later, we do the last one." Only to people who
// haven't answered, with a button for each day they still owe.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.RESEND_API_KEY = "test-key"; process.env.APP_URL = "https://events.example.org"; process.env.ADMIN_KEY = "testkey";
delete process.env.MS_MAIL_FROM;
const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.resend.com/")) { const p = JSON.parse(init.body); sent.push({ to: String(p.to), subject: p.subject, text: p.text, html: p.html }); return Response.json({ id: "m" + sent.length }); }
  throw new Error("unexpected fetch " + url);
};
const F = REPO + "netlify/functions/";
const S = await import(F + "lib/store.mjs");
const R = await import(F + "lib/surveysend.mjs");
const { personalId } = await import(F + "lib/letters.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };

const ev = { id: "ngs", title: "National Gang Summit: Building Solutions", city: "Toronto, ON", dayOne: "2026-11-09", lastDay: "2026-11-12", attendeeMail: true, board: [], contact: { name: "Andrew Hammond", email: "president@ongia.ca" },
  survey: { token: "tok1234567890abcd", open: true, mode: "daily", sessions: [{ id: "s1", day: "2026-11-09", title: "A", presenters: ["X"] }, { id: "s2", day: "2026-11-10", title: "B", presenters: ["Y"] }] } };
ev.tasks = [{ id: "svjob", what: "Survey link sent to attendees", daysBefore: -2, auto: "survey", done: false }];
await S.putEvent(ev);
ok("ends Thursday 12 Nov: Friday is one, Monday 16 Nov is two, and the last a week after", R.reminderDates(ev).join() === "2026-11-16,2026-11-23", R.reminderDates(ev).join());
ok("a Friday finish: Monday and Tuesday, then a week later", R.reminderDates({ ...ev, lastDay: "2026-11-13" }).join() === "2026-11-17,2026-11-24");
ok("nothing due on the Sunday before", R.reminderDue(ev, new Date("2026-11-15T20:00:00Z")) === null);
ok("the first is due Monday from 9 am Toronto time, not before", R.reminderDue(ev, new Date("2026-11-16T13:30:00Z")) === null && R.reminderDue(ev, new Date("2026-11-16T14:30:00Z")) === 1);
ok("the last from the following Monday", R.reminderDue(ev, new Date("2026-11-23T15:00:00Z")) === 2);
ok("and nothing weeks later", R.reminderDue(ev, new Date("2026-12-20T15:00:00Z")) === null);
ok("switched off on the Setup, none", R.reminderDue({ ...ev, survey: { ...ev.survey, remind: false } }, new Date("2026-11-16T15:00:00Z")) === null);

const row = (key, first, email, sentParts) => ({ key, first, email, status: "ATTENDING", source: "wix", sent: sentParts.map((p) => `survey:${p}`) });
await S.putAttendees("ngs", { people: [
  row("a", "Ann", "ann@x.ca", ["2026-11-09", "2026-11-10"]),   // answered both
  row("b", "Ben", "ben@x.ca", ["2026-11-09", "2026-11-10"]),   // answered day 1 only
  row("c", "Cat", "cat@x.ca", ["2026-11-09", "2026-11-10"]),   // answered none (or by QR)
  row("d", "Dee", "dee@x.ca", []),                             // never sent the survey
] });
await S.putSurveyDone("ngs", personalId(ev.survey.token, { key: "a" }), { parts: ["2026-11-09", "2026-11-10"] });
await S.putSurveyDone("ngs", personalId(ev.survey.token, { key: "b" }), { parts: ["2026-11-09"] });
const owed = await R.stillOwed(ev, (await S.getAttendees("ngs")).people);
ok("still owed: Ben day 2, Cat both days; not Ann, who answered all, nor Dee, who was never sent it", JSON.stringify(owed.map((o) => [o.person.first, o.parts])) === JSON.stringify([["Ben", ["2026-11-10"]], ["Cat", ["2026-11-09", "2026-11-10"]]]), JSON.stringify(owed.map((o) => [o.person.first, o.parts])));

const out = await R.sendReminderRound(ev, 1, { pace: async () => {} });
ok("reminder 1 goes to Ben and Cat only", out.sent === 2 && sent.map((m) => m.to).sort().join() === "ben@x.ca,cat@x.ca", JSON.stringify(out));
const ben = sent.find((m) => m.to === "ben@x.ca"), cat = sent.find((m) => m.to === "cat@x.ca");
ok("Ben's has one button, Day 2, to day 2's sessions with his own link", /Day 2 · Tuesday, November 10: https:\/\/events\.example\.org\/f\/tok1234567890abcd\/[0-9a-f]{16}\?lang=en&part=2026-11-10/.test(ben.text) && !/Day 1 ·/.test(ben.text), ben.text);
ok("Cat's has Day 1 and Day 2, and the French buttons too", /Day 1 · Monday, November 9/.test(cat.text) && /Day 2 · Tuesday, November 10/.test(cat.text) && /Jour 1 · lundi 9 novembre/.test(cat.text), cat.text);
ok("it says a QR code answer counts, and names the event", /Already answered by scanning the QR code\? Then you're done/.test(cat.text) && /^National Gang Summit: a reminder about the survey/.test(cat.subject), cat.subject);
// The checklist job (Andrew 26 Nov 2026): open while people still owe it, until the last reminder has gone.
const job = async () => (await S.getEvent("ngs")).tasks.find((t) => t.id === "svjob");
ok("after the first reminder, with people still to answer, the survey job stays open", (await job()).done === false);
ok("again: nobody gets reminder 1 twice", (await R.sendReminderRound(ev, 1, { pace: async () => {} })).sent === 0);
// Ben answers day 2 before the last reminder.
await S.putSurveyDone("ngs", personalId(ev.survey.token, { key: "b" }), { parts: ["2026-11-09", "2026-11-10"] });
const before = sent.length;
const out2 = await R.sendReminderRound(ev, 2, { pace: async () => {} });
ok("the last reminder: only Cat, and it says it's the last", out2.sent === 1 && sent.at(-1).to === "cat@x.ca" && /This is our last reminder/.test(sent.at(-1).text) && /last reminder/.test(sent.at(-1).subject) && sent.length === before + 1);
ok("once the last reminder has gone, the survey job ticks itself", (await job()).done === true && /last reminder sent/.test((await job()).doneBy), JSON.stringify(await job()));
// Everyone answering ticks it sooner.
{ const e2 = { ...ev, id: "ngs2", tasks: [{ id: "svjob", what: "Survey link sent to attendees", daysBefore: -2, auto: "survey", done: false }] };
  await S.putEvent(e2);
  await S.putAttendees("ngs2", { people: [row("a", "Ann", "ann@x.ca", ["2026-11-09", "2026-11-10"])] });
  await S.putSurveyDone("ngs2", personalId(ev.survey.token, { key: "a" }), { parts: ["2026-11-09", "2026-11-10"] });
  ok("when everyone has answered, it ticks at the first reminder", (await R.settleSurveyJob(e2, { reminder: true })) === "everyone answered");
  await S.putEvent({ ...e2, id: "ngs3" });
  await S.putAttendees("ngs3", { people: [row("a", "Ann", "ann@x.ca", ["2026-11-09"])] });
  await S.putSurveyDone("ngs3", personalId(ev.survey.token, { key: "a" }), { parts: ["2026-11-09"] });
  ok("…but never after day one of a daily survey, before the last day has gone", (await R.settleSurveyJob({ ...e2, id: "ngs3" }, { lastPart: false })) === false); }
// The 15-minute check and the morning run pick it up on its day.
await S.putEvent(ev);
ok("the 15-minute check sees no work once everyone owed has had it", (await R.surveyWorkDue([ev], new Date("2026-11-23T15:00:00Z"))) === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
