// SurveyMonkey's past training surveys as the year reports' ratings (Andrew 2 Nov 2026). Rollups only: counts per choice.
const REPO = new URL("../../", import.meta.url).pathname;
const { summarizeSurvey, combineSurveys, matchSurveys, scoreOfLabel, sessionOf, surveySummaries } = await import(REPO + "netlify/functions/lib/smsurveys.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };

const choice = (id, text, weight = null) => ({ id, text, weight, position: null });
const single = (id, heading, labels) => ({ id, heading, family: "single_choice", subtype: "vertical", rows: [], choices: labels.map((t, i) => choice(`${id}c${i}`, t)) });
const roll1 = (id, counts) => ({ id, summary: [{ answered: counts.reduce((a, b) => a + b, 0), choices: counts.map((k, i) => ({ id: `${id}c${i}`, count: k })) }] });
const stars = (id, heading) => ({ id, heading, family: "matrix", subtype: "rating", rows: [{ id: `${id}r`, text: "" }], choices: [1, 2, 3, 4, 5].map((w) => choice(`${id}c${w}`, "", w)) });
const rollStars = (id, counts) => ({ id, summary: [{ answered: counts.reduce((a, b) => a + b, 0), rows: [{ id: `${id}r`, choices: counts.map((k, i) => ({ id: `${id}c${i + 1}`, count: k })) }] }] });

ok("scales are read from their words", scoreOfLabel("Excellent") === 5 && scoreOfLabel("Very Poor") === 1 && scoreOfLabel("Somewhat unlikely") === 2 && scoreOfLabel("Neither satisfied nor dissatisfied") === 3 && scoreOfLabel("Yes - significant value") === 5 && scoreOfLabel("Ineffective") === 2 && scoreOfLabel("N/A") === null && scoreOfLabel("CBSA") === null);
ok("a presentation question names its session and presenter", JSON.stringify(sessionOf("Rate the presentation by Pat Lee on 'Gangs 101'.")) === JSON.stringify({ presenters: "Pat Lee", title: "Gangs 101" }));

// Shaped like the Winnipeg 2026 survey: an overall question, a venue question, star-rated presentations, wished-for topics.
const winnipeg = { id: "1", title: "Crime at the Crossroads Training Symposium", responses: 44, questions: [
  single("q1", "How would you rate the overall training experience?", ["Excellent", "Good", "Average", "Poor", "Very Poor"]),
  single("q2", "How satisfied were you with the event space at the hotel?", ["Very Satisfied", "Satisfied", "Neutral", "Dissatisfied", "Very Dissatisfied"]),
  single("q3", "Which agency do you work for?", ["Police", "CBSA"]),
  stars("q4", "Rate the presentation by Pat Lee on 'Gangs 101'."),
  { id: "q5", heading: "Which topics would you have liked to see covered?", family: "multiple_choice", subtype: "vertical", rows: [], choices: [choice("q5c0", "Cybercrime"), choice("q5c1", "Youth Gangs"), choice("q5c2", "Other (please specify)")] },
  { id: "q6", heading: "Any other comments?", family: "open_ended", subtype: "single", rows: [], choices: [] },
] };
const wr = [roll1("q1", [29, 12, 1, 0, 0]), roll1("q2", [14, 21, 1, 8, 0]), roll1("q3", [30, 14]), rollStars("q4", [1, 1, 7, 15, 19]), roll1("q5", [15, 13, 2]), { id: "q6", summary: [{ answered: 19 }] }];
const w = summarizeSurvey(winnipeg, wr);
ok("the overall question is the rating: (29×5 + 12×4 + 1×3) / 42 = 4.7, 98% rated it 4 or 5", w.quality.mean === 4.7 && w.quality.top2 === 98 && w.quality.n === 42 && w.quality.basis === "overall", JSON.stringify(w.quality));
ok("the venue is measured on its own and isn't part of the rating", w.scoring.find((g) => g.id === "venue")?.top2 === 80);
ok("an agency question is not scored", !w.scoring.some((g) => g.n === 44 && g.id !== "venue"));
ok("a star-rated presentation is a session: 34 of 43 gave 4 or 5 (79%)", w.sessions.length === 1 && w.sessions[0].title === "Gangs 101" && w.sessions[0].top2 === 79 && w.sessions[0].mean === 4.2, JSON.stringify(w.sessions));
ok("wished-for topics are counted, 'Other' left out; no comment text is read", JSON.stringify(w.asked) === JSON.stringify([{ text: "Cybercrime", count: 15 }, { text: "Youth Gangs", count: 13 }]));

// Shaped like Regina 2026: no overall question, agree/disagree statements with an N/A choice.
const agree = (id, heading) => ({ id, heading, family: "matrix", subtype: "rating", rows: [{ id: `${id}r`, text: "" }], choices: ["N/A", "Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"].map((t, i) => choice(`${id}c${i}`, t, i)) });
const rollAgree = (id, counts) => ({ id, summary: [{ rows: [{ id: `${id}r`, choices: counts.map((k, i) => ({ id: `${id}c${i}`, count: k })) }] }] });
const regina = (id, n) => ({ id, title: `Regina Training Symposium - Day ${id}`, responses: n, questions: [agree("a", "The topic was relevant to my work/position."), agree("b", "Was the presenter knowledgeable?")] });
const r1 = summarizeSurvey(regina("1", 22), [rollAgree("a", [1, 0, 0, 5, 6, 6]), rollAgree("b", [0, 0, 0, 2, 8, 8])]);
ok("with no overall question the rating is every rated statement averaged, N/A left out, counted as the survey's responses: (69 + 78) / 35 = 4.2", r1.quality.basis === "all" && r1.quality.n === 22 && r1.quality.mean === 4.2, JSON.stringify(r1.quality));
ok("'Was the presenter knowledgeable?' is about the presenters, not knowledge gained", r1.scoring.some((g) => g.id === "presenters") && !r1.scoring.some((g) => g.id === "knowledge"));
const r2 = summarizeSurvey(regina("2", 14), [rollAgree("a", [0, 0, 0, 0, 7, 7]), rollAgree("b", [0, 0, 0, 0, 7, 7])]);
const both = combineSurveys([r1, r2]);
ok("a training's two days are one figure: answered is the busier day (22), responses all of them (36)", both.answered === 22 && both.responses === 36 && both.surveys.length === 2);
ok("the combined rating is weighted by responses", both.quality.mean === Math.round(((r1.quality.mean * 22 + r2.quality.mean * 14) / 36) * 10) / 10, JSON.stringify(both.quality));
ok("number labels '1' to '5' are a number scale", summarizeSurvey({ id: "9", responses: 2, questions: [{ id: "n", heading: "Overall quality", family: "matrix", subtype: "rating", rows: [{ id: "nr", text: "" }], choices: [1, 2, 3, 4, 5].map((v) => choice(`nc${v}`, String(v), v)) }] },
  [{ id: "n", summary: [{ rows: [{ id: "nr", choices: [{ id: "nc5", count: 1 }, { id: "nc4", count: 1 }] }] }] }]).quality?.mean === 4.5);

// Which survey belongs to which training.
const rows = [
  { id: "wpg", title: "Crime at the Crossroads (Winnipeg)", city: "Winnipeg", dayOne: "2026-03-10", lastDay: "2026-03-11", days: 2 },
  { id: "itp", title: "ITP Training", city: "Montréal", dayOne: "2026-05-11", lastDay: "2026-05-15", days: 5 },
  { id: "reg", title: "Mapping the Threat: Gang Structures", city: "Regina", dayOne: "2026-10-06", lastDay: "2026-10-07", days: 2 },
  { id: "kin", title: "Chain Reaction: Crime, Money & Power", city: "Kingston", dayOne: "2025-11-17", lastDay: "2025-11-20", days: 4 },
  { id: "com", title: "Community Event - Beneath the Surface", city: "Kingston", dayOne: "2025-11-18", lastDay: "2025-11-18", days: 1 },
  { id: "conf", title: "Guns, Gangs and Violence", city: "Kingston", dayOne: "2022-11-13", lastDay: "2022-11-17", days: 5 },
  { id: "tow", title: "Turf Wars: Tow Truck Operations & How They Impact Organized Crime", city: "", dayOne: "2024-09-19", lastDay: "2024-09-19", days: 1 },
];
const S = (id, title, created, responses = 20) => ({ id, title, created, responses });
const m = matchSurveys(rows, [S("a", "Crime at the Crossroads Training Symposium", "2026-03-11"), S("b", "Illicit Trade Prevention Training Evaluation Survey", "2026-05-13"),
  S("c", "2026 ONGIA Regina Training Symposium - Day 1", "2026-10-07"), S("d", "2026 ONGIA Regina Training Symposium - Day 2", "2026-10-07"),
  S("e", "2025 ONGIA Kingston Training Symposium - Day 4", "2025-11-13"), S("f", "2022 ONGIA Conference - Day 3 PM", "2022-11-13"),
  S("g", "Turf Wars: Tow Truck Operations & How They Impact Organized Crime", "2024-03-08"), S("h", "ONGIA Pre-Training Survey: RBH, Canada", "2026-06-03"),
  S("i", "ONGIA Membership Survey", "2023-04-20"), S("j", "UCCM Police Service - Gang Workshop", "2024-06-20", 2), S("k", "Crime at the Crossroads Training Symposium", "2026-08-30")]);
const ids = (k) => (m.get(k) ?? []).map((s) => s.id).join(",");
ok("by title words", ids("wpg") === "a", ids("wpg"));
ok("ITP is Illicit Trade Prevention spelled out", ids("itp") === "b");
ok("by city, both of Regina's days", ids("reg") === "c,d");
ok("a 'Day 4' survey goes to the four-day conference, not the one-evening community event", ids("kin") === "e" && !ids("com"));
ok("a 'Conference' survey goes to the year's multi-day conference", ids("conf") === "f");
ok("a survey built months ahead still matches a title it shares", ids("tow") === "g");
ok("pre-training, membership, two-answer and out-of-season surveys aren't ratings", ![...m.values()].flat().some((s) => "hijk".includes(s.id)));

// Kept, and read again only when the response count changes.
let calls = 0;
const fetchOne = async (s) => { calls++; return { id: String(s.id), title: s.title, responses: s.responses, quality: { n: 5, mean: 4.4, top2: 90, basis: "overall" }, scoring: [], sessions: [], asked: [] }; };
await surveySummaries([S("x1", "Calgary Training Symposium", "2025-07-14", 40)], { fetchOne });
await surveySummaries([S("x1", "Calgary Training Symposium", "2025-07-14", 40)], { fetchOne });
ok("a survey read once is kept", calls === 1);
await surveySummaries([S("x1", "Calgary Training Symposium", "2025-07-14", 41)], { fetchOne });
ok("a new response means it's read again", calls === 2);
const capped = await surveySummaries(["y1", "y2", "y3"].map((id) => S(id, "Montreal Training Symposium", "2025-04-29", 9)), { fetchOne, budget: 2 });
ok("no more than the budget is read in one run; the rest wait for the next", capped.fetched === 2 && capped.skipped === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
