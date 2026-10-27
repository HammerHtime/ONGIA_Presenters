// The survey's results (Andrew 27 Oct 2026): the numbers, the summary PDF, every answer and the would-be presenters
// as spreadsheets, Claude's read (quotes only word for word), and the infographic in English and French.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const REPO = new URL("../../", import.meta.url).pathname;
process.env.APP_URL = "https://events.example.org";
process.env.ADMIN_KEY = "testkey";
const F = REPO + "netlify/functions/";
const { putEvent, getEvent, putSurveyResponse, putSurveyContact } = await import(F + "lib/store.mjs");
const { surveyResults } = await import(F + "lib/surveyresults.mjs");
const { analyseSurvey, verbatim } = await import(F + "lib/surveyanalysis.mjs");
const { readXlsx } = await import(F + "lib/xlsx.mjs");
const { directory } = await import(F + "lib/agencies.mjs");
const survey = (await import(F + "survey.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const get = (qs) => survey(new Request(`http://x/api/survey?event=ngs${qs}`, { headers: H }));

const sessions = [{ id: "s1", day: "2026-11-09", title: "Following the Money", titleFr: "Suivre l'argent", presenters: ["Jordan Avery"] },
  { id: "s2", day: "2026-11-10", title: "Ghost Guns", titleFr: "", presenters: ["Sam Ortiz", "Riley Chen"] }];
await putEvent({ id: "ngs", title: "National Gang Summit: Organized Crime, Gangs & Youth", city: "Toronto, ON", dayOne: "2026-11-09", lastDay: "2026-11-12", board: [],
  survey: { token: "tok12345678", open: true, mode: "end", sendOn: "2026-11-13", sessions } });
const S = (n) => ({ relevant: n, knowledge: n, expectations: n, expert: n, engaging: n, delivery: n });
const people = [
  { about: { agency: "TPS", province: "ON", years: 4, before: 0, again: 0 }, s1: { ...S(5), rebook: 0, comment: "The financial investigations session changed how my unit will approach our next file. Practical and current." }, s2: { ...S(4), rebook: 0 }, overall: { quality: 5, pace: 1, confidence: 5, variety: 5, practical: 4, venue: 5, av: 4, registration: 5, food: 3, length: 1, nps: 10, topics: "Drill music and gang violence" } },
  { about: { agency: "RCMP F Division", province: "SK", years: 3, before: 1, again: 0 }, s1: { ...S(4), rebook: 0 }, s2: { skipped: "session" }, overall: { quality: 4, pace: 1, confidence: 4, variety: 4, practical: 4, venue: 4, av: "na", registration: 4, food: 4, length: 1, nps: 9, anything: "Best ONGIA event I have attended. Hearing directly from front-line investigators was invaluable." } },
  { about: { agency: "Royal Canadian Mounted Police", province: "BC", years: 2, before: 0, again: 0 }, s1: { ...S(3), delivery: "na", rebook: 1 }, s2: { ...S(2), rebook: 2, comment: "Too much on hardware, not enough on investigations." }, overall: { quality: 3, pace: 2, confidence: 3, variety: 4, practical: 3, venue: 3, av: 3, registration: 5, food: 2, length: 2, nps: 6, where: "BC" } },
  { about: { agency: "Kenora Youth Outreach", province: "ON", years: 0, before: 1, again: 1 }, s1: { ...S(5), rebook: 0 }, s2: { ...S(5), rebook: 0 }, overall: { quality: 5, pace: 1, confidence: 5, variety: 5, practical: 5, venue: 5, av: 5, registration: 5, food: 5, length: 1, nps: 10, present: 0 } },
];
let i = 0;
for (const p of people) await putSurveyResponse("ngs", { id: `r${++i}`, at: `2026-11-13T15:0${i}:00Z`, part: "end", lang: i === 2 ? "fr" : "en", about: p.about, sessions: { s1: p.s1, s2: p.s2 }, overall: p.overall });
await putSurveyContact("ngs", { id: "c1", at: "2026-11-13T15:04:00Z", name: "Pat Sample", email: "pat@example.ca", topic: "Youth outreach" });

const R = surveyResults(await getEvent("ngs"), (await (await import(F + "lib/store.mjs")).getSurveyResponses("ngs")), await directory());
ok("counts: four answers from four people, one in French", R.responses === 4 && R.respondents === 4 && R.languages.fr === 1);
ok("agencies under their standard names: two RCMP spellings are one agency, with its provinces", R.agencies.find((a) => a.agency === "Royal Canadian Mounted Police")?.count === 2 && R.agencies.find((a) => a.agency === "Royal Canadian Mounted Police").provinces.BC === 1 && R.agencies.find((a) => a.agency === "Kenora Youth Outreach")?.known === false, JSON.stringify(R.agencies));
ok("provinces as shares of those who answered", R.provinces[0].code === "ON" && R.provinces[0].pct === 50, JSON.stringify(R.provinces));
const s1 = R.sessions.find((s) => s.id === "s1"), s2 = R.sessions.find((s) => s.id === "s2");
ok("a session's average leaves N/A out (4.3 from 23 star answers)", s1.n === 4 && s1.avg === 4.3, `${s1.avg}`);
ok("a skipped session is not rated, and is counted apart", s2.n === 3 && s2.skipped === 1);
ok("would book again: yes, maybe, no", s1.rebook.yes === 3 && s1.rebook.maybe === 1 && s2.rebook.no === 1);
ok("overall quality: average 4.3, 75% rated 4 or 5; N/A left out of sound and screens", R.overall.quality.avg === 4.3 && R.overall.quality.top2 === 75 && R.overall.av.n === 3 && R.overall.av.na === 1, JSON.stringify(R.overall.quality));
ok("recommend score: 3 promoters, 1 detractor of 4 → +50", R.overall.nps.score === 50, JSON.stringify(R.overall.nps));
ok("pace about right 75%", R.overall.pace.aboutRightPct === 75);
ok("comments gathered with what they're about, nothing identifying added", R.comments.length === 3 && R.comments.some((c) => c.about === "The event overall"));

// Claude's read: only word-for-word quotes survive.
const fake = { messages: { create: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ summary: "Well received.", liked: [{ point: "Financial investigations", evidence: "4.3/5" }], improve: [{ point: "Food", evidence: "3.5/5" }],
  presenters: [{ session: "Ghost Guns", note: "Mixed" }], nextTime: ["Drill music"], quotes: [
    { text: "The financial investigations session changed how my unit will approach our next file. Practical and current.", about: "Following the Money" },
    { text: "Best ONGIA event I have attended.", about: "overall" },
    { text: "An amazing event that everyone loved!", about: "overall" }] }) }] }) } };
const A = await analyseSurvey(await getEvent("ngs"), R, { client: fake });
ok("a made-up quote is dropped; real ones (whole, or whole sentences of one) are kept", A.quotes.length === 2 && !A.quotes.some((q) => /amazing/.test(q.text)), JSON.stringify(A.quotes));
ok("a reworded quote is dropped too", verbatim([{ text: "The financial session changed how my team works." }], R.comments).length === 0);
const e = await getEvent("ngs"); e.survey.analysis = A; await putEvent(e);

// The downloads.
const dir = mkdtempSync(path.join(tmpdir(), "svr-"));
const pdfRes = await get("&download=summary");
const pdf = Buffer.from(await pdfRes.arrayBuffer());
writeFileSync(path.join(dir, "s.pdf"), pdf);
const txt = execFileSync("pdftotext", ["-layout", path.join(dir, "s.pdf"), "-"]).toString();
const need = { status: pdfRes.status === 200, tiles: /overall quality/i.test(txt), avg: /4\.3\/5/.test(txt), read: /claude.s read/i.test(txt), s1: /Following the Money/.test(txt), s2: /Ghost Guns/.test(txt), prov: /Province or territory/.test(txt), rcmp: /Royal Canadian Mounted Police: 2/.test(txt), comment: /Too much on hardware/.test(txt) };
ok("the summary PDF has the tiles, Claude's read, each session, the overall, who answered and the comments", Object.values(need).every(Boolean), JSON.stringify(need));
ok("and numbers its pages", /1 of \d/.test(txt));
const ans = readXlsx(new Uint8Array(await (await get("&download=answers")).arrayBuffer()));
const flat = JSON.stringify(ans);
ok("every answer as a spreadsheet: one row each, stars as numbers, N/A and 'Not there' shown, no names", /Following the Money/.test(flat) && /Not there/.test(flat) && /N\/A/.test(flat) && !/Pat Sample|pat@/.test(flat), flat.slice(0, 400));
const pres = JSON.stringify(readXlsx(new Uint8Array(await (await get("&download=presenters")).arrayBuffer())));
ok("the would-be presenters, apart", /Pat Sample/.test(pres) && /Youth outreach/.test(pres));

// The infographic.
const en = await (await get("&infographic=1&lang=en")).text();
ok("the infographic: title, city landmark, the 75% banner, the 4.3, agencies, topics, takeaways, the real quotes", /National Gang Summit/.test(en) && /<ellipse cx="210" cy="96"/.test(en) && />75%</.test(en) && /4\.3/.test(en) && /Royal Canadian Mounted Police/.test(en) && /Ghost Guns/.test(en) && /Pace of training/.test(en) && /changed how my unit/.test(en) && !/amazing/.test(en));
const fr = await (await get("&infographic=1&lang=fr")).text();
ok("in French: French labels, the French session title and a French date", /9 au 12 novembre 2026/.test(fr) && /Qualité globale/.test(fr) && /Suivre l'argent/.test(fr) && /Points saillants/.test(fr) && /Ontario/.test(fr));
const sq = await (await get("&infographic=1&lang=en&block=quotes")).text();
ok("one section as a square for social media, with the event's name on it", /class="square"/.test(sq) && /class="fit"/.test(sq) && /What participants said/.test(sq) && /ONGIA\.CA/.test(sq) && !/Key takeaways/.test(sq));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const asPdf = await survey(new Request("http://x/api/survey?event=ngs&pdf=1&w=1080&h=3800&name=Infographic", { method: "POST", headers: { "x-admin-key": "testkey" }, body: png }));
const pdfBytes = Buffer.from(await asPdf.arrayBuffer());
ok("a PNG of it comes back as a one-page PDF of the same shape", asPdf.status === 200 && pdfBytes.slice(0, 5).toString() === "%PDF-" && /MediaBox \[0 0 612 2153\]/.test(pdfBytes.toString("latin1")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
