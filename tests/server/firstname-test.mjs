// Letters greet each person by their first name, and only by a name (Andrew 28 Oct 2026, after a test welcome letter
// opened "Hello D22,": "Open with Hello and their first name"). What isn't a name is left out ("Hello,"), and the welcome
// card lists those registrations so they can be fixed in Wix.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.RESEND_API_KEY = "test-key";
process.env.APP_URL = "https://events.example.org";
process.env.ADMIN_KEY = "testkey";
delete process.env.MS_MAIL_FROM;
const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.resend.com/")) {
    const p = JSON.parse(init.body);
    sent.push({ to: String(p.to), subject: p.subject, html: p.html, text: p.text });
    return new Response(JSON.stringify({ id: "m" + sent.length }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error("unexpected fetch " + url);
};
const F = REPO + "netlify/functions/";
const { putEvent, getEvent, putAttendees } = await import(F + "lib/store.mjs");
const { firstNameOf, renderLetter } = await import(F + "lib/letters.mjs");
const { runLetterRounds } = await import(F + "lib/sendletters.mjs");
const welcome = (await import(F + "welcome.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };

console.log("— what counts as a first name");
for (const [typed, want] of [["Jordan", "Jordan"], ["Ed", "Ed"], ["Jean-François", "Jean-François"], ["McDonald", "McDonald"], ["jordan", "Jordan"], ["MARY-ANNE", "Mary-Anne"],
  ["o'brien", "O'Brien"], ["  sam  ", "Sam"], ["D22", ""], ["123", ""], ["J.", ""], ["D.J.", ""], ["x", ""], ["sam@example.ca", ""], ["", ""], [undefined, ""]])
  ok(`${JSON.stringify(typed)} → ${JSON.stringify(want)}`, firstNameOf(typed) === want, JSON.stringify(firstNameOf(typed)));

console.log("— how a letter reads");
const ev = { id: "e", title: "National Gang Summit", city: "Toronto, ON", venue: "Delta Hotels", dayOne: "2026-11-09", lastDay: "2026-11-12" };
const letter = { subject: "Welcome, {first}", body: "Hello {first},\n\nBonjour {first},\n\nSee you in {city}." };
const good = renderLetter(letter, ev, { first: "jordan", email: "j@example.ca" });
ok("a name: Hello Jordan, and Bonjour Jordan, with a capital", /^Hello Jordan,$/m.test(good.text) && /^Bonjour Jordan,$/m.test(good.text) && /Hello Jordan,/.test(good.html) && good.subject === "Welcome, Jordan", good.text);
const odd = renderLetter(letter, ev, { first: "D22", email: "d@example.ca" });
ok("not a name: Hello, and Bonjour, with no gap before the comma", /^Hello,$/m.test(odd.text) && /^Bonjour,$/m.test(odd.text) && /Hello,/.test(odd.html) && !/D22/.test(odd.html + odd.text) && !/Hello ,/.test(odd.html + odd.text), odd.text);
ok("and the subject leaves it out too", odd.subject === "Welcome,", odd.subject);
const none = renderLetter(letter, ev, { email: "n@example.ca" });
ok("no name at all: the same", /^Hello,$/m.test(none.text) && !/there/.test(none.text));

console.log("— the welcome card lists who it can't greet, and the letter goes to them all");
await putEvent({ id: "nm", title: "Names Training", city: "Ottawa, ON", venue: "Hall", dayOne: "2026-11-20", lastDay: "2026-11-20", board: [], attendeeMail: true,
  welcome: { main: { subject: "Welcome to {event}", body: "Hello {first},\n\nSee you in {city}." } },
  tasks: [{ id: "t1", what: "Welcome letter sent to attendees", daysBefore: 7, auto: "welcome", due: "2026-11-13" }] });
await putAttendees("nm", { people: [
  { key: "a", first: "Ari", last: "Lane", email: "ari@example.ca", status: "ATTENDING" },
  { key: "b", first: "D22", last: "", email: "d22@example.ca", status: "ATTENDING" },
  { key: "c", first: "J.", last: "Park", email: "jpark@example.ca", status: "ATTENDING" },
  { key: "d", first: "Q9", last: "", email: "gone@example.ca", status: "NOT_ATTENDING" }] });
const W = await (await welcome(new Request("http://x/api/welcome?event=nm", { headers: { "x-admin-key": "testkey" } }))).json();
ok("the card names the two attending registrations without a usable first name", W.noName?.length === 2 && W.noName.some((p) => p.name === "D22" && p.email === "d22@example.ca") && W.noName.some((p) => p.name === "J. Park"), JSON.stringify(W.noName));
ok("and leaves out someone not coming", !W.noName.some((p) => p.email === "gone@example.ca"));
await runLetterRounds([await getEvent("nm")], { today: "2026-11-13", pace: async () => {} });
const to = (e) => sent.find((m) => m.to === e);
ok("the letters went: Ari's opens Hello Ari,", /Hello Ari,/.test(to("ari@example.ca")?.text ?? ""), JSON.stringify(sent.map((m) => m.to)));
ok("D22's opens Hello,", /^Hello,$/m.test(to("d22@example.ca")?.text ?? "") && !/D22/.test(to("d22@example.ca").text), to("d22@example.ca")?.text);
ok("J. Park's opens Hello,", /^Hello,$/m.test(to("jpark@example.ca")?.text ?? ""));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
