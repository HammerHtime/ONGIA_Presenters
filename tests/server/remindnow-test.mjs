// "Send a reminder now" (Andrew 1 Nov 2026: "Push the date to Nov 3 … and send out a reminder"): the food-allergy
// reminder at once, on any day, with automatic emails to attendees off, to those who had the email and haven't answered,
// through Resend from events@send.ongia.ca, once a day.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
process.env.RESEND_API_KEY = "test-key";
process.env.APP_URL = "https://events.example.org";
delete process.env.MS_MAIL_FROM;
const RealDate = Date, FIXED = new RealDate("2026-11-01T15:00:00Z").getTime();
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [FIXED])); } static now() { return FIXED; } };
const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.resend.com/")) {
    const p = JSON.parse(init.body);
    sent.push({ to: String(p.to), subject: p.subject, from: p.from, replyTo: p.reply_to, text: p.text });
    return new Response(JSON.stringify({ id: "r" + sent.length }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error("unexpected fetch " + url);
};
const F = REPO + "netlify/functions/";
const reply = (await import(F + "reply.mjs")).default;
const background = (await import(F + "reply-send-background.mjs")).default;
const { putEvent, getEvent, putAttendees, getAttendees } = await import(F + "lib/store.mjs");
const { startingReply, replyStatus } = await import(F + "lib/reply.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (qs, { method = "GET", body } = {}) => {
  const r = await reply(new Request(`http://localhost/api/reply?${qs}`, { method, headers: H, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const runBackground = () => background(new Request("http://localhost/api/reply-send-background?event=sum1&who=remind", { method: "POST", headers: H }));

const base = { id: "sum1", title: "National Gang Summit", city: "Toronto", dayOne: "2026-11-09", lastDay: "2026-11-12", attendeeMail: false,
  reviewer: { name: "Sam Rivera", email: "lead@example.ca" }, board: [] };
await putEvent({ ...base, reply: { ...startingReply(base), sentAt: "2026-10-27T15:00:00Z", open: true, replyBy: "2026-11-03", reminders: ["2026-10-29", "2026-10-31"] } });
const p = (first, last, email, extra = {}) => ({ key: email, first, last, email, status: "ATTENDING", source: "wix", sent: ["reply"], ...extra });
await putAttendees("sum1", { people: [p("Ann", "One", "ann@example.ca"), p("Ben", "Two", "ben@example.ca"), p("Cleo", "Three", "cleo@example.ca"),
  p("Dev", "Four", "dev@example.ca", { sent: [] })] });
// Ann answers; Ben and Cleo don't. Dev never had the email.
const tok = (await call("event=sum1")).body.link.split("/q/")[1];
const ans = await reply(new Request(`http://localhost/api/reply?t=${tok}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ first: "Ann", last: "One", agency: "TPS", email: "ann@example.ca", allergy: "no", socials: { s1: "no", s2: "no" } }) }));
ok("Ann's answer is taken", ans.status === 200, `${ans.status} ${await ans.clone().text()}`);

let st = await replyStatus(await getEvent("sum1"));
ok("two still to answer: Ben and Cleo (Ann answered, Dev never had it)", st.stillToAnswer === 2, JSON.stringify(st));

// The button starts it on the server; here the server run is called the way the button's request starts it.
await runBackground();
const got = sent.filter((m) => /^Reminder/.test(m.subject));
ok("on a day that isn't a reminder date, with automatic emails off, the reminder goes to Ben and Cleo only", got.map((m) => m.to).sort().join() === "ben@example.ca,cleo@example.ca", got.map((m) => m.to).join());
ok("from ONGIA Events <events@send.ongia.ca>, replies to the ONGIA Events mailbox", got.every((m) => m.from === "ONGIA Events <events@send.ongia.ca>" && m.replyTo === "ongiaevents@ongia.ca"), JSON.stringify(got.map((m) => [m.from, m.replyTo])));
ok("it asks for answers by the new date, Tuesday, November 3", got.every((m) => /November 3/.test(m.text)), got[0]?.text?.slice(0, 400));
st = await replyStatus(await getEvent("sum1"));
ok("the page can say when it went and to how many", st.lastReminder?.date === "2026-11-01" && st.lastReminder?.sent === 2, JSON.stringify(st.lastReminder));
const ev1 = await getEvent("sum1");
ok("the event is no longer marked as sending", !ev1.replySending && ev1.replyLastSend?.kind === "remind", JSON.stringify(ev1.replyLastSend));

const n = sent.length;
await runBackground();
ok("a second press the same day sends nobody a second copy", sent.length === n);

// The guards on the button's request.
await putEvent({ ...ev1, reply: { ...ev1.reply, replyBy: "2026-10-31" } });
let r = await call("event=sum1&remind=1", { method: "POST", body: {} });
ok("refused once the reply-by date has passed, and says to move it", r.status === 409 && /reply-by date has passed/i.test(r.body.error), JSON.stringify(r.body));
await putEvent({ ...ev1, reply: { ...ev1.reply, open: false } });
r = await call("event=sum1&remind=1", { method: "POST", body: {} });
ok("refused while the form is closed", r.status === 409 && /closed/i.test(r.body.error), JSON.stringify(r.body));
await putEvent({ ...ev1, reply: { ...ev1.reply, sentAt: null } });
r = await call("event=sum1&remind=1", { method: "POST", body: {} });
ok("refused before the email itself has gone", r.status === 409 && /Send the email first/i.test(r.body.error), JSON.stringify(r.body));
await putEvent({ ...ev1 });
r = await call("event=sum1&remind=1", { method: "POST", body: {} });
ok("when the server run can't be started, nothing is sent and it says so", r.status === 503 && /didn't start/.test(r.body.error) && !(await getEvent("sum1")).replySending && sent.length === n, JSON.stringify(r.body));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
