// The food-allergy email to the presenters too (Andrew 29 Oct 2026: "Add a button send presenters as well"). They are on
// the event, not on the Wix guest list, so the email to everyone registered never reached them.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.RESEND_API_KEY = "test-key";
process.env.APP_URL = "https://events.example.org";
process.env.ADMIN_KEY = "testkey";
process.env.OFFICERS_TO = "president@ongia.ca";
delete process.env.MS_MAIL_FROM;
const F = REPO + "netlify/functions/";
const mails = [], started = [];
let background = "run";
const runner = (await import(F + "reply-send-background.mjs")).default;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith("https://api.resend.com/")) {
    const p = JSON.parse(init.body);
    if (String(p.to).includes("bounce@")) return new Response(JSON.stringify({ message: "The recipient's address is not valid." }), { status: 422, headers: { "content-type": "application/json" } });
    mails.push({ to: String(p.to), subject: p.subject, text: p.text, html: p.html });
    return new Response(JSON.stringify({ id: "m" + mails.length }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (u.includes("/api/reply-send-background")) {
    started.push(u);
    if (background === "down") return new Response("no", { status: 502 });
    await runner(new Request(u, init));
    return new Response(null, { status: 202 });
  }
  throw new Error("unexpected fetch " + u);
};
const { putEvent, getEvent, putAttendees, putPresenter, putReply } = await import(F + "lib/store.mjs");
const reply = (await import(F + "reply.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (qs, method = "GET", body) => { const r = await reply(new Request(`http://x/api/reply?${qs}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const toPresenters = (m) => m.filter((x) => !/^\[Desk\]/.test(x.subject));

await putEvent({ id: "ngs", title: "National Gang Summit", city: "Toronto", dayOne: "2026-11-09", lastDay: "2026-11-12", board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], attendeeMail: true });
await putAttendees("ngs", { people: [
  { key: "a", first: "Ann", last: "Attendee", email: "ann@example.ca", status: "ATTENDING" },
  { key: "r", first: "Rita", last: "Both", email: "rita@example.ca", status: "ATTENDING" }] });
const P = (id, first, last, email, status = "approved") => putPresenter({ id, eventId: "ngs", first, last, email, status, token: `tok${id}` });
await P("p1", "Jordan", "Avery", "jordan@example.ca");
await P("p2", "Sam", "Ortiz", "SAM@Example.ca", "invited");
await P("p3", "Rita", "Both", "rita@example.ca");                    // also registered on Wix: had it with everyone else
await P("p4", "Wes", "Gone", "wes@example.ca", "withdrawn");         // withdrew
await P("p5", "Tara", "Told", "tara@example.ca");                    // already told us
await P("p6", "Noel", "Noemail", "");                                // no address
await P("p7", "Bo", "Bounce", "bounce@example.ca");                  // the address bounces
await putReply("ngs", { id: "0123456789abcdef", first: "Tara", last: "Told", email: "tara@example.ca", allergy: false, at: "2026-10-28T12:00:00Z" });

await call("event=ngs", "PUT", {});
let card = (await call("event=ngs")).body;
ok("the card counts the presenters still to get it: Jordan, Sam and Bo", card.presenters?.toSend === 3 && card.presenters.had === 0, JSON.stringify(card.presenters));
mails.length = 0;
const out = await call("event=ngs&presenters=1", "POST", {});
ok("the button hands it to the server run", out.status === 200 && out.body.started === true && started.some((u) => /who=presenters/.test(u)), JSON.stringify(out.body));
const got = toPresenters(mails).map((m) => m.to).sort();
ok("Jordan and Sam got it (Sam at their address, in small letters)", JSON.stringify(got) === JSON.stringify(["jordan@example.ca", "sam@example.ca"]), JSON.stringify(got));
ok("not the one also registered on Wix, not the one who withdrew, not the one who already told us", !got.some((e) => /rita|wes|tara/.test(e)));
const j = toPresenters(mails).find((m) => m.to === "jordan@example.ca");
ok("it is the same email, greeting them by name, with their own link to the form", /Hello Jordan,/.test(j.text) && /https:\/\/events\.example\.org\/q\//.test(j.text), j.text.slice(0, 300));
const desk = mails.filter((m) => /^\[Desk\]/.test(m.subject));
ok("the address that bounced is emailed to the officers", desk.length === 1 && /bounce@example\.ca/.test(desk[0].text) && /presenters/.test(desk[0].text), JSON.stringify(desk.map((d) => d.text)));
card = (await call("event=ngs")).body;
ok("afterwards: 2 had it, the bounced one still to go, and nothing says it is still sending", card.presenters.had === 2 && card.presenters.toSend === 1 && !card.presenters.sending && card.presenters.round?.failed === 1, JSON.stringify(card.presenters));
ok("the run is not left marked as going", !(await getEvent("ngs")).replyPresentersSending);
mails.length = 0;
await call("event=ngs&presenters=1", "POST", {});
ok("pressed again: only the one still owed is tried, nobody gets it twice", toPresenters(mails).length === 0 && !mails.some((m) => /jordan|sam/.test(m.to)), JSON.stringify(mails.map((m) => m.to)));

await P("p8", "Lee", "Late", "lee@example.ca");
background = "down"; mails.length = 0;
const here = await call("event=ngs&presenters=1", "POST", {});
ok("if the server run can't start, it sends from here instead", here.status === 200 && toPresenters(mails).some((m) => m.to === "lee@example.ca") && !(await getEvent("ngs")).replyPresentersSending, JSON.stringify(here.body));
ok("the answers still go to everyone registered as before: the attendee count is unchanged", (await call("event=ngs")).body.status.reaches === 2);

// Their answers pool with everyone else's (Andrew 29 Oct 2026: "the answers from the presenters needs to be pooled into
// the overall Excel sheet numbers"): same form, same list, same spreadsheets.
const { readXlsx } = await import(F + "lib/xlsx.mjs");
const link = j.text.match(/https:\/\/events\.example\.org\/q\/([a-z0-9]+)\/?([a-z0-9]*)/i);
const form = async (body) => { const r = await reply(new Request(`http://x/api/reply?t=${link[1]}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })); if (r.status >= 300) console.log("   form said", r.status, await r.text()); return r.status; };
const opened = await (await reply(new Request(`http://x/api/reply?t=${link[1]}&p=${link[2]}`))).json();
ok("Jordan's own link opens the form with their name and email filled in, as an attendee's does", opened.you?.first === "Jordan" && opened.you?.email === "jordan@example.ca", JSON.stringify(opened.you));
ok("Jordan answers from the link in the email", await form({ first: "Jordan", last: "Avery", agency: "Sample Police", email: "jordan@example.ca", allergy: "yes", dietary: "Peanuts (anaphylaxis)", socials: { s1: "yes", s2: "no" } }) < 300);
ok("an attendee answers the same form", await form({ first: "Ann", last: "Attendee", agency: "TPS", email: "ann@example.ca", allergy: "yes", dietary: "Gluten free", socials: { s1: "no", s2: "yes" } }) < 300);
const sheet = async (which) => readXlsx(Buffer.from(await (await reply(new Request(`http://x/api/reply?event=ngs&sheet=${which}`, { headers: H }))).arrayBuffer())).map((r) => r.join(" | ")).join("\n");
const diet = await sheet("dietary");
ok("the dietary list for the hotel has the presenter and the attendee together", /Jordan \| Avery \| Peanuts \(anaphylaxis\)/.test(diet) && /Ann \| Attendee \| Gluten free/.test(diet), diet);
card = (await call("event=ngs")).body;
ok("and the card's count of answers includes them both (with Tara's from before)", card.status.answered === 3 && card.answers.some((a) => a.first === "Jordan"), JSON.stringify(card.status));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
