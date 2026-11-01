// The RBH year end (Andrew 31 Oct 2026): every figure for a calendar year worked out by the desk (trainings, people,
// agencies, provinces, the survey weighted by answers, certificates, what's booked next year, the two figures typed in),
// the Executive Summary and infographic written by Claude around them in English and French, kept as versions, changed by
// asking, filed to the year-end folder, and the list on Admin › RBH reports. Practice events and other kinds never count.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
// The story is told on 31 Oct 2026: the March training is done, the December one still to come.
const RealDate = Date, FIXED = new RealDate("2026-10-31T15:00:00Z").getTime();
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [FIXED])); } static now() { return FIXED; } };
const F = REPO + "netlify/functions/";
const { execFileSync } = await import("node:child_process");
const fs = await import("node:fs");
const { putEvent, putSurveyResponse, putAttendees, putMeta } = await import(F + "lib/store.mjs");
const Y = await import(F + "lib/yearend.mjs");
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

const sessions = [{ id: "s1", day: "2026-03-10", title: "Field visits", titleFr: "Visites sur le terrain", presenters: [] }];
// Two RBH trainings in 2026 (one done, one still to come), one in 2025, one booked in 2027; a practice one and a non-RBH one that never count.
await putEvent({ id: "ye-itp", kind: "rbh", title: "ITP Week", city: "Montréal, QC", province: "QC", dayOne: "2026-03-09", lastDay: "2026-03-11", board: [], survey: { token: "tokyeitp1234", open: true, mode: "end", sessions } });
await putEvent({ id: "ye-2025", kind: "rbh", title: "SOR Training", city: "Windsor", dayOne: "2025-04-13", board: [] });
await putEvent({ id: "ye-2027", kind: "rbh", title: "Halifax Training", city: "Halifax", dayOne: "2027-06-07", board: [] });
await putEvent({ id: "ye-practice", kind: "rbh", practice: true, title: "Practice ITP", city: "Montréal", dayOne: "2026-02-01", board: [] });
await putEvent({ id: "ye-plain", title: "Ontario Symposium", city: "Toronto", dayOne: "2026-05-04", board: [] });
await putEvent({ id: "ye-later", kind: "rbh", title: "Western Symposium", city: "Victoria, BC", dayOne: "2026-12-30", board: [] });
const person = (i, org, extra = {}) => ({ key: `p${i}`, first: `Pat${i}`, last: "Example", email: `pat${i}@example.ca`, organization: org, status: "ATTENDING", sent: ["survey:end"], ...extra });
// Six registered, five checked in: TPS ×2, SQ, SPVM, OPP; one from RBH itself (not reach); one registered but not checked in.
await putAttendees("ye-itp", { people: [person(1, "Toronto Police Service", { checkedIn: true }), person(2, "TPS", { checkedIn: true }), person(3, "Sûreté du Québec", { checkedIn: true }),
  person(4, "SPVM", { checkedIn: true }), person(5, "Rothmans, Benson & Hedges", { checkedIn: true }), person(6, "OPP", { checkedIn: false })] });
await putAttendees("ye-2025", { people: [person(9, "Toronto Police Service", { checkedIn: true })] });
await putAttendees("ye-practice", { people: [person(20, "Calgary Police Service", { checkedIn: true })] });
for (let i = 1; i <= 4; i++) await putSurveyResponse("ye-itp", { id: `r${i}`, at: "2026-03-12T12:00:00Z", part: "end", lang: "en", about: { agency: "TPS", again: 0 },
  sessions: { s1: { relevant: 5, knowledge: 5, expectations: 5, expert: 5, engaging: 5, delivery: 5, rebook: 0, comment: i === 1 ? "The field visit made it real." : "" } },
  overall: { quality: i === 4 ? 3 : 5, confidence: 4, practical: 5, variety: 4, nps: 10, topics: "Court testimony" } });
await putMeta("certs:event:ye-itp", { p1: "AAAA-1111", p2: "AAAA-2222", p3: "AAAA-3333" });

let f = await Y.yearFacts(2026);
ok("the year holds the two RBH trainings of 2026, not the practice one, the other kind, or 2025 and 2027", f.trainings === 2 && f.held === 1 && f.upcoming === 1, JSON.stringify(f.trainingsList.map((t) => t.title)));
ok("people trained: the four checked in from agencies, plus the one from RBH; the one not checked in doesn't count", f.attendees === 5 && f.attendanceBasis === "checked in", `${f.attendees} ${f.attendanceBasis}`);
ok("attendee training days: three days × five people", f.attendeeDays === 15, String(f.attendeeDays));
ok("agencies reached: TPS (two spellings, one agency), SQ, SPVM; RBH itself is not reach", f.agencyCount === 3 && !f.topAgencies.some((a) => /Rothmans/.test(a.agency)) && f.topAgencies[0].agency === "Toronto Police Service" && f.topAgencies[0].count === 2, JSON.stringify(f.topAgencies));
ok("provinces reached, with the attendees from each", f.provinceCount === 2 && f.provinces[0].code === "ON" && f.provinces[0].count === 2 && f.provinces.find((p) => p.code === "QC").count === 2, JSON.stringify(f.provinces));
ok("new and returning agencies, against the 2025 training", f.newAgencies === 2 && f.returningAgencies === 1, `${f.newAgencies}/${f.returningAgencies}`);
ok("the survey: 4 of 6 answered, quality 4 or 5 from 3 of 4 (75%)", f.survey.answered === 4 && f.survey.invited === 6 && f.survey.quality === 75, JSON.stringify(f.survey));
ok("certificates issued: 3", f.certificates === 3);
ok("next year: one RBH training already booked for 2027", f.nextYear.count === 1 && f.nextYear.trainings[0].title === "Halifax Training");
ok("comments carry the training's name", f.comments.length === 1 && /ITP Week/.test(f.comments[0].about));
ok("nothing about communications until it's typed in", f.communications.members === null && f.communications.estimatedEmails === null);
ok("Claude is never given anyone's name or email", !JSON.stringify(f).includes("@example.ca") && !JSON.stringify(f).includes("Pat1"));

// The two figures typed in once a year, through the API; a board member who isn't an officer can't change them.
const lee = { "x-admin-key": issueSession({ email: "secretary@ongia.ca", name: "Lee" }), "content-type": "application/json" };
ok("a board member who isn't the president or VP can't change the year end", (await call("yearend=2026&inputs=1", { method: "PUT", headers: lee, body: { members: 5 } })).status === 403);
let r = await call("yearend=2026&inputs=1", { method: "PUT", body: { members: "6000", campaigns: 10 } });
ok("members and campaigns are kept", r.status === 200 && r.body.inputs.members === 6000 && r.body.inputs.campaigns === 10, JSON.stringify(r.body));
f = await Y.yearFacts(2026);
ok("estimated emails = members × campaigns", f.communications.estimatedEmails === 60000);
r = await call("yearend=2026&inputs=1", { method: "PUT", body: { members: "-4", campaigns: "ten" } });
ok("nonsense is not kept as a figure", r.body.inputs.members === null && r.body.inputs.campaigns === null);
await call("yearend=2026&inputs=1", { method: "PUT", body: { members: 6000, campaigns: 10 } });

// Claude, stubbed: writes in the language asked; tries to slip in a quote nobody wrote, and a comms line with no figures.
const asked = [];
const client = { messages: { create: async (req) => {
  asked.push(req);
  const fr = /Write in Canadian French/.test(req.system), exec = /year-end executive summary/.test(req.system);
  const brief = JSON.parse(req.messages[0].content.split("\n\n")[0]);
  const real = brief.comments[0]?.id ?? 1;
  const body = exec
    ? { glance: [fr ? "Cette année, l'ONGIA a offert une formation." : "This year ONGIA delivered one training with RBH.", fr ? "Elle a été bien reçue." : "It was well received."], reach: ["Three agencies in two provinces."],
        communications: ["About 60,000 emails, an estimate."], quotes: [{ commentId: real, about: "Field visits" }, { commentId: 999, about: "made up" }], askedNext: "Court testimony.",
        strengths: ["National reach. Two provinces."], lookAhead: "One training is booked.", recommendations: ["Keep going. It works."], extra: [],
        reply: /Just now ONGIA asked/.test(req.messages[0].content) ? "Shortened the glance." : "" }
    : { headline: fr ? "Former la première ligne" : "Training the front line", tagline: "One training. Two provinces.", quote: { commentId: 999, about: "made up" }, wantNext: ["Court testimony"], reply: "" };
  return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(body) }] };
} } };
const v = await Y.buildYearReport(2026, "exec", { client });
await Y.buildYearReport(2026, "info", { client });
ok("each report in English and French: four calls to Claude", asked.length === 4 && asked.filter((q) => /Write in Canadian French/.test(q.system)).length === 2);
ok("the prompt is about the partnership's year, and forbids social media and invented figures", /year-end executive summary/.test(asked[0].system) && /Never mention social media/.test(asked[0].system) && /only figures that exist/.test(asked[0].system));
ok("a quote is kept only if an attendee wrote it, word for word", v.content.en.quotes.length === 1 && v.content.en.quotes[0].text === "The field visit made it real.");
let all = await Y.yearReportsOf(2026);
ok("the infographic's made-up quote is dropped", all.info.versions[0].content.en.quote === null);
ok("version 1 keeps the figures it was written from", all.exec.current === 1 && all.exec.versions[0].facts.attendees === 5);

// The PDFs, both languages: real files with the year's figures in them.
const out = new URL("./", import.meta.url).pathname;
for (const [kind, lang] of [["exec", "en"], ["exec", "fr"], ["info", "en"], ["info", "fr"]]) {
  const p = await call(`yearend=2026&kind=${kind}&lang=${lang}&pdf=1`);
  const file = `${out}yearend-${kind}-${lang}.pdf`;
  fs.writeFileSync(file, p.body);
  const txt = execFileSync("pdftotext", ["-layout", file, "-"]).toString();
  const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [file]).toString())[1]);
  if (kind === "exec") ok(`Executive Summary (${lang}): a PDF with the trainings, the totals and the communications`, p.type === "application/pdf" && /ITP Week/.test(txt) && /60[ ,  ]?000/.test(txt) && /Toronto Police Service/.test(txt) && pages >= 2, `${pages} pages`);
  else ok(`infographic (${lang}): one page, with the tiles and the booking for 2027`, p.type === "application/pdf" && pages === 1 && /2027/.test(txt) && /ITP Week/.test(txt), `${pages} pages`);
  fs.unlinkSync(file);
}
ok("a report not made yet is a 404", (await call("yearend=2025&kind=exec&lang=en&pdf=1")).status === 404);

// Asking for a change; final; revert. (The background maker isn't running here, so the request is checked and kept.)
r = await call("yearend=2026&kind=exec&ask=1", { method: "POST", body: { text: "Shorten the glance", lang: "both" } });
ok("a change asked for is kept with the report and shows as being made", r.status === 200 && r.body.reports.exec.requests.length === 1 && !!r.body.reports.exec.building, JSON.stringify(r.body.reports?.exec?.requests));
await Y.buildYearReport(2026, "exec", { client, reason: "asked-change", ask: "Shorten the glance" });
all = await Y.yearReportsOf(2026);
ok("rebuilt with the request: version 2, and Claude says what it changed", all.exec.current === 2 && all.exec.chat.at(-1).text === "Shortened the glance." && /Shorten the glance/.test(asked.at(-1).messages[0].content));
r = await call("yearend=2026&kind=exec&final=1", { method: "POST", body: { final: true } });
ok("marked final", r.body.reports.exec.final === true);
r = await call("yearend=2026&kind=exec&revert=1", { method: "POST", body: {} });
ok("back to version 1", r.body.reports.exec.current === 1);
ok("making it is refused for a year with no training held yet", (await call("yearend=2099&kind=exec&build=1", { method: "POST", body: {} })).status === 409);

// Filed to the year-end folder by plain names in both languages.
const filed = [];
await Y.fileYearReport(2026, "exec", { file: async ({ folder, name, bytes }) => { filed.push({ folder, name, bytes: bytes.length }); return { url: `https://sp/${folder}/${name}`, folderUrl: `https://sp/${folder}` }; } });
ok("filed under RBH/Year end 2026 as Executive Summary 2026.pdf and Sommaire exécutif 2026.pdf", filed.length === 2 && filed.every((x) => x.folder === "RBH/Year end 2026" && x.bytes > 1000) && filed.some((x) => x.name === "Executive Summary 2026.pdf") && filed.some((x) => x.name === "Sommaire exécutif 2026.pdf"), JSON.stringify(filed));

// The list on Admin › RBH reports.
r = await call("list=1&year=2026");
ok("the list: the 2026 RBH trainings in date order, the practice one marked, not the other kind", r.status === 200 && r.body.rows.map((x) => x.id).join() === "ye-practice,ye-itp,ye-later" && r.body.rows[0].practice === true && !r.body.rows.some((x) => x.id === "ye-plain"), r.body.rows?.map((x) => x.id).join());
ok("each row carries its reports' state, and whether it has been held", r.body.rows.find((x) => x.id === "ye-itp").reports.exec.name.en === "Executive Summary" && r.body.rows.find((x) => x.id === "ye-itp").held === true && r.body.rows.find((x) => x.id === "ye-later").held === false);
ok("with the year's figures (no comments sent to the page), the typed-in figures and the year-end reports", r.body.facts.attendees === 5 && r.body.facts.comments === undefined && r.body.inputs.members === 6000 && r.body.yearend.reports.exec.made === true);
ok("the years offered are those with RBH trainings, and this one", ["2025", "2026", "2027"].every((y) => r.body.years.includes(y)) && r.body.years.includes(new Date().toISOString().slice(0, 4)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
