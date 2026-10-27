// The event's own survey (Andrew 27 Oct 2026; notes/surveys-plan.md): bilingual, anonymous, stars, by day; daily or at
// the end; about-you once; the event overall on the last part; the Summit's community partners only their two days.
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
const { putEvent, getEvent, putAttendees, putPresenter, getSurveyResponses, getSurveyContacts } = await import(F + "lib/store.mjs");
const { personalId } = await import(F + "lib/letters.mjs");
const { partsDue, sendSurveyRound } = await import(F + "lib/surveysend.mjs");
const survey = (await import(F + "survey.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const admin = async (qs, init = {}) => { const r = await survey(new Request(`http://x/api/survey?event=ngs${qs}`, { ...init, headers: H, body: init.body ? JSON.stringify(init.body) : undefined })); return { status: r.status, body: await r.json() }; };
const pub = async (qs, init = {}) => { const r = await survey(new Request(`http://x/api/survey?${qs}`, { ...init, headers: { "content-type": "application/json" }, body: init.body ? JSON.stringify(init.body) : undefined })); return { status: r.status, body: await r.json() }; };

await putEvent({ id: "ngs", title: "National Gang Summit", city: "Toronto, ON", dayOne: "2026-11-09", lastDay: "2026-11-12", board: [], attendeeMail: true,
  wixMore: [{ eventId: "w2", title: "NGS Community Partners", group: "Community partners" }],
  schedule: ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"].map((date) => ({ date, start: "08:30", end: "16:00" })) });
const talks = [["a1", "Casey", "Morgan", "Gang Trends Coast to Coast"], ["a2", "Jordan", "Avery", "Following the Money"], ["a3", "Riley", "Chen", "Following the Money"], ["a4", "Morgan", "Lee", "From Recruitment to Exit"], ["a5", "Sam", "Ortiz", "Ghost Guns"]];
for (const [id, first, last, talk] of talks) await putPresenter({ eventId: "ngs", id, first, last, status: "approved", submission: { talk }, createdAt: `2026-10-0${talks.findIndex((t) => t[0] === id) + 1}` });
await putAttendees("ngs", { people: [
  { key: "j1", first: "Jay", email: "jay@example.ca", status: "ATTENDING", organization: "TPS" },
  { key: "c1", first: "Cam", email: "cam@example.ca", status: "ATTENDING", organization: "OPP", group: "Community partners" }] });

const set = (await admin("", { method: "PUT", body: {} })).body;
ok("set up from the presenters: one session per talk, two presenters sharing one talk on one session", set.survey.sessions.length === 4 && set.survey.sessions.find((s) => s.title === "Following the Money").presenters.join() === "Jordan Avery,Riley Chen", JSON.stringify(set.survey.sessions));
ok("it waits for each session's day, and says so", set.problems.some((p) => /4 sessions have no day yet/.test(p)));
const days = { "Gang Trends Coast to Coast": "2026-11-09", "Following the Money": "2026-11-10", "From Recruitment to Exit": "2026-11-11", "Ghost Guns": "2026-11-12" };
const withDays = (await admin("", { method: "PUT", body: { mode: "daily", sessions: set.survey.sessions.map((s) => ({ ...s, day: days[s.title] })) } })).body;
ok("with the days set, nothing is held back; daily times are 15 minutes after each day's end", withDays.problems.length === 0 && withDays.times.every((t) => t.at === "16:15"), JSON.stringify(withDays.problems));
const tok = withDays.survey.token;
const ev = await getEvent("ngs");
const jay = personalId(tok, { key: "j1" }), cam = personalId(tok, { key: "c1" });

// The questions.
const day1 = (await pub(`t=${tok}&p=${jay}&part=2026-11-09`)).body;
ok("Jay's Day 1: about-you, Day 1's session only, no overall yet", day1.about?.length === 6 && day1.days.length === 1 && day1.days[0].sessions[0].en === "Gang Trends Coast to Coast" && !day1.overall);
ok("each question in both languages, and the star words in both", day1.session[0].fr && day1.stars.fr[4] === "Excellent" && day1.stars.en[0] === "Poor");
const camDay1 = (await pub(`t=${tok}&p=${cam}&part=2026-11-09`)).body;
ok("a community partner asking for Day 1 is given their first day instead (Nov 10)", camDay1.days[0].day === "2026-11-10", JSON.stringify(camDay1.days));

// Answers: missing ones are named; complete ones are kept with no name.
const stars = (n) => Object.fromEntries(["relevant", "knowledge", "expectations", "expert", "engaging", "delivery"].map((k) => [k, n]));
const about = { agency: "Toronto Police Service", province: "ON", years: 4, before: 0, again: 0, heard: 1 };
const sid = (title) => withDays.survey.sessions.find((s) => s.title === title).id;
const short = await pub(`t=${tok}&p=${jay}`, { method: "POST", body: { part: "2026-11-09", about, sessions: { [sid("Gang Trends Coast to Coast")]: { relevant: 5 } } } });
ok("a part with answers missing is refused, naming each one", short.status === 400 && short.body.missing.includes(`${sid("Gang Trends Coast to Coast")}.knowledge`) && short.body.missing.includes(`${sid("Gang Trends Coast to Coast")}.rebook`));
const okDay1 = await pub(`t=${tok}&p=${jay}`, { method: "POST", body: { part: "2026-11-09", lang: "fr", about, sessions: { [sid("Gang Trends Coast to Coast")]: { ...stars(5), delivery: "na", rebook: 0, comment: "Great start" } } } });
ok("a complete part is kept", okDay1.status === 200 && okDay1.body.ok);
const kept = await getSurveyResponses("ngs");
ok("the answers carry no name, address or link id", kept.length === 1 && !/jay|Jay|j1|example\.ca/.test(JSON.stringify(kept[0])) && kept[0].lang === "fr" && kept[0].about.agency === "Toronto Police Service" && kept[0].sessions[sid("Gang Trends Coast to Coast")].delivery === "na", JSON.stringify(kept[0]));
ok("answering the same part again is not counted twice", (await pub(`t=${tok}&p=${jay}`, { method: "POST", body: { part: "2026-11-09", about, sessions: {} } })).body.already === true && (await getSurveyResponses("ngs")).length === 1);
const day2 = (await pub(`t=${tok}&p=${jay}&part=2026-11-10`)).body;
ok("on Day 2, about-you is not asked again", day2.about === null && day2.days[0].day === "2026-11-10");
const day4 = (await pub(`t=${tok}&p=${jay}&part=2026-11-12`)).body;
ok("the last day carries the event overall, with the extra questions", day4.overall?.some((q) => q.id === "nps") && day4.overall.some((q) => q.id === "venue") && day4.overall.some((q) => q.id === "present"));
const camLast = (await pub(`t=${tok}&p=${cam}&part=2026-11-11`)).body;
ok("a community partner's last day is Nov 11, so their overall comes then", !!camLast.overall);
const overall = { quality: 5, pace: 1, confidence: 4, variety: 5, practical: 4, venue: 5, av: "na", registration: 5, food: 3, length: 1, nps: 9 };
const skipped = await pub(`t=${tok}&p=${jay}`, { method: "POST", body: { part: "2026-11-12", skipDays: ["2026-11-12"], overall: { ...overall, present: 0 }, contact: { name: "Jay Sample", email: "jay@example.ca", topic: "Drill music" } } });
ok("'I wasn't there this day' skips every session that day; the overall is still kept", skipped.status === 200);
const last = (await getSurveyResponses("ngs")).at(-1);
ok("the day is kept as skipped, and the person who would like to present is kept apart from the answers", last.sessions[sid("Ghost Guns")].skipped === "day" && !/Jay|jay@/.test(JSON.stringify(last)) && (await getSurveyContacts("ngs"))[0]?.email === "jay@example.ca");
ok("a test (preview) answer is checked but not kept", (await pub(`t=${tok}&preview=1`, { method: "POST", body: { part: "2026-11-10", about, sessions: { [sid("Following the Money")]: { ...stars(4), rebook: 1 } } } })).body.preview && (await getSurveyResponses("ngs")).length === 2);

// When each part goes.
const at = (local) => new Date(`${local}:00-05:00`); // Toronto in November
ok("Day 1's part is not due at 4:10 pm, and is at 4:15 pm", partsDue(await getEvent("ngs"), at("2026-11-09T16:10")).length === 0 && partsDue(await getEvent("ngs"), at("2026-11-09T16:15")).join() === "2026-11-09");
ok("a day missed is still sent the next day, but not two days late", partsDue(await getEvent("ngs"), at("2026-11-10T09:00")).join() === "2026-11-09" && !partsDue(await getEvent("ngs"), at("2026-11-11T09:00")).includes("2026-11-09"));
const noEnd = { ...(await getEvent("ngs")), schedule: [] };
ok("a day with no end time saved is never sent by guess", partsDue(noEnd, at("2026-11-09T23:00")).length === 0);
const endMode = { ...(await getEvent("ngs")), survey: { ...(await getEvent("ngs")).survey, mode: "end", sendOn: "2026-11-13" } };
ok("at the end: on its day from 9 am local, not at midnight", partsDue(endMode, at("2026-11-13T08:30")).length === 0 && partsDue(endMode, at("2026-11-13T09:00")).join() === "end");

// Sending: Day 1 goes only to people there that day.
const round1 = await sendSurveyRound(await getEvent("ngs"), "2026-11-09", { pace: async () => {} });
ok("Day 1's survey goes to the justice partner, not to the community partner", round1.sent === 1 && sent.at(-1).to.includes("jay@"), JSON.stringify(round1));
const round2 = await sendSurveyRound(await getEvent("ngs"), "2026-11-10", { pace: async () => {} });
ok("Day 2's goes to both", round2.sent === 2);
ok("the email is in both languages, each with its own button, opening the survey in that language", /\/f\/[A-Za-z0-9_-]+\/[0-9a-f]{16}\?lang=en/.test(sent.at(-1).text) && /\?lang=fr/.test(sent.at(-1).text) && /FRANÇAIS/.test(sent.at(-1).text) && /how was today\? \/ Votre avis/.test(sent.at(-1).subject));
ok("and nobody gets the same day twice", (await sendSurveyRound(await getEvent("ngs"), "2026-11-10", { pace: async () => {} })).sent === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
