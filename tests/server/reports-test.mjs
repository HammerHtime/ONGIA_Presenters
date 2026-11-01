// RBH survey reports (Andrew 30 Oct 2026): the Executive Summary and the infographic in English and French, made the night
// half the survey's people have answered ("once 50% of the surveys return") or when asked; rebuilt each night more answers
// come in until marked final; changes asked of Claude kept and applied on every rebuild; filed to the event's OneDrive
// folder under Survey by their plain names. Figures and quotes always from the survey.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const F = REPO + "netlify/functions/";
const fs = await import("node:fs");
const { execFileSync } = await import("node:child_process");
const { putEvent, getEvent, putSurveyResponse, putAttendees } = await import(F + "lib/store.mjs");
const R = await import(F + "lib/reports.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };

const sessions = [{ id: "s1", day: "2027-05-11", title: "Field visits", titleFr: "Visites sur le terrain", presenters: [] }, { id: "s2", day: "2027-05-12", title: "Vape and pouch identification", titleFr: "", presenters: [] }];
await putEvent({ id: "itp", kind: "rbh", title: "Illicit Trade Prevention Training", city: "Montréal", dayOne: "2027-05-11", lastDay: "2027-05-15", board: [], sharePointFolder: "Events/ITP",
  survey: { token: "tokitp12345", open: true, mode: "end", sessions } });
await putEvent({ id: "plain", title: "Ontario Symposium", city: "Toronto", dayOne: "2027-11-04", board: [], survey: { token: "tokplain1234", open: true, mode: "end", sessions } });
// Ten people were sent the survey.
await putAttendees("itp", { people: Array.from({ length: 10 }, (_, i) => ({ key: `p${i}`, email: `p${i}@example.ca`, status: "ATTENDING", sent: ["survey:end"] })) });
const S = (n) => ({ relevant: n, knowledge: n, expectations: n, expert: n, engaging: n, delivery: n });
let k = 0;
const answer = async (q, comment) => putSurveyResponse("itp", { id: `r${++k}`, at: `2027-05-1${5 + (k % 4)}T12:00:00Z`, part: "end", lang: k % 3 ? "en" : "fr", about: { agency: "TPS", again: 0 },
  sessions: { s1: { ...S(5), rebook: 0, comment }, s2: { ...S(q), rebook: 0 } }, overall: { quality: 5, confidence: q, practical: 5, variety: 4, nps: 10, topics: "Court testimony" } });
for (let i = 0; i < 4; i++) await answer(4, i === 0 ? "Both field tours closed the loop for me." : "");

// Claude, stubbed: records what it is asked; writes in the language asked; tries to slip in a quote that was never said.
const asked = [];
const client = { messages: { create: async (req) => {
  asked.push(req);
  const fr = /Write in Canadian French/.test(req.system), exec = /executive summary/.test(req.system);
  const brief = JSON.parse(req.messages[0].content.split("\n\n")[0]);
  const real = brief.comments[0]?.id ?? 1;
  const asks = (req.messages[0].content.split("ONGIA's requests:\n")[1] ?? "").split("\n").filter((l) => l.startsWith("- "));
  const extra = asks.filter((a) => /Akwesasne/.test(a)).map(() => ({ title: fr ? "La visite d'Akwesasne" : "The Akwesasne visit", paragraphs: [fr ? "Première fois au programme." : "First time on the program."] }));
  const body = exec
    ? { glance: [fr ? "Ce sommaire présente les résultats." : "This summary presents the results."], context: [], notes: [{ id: "quality", note: fr ? "Unanime" : "Unanimous" }, { id: "nope", note: "x" }], strengths: [fr ? "Les visites." : "The field visits."],
        quotes: [{ commentId: real, about: "Field visits" }, { commentId: 999, about: "made up" }], areas: [{ title: "Vape identification", text: "Lowest score." }], topicsIntro: "", topics: ["Court testimony", "Crown briefing", "Pipeline investigations", "Parcel interdiction"], recommendations: ["Keep the tours."], extra, reply: /Just now ONGIA asked/.test(req.messages[0].content) ? (fr ? "J'ai ajouté une section." : "Added a section on the Akwesasne visit.") : "" }
    : { tagline: fr ? "Un résultat unanime." : "A unanimous result.", lockIn: [{ head: "Tours.", text: "Keep." }], buildNext: [], quote: { commentId: real, about: "Field visits" }, wantNext: ["Court testimony"], reply: "" };
  return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(body) }] };
} } };
const filed = [];
const file = async ({ folder, name, bytes }) => { filed.push({ folder, name, bytes: bytes.length }); return { url: `https://sp/${folder}/${name}`, folderUrl: `https://sp/${folder}` }; };

let f = await R.factsFor(await getEvent("itp"));
ok("ten were sent the survey, four have answered", f.invited === 10 && f.answered === 4, `${f.answered}/${f.invited}`);
let out = await R.runReports({ client, file });
ok("under half back: nothing is made yet", out.length === 0, JSON.stringify(out));
await answer(5, "The plant tour was important.");
out = await R.runReports({ client, file });
ok("half back: both reports are made that night", out.filter((x) => x.reason === "half").length === 2, JSON.stringify(out));
ok("a non-RBH event gets none", !out.some((x) => x.event === "plain"));
ok("each in English and in French: four calls to Claude", asked.length === 4 && asked.filter((r) => /Write in Canadian French/.test(r.system)).length === 2);
ok("filed to the event's folder under Survey by their plain names, both languages", ["Executive Summary.pdf", "Sommaire exécutif.pdf", "Infographic.pdf", "Infographie.pdf"].every((n) => filed.some((x) => x.folder === "Survey" && x.name === n)), JSON.stringify(filed.map((x) => x.name)));
ok("Claude is never sent anyone's name or email", !JSON.stringify(asked).includes("@example.ca"));

let r = (await R.reportsOf("itp")).exec;
const v1 = r.versions.at(-1);
ok("a quote is kept only if someone wrote it, word for word; a note only for a question asked", v1.content.en.quotes.length === 1 && v1.content.en.quotes[0].text === "Both field tours closed the loop for me." && v1.content.en.notes.every((n) => n.id !== "nope"));
ok("the figures are worked out by the desk: 5 of 10 answered, 50%", v1.facts.answered === 5 && v1.facts.invited === 10 && v1.facts.rate === 50);

// The PDFs, in both languages.
for (const [kind, lang] of [["exec", "en"], ["exec", "fr"], ["info", "en"], ["info", "fr"]]) {
  const pdf = await R.versionPdf(await getEvent("itp"), kind, lang);
  fs.writeFileSync(`/tmp/report-${kind}-${lang}.pdf`, pdf);
}
const t = (p) => execFileSync("pdftotext", [p, "-"]).toString().replace(/\s+/g, " ");
// Requested topics sit in two columns (Andrew 30 Oct 2026): the first and third topics share a line in the laid-out text.
const laid = execFileSync("pdftotext", ["-layout", "/tmp/report-exec-en.pdf", "-"]).toString();
ok("the requested topics are in two columns", /Court testimony\s{3,}.*Pipeline investigations/.test(laid) && /Crown briefing\s{3,}.*Parcel interdiction/.test(laid), laid.slice(laid.indexOf("Requested"), laid.indexOf("Requested") + 300));
ok("the English summary: its sections and the survey's figures", /Executive Summary/.test(t("/tmp/report-exec-en.pdf")) && /At a Glance/.test(t("/tmp/report-exec-en.pdf")) && /5 of 10 surveys returned \(50%\)/.test(t("/tmp/report-exec-en.pdf")) && /Both field tours closed the loop for me/.test(t("/tmp/report-exec-en.pdf")), t("/tmp/report-exec-en.pdf").slice(0, 300));
ok("the French one: French headings and text", /Sommaire exécutif/.test(t("/tmp/report-exec-fr.pdf")) && /En un coup d'œil/.test(t("/tmp/report-exec-fr.pdf")) && /Ce sommaire présente les résultats/.test(t("/tmp/report-exec-fr.pdf")) && /5 sondages reçus sur 10/.test(t("/tmp/report-exec-fr.pdf")));
ok("the infographic is one page, in each language", /Pages:\s+1\b/.test(execFileSync("pdfinfo", ["/tmp/report-info-fr.pdf"]).toString()) && /APERÇUEXÉCUTIF/.test(t("/tmp/report-info-fr.pdf").replace(/ /g, "")) && /EXECUTIVESNAPSHOT/.test(t("/tmp/report-info-en.pdf").replace(/ /g, "")));

// No new answers: nothing changes overnight. New answers: rebuilt.
asked.length = 0;
out = await R.runReports({ client, file });
ok("a night with no new surveys changes nothing", out.length === 0 && asked.length === 0);
await answer(5, "");
out = await R.runReports({ client, file });
ok("a night with new surveys rebuilds both, with every answer", out.filter((x) => x.reason === "more").length === 2 && (await R.reportsOf("itp")).exec.versions.at(-1).facts.answered === 6);

// A change asked of Claude is kept and applied on the next rebuild too.
const ev = await getEvent("itp");
const all = await R.reportsOf("itp");
await R.putReports("itp", { ...all, exec: { ...all.exec, requests: [{ id: "q1", text: "Add a section on the Akwesasne visit", lang: "both" }] } });
await R.buildReport(ev, "exec", { reason: "asked-change", ask: "Add a section on the Akwesasne visit", client });
r = (await R.reportsOf("itp")).exec;
ok("the change is made, in both languages, and Claude says what it did", r.versions.at(-1).content.en.extra[0]?.title === "The Akwesasne visit" && r.versions.at(-1).content.fr.extra[0]?.title === "La visite d'Akwesasne" && /Akwesasne/.test(r.chat.at(-1).text));
await answer(4, "");
await R.runReports({ client, file });
r = (await R.reportsOf("itp")).exec;
ok("and still there after the next night's rebuild with new answers", r.versions.at(-1).reason === "more" && r.versions.at(-1).content.en.extra[0]?.title === "The Akwesasne visit" && r.versions.at(-1).facts.answered === 7);
ok("Claude is shown the requests every time", asked.filter((q) => /executive summary/.test(q.system)).slice(-2).every((q) => /\(this report\) Add a section on the Akwesasne visit/.test(q.messages[0].content)));

// A request kept for every RBH report reaches another RBH event's report.
await R.putStanding("exec", [{ id: "a1", text: "Always end with a note on the RBH partnership." }]);
await R.buildReport(ev, "exec", { reason: "asked", client });
ok("a request kept for every RBH report is applied too", /\(every RBH report\) Always end with a note on the RBH partnership/.test(asked.at(-1).messages[0].content));

// Marked final: no more nightly changes.
const a2 = await R.reportsOf("itp");
await R.putReports("itp", { ...a2, exec: { ...a2.exec, final: true }, info: { ...a2.info, final: true } });
await answer(5, "");
asked.length = 0;
out = await R.runReports({ client, file });
ok("marked final, nothing changes overnight even with new surveys", out.length === 0 && asked.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
