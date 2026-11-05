// Coming up: every email the desk will send on its own, its day, and to how many (Andrew 5 Nov 2026).
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const F = REPO + "netlify/functions/";
const { putEvent, putAttendees, getEvent, putPresenter } = await import(F + "lib/store.mjs");
const { emailSchedule } = await import(F + "lib/schedule.mjs");
const { startingReply } = await import(F + "lib/reply.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const days = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"];
await putEvent({ id: "ngs", title: "National Gang Summit", city: "Toronto", dayOne: days[0], lastDay: days[3], attendeeMail: true, noDeadlines: true,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], wix: { eventId: "w1" },
  wixMore: [{ eventId: "w2", group: "Community partners", dayOne: days[1], lastDay: days[2] }, { eventId: "v", group: "Virtual", online: true, dayOne: days[0], lastDay: days[3] }],
  schedule: days.map((date) => ({ date, start: "09:00", end: "16:00" })),
  tasks: [{ id: "t1", what: "Welcome letter sent to attendees", daysBefore: 6, auto: "welcome" }],
  welcome: { main: { subject: "Welcome", body: "Hello {first}" }, group: { subject: "Welcome", body: "Hello {first}" }, xv: { subject: "Online", body: "Hello {first}" } },
  survey: { open: true, mode: "daily" } });
const e = await getEvent("ngs");
await putEvent({ ...e, reply: { ...startingReply(e), sentAt: "2026-10-20T00:00:00Z", open: true, replyBy: "2026-11-08", reminders: ["2026-11-04", "2026-11-07"] } });
await putAttendees("ngs", { people: [
  { key: "a", first: "A", email: "a@example.ca", status: "ATTENDING", wixEventId: "w1", group: "", sent: ["welcome", "reply"] },
  { key: "b", first: "B", email: "b@example.ca", status: "ATTENDING", wixEventId: "w1", group: "", sent: ["reply"] },
  { key: "c", first: "C", email: "c@example.ca", status: "ATTENDING", wixEventId: "w2", group: "Community partners", sent: ["welcome"] },
  { key: "v", first: "V", email: "v@example.ca", status: "ATTENDING", wixEventId: "v", group: "Virtual", sent: ["welcome"] },
] });
const S = await emailSchedule(await getEvent("ngs"), "2026-11-02");
const line = (w) => S.filter((x) => x.what.startsWith(w));
ok("in date order", S.every((x, i) => !i || S[i - 1].date <= x.date), JSON.stringify(S.map((x) => x.date)));
ok("the welcome letter: only the version someone is still owed, and how many", line("Welcome letter").length === 1 && line("Welcome letter")[0].to === 1 && line("Welcome letter")[0].date === "2026-11-03", JSON.stringify(line("Welcome")));
ok("food-allergy reminders from today on, to those in the room who haven't answered", line("Food allergies").length === 2 && line("Food allergies")[0].to === 2, JSON.stringify(line("Food")));
const surv = line("Survey");
ok("each day's survey, to the people with that day", surv.length === 4 && surv[0].to === 3 && surv[1].to === 4, JSON.stringify(surv));
ok("welcome letters and reminders can be sent now; the survey can't", line("Welcome letter")[0].now?.type === "welcome" && line("Food allergies")[0].now?.type === "remind" && !surv[0].now);
ok("no presenter reminders on a one-date event", !line("Agreement").length);
const later = await emailSchedule(await getEvent("ngs"), "2026-11-08");
ok("what's past drops off", !later.some((x) => x.what.startsWith("Welcome") || x.what.startsWith("Food")) && later[0].date === "2026-11-09");
const off = await emailSchedule({ ...(await getEvent("ngs")), attendeeMail: false }, "2026-11-02");
ok("with attendee emails off, each says it won't go (not the online reminder, which goes when marked ready)", off.filter((x) => x.who === "attendees" && !/join online/.test(x.what)).every((x) => /won't go/.test(x.note)));

// An event with an agreement date: reminders to presenters who haven't signed.
await putEvent({ id: "reg", title: "Regina", city: "Regina", dayOne: "2026-12-10", lastDay: "2026-12-10", board: [{ name: "R", email: "r@ongia.ca", lead: true }], deadlines: { agreement: "2026-11-20", draft: "2026-11-25", final: "2026-12-01" } });
await putPresenter({ id: "p1", eventId: "reg", token: "t1", first: "P", last: "One", email: "p1@example.ca", status: "invited", mail: [{ type: "invite", at: "2026-11-01" }] });
await putPresenter({ id: "p2", eventId: "reg", token: "t2", first: "P", last: "Two", email: "p2@example.ca", status: "approved", mail: [{ type: "invite", at: "2026-11-01" }] });
const R = await emailSchedule(await getEvent("reg"), "2026-11-10");
ok("agreement reminders, to the presenters who haven't signed", R.length >= 5 && R.every((x) => x.who === "presenters" && x.to === 1) && R[0].date === "2026-11-13", JSON.stringify(R.slice(0, 3)));
{ const { dailyTimes, hhmm24 } = await import(F + "lib/surveysend.mjs");
  ok("session times typed as \"5:00 PM\" are read (the Summit's), so a daily survey goes 15 minutes after", JSON.stringify(dailyTimes({ dayOne: "2026-11-09", lastDay: "2026-11-10", schedule: [{ date: "2026-11-09", end: "5:00 PM" }, { date: "2026-11-10", end: "16:00" }] }).map((t) => t.at)) === '["17:15","16:15"]');
  ok("and 12 PM is noon, 12 AM midnight", hhmm24("12:00 PM") === "12:00" && hhmm24("12:30 AM") === "00:30" && hhmm24("whenever") === null); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
