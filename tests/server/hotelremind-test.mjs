// The hotel cut-off reminders to attendees go through Resend from events@send.ongia.ca, replies to the ONGIA Events
// mailbox (Andrew 31 Oct 2026), once per person per round, and never to a practice event's made-up address.
process.env.RESEND_API_KEY = "test-key";
process.env.APP_URL = "https://events.example.org";
delete process.env.MS_MAIL_FROM;
const REPO = new URL("../../", import.meta.url).pathname;
const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.resend.com/")) {
    const p = JSON.parse(init.body);
    sent.push({ to: p.to, from: p.from, replyTo: p.reply_to, subject: p.subject, html: p.html });
    return new Response(JSON.stringify({ id: "h" + sent.length }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error("unexpected fetch " + url);
};
const F = REPO + "netlify/functions/";
const { putAttendees, getAttendees } = await import(F + "lib/store.mjs");
const { sendHotelRound, hotelDueToday } = await import(F + "lib/hotel.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };

const event = { id: "hot1", title: "Practice Training", city: "Ottawa", dayOne: "2031-11-10", lastDay: "2031-11-12", attendeeMail: true,
  reviewer: { name: "Sam Rivera", email: "lead@example.ca" }, hotel: { name: "Lakeside Hotel", cutoff: "2031-10-20", link: "https://hotel.example.com/book" } };
await putAttendees("hot1", { people: [
  { first: "Ann", last: "One", email: "ann@example.ca", status: "ATTENDING" },
  { first: "Ben", last: "Two", email: "ben@example.ca", status: "ATTENDING" },
  { first: "Pat", last: "Made-up", email: "pat@practice.invalid", status: "ATTENDING" },
] });
ok("the 30-day round is due 30 days before the cut-off", hotelDueToday(event, "2031-09-20") === 30);
const r = await sendHotelRound(event, 30, { today: "2031-09-20", pace: async () => {} });
ok("it goes to the two real addresses, and the made-up one is skipped", sent.map((m) => String(m.to)).sort().join() === "ann@example.ca,ben@example.ca" && r.sent === 2, JSON.stringify(r));
ok("from ONGIA Events <events@send.ongia.ca>, replies to ongiaevents@ongia.ca", sent.every((m) => m.from === "ONGIA Events <events@send.ongia.ca>" && m.replyTo === "ongiaevents@ongia.ca"), JSON.stringify(sent.map((m) => [m.from, m.replyTo])));
ok("the email has the booking button", sent.every((m) => /Book your room/.test(m.html) && /hotel\.example\.com\/book/.test(m.html)));
const n = sent.length;
await sendHotelRound(event, 30, { today: "2031-09-21", pace: async () => {} });
ok("running the round again sends nobody a second copy", sent.length === n);
ok("each person is marked as having had the round", ((await getAttendees("hot1")).people ?? []).filter((p) => (p.sent ?? []).includes("hotel30")).length === 2);
delete process.env.RESEND_API_KEY;
const off = await sendHotelRound(event, 15, { today: "2031-10-05", pace: async () => {} });
ok("without a Resend key nothing is sent from Microsoft instead; it is reported, not lost", sent.length === n && off.sent === 0, JSON.stringify(off));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
