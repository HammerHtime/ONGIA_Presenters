// A switch for each automatic email (Andrew 24 Nov 2026: "a toggle (on and off) for each of the auto emails … when it's
// set to off, then a send now button appears"). Made-up events throughout; no real email.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const F = REPO + "netlify/functions/";
const events = (await import(F + "events.mjs")).default;
const S = await import(F + "lib/store.mjs");
const { autoOn, autoState, setAuto } = await import(F + "lib/autosend.mjs");
const { letterDue } = await import(F + "lib/sendletters.mjs");
const { hotelDueToday } = await import(F + "lib/hotel.mjs");
const { thanksDue } = await import(F + "lib/thanks.mjs");
const { emailSchedule } = await import(F + "lib/schedule.mjs");
const { todayIso } = await import(F + "lib/deadlines.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (url, method = "GET", body) => { const r = await events(new Request("http://localhost" + url, { method, headers: H, body: body ? JSON.stringify(body) : undefined }));
  return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
const day = (n) => todayIso(new Date(Date.now() + n * 86400e3));

// An event that had the old one switch on: every attendee email follows it, certificates stay off, the thank-you is its own.
const old = { id: "old", title: "Old Training", dayOne: day(10), lastDay: day(11), attendeeMail: true };
ok("an event with the old switch on: welcome, food allergies, hotel and survey on", ["welcome", "reply", "hotel", "survey"].every((k) => autoOn(old, k)));
ok("…certificates were never automatic, so they start off", autoOn(old, "certs") === false);
ok("…and the thank-you keeps its own setting", autoOn(old, "thanks") === true && autoOn({ ...old, presenterThanks: { off: true } }, "thanks") === false);
ok("the old switch off: all four off", ["welcome", "reply", "hotel", "survey"].every((k) => !autoOn({ ...old, attendeeMail: false }, k)));
ok("Nothing automatic beats every switch", Object.values(autoState({ ...old, quiet: true, auto: { welcome: true, certs: true } })).every((v) => v === false));

// Flipping one writes them all down, so the others stop following the old switch.
const e1 = setAuto({ ...old }, "welcome", false);
ok("welcome off leaves the survey on", autoOn(e1, "welcome") === false && autoOn(e1, "survey") === true && e1.auto.survey === true);
ok("…and the welcome letter is no longer due", letterDue(e1, "welcome").due === false && /switched off/.test(letterDue(e1, "welcome").why));
const e2 = setAuto({ ...e1 }, "certs", true);
ok("certificates on by themselves", autoOn(e2, "certs") === true && autoOn(e2, "welcome") === false);
const e3 = setAuto({ ...e2 }, "thanks", false);
ok("the thank-you switch is the one it always had", e3.presenterThanks.off === true && autoOn(e3, "thanks") === false && autoOn(setAuto({ ...e3 }, "thanks", true), "thanks") === true);

// Each email's own check follows its own switch.
const hotel = { hotel: { cutoff: day(7), link: "https://hotel.example" } };
ok("hotel reminders off: none due, though the survey is on", hotelDueToday({ ...setAuto({ ...old }, "hotel", false), ...hotel }) === null);
ok("hotel reminders on: due", hotelDueToday({ ...old, ...hotel }) === 7);
ok("the thank-you off: not due", thanksDue({ ...old, presenterThanks: { off: true }, lastDay: day(-1), city: "Toronto" }, new Date(`${day(0)}T20:00:00Z`)) === false);

// Through the desk: a new event starts with every switch off; each one flips on its own.
const board = [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }];
const ev = (await call("/api/events", "POST", { title: "New Training", city: "Montréal", dayOne: day(21), lastDay: day(22), board, invite: false })).event;
const fresh = await S.getEvent(ev.id);
ok("a new event starts with every automatic email off", Object.values(autoState(fresh)).every((v) => v === false), JSON.stringify(autoState(fresh)));
const shown = await call(`/api/events?id=${ev.id}`);
ok("the event page is told each switch", shown.event?.autoOn && shown.event.autoOn.survey === false && "certs" in shown.event.autoOn);
const on = await call(`/api/events?id=${ev.id}&auto=1`, "PUT", { kind: "survey", on: true });
ok("turning the survey on turns only the survey on", on.status === 200 && on.auto.survey === true && on.auto.welcome === false && on.auto.certs === false, JSON.stringify(on));
ok("…and it's kept", autoOn(await S.getEvent(ev.id), "survey") === true);
ok("an unknown email is refused", (await call(`/api/events?id=${ev.id}&auto=1`, "PUT", { kind: "everything", on: true })).status === 400);
await call(`/api/events?id=${ev.id}&quiet=1`, "PUT", { on: true });
ok("with Nothing automatic on, a switch can't be turned on", (await call(`/api/events?id=${ev.id}&auto=1`, "PUT", { kind: "welcome", on: true })).status === 409);
await call(`/api/events?id=${ev.id}&quiet=1`, "PUT", { on: false });

// Saving the event from Edit event leaves the switches alone.
const saved = await S.getEvent(ev.id);
await call(`/api/events?id=${ev.id}`, "PUT", { ...saved, title: "New Training, renamed" });
ok("saving the event keeps the switches", autoOn(await S.getEvent(ev.id), "survey") === true && autoOn(await S.getEvent(ev.id), "welcome") === false);

// The schedule says which won't go, per email; Send now is still offered.
await S.putAttendees(ev.id, { people: [{ key: "a1", first: "Alex", last: "Sample", email: "alex@example.ca", status: "ATTENDING" }] });
const sched = await emailSchedule({ ...(await S.getEvent(ev.id)), ...hotel });
const h = sched.filter((r) => /Hotel reminder/.test(r.what));
ok("the schedule marks the hotel reminders switched off, with Send now still there", h.length && h.every((r) => /switched off/.test(r.note) && r.now?.type === "hotel"), JSON.stringify(sched));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
