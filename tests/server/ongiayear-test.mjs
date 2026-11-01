// ONGIA's year (Andrew 1 Nov 2026): the figures for a calendar year worked out by the desk (events, people trained,
// agencies, provinces, sectors, topics, rating, presenters, months, contacts typed in), the agencies sorted into sectors
// with Andrew's corrections kept, three reports and an infographic written around the figures in English and French,
// kept as versions, and the API on Reports › ONGIA. Practice events never count; any kind of event does.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
delete process.env.ANTHROPIC_API_KEY;
const RealDate = Date, FIXED = new RealDate("2026-10-31T15:00:00Z").getTime();
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [FIXED])); } static now() { return FIXED; } };
const F = REPO + "netlify/functions/";
const { execFileSync } = await import("node:child_process");
const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
const { putEvent, putSurveyResponse, putAttendees, putPresenter, getAgencyList } = await import(F + "lib/store.mjs");
const Y = await import(F + "lib/ongiayear.mjs");
const { sortAgencies, guessSector } = await import(F + "lib/sectors.mjs");
const { directory, editAgency } = await import(F + "lib/agencies.mjs");
const { ongPdf } = await import(F + "lib/ongiapdf.mjs");
const reports = (await import(F + "reports.mjs")).default;
const { issueSession } = await import(F + "lib/auth.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (qs, { method = "GET", body, headers = H } = {}) => {
  const res = await reports(new Request(`http://localhost/api/reports?${qs}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, body: type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer()), type };
};

/* Sectors: the best guess from names, Claude's pass, and a correction that sticks. */
ok("the best guess from a name: police, federal, corrections, schools, justice, social services", guessSector("Toronto Police Service") === "police" && guessSector("Royal Canadian Mounted Police") === "federal"
  && guessSector("Correctional Service Canada") === "corrections" && guessSector("Peel District School Board") === "education" && guessSector("Ministry of the Attorney General") === "justice"
  && guessSector("Children's Aid Society of Toronto") === "social");
const sorter = { messages: { create: async (req) => {
  const names = req.messages[0].content.split("\n").map((l) => l.replace(/^- /, ""));
  return { content: [{ type: "text", text: JSON.stringify({ agencies: names.map((name) => ({ name, sector: /Sûreté|Mounted/.test(name) ? "federal" : /Police|SPVM|Service de police/.test(name) ? "police" : "community" })) }) }] };
} } };
const sorted = await sortAgencies({ client: sorter });
let dir = await directory();
ok("Claude sorts every agency on the list into a sector", sorted.by === "claude" && dir.every((a) => a.sector) && dir.find((a) => a.name === "Toronto Police Service").sector === "police", JSON.stringify(sorted));
await editAgency("Sûreté du Québec", { sector: "police" });
await sortAgencies({ client: sorter, all: true });
dir = await directory();
ok("a sector set by hand stays when Claude sorts them all again", dir.find((a) => a.name === "Sûreté du Québec").sector === "police" && dir.find((a) => a.name === "Sûreté du Québec").sectorBy === "desk");
await editAgency("Peel Regional Police", { newName: "Peel Regional Police Service" });
dir = await directory();
ok("renaming an agency keeps its sector", dir.find((a) => a.name === "Peel Regional Police Service")?.sector === "police");
ok("the stored list only gains small sector rows; nothing else about an agency changes", (await getAgencyList()).every((r) => r.name));

/* The year's events. */
const sessions = [{ id: "s1", day: "2026-03-10", title: "Street gang recruitment online", titleFr: "", presenters: [] }];
await putEvent({ id: "o-sym", title: "Ontario Gang Symposium", city: "Toronto", dayOne: "2026-03-09", lastDay: "2026-03-10", board: [], survey: { token: "tokongsym123", open: true, mode: "end", sessions } });
await putEvent({ id: "o-rbh", kind: "rbh", title: "ITP Week", city: "Montréal, QC", dayOne: "2026-05-04", lastDay: "2026-05-04", board: [] });
await putEvent({ id: "o-later", title: "Human Trafficking Forum", city: "Halifax", dayOne: "2026-12-02", board: [] });
await putEvent({ id: "o-2025", title: "Youth Violence Conference", city: "Ottawa", dayOne: "2025-04-13", board: [] });
await putEvent({ id: "o-2027a", title: "Winnipeg Training", city: "Winnipeg", dayOne: "2027-02-01", board: [] });
await putEvent({ id: "o-2027b", title: "Calgary Training", city: "Calgary", dayOne: "2027-03-01", board: [] });
await putEvent({ id: "o-practice", practice: true, title: "Practice Symposium", city: "Toronto", dayOne: "2026-04-01", board: [] });
const person = (i, org, extra = {}) => ({ key: `p${i}`, first: `Sam${i}`, last: "Sample", email: `sam${i}@example.ca`, organization: org, status: "ATTENDING", sent: ["survey:end"], ...extra });
await putAttendees("o-sym", { people: [person(1, "Toronto Police Service"), person(2, "TPS"), person(3, "OPP"), person(4, "RCMP"), person(5, "Some Unknown Group Inc")] });
await putAttendees("o-rbh", { people: [person(6, "Sûreté du Québec", { checkedIn: true }), person(7, "SPVM", { checkedIn: true }), person(8, "SPVM", { checkedIn: false })] });
await putAttendees("o-later", { people: [person(9, "Halifax Regional Police")] });
await putAttendees("o-2025", { people: [person(10, "Toronto Police Service")] });
await putAttendees("o-practice", { people: [person(11, "Calgary Police Service")] });
await putPresenter({ id: "pr1", eventId: "o-sym", first: "Ari", last: "Speaker", email: "ari@example.org", organization: "Toronto Police Service", status: "approved", submission: { talk: "Human trafficking indicators" } });
await putPresenter({ id: "pr2", eventId: "o-rbh", first: "Ari", last: "Speaker", email: "ari@example.org", organization: "Toronto Police Service", status: "approved", submission: { talk: "Contraband tobacco" } });
await putPresenter({ id: "pr3", eventId: "o-rbh", first: "Bo", last: "Gone", email: "bo@example.org", organization: "SPVM", status: "withdrawn" });
for (let i = 1; i <= 3; i++) await putSurveyResponse("o-sym", { id: `r${i}`, at: "2026-03-11T12:00:00Z", part: "end", lang: "en", about: { agency: "TPS", again: 0 },
  sessions: { s1: { relevant: 5, knowledge: 5, expectations: 5, expert: 5, engaging: 5, delivery: 5, rebook: 0, comment: i === 1 ? "Very practical day." : "" } },
  overall: { quality: i === 3 ? 3 : 5, confidence: 4, practical: 5, variety: 4, nps: 10, topics: "Court testimony" } });
await Y.putOngInputs(2026, { contacts: 6092 }, "test");

let f = await Y.ongiaYearFacts(2026);
ok("the year: three events in 2026 of any kind (RBH included), two held, one to come; not the practice one, 2025 or 2027", f.events === 3 && f.held === 2 && f.upcoming === 1, JSON.stringify(f.eventsList.map((e) => e.title)));
ok("people trained: five registered at the symposium (no attendance taken), two checked in at the ITP week", f.attendees === 7 && f.attendanceBasis === "mixed", `${f.attendees} ${f.attendanceBasis}`);
ok("agencies: TPS (two spellings), OPP, RCMP, SQ, SPVM; the unknown group isn't an agency", f.agencyCount === 5 && f.unmatched === 1, `${f.agencyCount} / ${f.unmatched}`);
ok("provinces counted by people whose agency has one: Ontario 3, Quebec 2 (the RCMP has none)", f.provinceCount === 2 && f.provinces.find((p) => p.code === "ON").count === 3 && f.provinces.find((p) => p.code === "QC").count === 2, JSON.stringify(f.provinces));
ok("sectors from the stored sorting: police and federal", f.sectors.find((s) => s.id === "police")?.count === 5 && f.sectors.find((s) => s.id === "federal")?.count === 1, JSON.stringify(f.sectors));
ok("new agencies against 2025: all but TPS", f.newAgencies === 4 && f.returningAgencies === 1, `${f.newAgencies}/${f.returningAgencies}`);
ok("the average rating: quality 5, 5, 3 → 4.3 out of 5, 67% rated 4 or 5", f.rating?.mean === 4.3 && f.rating?.top2 === 67 && f.rating?.n === 3, JSON.stringify(f.rating));
ok("presenters counted once each, not the one who withdrew", f.presenters === 1 && f.presenterOrgs === 1, `${f.presenters}/${f.presenterOrgs}`);
ok("events by month: March and May held, December to come", f.months[2].held === 1 && f.months[4].held === 1 && f.months[11].upcoming === 1);
ok("contacts as typed in", f.contacts === 6092);
ok("next year: two events booked, in two provinces (from their cities)", f.nextYear.count === 2 && f.nextYear.provinces === 2, JSON.stringify(f.nextYear));
ok("no topics until they're grouped", f.topics.length === 0);
ok("Claude is never given anyone's name or email", !JSON.stringify(f).includes("@example.ca") && !JSON.stringify(f).includes("Sam1"));

/* Topics: grouped by Claude from the held events' titles and sessions; a best guess without it. */
const list = await directory();
const rows = await Promise.all(["o-sym", "o-rbh", "o-later"].map(async (id) => Y.eventFacts((await (await import(F + "lib/store.mjs")).getEvent(id)), list)));
const guessed = await Y.groupTopics(2026, rows);
ok("without Claude, a best guess from the titles; only events that took place", guessed.by === "guess" && guessed.topics.some((t) => /gangs/i.test(t.en)) && !guessed.events.includes("o-later"), JSON.stringify(guessed.topics));
let topicAsk = null;
const grouper = { messages: { create: async (req) => { topicAsk = req; return { content: [{ type: "text", text: JSON.stringify({ topics: [
  { en: "Street gangs and recruitment", fr: "Gangs de rue et recrutement", events: ["o-sym"] }, { en: "Illicit trade", fr: "Commerce illicite", events: ["o-rbh", "nope"] }] }) }] }; } } };
const grouped = await Y.groupTopics(2026, rows, { client: grouper });
f = await Y.ongiaYearFacts(2026);
ok("Claude groups the sessions into topics; people per topic are those at the events that covered it", grouped.by === "claude" && f.topics.find((t) => t.en === "Street gangs and recruitment")?.people === 5 && f.topics.find((t) => t.en === "Illicit trade")?.people === 2, JSON.stringify(f.topics));
ok("Claude is given the events' titles and session titles", /Street gang recruitment online/.test(topicAsk.messages[0].content) && /Contraband tobacco/.test(topicAsk.messages[0].content));

/* The reports, written around the figures. */
const asked = [];
const writer = { messages: { create: async (req) => {
  asked.push(req);
  const fr = /Write in Canadian French/.test(req.system), brief = JSON.parse(req.messages[0].content.split("\n\n")[0]);
  const real = brief.comments[0]?.id ?? 1;
  const kind = /Annual Impact Report/.test(req.system) ? "impact" : /Reach and Network/.test(req.system) ? "reach" : /Training Program/.test(req.system) ? "program" : "info";
  const body = {
    impact: { glance: [fr ? "En 2026, l'ONGIA a formé sept personnes." : "In 2026 ONGIA trained seven people."], who: ["Mostly police."], quotes: [{ commentId: real, about: "Symposium" }, { commentId: 999, about: "made up" }],
      highlights: ["National reach. Two provinces."], lookAhead: "Two events are booked.", reply: /Just now ONGIA asked/.test(req.messages[0].content) ? "Made it shorter." : "" },
    reach: { intro: ["Five agencies."], provinces: "Ontario and Quebec.", sectors: "Police services first.", growth: "Four new agencies.", reply: "" },
    program: { intro: ["Two events held."], topics: "Gangs and illicit trade.", presenters: "One presenter.", ratings: "Rated 4.3.", askedNext: "Court testimony.", recommendations: ["Keep going. It works."], reply: "" },
    info: { headline: fr ? "Outiller la première ligne" : "Equipping the front line", tagline: "Training for the people who respond.", quote: { commentId: real, about: "Symposium" }, reply: "" },
  }[kind];
  return { content: [{ type: "text", text: JSON.stringify(body) }], stop_reason: "end_turn" };
} } };
for (const kind of ["impact", "reach", "program", "info"]) await Y.buildOngReport(2026, kind, { client: writer });
const all = await Y.ongReportsOf(2026);
ok("each of the four is made in English and French as version 1", ["impact", "reach", "program", "info"].every((k) => all[k].current === 1 && all[k].versions[0].content.en && all[k].versions[0].content.fr));
ok("a quote is kept only when it's word for word an attendee's comment", all.impact.versions[0].content.en.quotes.length === 1 && all.impact.versions[0].content.en.quotes[0].text === "Very practical day.");
ok("Claude is told the figures are the only ones, and to name no attendee", asked.every((r) => /only figures that exist/.test(r.system) && /Never name or identify an attendee/.test(r.system)));
await Y.buildOngReport(2026, "impact", { client: writer, reason: "asked-change", ask: "Shorter, please" });
ok("asking for a change makes version 2 and Claude says what it changed", (await Y.ongReportsOf(2026)).impact.current === 2 && (await Y.ongReportsOf(2026)).impact.chat.at(-1).text === "Made it shorter.");

/* The PDFs: every page drawn, in both languages, no section printed empty. */
const dirOut = fs.mkdtempSync(path.join(os.tmpdir(), "ongia-"));
for (const kind of ["impact", "reach", "program", "info"]) for (const lang of ["en", "fr"]) {
  const v = (await Y.ongReportsOf(2026))[kind].versions.at(-1);
  const file = path.join(dirOut, `${kind}-${lang}.pdf`);
  fs.writeFileSync(file, await ongPdf(kind, v.content[lang], v.facts, lang, { date: "2027-01-08" }));
  const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [file]).toString())[1]);
  const text = execFileSync("pdftotext", ["-layout", file, "-"]).toString();
  if (kind === "info") ok(`the ${lang} infographic is one page with the six tiles and the province map`, pages === 1 && /6[,  ]?092/.test(text) && /\bON\b/.test(text) && /QC/.test(text), `${pages} pages`);
  else ok(`the ${lang} ${kind} report is drawn (${pages} pages), with the year's figures`, pages >= 1 && pages <= 5 && text.includes("2026") && (kind === "program" ? /\b3\b/.test(text) : /\b7\b/.test(text)), text.slice(0, 200));
}

/* The API on Reports › ONGIA. */
let r = await call("ongia=2026");
ok("the page gets the year's figures, contacts, the four reports and the years", r.status === 200 && r.body.facts.attendees === 7 && r.body.inputs.contacts === 6092 && r.body.state.reports.info.current === 1 && r.body.years.includes("2026") && r.body.mayChange === true, JSON.stringify(Object.keys(r.body)));
ok("comments aren't sent to the page", r.body.facts.comments === undefined && r.body.facts.commentCount === 1);
const lee = { "x-admin-key": issueSession({ email: "secretary@ongia.ca", name: "Lee" }), "content-type": "application/json" };
r = await call("ongia=2026", { headers: lee });
ok("any board member can read ONGIA's reports", r.status === 200 && r.body.mayChange === false);
r = await call("ongia=2026&inputs=1", { method: "PUT", body: { contacts: 1 }, headers: lee });
ok("but only the officers can change contacts or make reports", r.status === 403);
r = await call("ongia=2026&inputs=1", { method: "PUT", body: { contacts: 6100 } });
ok("contacts typed in through the API", r.status === 200 && r.body.inputs.contacts === 6100);
r = await call("ongia=2026&kind=reach&lang=fr&pdf=1");
ok("each report's PDF opens, named in its language", r.status === 200 && /pdf/.test(r.type) && r.body.length > 5000);
r = await call("ongia=2026&kind=impact&revert=1", { method: "POST", body: {} });
ok("an earlier version can be brought back", r.status === 200 && r.body.reports.impact.current === 1);
r = await call("ongia=2031&build=all", { method: "POST", body: {} });
ok("a year with no event held yet can't be made", r.status === 409 && /No ONGIA event in 2031/.test(r.body.error));

/* The RBH year end can now say who attended by sector. */
const rbhYear = await (await import(F + "lib/yearend.mjs")).yearFacts(2026);
ok("the RBH year end gets who attended by sector, with shares (the SQ is police, as corrected by hand above)", rbhYear.sectors.length === 1 && rbhYear.sectors[0].id === "police" && rbhYear.sectors[0].count === 2 && rbhYear.sectors[0].pct === 100, JSON.stringify(rbhYear.sectors));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
