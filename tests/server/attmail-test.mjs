// Who has had each email to attendees, and Send again to one person (Andrew 5 Nov 2026: "where can I see who and how
// many haven't received the email? How do I resend to individual attendees"). Plus bounce notices in the sending
// mailbox, marked on the person's row.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.RESEND_API_KEY = "test-key";
process.env.APP_URL = "https://events.example.org";
process.env.ADMIN_KEY = "testkey";
delete process.env.MS_MAIL_FROM;
const sent = [];
let failNext = false;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.resend.com/")) {
    if (failNext) { failNext = false; return new Response(JSON.stringify({ message: "Mailbox unavailable" }), { status: 422, headers: { "content-type": "application/json" } }); }
    const p = JSON.parse(init.body);
    sent.push({ to: String(p.to), subject: p.subject, text: p.text });
    return new Response(JSON.stringify({ id: "m" + sent.length }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error("unexpected fetch " + url);
};
const F = REPO + "netlify/functions/";
const { putEvent, putAttendees, getAttendees } = await import(F + "lib/store.mjs");
const { runLetterRounds } = await import(F + "lib/sendletters.mjs");
const { bouncedAddresses, kindOfBounce, scanBounces } = await import(F + "lib/attmail.mjs");
const attmail = (await import(F + "attmail.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (qs, method = "GET") => { const r = await attmail(new Request(`http://x/api/attmail?event=ngs${qs}`, { method, headers: H })); return { status: r.status, body: await r.json() }; };

const V = "virt-wix";
const days = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"];
await putEvent({ id: "ngs", title: "National Gang Summit", city: "Toronto", venue: "Delta Hotels", dayOne: days[0], lastDay: days[3], attendeeMail: true,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], wix: { eventId: "w1", title: "NGS" },
  wixMore: [{ eventId: "w2", title: "NGS Community", group: "Community partners", dayOne: days[1], lastDay: days[2] },
    { eventId: V, title: "NGS VIRTUAL", group: "Virtual", online: true, dayOne: days[0], lastDay: days[3] }],
  schedule: days.map((date) => ({ date, start: "09:00", end: "16:00" })),
  tasks: [{ id: "t1", what: "Welcome letter sent to attendees", daysBefore: 7, auto: "welcome" }],
  welcome: { main: { subject: "Welcome to the Summit", body: "Hello {first},\n\nSee you {dates}." },
    group: { subject: "Welcome, community partners", body: "Hello {first},\n\nSee you {dates}." },
    xvirtwix: { subject: "How to join online", body: "Hello {first},\n\nThe Zoom link." } },
  welcomeReady: { xvirtwix: "2026-11-04T00:00:00Z" },
 });
{ const { getEvent } = await import(F + "lib/store.mjs"); const { startingReply } = await import(F + "lib/reply.mjs"); const e = await getEvent("ngs");
  await putEvent({ ...e, reply: { ...startingReply(e), sentAt: "2026-10-20T00:00:00Z", open: true, replyBy: "2026-11-06" } }); }
await putAttendees("ngs", { people: [
  { key: "j1", first: "Jay", last: "Justice", email: "jay@example.ca", status: "ATTENDING", wixEventId: "w1", group: "" },
  { key: "c1", first: "Cam", last: "Community", email: "cam@example.ca", status: "ATTENDING", wixEventId: "w2", group: "Community partners" },
  { key: "v1", first: "Val", last: "Virtual", email: "val@example.ca", status: "ATTENDING", wixEventId: V, group: "Virtual" },
  { key: "x1", first: "Wes", last: "Withdrawn", email: "wes@example.ca", status: "WITHDRAWN", wixEventId: "w1", group: "" },
] });

// A round where one send fails: that person's row says so.
failNext = true;
await runLetterRounds([await (await import(F + "lib/store.mjs")).getEvent("ngs")], { today: "2026-11-05" });
let w = (await call("&kind=welcome")).body.people;
ok("everyone registered is listed once, with their version; not the withdrawn", w.length === 3 && w.find((p) => p.email === "cam@example.ca").version === "Community partners" && w.find((p) => p.email === "val@example.ca").version === "Virtual" && !w.some((p) => p.email === "wes@example.ca"), JSON.stringify(w));
const failed = w.filter((p) => !p.had);
ok("the one that couldn't be sent says so, with why", failed.length === 1 && failed[0].trouble?.kind === "failed" && /Mailbox unavailable/.test(failed[0].trouble.why), JSON.stringify(failed));
ok("the others show when it went", w.filter((p) => p.had).every((p) => p.at));

// Send again to that one person: their own version, and the trouble clears.
const before = sent.length;
const again = await call(`&kind=welcome&to=${encodeURIComponent(failed[0].email)}`, "POST");
ok("Send again sends to that one address, with their own version", again.status === 200 && sent.length === before + 1 && sent.at(-1).to === failed[0].email, JSON.stringify(again));
w = (await call("&kind=welcome")).body.people;
ok("and now they've had it, with no trouble showing", w.every((p) => p.had && !p.trouble));
const v = await call("&kind=welcome&to=val%40example.ca", "POST");
ok("the virtual attendee gets the virtual letter", v.status === 200 && sent.at(-1).subject === "How to join online");
ok("someone not registered can't be sent it", (await call("&kind=welcome&to=nobody%40example.ca", "POST")).status === 409);
ok("nor someone who withdrew", (await call("&kind=welcome&to=wes%40example.ca", "POST")).status === 409);

// The food-allergy email: only the people in the room.
const r = (await call("&kind=reply")).body.people;
ok("the food-allergy list leaves out the virtual attendees", r.length === 2 && !r.some((p) => p.email === "val@example.ca"));
ok("a virtual attendee can't be sent it", (await call("&kind=reply&to=val%40example.ca", "POST")).status === 409);
const rr = await call("&kind=reply&to=cam%40example.ca", "POST");
ok("the food-allergy email goes to one person in the room", rr.status === 200 && sent.at(-1).to === "cam@example.ca" && (await call("&kind=reply")).body.people.find((p) => p.email === "cam@example.ca").had);

// Bounces.
ok("a bounce notice's address is found, not ours or Microsoft's", JSON.stringify(bouncedAddresses("Your message to jay@example.ca couldn't be delivered. postmaster@outlook.com ongiaspeakers@ongia.ca abc@NAM12.prod.outlook.com", "ongiaspeakers@ongia.ca")) === '["jay@example.ca"]');
const ev = await (await import(F + "lib/store.mjs")).getEvent("ngs");
ok("which email bounced is told from the subject", kindOfBounce("Undeliverable: Welcome to the Summit", ev) === "welcome" && kindOfBounce(`Undeliverable: ${ev.reply.subject.replace(/\{[^}]+\}/g, "Summit")}`, ev) === "reply");
const later = new Date(Date.now() + 5 * 60000).toISOString();
const page = { value: [
  { id: "n1", subject: "Undeliverable: Welcome to the Summit", from: { emailAddress: { name: "Microsoft Outlook", address: "postmaster@ongia.ca" } }, receivedDateTime: later,
    body: { content: "<p>Your message to <b>jay@example.ca</b> couldn't be delivered. jay wasn't found at example.ca.</p>" } },
  { id: "n2", subject: "Re: thanks", from: { emailAddress: { name: "Someone", address: "cam@example.ca" } }, receivedDateTime: later, body: { content: "Thanks! cam@example.ca" } },
] };
const out = await scanBounces({ force: true, get: async () => page, mailbox: "ongiaspeakers@ongia.ca" });
w = (await call("&kind=welcome")).body.people;
ok("a bounce is marked on that person's welcome letter", out.marked === 1 && w.find((p) => p.email === "jay@example.ca").trouble?.kind === "bounced" && /couldn't be delivered|wasn't found/.test(w.find((p) => p.email === "jay@example.ca").trouble.why), JSON.stringify(out));
ok("an ordinary reply isn't taken for a bounce", !w.find((p) => p.email === "cam@example.ca").trouble);
await scanBounces({ force: true, get: async () => page, mailbox: "ongiaspeakers@ongia.ca" });
ok("reading the same notice again changes nothing", (await getAttendees("ngs")).people.filter((p) => p.mailTrouble?.welcome).length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
