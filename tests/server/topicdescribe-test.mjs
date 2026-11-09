// A plain line under each session title on the infographic (Andrew 9 Nov 2026: "people who did attend the training
// wouldn't know what Project Poppy was … It would be great to have a title that describes the presentation").
const REPO = new URL("../../", import.meta.url).pathname;
const F = REPO + "netlify/functions/";
const { describeSessions } = await import(F + "lib/topicdescribe.mjs");
const { cleanSurvey } = await import(F + "lib/survey.mjs");
const { infographicHtml } = await import(F + "lib/infographic.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };

let asked = null;
const client = { messages: { create: async (req) => { asked = req; return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ sessions: [
  { id: "p1", en: "A human trafficking investigation and its lessons.", fr: "Une enquête sur la traite de personnes" },
  { id: "zz", en: "not asked for", fr: "non" },
] }) }] }; } } };
const out = await describeSessions([{ id: "p1", title: "Project Poppy", presenters: ["A. Presenter"], outline: "x".repeat(5000) }], { client });
ok("Claude's line comes back for the session asked about, its full stop taken off", out.p1?.en === "A human trafficking investigation and its lessons" && out.p1.fr === "Une enquête sur la traite de personnes", JSON.stringify(out));
ok("a line for a session not asked about is dropped", !out.zz);
ok("asked with structured output, on Opus, with the outline cut to 1500 characters", asked.model === "claude-opus-5-5" && asked.output_config.format.type === "json_schema" && JSON.parse(asked.messages[0].content.replace(/^The sessions:\n/, ""))[0].outline.length === 1500);
ok("and told to keep it general for a public infographic", /General terms only/.test(asked.system) && /public infographic/.test(asked.system));
ok("a refusal is said plainly", await describeSessions([{ id: "p1", title: "T" }], { client: { messages: { create: async () => ({ stop_reason: "refusal", content: [] }) } } }).then(() => false, (e) => /declined/.test(e.message)));

const event = { id: "e", title: "National Gang Summit", dayOne: "2026-11-09", lastDay: "2026-11-12", schedule: [{ date: "2026-11-09" }] };
const had = { sessions: [{ id: "p1", day: "2026-11-09", title: "Project Poppy", presenters: ["A"], about: "A human trafficking investigation", aboutFr: "Une enquête" }] };
const kept = cleanSurvey({ sessions: [{ id: "p1", day: "2026-11-09", title: "Project Poppy", presenters: "A" }] }, had, event);
ok("saving the sessions without the line keeps it", kept.sessions[0].about === "A human trafficking investigation" && kept.sessions[0].aboutFr === "Une enquête");
const changed = cleanSurvey({ sessions: [{ id: "p1", day: "2026-11-09", title: "Project Poppy", presenters: "A", about: "Changed by Andrew", aboutFr: "" }] }, had, event);
ok("and saving it changed keeps the change", changed.sessions[0].about === "Changed by Andrew" && changed.sessions[0].aboutFr === "");

const R = { respondents: 3, responses: 3, headline: { n: 0 }, years: [], provinces: [], agencies: [], trained: null, sessions: [], overall: { pace: {}, topics: [] }, comments: [] };
const html = infographicHtml({ ...event, survey: had }, R, null, { lang: "en", block: "topics" });
ok("the infographic shows it under the title", /<h3>Project Poppy<\/h3><p>A human trafficking investigation<\/p>/.test(html), (html.match(/<h3>[\s\S]{0,120}/) || [""])[0]);
const fr = infographicHtml({ ...event, survey: had }, R, null, { lang: "fr", block: "topics" });
ok("in French, the French line", /<p>Une enquête<\/p>/.test(fr));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
