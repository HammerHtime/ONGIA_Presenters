// Certificates emailed automatically (Andrew 24 Nov 2026: "I want the surveys and certificates to go out automatically").
// While the event's Certificates switch is on: 10:00 its own time, the day after its last day, to everyone checked in;
// anyone checked in later on the next check, for 14 days; nobody twice. Made-up people; no real email.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
process.env.APP_URL = "https://events.ongia.org";
process.env.RESEND_API_KEY = "re_test";
delete process.env.MS_MAIL_FROM;
const F = REPO + "netlify/functions/";
const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes("api.resend.com")) { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: `re_${sent.length}` }), { status: 200 }); }
  throw new Error("unexpected fetch " + url);
};
const S = await import(F + "lib/store.mjs");
const { certsWhen, certsDue, certsWorkDue, runCertsRounds } = await import(F + "lib/certauto.mjs");
const { setAuto } = await import(F + "lib/autosend.mjs");
const certificates = (await import(F + "certificates.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const call = async (qs, { method = "GET", body } = {}) => {
  const r = await certificates(new Request(`http://x/api/certificates?${qs}`, { method, headers: { "x-admin-key": "testkey", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const quick = { pace: async () => {}, origin: "https://events.ongia.org" };

// A one-day event in Victoria (Pacific time), like the Western Symposium.
const ev = { id: "vic31", title: "Western Symposium 2031", city: "Victoria, BC", dayOne: "2031-11-24", lastDay: "2031-11-24",
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }] };
await S.putEvent(ev);
const p = (key, first, last, email, extra = {}) => ({ key, first, last, organization: "Victoria Police", email, status: "ATTENDING", source: "wix", checkedIn: true, ...extra });
await S.putAttendees("vic31", { people: [p("k1", "Jordan", "Tremblay", "jt@example.ca"), p("k2", "Sam", "Okafor", "so@example.ca"), p("k3", "Casey", "Lee", ""),
  p("k4", "Riley", "Gagnon", "rg@example.ca", { checkedIn: false })] });

ok("they go the day after the last day, at 10:00", certsWhen(ev).day === "2031-11-25" && certsWhen(ev).time === "10:00");
// 10:00 in Victoria is 17:00 or 18:00 UTC, as BC keeps daylight time or not.
const at = (iso) => new Date(iso);
ok("with the switch off, never", certsDue(ev, at("2031-11-25T19:00:00Z")) === false);
const on = setAuto({ ...ev }, "certs", true);
await S.putEvent(on);
ok("on: not before 10:00 Victoria time", certsDue(on, at("2031-11-25T16:00:00Z")) === false); // 8 or 9 am there, either clock
ok("on: from 10:00 Victoria time", certsDue(on, at("2031-11-25T18:00:00Z")) === true);
ok("on: still 14 days on, for late check-ins", certsDue(on, at("2031-12-09T20:00:00Z")) === true);
ok("on: not after that", certsDue(on, at("2031-12-10T20:00:00Z")) === false);
ok("not on the event day itself", certsDue(on, at("2031-11-24T23:00:00Z")) === false);
ok("Nothing automatic stops it", certsDue({ ...on, quiet: true }, at("2031-11-25T19:00:00Z")) === false);

ok("the 15-minute check sees work to do", await certsWorkDue([on], at("2031-11-25T19:00:00Z")) === true);
const out = await runCertsRounds([on], { ...quick, now: at("2031-11-25T19:00:00Z") });
ok("everyone checked in with an address is issued and sent theirs", out[0]?.sent === 2 && sent.length === 2 && sent.map((m) => m.to).flat().sort().join() === "jt@example.ca,so@example.ca", JSON.stringify(out));
ok("…with the certificate attached", sent.every((m) => m.attachments?.length === 1));
const index = await S.getMeta("certs:event:vic31");
ok("each has a certificate number", index.k1 && index.k2 && !index.k4);
ok("someone not checked in isn't sent one", !sent.some((m) => [].concat(m.to).includes("rg@example.ca")));
ok("the check then finds nothing to do", await certsWorkDue([on], at("2031-11-25T19:15:00Z")) === false);
const again = await runCertsRounds([on], { ...quick, now: at("2031-11-25T19:15:00Z") });
ok("running again sends nobody a second copy", again.length === 0 && sent.length === 2);

// Riley checks in the next day: theirs goes on the next check.
const st = await S.getAttendees("vic31");
st.people.find((x) => x.key === "k4").checkedIn = true;
await S.putAttendees("vic31", st);
const late = await runCertsRounds([on], { ...quick, now: at("2031-11-26T18:30:00Z") });
ok("someone checked in later is sent theirs", late[0]?.sent === 1 && [].concat(sent.at(-1).to).includes("rg@example.ca"), JSON.stringify(late));

// The Certificates screen: the switch, the day and the time; a day and time of the desk's own.
const view = await call("event=vic31");
ok("the screen is told the switch, day and time", view.body.auto?.on === true && view.body.auto.day === "2031-11-25" && view.body.auto.time === "10:00" && view.body.auto.zone === "America/Vancouver", JSON.stringify(view.body.auto));
const moved = await call("event=vic31", { method: "PUT", body: { sendDay: "2031-11-26", sendTime: "14:30" } });
ok("a day and time can be set", moved.status === 200 && moved.body.auto.day === "2031-11-26" && moved.body.auto.time === "14:30");
ok("…without touching the date printed on them", (await S.getEvent("vic31")).certs.date === undefined || (await S.getEvent("vic31")).certs.date === "");
ok("a day on or before the last day is refused", (await call("event=vic31", { method: "PUT", body: { sendDay: "2031-11-24" } })).status === 409);
ok("a time that isn't one is refused", (await call("event=vic31", { method: "PUT", body: { sendTime: "25:00" } })).status === 400);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
