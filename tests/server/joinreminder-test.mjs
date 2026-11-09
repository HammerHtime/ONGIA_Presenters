// The reminder to those joining online, two hours before it starts, with how to log in (Andrew 5 Nov 2026).
const REPO = new URL("../../", import.meta.url).pathname;
process.env.RESEND_API_KEY = "test-key";
process.env.APP_URL = "https://events.example.org";
process.env.ADMIN_KEY = "testkey";
delete process.env.MS_MAIL_FROM;
const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.resend.com/")) { const p = JSON.parse(init.body); sent.push({ to: String(p.to), subject: p.subject, text: p.text }); return new Response(JSON.stringify({ id: "m" + sent.length }), { status: 200, headers: { "content-type": "application/json" } }); }
  throw new Error("unexpected fetch " + url);
};
const F = REPO + "netlify/functions/";
const { putEvent, getEvent, putAttendees } = await import(F + "lib/store.mjs");
const J = await import(F + "lib/joinreminder.mjs");
const { emailSchedule } = await import(F + "lib/schedule.mjs");
const attmail = (await import(F + "attmail.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const days = ["2026-11-09", "2026-11-10"];
await putEvent({ id: "ngs", title: "National Gang Summit", city: "Toronto", dayOne: days[0], lastDay: days[1], attendeeMail: true,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], wix: { eventId: "w1" },
  wixMore: [{ eventId: "w2", group: "Community partners" }, { eventId: "v-1", group: "Virtual", online: true, dayOne: days[0], lastDay: days[1] }],
  schedule: [{ date: days[0], start: "9:30 AM", end: "5:00 PM" }, { date: days[1], start: "9:00 AM", end: "4:00 PM" }],
  welcome: { main: { subject: "Welcome", body: "Hello {first}" }, xv1: { subject: "Online", body: "Hello {first},\n\nHOW TO JOIN\n\nThe Summit will stream on Zoom.\n\nJoin Zoom Meeting\nhttps://example.zoom.us/j/123?pwd=abc\nMeeting ID: 123\nPasscode: 999\n\nSCHEDULE\n\nMonday." } } });
await putAttendees("ngs", { people: [
  { key: "a", first: "Ann", email: "ann@example.ca", status: "ATTENDING", wixEventId: "w1", group: "" },
  { key: "v", first: "Val", email: "val@example.ca", status: "ATTENDING", wixEventId: "v-1", group: "Virtual" },
  { key: "w", first: "Wes", email: "wes@example.ca", status: "ATTENDING", wixEventId: "v-1", group: "Virtual" },
  // Registered both ways (Andrew 9 Nov 2026: "94 virtual in wix and the briefing room shows 93"): still gets the Zoom login.
  { key: "b1", first: "Bea", email: "bea@example.ca", status: "ATTENDING", wixEventId: "w1", group: "" },
  { key: "b2", first: "Bea", email: "bea@example.ca", status: "ATTENDING", wixEventId: "v-1", group: "Virtual" },
] });
let ev = await getEvent("ngs");
const key = J.onlineGroups(ev)[0]?.key;
const t = J.timesOf(ev, key);
ok("it starts at 9:30 Eastern and goes two hours before", t.startAt === "2026-11-09T14:30:00.000Z" && t.sendAt === "2026-11-09T12:30:00.000Z", JSON.stringify(t));
const w = J.joinWords(ev, key);
ok("the draft carries the Zoom link, meeting ID and passcode from the virtual welcome letter", /example\.zoom\.us/.test(w.body) && /Passcode: 999/.test(w.body) && !/SCHEDULE/.test(w.body), w.body);
ok("it isn't due until marked ready", !J.joinDue(ev, key, new Date("2026-11-09T12:40:00Z")));
const call = async (qs, method = "GET", body) => { const r = await attmail(new Request(`http://x/api/attmail?event=ngs&kind=join&key=${key}${qs}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, body: await r.json() }; };
const g = await call("");
ok("the page sees when it goes and to how many", g.body.reaches === 3 && g.body.sendAt === t.sendAt && !g.body.readyAt, JSON.stringify(g.body).slice(0, 200));
await call("", "PUT", { ready: true });
ev = await getEvent("ngs");
ok("marked ready: not before its time", !J.joinDue(ev, key, new Date("2026-11-09T12:00:00Z")) && J.joinDue(ev, key, new Date("2026-11-09T12:34:00Z")));
const S = await emailSchedule(await getEvent("ngs"), "2026-11-05");
const line = S.find((x) => /join online/.test(x.what));
ok("Coming up lists it at 7:30 am ET", line && line.date === "2026-11-09" && line.time === "07:30" && line.tz === "ET" && line.now?.type === "join", JSON.stringify(line));
const out = await J.sendJoinRound(ev, key, { now: new Date("2026-11-09T12:34:00Z") });
ok("at its time it goes to the three joining online, Bea too (also registered in person), not Ann in the room", out.sent === 3 && sent.some((m) => m.to === "bea@example.ca") && sent.every((m) => m.to !== "ann@example.ca") && /example\.zoom\.us/.test(sent[0].text), JSON.stringify(out));
ok("again: nobody gets it twice", (await J.sendJoinRound(await getEvent("ngs"), key, { now: new Date("2026-11-09T12:50:00Z") })).sent === 0);
ok("an hour into the first session it stops", !J.joinDue(ev, key, new Date("2026-11-09T15:31:00Z")));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
