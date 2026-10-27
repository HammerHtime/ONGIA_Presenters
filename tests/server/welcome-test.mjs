// The welcome letter written on the event itself (Andrew 27 Oct 2026: "I need the one place to write the letters. And
// then under the National Gang Summit event, I just need to click email attendees"). The justice partners get theirs
// with the four-day agenda, the community partners theirs with the two-day one, the desk deciding who is who.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.RESEND_API_KEY = "test-key";
process.env.APP_URL = "https://events.example.org";
process.env.ADMIN_KEY = "testkey";
delete process.env.MS_MAIL_FROM;
const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.resend.com/")) {
    const p = JSON.parse(init.body);
    sent.push({ to: String(p.to), subject: p.subject, html: p.html, text: p.text, files: (p.attachments ?? []).map((a) => a.filename), replyTo: p.reply_to });
    return new Response(JSON.stringify({ id: "m" + sent.length }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error("unexpected fetch " + url);
};
const F = REPO + "netlify/functions/";
const { putEvent, getEvent, putAttendees, putLetter } = await import(F + "lib/store.mjs");
const { runLetterRounds } = await import(F + "lib/sendletters.mjs");
const welcome = (await import(F + "welcome.mjs")).default;
const agenda = (await import(F + "agenda.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (qs, init = {}) => { const r = await welcome(new Request(`http://x/api/welcome?event=ngs${qs}`, { ...init, headers: H, body: init.body ? JSON.stringify(init.body) : undefined })); return { status: r.status, body: await r.json() }; };
const pdf = (s) => new TextEncoder().encode(`%PDF-1.4\n${s}\n%%EOF`);

await putEvent({ id: "ngs", title: "National Gang Summit: Organized Crime, Gangs & Youth: Building Solutions for a Safer Future", city: "Toronto, ON", venue: "the Sheraton Centre", dayOne: "2026-11-09", lastDay: "2026-11-12", board: [],
  wixMore: [{ eventId: "w2", title: "NGS Community Partners", group: "Community partners" }],
  schedule: ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"].map((date, i) => ({ date, start: "08:30", end: "16:00", where: `Hall ${"ABCD"[i]}` })),
  tasks: [{ id: "t1", what: "Welcome letter sent to attendees", daysBefore: 7, auto: "welcome" }] });
await putAttendees("ngs", { people: [
  { key: "j1", first: "Jay", last: "Justice", email: "jay@example.ca", status: "ATTENDING" },
  { key: "c1", first: "Cam", last: "Community", email: "cam@example.ca", status: "ATTENDING", group: "Community partners" },
  { key: "b1", first: "Bo", email: "bo@example.ca", status: "ATTENDING" },
  { key: "b2", first: "Bo", email: "bo@example.ca", status: "ATTENDING", group: "Community partners" },
] });

const first = (await call("")).body;
ok("the card shows two versions: justice partners Nov 9-12 and community partners Nov 10-11", first.versions.length === 2 && first.versions[0].label === "Justice partners" && /9 Nov/.test(first.versions[0].dates) && /12 Nov/.test(first.versions[0].dates) && first.versions[1].label === "Community partners" && /10 Nov/.test(first.versions[1].dates) && /11 Nov/.test(first.versions[1].dates), JSON.stringify(first.versions.map((v) => [v.label, v.dates])));
ok("who each reaches: two addresses the justice letter (one also registered as a community partner), one the community letter", first.versions[0].reaches === 2 && first.versions[1].reaches === 1);
ok("the words start written for the Summit: no 'training', no province", /The Summit runs \{dates\}/.test(first.versions[0].body) && /community partner/.test(first.versions[1].body) && !/training|Toronto, ON/.test(first.versions[0].body + first.versions[1].body));
ok("the day it goes is the checklist's: a week before", first.sendOn === "2026-11-02", first.sendOn);

// Preview each, from the words on screen.
const pvMain = (await call("&preview=main", { method: "POST", body: {} })).body;
const pvGroup = (await call("&preview=group", { method: "POST", body: { group: { subject: "Welcome, partners", body: "Hello {first},\n\nYou're with us {dates}.\n\n{schedule}" } } })).body;
ok("the justice partners' preview is made out to one of them, with all four days", /Hello Jay/.test(pvMain.text) && /Mon 9 Nov – Thu 12 Nov 2026/.test(pvMain.text) && /Hall A/.test(pvMain.text) && /Hall D/.test(pvMain.text), pvMain.text.slice(0, 400));
ok("the community partners' preview is made out to one of them, with only their two days", /Hello Cam/.test(pvGroup.text) && /Tue 10 Nov – Wed 11 Nov 2026/.test(pvGroup.text) && /Hall B/.test(pvGroup.text) && !/Hall A|Hall D/.test(pvGroup.text), pvGroup.text);

// Upload the two agendas, change the words and the day, save.
await agenda(new Request("http://x/api/agenda?event=ngs", { method: "POST", headers: { "x-admin-key": "testkey", "x-file-name": "summit-4-day.pdf" }, body: pdf("4") }));
await agenda(new Request("http://x/api/agenda?event=ngs&group=1", { method: "POST", headers: { "x-admin-key": "testkey", "x-file-name": "community-2-day.pdf" }, body: pdf("2") }));
const saved = (await call("", { method: "PUT", body: { main: { subject: first.versions[0].subject, body: first.versions[0].body + "\n\nParking is on Richmond Street." }, sendOn: "2026-11-03" } })).body;
ok("saving keeps the words, shows both agendas and moves the day", /Richmond Street/.test(saved.versions[0].body) && saved.versions[0].agenda?.name === "summit-4-day.pdf" && saved.versions[1].agenda?.name === "community-2-day.pdf" && saved.sendOn === "2026-11-03", JSON.stringify(saved).slice(0, 300));
ok("a day after the event starts is refused", (await call("", { method: "PUT", body: { sendOn: "2026-11-10" } })).status === 400);

// A test of the community version: their agenda attached, marked TEST, signed by the board.
const t = await call("&test=group", { method: "POST", body: { to: "president@ongia.ca" } });
const tm = sent.at(-1);
ok("a test of the community version goes with their agenda, marked TEST", t.status === 200 && /^TEST: /.test(tm.subject) && tm.files.join() === "community-2-day.pdf" && tm.replyTo === "ngs@ongia.ca", JSON.stringify(t.body) + JSON.stringify(tm?.files));

// Emails to attendees off: nothing goes. On: each gets theirs, once.
sent.length = 0;
await runLetterRounds([await getEvent("ngs")], { today: "2026-11-03", pace: async () => {} });
ok("with attendee emails off, nothing goes", sent.length === 0);
const e = await getEvent("ngs"); e.attendeeMail = true; await putEvent(e);
await runLetterRounds([await getEvent("ngs")], { today: "2026-11-02", pace: async () => {} });
ok("nothing before its day", sent.length === 0);
await runLetterRounds([await getEvent("ngs")], { today: "2026-11-03", pace: async () => {} });
const to = (a) => sent.find((m) => m.to.includes(a));
ok("on its day: three letters, one per address", sent.length === 3, sent.map((m) => m.to).join());
ok("the justice partner gets theirs with the four-day agenda and the new line", /Welcome to the National Gang Summit$/.test(to("jay@").subject) && to("jay@").files.join() === "summit-4-day.pdf" && /Richmond Street/.test(to("jay@").text));
ok("the community partner gets theirs with the two-day agenda and their dates", /community partners/.test(to("cam@").subject) && to("cam@").files.join() === "community-2-day.pdf" && /Tue 10 Nov – Wed 11 Nov 2026/.test(to("cam@").text));
ok("someone on both gets the justice partners' letter", /Welcome to the National Gang Summit$/.test(to("bo@").subject));
await runLetterRounds([await getEvent("ngs")], { today: "2026-11-04", pace: async () => {} });
ok("nobody gets it twice", sent.length === 3);
ok("the card shows who has had it", (await call("")).body.versions.every((v) => v.had === v.reaches));

// Letters used before, to start another event's from (Andrew 27 Oct 2026).
await putLetter({ id: "w1", kind: "welcome", name: "Welcome letter", subject: "Welcome to {event}", body: "Hello {first}," });
await putLetter({ id: "s1", kind: "survey", name: "Survey", subject: "How was it?", body: "Hello" });
await putEvent({ id: "gad", title: "Gang Awareness Day", city: "Victoria, BC", dayOne: "2026-12-01", board: [] });
const lib = await (await welcome(new Request("http://x/api/welcome?event=gad&library=1", { headers: H }))).json();
ok("another event can start from the saved welcome letter or the Summit's two, not the survey", lib.letters.some((l) => l.from === "Saved letters" && l.name === "Welcome letter") && !lib.letters.some((l) => l.name === "Survey")
  && lib.letters.some((l) => /National Gang Summit.*Justice partners/.test(l.name) && /Richmond Street/.test(l.body)) && lib.letters.some((l) => /Community partners/.test(l.name)), JSON.stringify(lib.letters.map((l) => l.name)));
const gad = await (await welcome(new Request("http://x/api/welcome?event=gad", { headers: H }))).json();
ok("an ordinary event has one welcome letter, no groups", gad.versions.length === 1 && gad.versions[0].label === "Everyone");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
