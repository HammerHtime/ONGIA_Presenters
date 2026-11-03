// The welcome letter's catch-up (Andrew 3 Nov 2026: "when the web app pulls the new list from Wix, realizes there's been
// 15 new additions, I need Claude to send those out immediately ... I don't want to wait 24 hours"). Every 15 minutes,
// after the morning run has sent the letter: pull from Wix, send it to whoever hasn't had it; nobody twice, no
// reminders, never while the morning run sends, never once the event has started. Made-up people; a stand-in for Resend.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.RESEND_API_KEY = "test-key";
process.env.APP_URL = "https://events.example.org";
process.env.ADMIN_KEY = "testkey";
process.env.WIX_API_KEY = "test"; process.env.WIX_SITE_ID = "test";   // the pull itself is a stand-in below
delete process.env.MS_MAIL_FROM;
const sent = [], started = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.resend.com/")) {
    const p = JSON.parse(init.body);
    sent.push({ to: String(p.to), subject: p.subject });
    return new Response(JSON.stringify({ id: "m" + sent.length }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (String(url).includes("/api/welcome-catchup-background")) { started.push(url); return new Response(null, { status: 202 }); }
  throw new Error("unexpected fetch " + url);
};
const F = REPO + "netlify/functions/";
const S = await import(F + "lib/store.mjs");
const { runLetterRounds } = await import(F + "lib/sendletters.mjs");
const C = await import(F + "lib/welcomecatchup.mjs");
const welcome = (await import(F + "welcome.mjs")).default;
const tick = (await import(F + "welcome-tick.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (qs, init = {}) => { const r = await welcome(new Request(`http://x/api/welcome?event=ngs${qs}`, { ...init, headers: H, body: init.body ? JSON.stringify(init.body) : undefined })); return { status: r.status, body: await r.json() }; };
const quiet = { pace: async () => {} };
const person = (k, email) => ({ key: k, first: k, last: "Test", email, status: "ATTENDING" });

await S.putEvent({ id: "ngs", title: "Practice Summit", city: "Toronto, ON", venue: "the Hall", dayOne: "2026-11-09", lastDay: "2026-11-12", board: [], attendeeMail: true, wix: { eventId: "w1" },
  schedule: [{ date: "2026-11-09", start: "08:30", end: "16:00", where: "Hall A" }],
  tasks: [{ id: "t1", what: "Welcome letter sent to attendees", daysBefore: 7, auto: "welcome" }] });
await S.putAttendees("ngs", { people: [person("a", "a@example.ca"), person("b", "b@example.ca"), person("c", "c@example.ca")] });
const first = (await call("")).body;
await call("", { method: "PUT", body: { main: { subject: first.versions[0].subject, body: first.versions[0].body }, sendOn: "2026-11-03" } });

console.log("— before the morning run, the catch-up leaves it alone");
let out = await C.catchUpWelcome({ today: "2026-11-03", ...quiet });
ok("on the letter's day, before the morning run has sent it, nothing goes (never the whole list at midnight)", sent.length === 0 && (out.events ?? []).length === 0, JSON.stringify(out));
ok("…and the 15-minute check stays quiet", (await (await tick()).text()) === "ok" && started.length === 0);

console.log("— the morning run sends it");
await runLetterRounds([await S.getEvent("ngs")], { today: "2026-11-03", ...quiet });
ok("the morning run sends it to the three on the list", sent.length === 3, String(sent.length));

console.log("— people registered since: sent within the next check");
let k = sent.length;
const pull = async (ev) => {   // what a Wix pull does: new registrations land on the event's list
  const st = await S.getAttendees(ev.id);
  st.people.push(person("d", "d@example.ca"), person("e", "e@example.ca"));
  await S.putAttendees(ev.id, st);
  return { added: 2, changed: 0, withdrawn: 0 };
};
out = await C.catchUpWelcome({ today: "2026-11-03", pull, ...quiet });
ok("the catch-up sends it to the two new people, and only them", sent.slice(k).map((m) => m.to).sort().join() === "d@example.ca,e@example.ca", JSON.stringify(sent.slice(k)));
ok("…saying what it pulled and sent", out.events?.[0]?.sent === 2, JSON.stringify(out.events?.[0]));
k = sent.length;
out = await C.catchUpWelcome({ today: "2026-11-04", ...quiet });
ok("the next check, the next day: nobody gets it twice, and no reminders", sent.length === k && out.events?.[0]?.sent === 0, JSON.stringify(out.events?.[0]));

console.log("— never alongside the morning run");
let st = await S.getAttendees("ngs"); st.people.push(person("f", "f@example.ca")); await S.putAttendees("ngs", st);
await S.putMeta(C.NIGHT_LOCK, { at: new Date().toISOString() });
out = await C.catchUpWelcome({ today: "2026-11-04", ...quiet });
ok("while the morning run is sending, the catch-up waits", out.skipped === "the morning run is sending" && sent.length === k);
ok("…and so does the 15-minute check", (await (await tick()).text()) === "the morning run is sending" && started.length === 0);
await S.putMeta(C.NIGHT_LOCK, { at: null });
ok("when it's done, the check hands the catch-up to the background", (await (await tick()).text()) === "started" && started.length === 1);
ok("…and one at a time: a second check while it runs leaves it be", (await (await tick()).text()) === "already catching up" && started.length === 1);
await S.putMeta(C.CATCHUP_LOCK, { at: null });
out = await C.catchUpWelcome({ today: "2026-11-04", ...quiet });
ok("the one who registered meanwhile gets it", sent.slice(k).map((m) => m.to).join() === "f@example.ca", JSON.stringify(sent.slice(k)));

console.log("— a linked Wix event with no letter of its own (the Summit's VIRTUAL one, 3 Nov 2026)");
{
  const e2 = await S.getEvent("ngs");
  e2.wixMore = [{ eventId: "w2", title: "Community", group: "Community partners" }, { eventId: "w3", title: "VIRTUAL", group: "Virtual" }];
  await S.putEvent(e2);
  const fresh = (await call("")).body;
  await call("", { method: "PUT", body: { group: { subject: "Welcome, community partners", body: "Hello {first},\n\nYou're with us {dates}." } } });
  ok("the letter's second version is the community partners'", fresh.versions?.[1]?.label === "Community partners", JSON.stringify(fresh.versions?.map((v) => v.label)));
  k = sent.length;
  st = await S.getAttendees("ngs");
  st.people.push({ ...person("v", "v@example.ca"), group: "Virtual" }, { ...person("cp", "cp@example.ca"), group: "Community partners" });
  await S.putAttendees("ngs", st);
  out = await C.catchUpWelcome({ today: "2026-11-04", ...quiet });
  const got = sent.slice(k);
  ok("a community partner gets the community partners' letter", got.some((m) => m.to === "cp@example.ca" && /community partners/i.test(m.subject)), JSON.stringify(got));
  ok("someone registered only in the VIRTUAL event gets nothing (no in-person letter), until a letter of their own exists", !got.some((m) => m.to === "v@example.ca"), JSON.stringify(got));
  ok("…and is counted as held back, not lost", out.events?.[0]?.held === 1, JSON.stringify(out.events?.[0]));
  const card = (await call("")).body;
  ok("the welcome card no longer counts them among the community partners", card.versions?.[1]?.reaches === 1, JSON.stringify(card.versions?.map((v) => [v.label, v.reaches])));
}

console.log("— a Wix outage, the event started, emails off");
k = sent.length;
st = await S.getAttendees("ngs"); st.people.push(person("g", "g@example.ca")); await S.putAttendees("ngs", st);
out = await C.catchUpWelcome({ today: "2026-11-05", pull: async () => { throw new Error("Wix is down"); }, ...quiet });
ok("Wix down: the people already on the list who are owed it still get it", sent.slice(k).map((m) => m.to).join() === "g@example.ca", JSON.stringify(out.events?.[0]));
k = sent.length;
st = await S.getAttendees("ngs"); st.people.push(person("h", "h@example.ca")); await S.putAttendees("ngs", st);
out = await C.catchUpWelcome({ today: "2026-11-09", ...quiet });
ok("the morning the event starts, it stops: nothing more goes", sent.length === k && (out.events ?? []).length === 0);
const ev = await S.getEvent("ngs"); ev.attendeeMail = false; await S.putEvent(ev);
out = await C.catchUpWelcome({ today: "2026-11-06", ...quiet });
ok("emails to attendees turned off: nothing goes", sent.length === k && (out.events ?? []).length === 0);
ok("every address was sent one welcome letter, never two", new Set(sent.map((m) => m.to)).size === sent.length, JSON.stringify(sent.map((m) => m.to)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
