// The infographic shows how many attended, not how many answered (Andrew 17 Nov 2026), and the presenter results mark
// critical comments in red and mixed ones in orange.
const REPO = new URL("../../", import.meta.url).pathname;
const F = REPO + "netlify/functions/";
const { attendedOf, surveyResults } = await import(F + "lib/surveyresults.mjs");
const { infographicHtml } = await import(F + "lib/infographic.mjs");
const A = await import(F + "lib/surveyanalysis.mjs");
const { surveyPresentersPdf } = await import(F + "lib/surveyreport.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };

const ev = { id: "e", title: "National Gang Summit", city: "Toronto, ON", dayOne: "2026-11-09", lastDay: "2026-11-12", wixMore: [{ eventId: "w2" }, { eventId: "wv", online: true }],
  survey: { sessions: [{ id: "s1", day: "2026-11-09", title: "Project Poppy", presenters: ["Natasha Hardie"] }] } };
const people = [
  ...Array.from({ length: 5 }, (_, i) => ({ email: `in${i}@x.ca`, status: "ATTENDING", checkedIn: true, wixEventId: "w1" })),
  ...Array.from({ length: 3 }, (_, i) => ({ email: `no${i}@x.ca`, status: "ATTENDING", wixEventId: "w1" })),
  ...Array.from({ length: 2 }, (_, i) => ({ email: `on${i}@x.ca`, status: "ATTENDING", wixEventId: "wv" })),
];
ok("attended: checked in at the door, plus everyone registered online", attendedOf(ev, people).count === 7);
ok("an event nobody was checked in at: everyone registered as coming", attendedOf(ev, people.map((p) => ({ ...p, checkedIn: false }))).count === 10);

const responses = [{ about: { agency: "TPS", province: "ON", years: 2 }, overall: { quality: 5 }, sessions: { s1: { relevant: 5, engaging: 4, comment: "Great case study." } } },
  { about: { agency: "OPP", province: "ON", years: 1 }, overall: { quality: 4 }, sessions: { s1: { relevant: 2, engaging: 2, comment: "Too long and hard to hear." } } },
  { about: { agency: "RCMP", province: "BC", years: 3 }, overall: { quality: 4 }, sessions: { s1: { relevant: 4, engaging: 4, comment: "Good content but rushed at the end." } } }];
const R = surveyResults(ev, responses, [], people);
const html = infographicHtml(ev, R, null, { lang: "en" });
ok("the infographic leads with 7 attended, not 3 who answered", /<div class="num">7\+<\/div>/.test(html) && /attended/.test(html) && !/answered the survey/.test(html), (html.match(/<div class="num">[^<]*<\/div>/) ?? [""])[0]);
// Laid out like the Calgary 2025 example (Andrew 17 Nov 2026): the rating split, the average, each quote's rating.
ok("the ratings box shows the split and the average", /SURVEY RATINGS|Survey ratings/.test(html) && /<span class="k">5\/5<\/span>/.test(html) && /Average rating/.test(html));
ok("the sessions and days, and the training summary", /were held over/.test(html) && /4 days,/i.test(html) && /Training summary/.test(html) && /Project Poppy/.test(html));
ok("the provinces", /Province representation breakdown/.test(html) && /Ontario/.test(html));
ok("and doesn't count the ratings either", !/average of <b>/.test(html) && /average rating/i.test(html));
ok("in French too", /ont participé/.test(infographicHtml(ev, R, null, { lang: "fr" })));

// Claude, stood in, sorts the comments.
const client = { messages: { create: async (q) => ({ content: [{ type: "text", text: JSON.stringify({ flagged: q.messages[0].content.split("\n").map((l, i) => (/hard to hear/.test(l) ? { n: i + 1, tone: "negative" } : /but rushed/.test(l) ? { n: i + 1, tone: "mixed" } : null)).filter(Boolean) }) }] }) } };
const tones = await A.toneComments(R, { client });
ok("critical and mixed comments marked; praise left alone", tones[A.squash("Too long and hard to hear.")] === "negative" && tones[A.squash("Good content but rushed at the end.")] === "mixed" && !tones[A.squash("Great case study.")], JSON.stringify(tones));
const pdf = await surveyPresentersPdf({ ...ev, survey: { ...ev.survey, tones: { of: tones } } }, R, null);
let txt = ""; try { const fs = await import("node:fs"); const os = await import("node:os"); const f = os.tmpdir() + "/tone.pdf"; fs.writeFileSync(f, pdf); txt = (await import("node:child_process")).execFileSync("pdftotext", [f, "-"]).toString().replace(/\s+/g, " "); } catch {}
ok("the presenter results come out with the key and every comment", Buffer.from(pdf).subarray(0, 4).toString() === "%PDF" && (!txt || (/Red: critical\. Orange: praise with a criticism\./.test(txt) && /hard to hear/.test(txt) && /Great case study/.test(txt))), txt.slice(0, 300));
if (process.env.TONE_PDF_OUT) (await import("node:fs")).writeFileSync(process.env.TONE_PDF_OUT, pdf);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
