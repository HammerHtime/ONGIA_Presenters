// Nothing automatic (Andrew 18 Nov 2026, the RBH VIP Event: "turn off all automation… I don't need reminders. I don't
// need survey. I don't even need certificates."). One switch on the event: nothing goes by itself, for any event that
// has it on. Made-up events and people throughout; no real email.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const F = REPO + "netlify/functions/";
const events = (await import(F + "events.mjs")).default;
const S = await import(F + "lib/store.mjs");
const { runReminders } = await import(F + "lib/reminders.mjs");
const { letterDue } = await import(F + "lib/sendletters.mjs");
const { hotelDueToday } = await import(F + "lib/hotel.mjs");
const { thanksDue } = await import(F + "lib/thanks.mjs");
const J = await import(F + "lib/joinreminder.mjs");
const { surveyWorkDue } = await import(F + "lib/surveysend.mjs");
const { runReports } = await import(F + "lib/reports.mjs");
const { emailSchedule } = await import(F + "lib/schedule.mjs");
const { todayIso } = await import(F + "lib/deadlines.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (url, method = "GET", body) => { const r = await events(new Request("http://localhost" + url, { method, headers: H, body: body ? JSON.stringify(body) : undefined }));
  return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
const day = (n) => todayIso(new Date(Date.now() + n * 86400e3));

// An event three weeks out, with a presenter invited long ago who hasn't signed: the morning run would chase them.
const board = [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }];
const ev = (await call("/api/events", "POST", { title: "Small Training", city: "Montréal", dayOne: day(21), lastDay: day(22), board, invite: false,
  presenters: [{ first: "Pat", last: "Example", email: "pat@example.ca", organization: "Test Police" }] })).event;
const [pat] = await S.listPresenters(ev.id);
await S.putPresenter({ ...pat, status: "invited", mail: [{ type: "invitation", at: new Date(Date.now() - 40 * 86400e3).toISOString() }] });
await call(`/api/events?id=${ev.id}&attendeeMail=1`, "PUT", { on: true });
// Their agreement due today, so today is a chase day (a details save re-derives the date, so it is set before each look).
const chases = async () => { const x = await S.getEvent(ev.id); await S.putEvent({ ...x, deadlines: { ...x.deadlines, agreement: day(0) } });
  return (await runReminders({ dry: true, origin: "http://x", onlyEvent: ev.id, forceDigest: true })).results; };
const before = await chases();
ok("with it off, the morning run chases the presenter and puts the event in the summary", before.some((r) => r.to === "pat@example.ca") && before.some((r) => r.kind === "weekly-summary"), JSON.stringify(before.map((r) => r.kind)));

console.log("— turning it on");
let r = await call(`/api/events?id=${ev.id}&quiet=1`, "PUT", { on: "yes" });
ok("it takes on or off, nothing else", r.status === 400);
r = await call(`/api/events?id=${ev.id}&quiet=1`, "PUT", { on: true });
let e = await S.getEvent(ev.id);
ok("on: saved, and attendee emails go off with it", r.quiet === true && e.quiet === true && e.attendeeMail === false, JSON.stringify(r));
r = await call(`/api/events?id=${ev.id}&attendeeMail=1`, "PUT", { on: true });
ok("attendee emails can't be turned back on while it's on, and it says why", r.status === 409 && /Nothing automatic/.test(r.error ?? ""), JSON.stringify(r));
await call(`/api/events?id=${ev.id}`, "PUT", { ...e, attendeeMail: true });
e = await S.getEvent(ev.id);
ok("…nor by ticking the box in Edit event", e.quiet === true && e.attendeeMail === false);
await call(`/api/events?id=${ev.id}`, "PUT", { ...e, quiet: undefined, title: "Small Training (VIP)" });
ok("saving the event's details without the box keeps it on", (await S.getEvent(ev.id)).quiet === true);

console.log("— nothing goes by itself");
const after = await chases();
ok("no presenter chase, no board digest, not in the Monday summary", after.length === 0, JSON.stringify(after));
e = await S.getEvent(ev.id);
const live = { ...e, attendeeMail: true }; // as if the two ever disagreed: the switch still wins
ok("no welcome letter", letterDue(live, "welcome").due === false);
ok("no hotel reminder", hotelDueToday({ ...live, hotel: { cutoff: day(7), link: "https://hotel.example" } }) === null && hotelDueToday({ ...live, quiet: false, hotel: { cutoff: day(7), link: "https://hotel.example" } }) === 7);
ok("no thank-yous", thanksDue({ ...live, lastDay: day(-1) }, new Date(), "presenters") === false && thanksDue({ ...live, quiet: false, presenterThanks: {}, lastDay: day(-1), city: "Toronto" }, new Date(`${day(0)}T20:00:00Z`), "presenters") === true);
const joinEv = { ...live, joinReminder: { k: { readyAt: "x" } } };
ok("no online join reminder", J.joinDue(joinEv, "k", new Date()) === false);
await S.putEvent({ ...e, survey: { open: true, mode: "end" } });
ok("no survey", (await surveyWorkDue([{ ...live, survey: { open: true, mode: "end" } }])) === false);
ok("no RBH reports", (await runReports({ events: [{ ...live, kind: "rbh", survey: { open: true } }] })).length === 0);
const sched = await emailSchedule(await S.getEvent(ev.id));
ok("the event's email list says each one won't go by itself", sched.length > 0 && sched.every((x) => /Nothing automatic/.test(x.note)), JSON.stringify(sched.map((x) => [x.what, x.note])));

console.log("— turning it off");
await S.putEvent({ ...(await S.getEvent(ev.id)), survey: undefined });
r = await call(`/api/events?id=${ev.id}&quiet=1`, "PUT", { on: false });
e = await S.getEvent(ev.id);
const back = await chases();
ok("off: the chases come back, and attendee emails stay off until turned on", r.quiet === false && e.attendeeMail === false && back.some((x) => x.to === "pat@example.ca"), JSON.stringify({ r, am: e.attendeeMail, back: back.map((x) => [x.kind, x.to, x.why]) }));
ok("a new event starts with it off", (await call("/api/events", "POST", { title: "Another", city: "Ottawa", dayOne: day(40), lastDay: day(40), board, invite: false, presenters: [] })).event.quiet === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
