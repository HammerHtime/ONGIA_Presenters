// Two welcome letters for one event (Andrew 27 Oct 2026, National Gang Summit): the justice partners come all four days
// and get the main letter with the four-day agenda; the community partners (pulled from a second Wix event) come
// November 10 and 11 and get their own letter with their own two-day agenda.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.RESEND_API_KEY = "test-key";
process.env.APP_URL = "https://events.example.org";
process.env.ADMIN_KEY = "testkey";
delete process.env.MS_MAIL_FROM;
const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.resend.com/")) {
    const p = JSON.parse(init.body);
    sent.push({ to: String(p.to), subject: p.subject, html: p.html, files: (p.attachments ?? []).map((a) => a.filename) });
    return new Response(JSON.stringify({ id: "m" + sent.length }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error("unexpected fetch " + url);
};
const F = REPO + "netlify/functions/";
const { putEvent, getEvent, putAttendees, putLetter } = await import(F + "lib/store.mjs");
const { sendLetterRound } = await import(F + "lib/sendletters.mjs");
const agenda = (await import(F + "agenda.mjs")).default;
const letters = (await import(F + "letters.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey" };
const pdf = (s) => new TextEncoder().encode(`%PDF-1.4\n${s}\n%%EOF`);

await putEvent({ id: "ngs", title: "National Gang Summit", city: "Toronto", venue: "Hotel", dayOne: "2026-11-09", lastDay: "2026-11-12", board: [],
  attendeeMail: true, wixMore: [{ eventId: "w2", title: "NGS Community Partners", group: "Community partners" }],
  letters: { welcome: "main1", survey: null, welcomeGroup: "comm1" },
  schedule: ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"].map((date, i) => ({ date, start: `0${8 + (i % 2)}:00`, end: "16:30", where: `Room ${i + 1}` })),
  tasks: [{ id: "t1", what: "Welcome letter sent to attendees", daysBefore: 7, auto: "welcome" }] });
await putLetter({ id: "main1", kind: "welcome", name: "Summit welcome", subject: "Welcome to the Summit", body: "Hello {first},\n\nThe Summit runs {dates}.", attachAgenda: true });
await putLetter({ id: "comm1", kind: "welcome", name: "Community partners welcome", subject: "Welcome, community partners", body: "Hello {first},\n\nYou are with us {dates}.\n\n{schedule}", attachAgenda: true, audience: "group" });
await putAttendees("ngs", { people: [
  { key: "j1", first: "Jay", email: "jay@example.ca", status: "ATTENDING" },
  { key: "c1", first: "Cam", email: "cam@example.ca", status: "ATTENDING", group: "Community partners" },
  // On both Wix events at one address: the four-day letter.
  { key: "b1", first: "Bo", email: "bo@example.ca", status: "ATTENDING" },
  { key: "b2", first: "Bo", email: "bo@example.ca", status: "ATTENDING", group: "Community partners" },
] });

// Only the main agenda so far: the community letter is held back, and nothing goes to anyone.
await agenda(new Request("http://x/api/agenda?event=ngs", { method: "POST", headers: { ...H, "x-file-name": "summit-4-day.pdf" }, body: pdf("four days") }));
const held = await sendLetterRound(await getEvent("ngs"), "welcome", { today: "2026-11-02", pace: async () => {} });
ok("without the community partners' agenda, the round is held back and says why", held.blocked?.some((b) => /Community partners welcome: .*second group's agenda/.test(b)) && sent.length === 0, JSON.stringify(held));

const up = await (await agenda(new Request("http://x/api/agenda?event=ngs&group=1", { method: "POST", headers: { ...H, "x-file-name": "community-2-day.pdf" }, body: pdf("two days") }))).json();
ok("the second agenda uploads and is listed under the group's name", up.groupFile?.name === "community-2-day.pdf" && up.groupName === "Community partners" && up.file?.name === "summit-4-day.pdf", JSON.stringify(up));

const round = await sendLetterRound(await getEvent("ngs"), "welcome", { today: "2026-11-02", pace: async () => {} });
const to = (e) => sent.find((m) => m.to.includes(e));
ok("three addresses, three letters", round.sent === 3 && sent.length === 3, JSON.stringify(round));
ok("the justice partner gets the main letter with the four-day agenda", /Welcome to the Summit/.test(to("jay@").subject) && to("jay@").files.join() === "summit-4-day.pdf");
ok("the community partner gets their letter with the two-day agenda", /community partners/.test(to("cam@").subject) && to("cam@").files.join() === "community-2-day.pdf");
ok("each letter gives its own dates: the justice partners all four days, the community partners November 10 and 11", /runs Mon 9 Nov – Thu 12 Nov 2026/.test(to("jay@").html) && /with us Tue 10 Nov – Wed 11 Nov 2026/.test(to("cam@").html) && !/ 9 Nov|12 Nov/.test(to("cam@").html), to("cam@").html.match(/You are with us[^<]*/)?.[0] + " | " + to("jay@").html.match(/runs[^<]*/)?.[0]);
ok("and the community partners' day-by-day times are only their two days", /Room 2/.test(to("cam@").html) && /Room 3/.test(to("cam@").html) && !/Room 1|Room 4/.test(to("cam@").html));
ok("someone registered on both gets the main letter, once", /Welcome to the Summit/.test(to("bo@").subject) && sent.filter((m) => m.to.includes("bo@")).length === 1);
ok("running again sends nobody a second copy", (await sendLetterRound(await getEvent("ngs"), "welcome", { today: "2026-11-03", pace: async () => {} })).sent === 0 && sent.length === 3);

// The letter's own preview is addressed to a community partner and shows their agenda.
const pv = await (await letters(new Request("http://x/api/letters?preview=1", { method: "POST", headers: { ...H, "content-type": "application/json" },
  body: JSON.stringify({ eventId: "ngs", letter: { kind: "welcome", name: "c", subject: "Welcome, community partners", body: "Hello {first},", attachAgenda: true, audience: "group" } }) }))).json();
ok("the community letter's preview is addressed to a community partner and attaches their agenda", /Hello Cam/.test(pv.text) && pv.attached?.[0]?.name === "community-2-day.pdf", JSON.stringify(pv).slice(0, 300));

// With no group letter chosen, everyone gets the main one.
const e = await getEvent("ngs"); e.letters.welcomeGroup = null; await putEvent(e);
await putAttendees("ngs", { people: [{ key: "c9", first: "Cy", email: "cy@example.ca", status: "ATTENDING", group: "Community partners" }] });
await sendLetterRound(await getEvent("ngs"), "welcome", { today: "2026-11-02", pace: async () => {} });
ok("with no letter chosen for the group, a community partner gets the main one", /Welcome to the Summit/.test(to("cy@").subject));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
