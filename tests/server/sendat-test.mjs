// The day and time each automatic email goes, set from its line on Communications (Andrew 24 Nov 2026: "if I click that a
// calendar and time window appears and I can set the date and time I want it to send"). Made-up events; no real email.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const F = REPO + "netlify/functions/";
const events = (await import(F + "events.mjs")).default;
const S = await import(F + "lib/store.mjs");
const { setWhen, whenOf } = await import(F + "lib/sendat.mjs");
const { letterDue } = await import(F + "lib/sendletters.mjs");
const { partsDue } = await import(F + "lib/surveysend.mjs");
const { thanksDue } = await import(F + "lib/thanks.mjs");
const { certsDue } = await import(F + "lib/certauto.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (url, method = "GET", body) => { const r = await events(new Request("http://localhost" + url, { method, headers: H, body: body ? JSON.stringify(body) : undefined }));
  return { status: r.status, ...(await r.json().catch(() => ({}))) }; };

// A two-day event in Victoria in 2031, every email switched on, as if it were 1 Nov 2031 at noon there.
const NOW = new Date("2031-11-01T19:00:00Z");
const base = { id: "w31", title: "Western Symposium 2031", city: "Victoria, BC", dayOne: "2031-11-24", lastDay: "2031-11-25",
  auto: { welcome: true, reply: true, hotel: true, survey: true, certs: true }, welcome: { main: { subject: "Welcome", body: "Hello {first}" } },
  survey: { open: true, mode: "end", sendOn: "2031-11-26" } };
const fresh = () => JSON.parse(JSON.stringify(base));

// The welcome letter: a day before the event, a time of its own.
let e = fresh();
ok("the welcome letter: a day and time before the event", setWhen(e, "welcome", "2031-11-20", "14:30", NOW) === null && e.welcomeAt === "14:30" && whenOf(e, "welcome").day === "2031-11-20" && whenOf(e, "welcome").time === "14:30", JSON.stringify(whenOf(e, "welcome")));
ok("…not on the first day", /before the event starts/.test(setWhen(fresh(), "welcome", "2031-11-24", "09:00", NOW)));
ok("…nor after it", /before the event starts/.test(setWhen(fresh(), "welcome", "2031-11-27", "09:00", NOW)));
ok("no time already past", /already passed/.test(setWhen(fresh(), "welcome", "2031-11-01", "11:00", NOW)));
ok("…but later today is fine", setWhen(fresh(), "welcome", "2031-11-01", "13:00", NOW) === null);
// 20 Nov at 14:30 Victoria time is 21:30 UTC (or 22:30, as BC keeps daylight time or not).
ok("not due that day before 14:30 there", letterDue(e, "welcome", "2031-11-20", new Date("2031-11-20T20:00:00Z")).due === false);
ok("due from 14:30 there", letterDue(e, "welcome", "2031-11-20", new Date("2031-11-20T23:00:00Z")).due === true);
ok("with no time set, its day is enough (the morning run, as before)", letterDue({ ...e, welcomeAt: undefined }, "welcome", "2031-11-20", new Date("2031-11-20T14:00:00Z")).due === true);
ok("with no time set, the time shown is the morning run in the event's time", /^0[5-7]:00$/.test(whenOf({ ...e, welcomeAt: undefined }, "welcome").time), whenOf({ ...e, welcomeAt: undefined }, "welcome").time);

// The survey after the event.
e = fresh();
ok("the survey: its last day or later", setWhen(e, "survey", "2031-11-25", "16:00", NOW) === null && e.survey.sendOn === "2031-11-25" && e.survey.sendAt === "16:00");
ok("…not before the event is over", /once the event is over/.test(setWhen(fresh(), "survey", "2031-11-24", "16:00", NOW)));
ok("not before 16:00 there", partsDue(e, new Date("2031-11-25T22:00:00Z")).length === 0);
ok("from 16:00 there", partsDue(e, new Date("2031-11-26T01:00:00Z")).includes("end"));
ok("a daily survey's times are its sessions'", /each day's last session/.test(setWhen({ ...fresh(), survey: { open: true, mode: "daily" } }, "survey", "2031-11-26", "09:00", NOW)));

// The certificates and the thank-you: after the event.
e = fresh();
ok("certificates: a day after the event, a time", setWhen(e, "certs", "2031-11-27", "08:15", NOW) === null && whenOf(e, "certs").day === "2031-11-27" && whenOf(e, "certs").time === "08:15");
ok("…not on its last day", /after its last day/.test(setWhen(fresh(), "certs", "2031-11-25", "17:00", NOW)));
ok("…and they go from then", certsDue(e, new Date("2031-11-27T17:00:00Z")) === true && certsDue(e, new Date("2031-11-27T15:00:00Z")) === false);
e = fresh();
ok("the thank-you: a day and time of its own", setWhen(e, "thanks", "2031-11-28", "11:00", NOW) === null && whenOf(e, "thanks").day === "2031-11-28" && whenOf(e, "thanks").time === "11:00");
ok("…it goes that day from that time, not the day after the event", thanksDue(e, new Date("2031-11-28T20:00:00Z")) === true && thanksDue(e, new Date("2031-11-26T20:00:00Z")) === false && thanksDue(e, new Date("2031-11-28T17:00:00Z")) === false);
ok("hotel reminders aren't set here", /set where it lives/.test(setWhen(fresh(), "hotel", "2031-11-20", "09:00", NOW)));
ok("a time that isn't one is refused", /Pick a time/.test(setWhen(fresh(), "certs", "2031-11-27", "9am", NOW)));

// Through the desk.
const board = [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }];
const soon = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const ev = (await call("/api/events", "POST", { title: "Times Training", city: "Victoria, BC", dayOne: soon(20), lastDay: soon(21), board, invite: false })).event;
const shown = await call(`/api/events?id=${ev.id}`);
ok("the event page is told each email's day and time, and the event's time zone", shown.event?.sendWhen?.zone === "America/Vancouver" && shown.event.sendWhen.certs.day === soon(22) && shown.event.sendWhen.certs.time === "10:00", JSON.stringify(shown.event?.sendWhen));
const put = await call(`/api/events?id=${ev.id}&sendat=1`, "PUT", { kind: "certs", day: soon(23), time: "13:45" });
ok("setting one saves it", put.status === 200 && put.when.certs.day === soon(23) && put.when.certs.time === "13:45", JSON.stringify(put));
ok("…and keeps it", whenOf(await S.getEvent(ev.id), "certs").time === "13:45");
const bad = await call(`/api/events?id=${ev.id}&sendat=1`, "PUT", { kind: "welcome", day: soon(20), time: "09:00" });
ok("a refused one says why", bad.status === 409 && /before the event starts/.test(bad.error ?? ""), JSON.stringify(bad));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
