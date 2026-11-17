// RBH's yearly sponsorship report (Andrew 17 Nov 2026): ONGIA's own events ticked "RBH presented" (Regina, Edmonton and
// the like), reported against the KPIs in the sponsorship agreement, apart from the report on the trainings ONGIA runs
// for RBH. Its own typed-in figures, its own versions, its own folder; the trainings report is untouched.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const RealDate = Date, FIXED = new RealDate("2026-11-17T15:00:00Z").getTime();
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [FIXED])); } static now() { return FIXED; } };
const F = REPO + "netlify/functions/";
const { execFileSync } = await import("node:child_process");
const fs = await import("node:fs");
const { putEvent, getEvent, putSurveyResponse, putAttendees, putPresenter } = await import(F + "lib/store.mjs");
const Y = await import(F + "lib/yearend.mjs");
const reports = (await import(F + "reports.mjs")).default;
const events = (await import(F + "events.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (fn, path, qs, { method = "GET", body } = {}) => {
  const res = await fn(new Request(`http://localhost/api/${path}?${qs}`, { method, headers: H, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, body: type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer()), type };
};

// Two sessions: one by RBH's presenter (found by the organization on their agreement), one by someone else.
const sessions = [{ id: "s1", day: "2026-05-05", title: "Contraband tobacco", presenters: ["Dana Smith"] }, { id: "s2", day: "2026-05-05", title: "Gangs today", presenters: ["Lee Wong"] }];
await putEvent({ id: "sp-regina", title: "Prairie Training Symposium", city: "Regina, SK", dayOne: "2026-05-05", lastDay: "2026-05-06", rbhPresented: true, board: [],
  survey: { token: "tokspregina12", open: true, mode: "end", sessions } });
await putEvent({ id: "sp-edmonton", title: "Alberta Symposium", city: "Edmonton", dayOne: "2026-12-02", rbhPresented: true, board: [] });
await putEvent({ id: "sp-plain", title: "Ontario Symposium", city: "Toronto, ON", dayOne: "2026-06-01", board: [] });
await putEvent({ id: "sp-rbh", kind: "rbh", title: "RBH ITP Training", city: "Montréal, QC", province: "QC", dayOne: "2026-04-01", rbhPresented: true, board: [] });
await putEvent({ id: "sp-practice", title: "Practice Symposium", practice: true, city: "Regina, SK", dayOne: "2026-03-01", rbhPresented: true, board: [] });
await putEvent({ id: "sp-next", title: "Prairie Training Symposium", city: "Saskatoon, SK", dayOne: "2027-05-04", rbhPresented: true, board: [] });
const person = (i, org, extra = {}) => ({ key: `p${i}`, first: `Pat${i}`, last: "Example", email: `pat${i}@example.ca`, organization: org, status: "ATTENDING", sent: ["survey:end"], ...extra });
await putAttendees("sp-regina", { people: [person(1, "Regina Police Service", { checkedIn: true }), person(2, "RCMP", { checkedIn: true }), person(3, "Saskatoon Police Service", { checkedIn: true }), person(4, "OPP", { checkedIn: false })] });
await putAttendees("sp-rbh", { people: [person(9, "SPVM", { checkedIn: true })] });
await putPresenter({ id: "pr1", eventId: "sp-regina", first: "Dana", last: "Smith", organization: "Rothmans, Benson & Hedges Inc.", email: "dana@example.ca", status: "signed" });
await putPresenter({ id: "pr2", eventId: "sp-regina", first: "Lee", last: "Wong", organization: "Regina Police Service", email: "lee@example.ca", status: "signed" });
for (let i = 1; i <= 2; i++) await putSurveyResponse("sp-regina", { id: `r${i}`, at: "2026-05-07T12:00:00Z", part: "end", lang: "en", about: { agency: "RCMP", again: 0 },
  sessions: { s1: { relevant: 5, knowledge: 5, expectations: 5, expert: 5, engaging: 5, delivery: 5, rebook: 0, comment: i === 1 ? "Eye-opening on contraband." : "" },
    s2: { relevant: 2, knowledge: 2, expectations: 2, expert: 2, engaging: 2, delivery: 2, rebook: 2, comment: "" } },
  overall: { quality: 5, confidence: 4, practical: 5, variety: 4, nps: 10, topics: "Illicit trade" } });

let f = await Y.yearFacts(2026, { track: "sponsor" });
ok("the sponsorship year: ONGIA events ticked RBH presented, not an RBH event, a plain one, a practice one or next year's", f.track === "sponsor" && f.trainings === 2 && f.held === 1 && f.trainingsList.map((t) => t.title).join() === "Prairie Training Symposium,Alberta Symposium", JSON.stringify(f.trainingsList.map((t) => t.title)));
ok("attendees: the three checked in at Regina", f.attendees === 3 && f.attendanceBasis === "checked in", String(f.attendees));
ok("where RBH took part: the province the event was held in, read from its city", f.heldInProvinces.length === 1 && f.heldInProvinces[0].code === "SK" && f.cities.join() === "Regina", JSON.stringify(f.heldInProvinces));
ok("next year's booking counts too", f.nextYear.count === 1);
ok("RBH's own session is found by its presenter's organization, and its rating kept (not the other session's)", f.trainingsList[0].rbhSession?.title === "Contraband tobacco" && f.trainingsList[0].rbhSession.top2 === 100, JSON.stringify(f.trainingsList[0].rbhSession));
ok("the year's value: RBH's contribution from the signed schedule ($50,000 in 2026), cost per person and per agency", f.value.contribution === 50000 && !f.value.contributionTyped && f.value.perPerson === 16667 && f.value.perAgency === 16667 && f.value.rbhSessionTop2 === 100, JSON.stringify(f.value));
ok("2027 starts at the amended $75,000", (await Y.inputsOf(2027, "sponsor")).contribution === 75000);
ok("a city typed without its province (\"Edmonton\") still finds it", (await import(F + "lib/yearend.mjs")).trainingFacts && (await Y.trainingFacts({ id: "sp-edmonton", title: "x", city: "Edmonton", dayOne: "2026-12-02" }, [])).province === "AB");
const c = await Y.yearFacts(2026);
ok("the trainings report still counts only RBH events", c.track === "consulting" && c.trainings === 1 && c.trainingsList[0].title === "RBH ITP Training", JSON.stringify(c.trainingsList.map((t) => t.title)));

// Its own typed-in figures, with the digital reach; the trainings report's are left alone.
let r = await call(reports, "reports", "yearend=2026&inputs=1&track=sponsor", { method: "PUT", body: { members: 6000, campaigns: 4, reach: 12000, contribution: 60000 } });
ok("the year's actual contribution can be typed in instead", r.body.inputs.contribution === 60000 && r.body.inputs.contributionTyped === true, JSON.stringify(r.body.inputs));
r = await call(reports, "reports", "yearend=2026&inputs=1&track=sponsor", { method: "PUT", body: { members: 6000, campaigns: 4, reach: 12000 } });
ok("members, contraband tobacco campaigns and digital reach are kept for the sponsorship report", r.status === 200 && r.body.inputs.members === 6000 && r.body.inputs.campaigns === 4 && r.body.inputs.reach === 12000, JSON.stringify(r.body.inputs));
ok("the trainings report's typed-in figures are untouched", (await Y.inputsOf(2026)).members === null);
f = await Y.yearFacts(2026, { track: "sponsor" });
ok("estimated emails and digital reach in the figures", f.communications.estimatedEmails === 24000 && f.communications.digitalReach === 12000);

// The list on Reports › RBH › Sponsorship.
r = await call(reports, "reports", "list=1&year=2026&track=sponsor");
ok("the sponsorship list: its events, figures and its own year-end state and folder", r.status === 200 && r.body.track === "sponsor" && r.body.rows.length === 2 && r.body.yearend.folder === "RBH/Year end 2026/Sponsorship" && r.body.yearend.reports.exec.name.en === "Sponsorship Report", JSON.stringify(r.body.yearend?.folder));
r = await call(reports, "reports", "list=1&year=2026");
ok("the trainings list is as before", r.body.track === "consulting" && r.body.rows.length === 1 && r.body.yearend.folder === "RBH/Year end 2026");

// Claude, stubbed, checking it was told what this report is.
const asked = [];
const client = { messages: { create: async (req) => {
  asked.push(req);
  const exec = /year-end sponsorship report/.test(req.system), brief = JSON.parse(req.messages[0].content.split("\n\n")[0]);
  const body = exec ? { value: ["For $50,000, RBH stood in front of three people from three agencies in Saskatchewan."], glance: ["RBH presented at one ONGIA event this year."], reach: ["Three agencies."], communications: [], quotes: [{ commentId: brief.comments[0]?.id ?? 1, about: "Contraband tobacco" }],
      askedNext: "", strengths: [], lookAhead: "", recommendations: [], extra: [], reply: "" }
    : { headline: "Sponsoring the front line", tagline: "One event. One province.", quote: null, wantNext: [], reply: "" };
  return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(body) }] };
} } };
await Y.buildYearReport(2026, "exec", { client, track: "sponsor" });
await Y.buildYearReport(2026, "info", { client, track: "sponsor" });
ok("Claude is told it's the sponsorship KPI report, on ONGIA's own events, never RBH trainings", /year-end sponsorship report/.test(asked[0].system) && /KPI report the sponsorship agreement/.test(asked[0].system) && /never call them RBH trainings/.test(asked[0].system) && /Never mention social media/.test(asked[0].system));
ok("…and to lead with what RBH got for its money, with a section for it", /what did we get for our money/.test(asked[0].system) && !!asked[0].output_config.format.schema.properties.value);
ok("kept apart from the trainings report", !!(await Y.yearReportsOf(2026, "sponsor")).exec?.versions?.length && !(await Y.yearReportsOf(2026)).exec);

const out = new URL("./", import.meta.url).pathname;
for (const [kind, lang] of [["exec", "en"], ["exec", "fr"], ["info", "en"]]) {
  const p = await call(reports, "reports", `yearend=2026&kind=${kind}&lang=${lang}&pdf=1&track=sponsor`);
  const file = `${out}sponsor-${kind}-${lang}.pdf`;
  fs.writeFileSync(file, p.body);
  const txt = execFileSync("pdftotext", ["-layout", file, "-"]).toString().replace(/\s+/g, " ");
  if (process.env.SPONSOR_PDF_OUT) fs.copyFileSync(file, `${process.env.SPONSOR_PDF_OUT}/sponsor-${kind}-${lang}.pdf`);
  if (kind === "exec" && lang === "en") ok("the report (en): the KPI table from the agreement, with each result", /Sponsorship Report/.test(txt) && /KPIs from the sponsorship agreement/.test(txt) && /Individuals RBH presented to/.test(txt)
    && /What RBH's sponsorship delivered in 2026/.test(txt) && /\$50,000/.test(txt) && /Cost per person reached \$16,667/.test(txt) && /Different agencies in front of RBH \(each counted once\) 3/.test(txt) && /RBH's own session rated 4 or 5 100% \(2 answers, 1 event\)/.test(txt)
    && /3 attendees at the events where RBH presented/.test(txt) && /1 city in 1 province \(Saskatchewan\)/.test(txt) && /About 24,000/.test(txt) && /About 12,000 \(an estimate\)/.test(txt) && /Prairie Training Symposium/.test(txt) && !/RBH training/.test(txt), txt.slice(0, 900));
  if (kind === "exec" && lang === "fr") ok("the report (fr): the same in French", /Rapport sur la commandite/.test(txt) && /Indicateurs de l'entente de commandite/.test(txt) && /Saskatchewan/.test(txt), txt.slice(0, 500));
  if (kind === "info") ok("the infographic: one page, what RBH's money bought, its events", /Prairie Training Symposium/.test(txt) && /\$50,000/.test(txt) && /put RBH in front of/.test(txt) && /DIFFERENTAGENCIES/.test(txt.replace(/ /g, "")) && /PERPERSONREACHED/.test(txt.replace(/ /g, "")) && Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [file]).toString())[1]) === 1, txt.slice(0, 400));
  fs.unlinkSync(file);
}
ok("filed under its own name", Y.yearFileName("exec", "en", 2026, "sponsor") === "Sponsorship Report 2026.pdf" && Y.yearFileName("exec", "en", 2026) === "Executive Summary 2026.pdf");

// The checkbox on Edit event: kept on ONGIA's events, never on an RBH event.
const base = { title: "Ontario Symposium", city: "Toronto, ON", dayOne: "2026-06-01", lastDay: "2026-06-01", board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }] };
r = await call(events, "events", "id=sp-plain", { method: "PUT", body: { ...base, rbhPresented: true } });
ok("ticking RBH presented on an ONGIA event keeps it", r.status === 200 && (await getEvent("sp-plain")).rbhPresented === true, JSON.stringify(r.body).slice(0, 200));
r = await call(events, "events", "id=sp-plain", { method: "PUT", body: { ...base } });
ok("an edit that doesn't mention it leaves it ticked", (await getEvent("sp-plain")).rbhPresented === true);
r = await call(events, "events", "id=sp-plain", { method: "PUT", body: { ...base, kind: "rbh", province: "ON", rbhPresented: true } });
ok("an RBH event is never also counted as RBH presenting at ONGIA's event", (await getEvent("sp-plain")).rbhPresented === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
