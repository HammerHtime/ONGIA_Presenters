// A message of Andrew's own to everyone registered, or one group (Andrew 9 Nov 2026: "HOW DO I SEND email to virtual
// attendees … I want to send it through the briefing room").
const REPO = new URL("../../", import.meta.url).pathname;
process.env.RESEND_API_KEY = "test-key";
process.env.APP_URL = "https://events.example.org";
process.env.ADMIN_KEY = "testkey";
delete process.env.MS_MAIL_FROM;
const sent = [];
let background = 0;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.resend.com/")) { const p = JSON.parse(init.body); sent.push({ to: String(p.to), subject: p.subject, text: p.text }); return new Response(JSON.stringify({ id: "m" + sent.length }), { status: 200, headers: { "content-type": "application/json" } }); }
  if (String(url).includes("/api/attmail-send-background")) { background++; return new Response(null, { status: 202 }); }
  throw new Error("unexpected fetch " + url);
};
const F = REPO + "netlify/functions/";
const { putEvent, getEvent, putAttendees, getAttendees } = await import(F + "lib/store.mjs");
const MS = await import(F + "lib/message.mjs");
const attmail = (await import(F + "attmail.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (qs, method = "GET", body) => { const r = await attmail(new Request(`http://x/api/attmail?event=ngs&kind=message${qs}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, body: await r.json() }; };

await putEvent({ id: "ngs", title: "National Gang Summit", city: "Toronto", dayOne: "2026-11-09", lastDay: "2026-11-12", attendeeMail: true,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], wix: { eventId: "w1" },
  wixMore: [{ eventId: "w2", group: "Community partners" }, { eventId: "v-1", group: "Virtual", online: true }] });
await putAttendees("ngs", { people: [
  { key: "a", first: "Ann", email: "ann@example.ca", status: "ATTENDING", wixEventId: "w1", group: "" },
  { key: "c", first: "Cam", email: "cam@example.ca", status: "ATTENDING", wixEventId: "w2", group: "Community partners" },
  { key: "v", first: "Val", email: "val@example.ca", status: "ATTENDING", wixEventId: "v-1", group: "Virtual" },
  // Registered both ways (Becky Spohr's "TBD" seat): in the online group as well as in the room.
  { key: "b1", first: "Bea", email: "bea@example.ca", status: "ATTENDING", wixEventId: "w1", group: "" },
  { key: "b2", first: "TBD", email: "bea@example.ca", status: "ATTENDING", wixEventId: "v-1", group: "Virtual" },
  { key: "x", first: "Xavi", email: "xavi@example.ca", status: "WITHDRAWN", wixEventId: "v-1", group: "Virtual" },
] });

const g = (await call("")).body;
const n = Object.fromEntries(g.groups.map((x) => [x.label, x.reaches]));
ok("the groups and how many each: Everyone 4, Justice partners 2, Community partners 1, Virtual 2 (Bea in both, Xavi withdrew)", n.Everyone === 4 && n["Justice partners"] === 2 && n["Community partners"] === 1 && n.Virtual === 2, JSON.stringify(n));
const vkey = g.groups.find((x) => x.label === "Virtual").key;
const words = { group: vkey, subject: "Zoom link for tomorrow", body: "Hello {first},\n\nThe Zoom link has changed. Use this one tomorrow:\nhttps://example.zoom.us/j/999\n\nSee you online." };

ok("the draft is kept as it's typed", (await call("", "PUT", words)).body.draft?.subject === "Zoom link for tomorrow" && (await getEvent("ngs")).messageDraft.group === vkey);
const pv = (await call("&preview=1", "POST", words)).body;
ok("See the email: as the group sees it, with their first name", /Zoom link for tomorrow/.test(pv.subject) && /Hello Val/.test(pv.html) && !pv.problems.length, JSON.stringify(pv).slice(0, 200));
const t = await call("&test=1", "POST", { ...words, to: "president@ongia.ca" });
ok("a test goes to Andrew only, marked TEST", t.status === 200 && sent.length === 1 && sent[0].to === "president@ongia.ca" && /^TEST: /.test(sent[0].subject));
ok("an empty message can't be sent", (await call("&send=1", "POST", { ...words, body: "" })).status === 409);

const s = await call("&send=1", "POST", words);
let ev = await getEvent("ngs");
ok("Send starts it on the server, and keeps the message", s.status === 200 && background === 1 && ev.messages.length === 1 && ev.sendNow?.type === "message" && !ev.messageDraft, JSON.stringify(s.body));
ok("a second Send while it goes is refused", (await call("&send=1", "POST", words)).status === 409);
// What the server run does.
delete ev.sendNow; await putEvent(ev);
const out = await MS.sendMessageRound(ev, ev.messages[0].id, { pace: async () => {} });
const to = sent.slice(1).map((m) => m.to).sort();
ok("it goes to the two joining online, Bea too, not Ann, Cam or Xavi", out.sent === 2 && to.join() === "bea@example.ca,val@example.ca", JSON.stringify(to));
ok("each with their own first name", sent.some((m) => m.to === "val@example.ca" && /Hello Val/.test(m.text)));
ok("again: nobody gets it twice", (await MS.sendMessageRound(await getEvent("ngs"), ev.messages[0].id, { pace: async () => {} })).sent === 0);
const list = (await call("")).body.sent;
ok("Sent lists it: 2 of 2, Virtual", list.length === 1 && list[0].had === 2 && list[0].reaches === 2 && list[0].label === "Virtual", JSON.stringify(list));

// Someone registers online afterwards: Send the rest reaches only them.
const st = await getAttendees("ngs");
st.people.push({ key: "w", first: "Wes", email: "wes@example.ca", status: "ATTENDING", wixEventId: "v-1", group: "Virtual" });
await putAttendees("ngs", st);
ok("someone who registers later shows as owed", (await call("")).body.sent[0].had === 2 && (await call("")).body.sent[0].reaches === 3);
const rest = await call(`&rest=${ev.messages[0].id}`, "POST", {});
ok("Send the rest starts on the server", rest.status === 200 && background === 2);
ev = await getEvent("ngs"); delete ev.sendNow; await putEvent(ev);
const out2 = await MS.sendMessageRound(ev, ev.messages[0].id, { pace: async () => {} });
ok("and only Wes gets it", out2.sent === 1 && sent.at(-1).to === "wes@example.ca");

// Off: nothing goes.
ev = await getEvent("ngs"); ev.attendeeMail = false; await putEvent(ev);
ok("with attendee emails off, it can't be sent", (await call("&send=1", "POST", { ...words, subject: "Another" })).status === 409);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
