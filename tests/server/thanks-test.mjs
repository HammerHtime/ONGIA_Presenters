// The presenter thank-you (Andrew 14 Nov 2026): "Goes out the day after the conference or training event ends, and it
// goes out personally to each one … set it up like we are the welcome emails, where I can edit it".
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
const T = await import(F + "lib/thanks.mjs");
const { emailSchedule } = await import(F + "lib/schedule.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };

const ev = { id: "vic", title: "Western Symposium", city: "Victoria, BC", dayOne: "2026-11-24", lastDay: "2026-11-24",
  survey: { token: "t", sessions: [{ id: "s1", day: "2026-11-24", title: "Gangs in BC", presenters: ["Ana Diaz"] }, { id: "s2", day: "2026-11-24", title: "Tobacco", presenters: ["Sam Lee"] }] } };
await S.putEvent(ev);
const sub = (talk) => ({ talk, bio: "b", outline: "o", phone: "1" });
await S.putPresenter({ id: "a", eventId: "vic", first: "Ana", last: "Diaz", email: "ana@x.ca", status: "approved", submission: sub("Gangs in BC") });
await S.putPresenter({ id: "b", eventId: "vic", first: "Sam", last: "Lee", email: "sam@x.ca", status: "submitted", submission: sub("") });
await S.putPresenter({ id: "c", eventId: "vic", first: "Jo", last: "Ray", email: "jo@x.ca", status: "invited" });
await S.putPresenter({ id: "d", eventId: "vic", first: "Old", last: "One", email: "old@x.ca", status: "withdrawn", submission: sub("Gone") });

ok("it goes the day after the last day", T.thanksDay(ev) === "2026-11-25");
ok("not on the last day itself", !T.thanksDue(ev, new Date("2026-11-24T20:00:00Z")));
ok("not before 9 am Victoria time on the day after (BC keeps daylight time now: 15:30 UTC is 8:30 there)", !T.thanksDue(ev, new Date("2026-11-25T15:30:00Z")));
ok("from 9 am Victoria time", T.thanksDue(ev, new Date("2026-11-25T16:05:00Z")));
ok("and not days later: an event that ended before this was built isn't thanked out of the blue", !T.thanksDue(ev, new Date("2026-11-26T18:00:00Z")));
ok("switched off, not at all", !T.thanksDue({ ...ev, presenterThanks: { off: true } }, new Date("2026-11-25T18:00:00Z")));

const people = T.thanksPeople(ev, await S.listPresenters("vic"));
ok("withdrawn presenters aren't listed", !people.some((p) => p.id === "d") && people.length === 3);
ok("everyone with an agreement, signed or only invited", people.every((p) => p.in));
ok("a talk with no title on the agreement takes the program's", people.find((p) => p.id === "b").talk === "Tobacco");

const sched = await emailSchedule(ev, "2026-11-14");
const row = sched.find((x) => x.what === "Presenter thank-you");
ok("Coming up lists it: Wed 25 Nov, 9:00 PT, to 3 presenters", row && row.date === "2026-11-25" && row.time === "09:00" && row.tz === "PT" && row.to === 3 && row.who === "presenters", JSON.stringify(row));

const r = await T.sendThanksRound(ev, { now: new Date("2026-11-25T17:05:00Z"), pace: async () => {} });
ok("three sent, one each, Jo too", r.sent === 3 && sent.length === 3 && sent.map((m) => m.to).sort().join() === "ana@x.ca,jo@x.ca,sam@x.ca", JSON.stringify(r));
ok("Jo, with no talk title, is thanked for presenting at the event", /thank you for presenting at Western Symposium on/.test(sent.find((m) => m.to === "jo@x.ca").text));
const ana = sent.find((m) => m.to === "ana@x.ca");
ok("greeted by first name, with their talk in quotes and the day", /Hi Ana,/.test(ana.text) && /thank you for presenting “Gangs in BC” at Western Symposium on Tuesday, November 24\./.test(ana.text), ana.text.slice(0, 300));
ok("the subject names the event", ana.subject === "Thank you for presenting at Western Symposium");
ok("Andrew's words are in it", /That kind of generosity is what ONGIA runs on/.test(ana.text) && /With gratitude,/.test(ana.text));
const again = await T.sendThanksRound(ev, { now: new Date("2026-11-25T17:20:00Z"), pace: async () => {} });
ok("nobody gets it twice", again.sent === 0 && sent.length === 3);
ok("and the 15-minute check sees nothing left to do", !(await T.thanksWorkDue([ev], new Date("2026-11-25T17:20:00Z"))));

// The desk: words changed for one event, someone added, a test, Send now to one.
const fn = (await import(F + "attmail.mjs")).default;
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = (q, method = "GET", body) => fn(new Request(`http://x/api/attmail?event=vic&kind=thanks${q}`, { method, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) }));
let v = await (await call("")).json();
ok("the card: standard words, on, the day, each presenter", v.standard && v.on && v.day === "2026-11-25" && v.people.length === 3 && v.people.find((p) => p.id === "a").sentAt);
v = await (await call("", "PUT", { subject: "Thanks, {first}", body: "Hi {first}, thanks for {talk} at {event}." })).json();
ok("own words kept for this event", !v.standard && v.subject === "Thanks, {first}");
ok("a blank that doesn't exist is refused", (await call("", "PUT", { subject: "x", body: "Hi {frist}" })).status === 409);
v = await (await call("", "PUT", { standard: true })).json();
ok("standard words back", v.standard && v.body === T.STANDARD.body && !(await S.getEvent("vic")).presenterThanks.body);
await S.putPresenter({ id: "e", eventId: "vic", first: "Kim", last: "Fox", email: "kim@x.ca", status: "approved" });
v = await (await call("", "PUT", { id: "e", pick: "no" })).json();
ok("Kim skipped on the card", v.people.find((p) => p.id === "e").in === false);
v = await (await call("", "PUT", { id: "e", pick: "" })).json();
ok("and back on", v.people.find((p) => p.id === "e").in);
const t = await call("&test=1", "POST", { to: "me@x.ca" });
ok("a test goes to the address given, marked TEST", t.status === 200 && sent.at(-1).to === "me@x.ca" && /^TEST: /.test(sent.at(-1).subject));
const now = await (await call("&send=1", "POST", {})).json();
ok("Send now: only Kim, added since, is owed and gets it; the others don't again", now.sent === 1 && sent.at(-1).to === "kim@x.ca", JSON.stringify(now.sent));
v = await (await call("", "PUT", { off: true })).json();
ok("switched off", v.on === false && (await emailSchedule({ ...(await S.getEvent("vic")) }, "2026-11-14")).find((x) => x.what === "Presenter thank-you") === undefined);
ok("no key, no access", (await fn(new Request("http://x/api/attmail?event=vic&kind=thanks"))).status === 401);

if (process.env.THANKS_HTML) (await import("node:fs")).writeFileSync(process.env.THANKS_HTML, ana.html);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
