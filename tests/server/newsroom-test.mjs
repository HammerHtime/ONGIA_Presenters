// The Newsroom (spec 28 Nov 2026 and Andrew's changes that day): duplicates collapse to one, a covered story is skipped,
// a youth or victim named in a source never reaches a draft, a number without a checked source is refused, the law only
// from a government page, one post per story (a later step joins the case thread, only on a sure match), the Rising
// flag, search as you type, and a whole sample night with Claude stood in for. The names below are made up.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
delete process.env.ANTHROPIC_API_KEY;
const F = REPO + "netlify/functions/";
const G = await import(F + "lib/newsguard.mjs");
const N = await import(F + "lib/newsroom.mjs");
const { putMeta, getMeta } = await import(F + "lib/store.mjs");
const { issueSession } = await import(F + "lib/auth.mjs");
const endpoint = (await import(F + "newsroom.mjs")).default;
const image = (await import(F + "newsimg.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const GOV = ["gc.ca", "canada.ca", "laws-lois.justice.gc.ca"];

console.log("— the same story told twice, and stories already covered");
const cands = [
  { title: "Peel police seize three handguns, one 3D-printed, in Brampton", url: "https://www.cp24.com/news/peel-guns-1?utm_source=x", outlet: "CP24" },
  { title: "Three handguns including 3D-printed gun seized in Brampton, Peel police say", url: "https://www.cbc.ca/news/brampton-guns", outlet: "CBC" },
  { title: "Peel Regional Police seize three handguns, one 3D-printed, in Brampton", url: "https://www.peelpolice.ca/news/123", outlet: "Peel Regional Police", official: true },
  { title: "CBSA seizes contraband cigarettes at Lacolle crossing", url: "https://www.canada.ca/en/cbsa/news/lacolle", official: true },
  { title: "Winnipeg mentoring program opens to teens", url: "https://winnipegfreepress.com/mentor" },
];
const covered = [{ url: G.canonUrl("https://www.canada.ca/en/cbsa/news/lacolle/"), headline: "CBSA seizes contraband cigarettes at Lacolle crossing", at: "2026-11-27" }];
const c = G.collapse(cands, covered);
ok("three outlets on the Brampton guns become one item", c.kept.filter((k) => /Brampton/.test(k.title)).length === 1, JSON.stringify(c.kept.map((k) => k.title)));
ok("…and the one kept is the official release, with the others listed under it", c.kept.find((k) => /Brampton/.test(k.title))?.official === true && c.kept.find((k) => /Brampton/.test(k.title)).also.length === 2);
ok("a story covered yesterday is skipped, and says so", !c.kept.some((k) => /Lacolle/.test(k.title)) && c.dropped.some((d) => /already covered/.test(d.why) && /Lacolle/.test(d.title)));
ok("a different story stays", c.kept.some((k) => /mentoring/.test(k.title)));
ok("the same headline in another city is a different story", G.likeness("Three handguns seized in Brampton", "Three handguns seized in Toronto") === 0 && G.likeness("Three handguns seized in Brampton", "Brampton: three handguns seized") >= 0.7);
ok("addresses compare without www, tracking or a trailing slash", G.canonUrl("https://WWW.cp24.com/news/peel-guns-1/?utm_source=x#top") === "cp24.com/news/peel-guns-1");

console.log("— nobody named: youth, victims, anyone");
const names = ["Jordan Tremblay-Côté", "Avery Okafor"];       // made up
ok("a made-up youth's name in a caption is found", G.namesFound(["Police say Jordan Tremblay-Côté, 16, was charged."], names).includes("Jordan Tremblay-Côté"));
ok("…with accents and case ignored", G.namesFound(["police charged jordan tremblay-cote"], names).length === 1);
ok("…and a surname alone counts", G.namesFound(["Okafor was taken to hospital."], names).includes("Avery Okafor"));
ok("text with no names passes", G.namesFound(["Two youths were charged after a shooting in Winnipeg."], names).length === 0);

console.log("— every number from a checked source");
const facts = [
  { id: "f1", statement: "Police seized three handguns, 1,100 rounds and $25 million in pouches", verdict: "confirmed", kind: "number", sourceUrl: "https://www.peelpolice.ca/news/123" },
  { id: "f2", statement: "Two adults were charged", verdict: "corrected", corrected: "2 adults were charged", kind: "charge", sourceUrl: "https://www.peelpolice.ca/news/123" },
];
ok("numbers the facts carry pass (1,100 = 1100; $25 million)", G.unsourcedNumbers(["About 1100 rounds and $25 million in pouches; 2 charged."], facts).length === 0);
ok("a statistic with no source is refused", G.unsourcedNumbers(["Gun crime rose 40% last year."], facts).join() === "40", JSON.stringify(G.unsourcedNumbers(["Gun crime rose 40% last year."], facts)));
ok("the hotline, 24/7, '3D-printed', hashtags and links are not figures", G.unsourcedNumbers(["Call 1-833-900-1010, 24/7. One gun was 3D-printed. #Top10 https://x.ca/2026/11"], facts).length === 0);
ok("numbered points in a comment are not figures", G.unsourcedNumbers(["So what do we do?\n1. Start early.\n2) Mentor.\n10. Real exits."], facts).length === 0);
ok("'$25-million' with a hyphen is the same as '$25 million'", G.unsourcedNumbers(["More than $25-million in pouches, about 25 million in all."], facts).length === 0);
ok("a statement that was never checked refuses the draft", G.refusals({ texts: [], facts: [{ id: "f9", statement: "x", kind: "other" }] }).some((w) => /never checked/.test(w)));

console.log("— the law only from a government page");
const law = (sourceUrl, verdict = "confirmed") => [{ id: "l1", kind: "law", statement: "Some nicotine pouches are authorized for adults as a quit-smoking aid", sourceUrl, verdict }];
ok("a law statement sourced to a news summary is refused", G.lawProblems(law("https://www.ctvnews.ca/pouches"), GOV).length === 1);
ok("…and one stated from memory (no source) too", G.lawProblems(law(""), GOV).length === 1);
ok("confirmed on canada.ca, it passes", G.lawProblems(law("https://www.canada.ca/en/health-canada/news/zonnic.html"), GOV).length === 0);
ok("removed by the checker, it no longer matters", G.lawProblems(law("https://www.ctvnews.ca/x", "removed"), GOV).length === 0);
ok("a photo from a news outlet is refused", G.refusals({ texts: [], facts: [], photo: { url: "https://www.cbc.ca/i/guns.jpg", person: false } }, { officialDomains: ["peelpolice.ca"] }).some((w) => /official release/.test(w)));
ok("a photo not cleared of people is refused", G.refusals({ texts: [], facts: [], photo: { url: "https://peelpolice.ca/i/guns.jpg" } }, { officialDomains: ["peelpolice.ca"] }).some((w) => /person/.test(w)));

console.log("— one post per story: the case thread");
const lib = [
  { id: "s1", night: "2026-11-12", city: "Brampton", headline: "Two arrested after Brampton traffic stop", caseKey: { project: "Project Mantis", agency: "Peel Regional Police", details: ["handguns"] }, keywords: { agency: ["Peel Regional Police"], specifics: ["ghost gun"] } },
  { id: "s2", night: "2026-10-01", city: "Calgary", headline: "Calgary home invasion", caseKey: { agency: "Calgary Police Service" }, keywords: { agency: ["Calgary Police Service"] } },
];
const now = Date.parse("2026-11-28T08:00:00Z");
ok("the same named project links to the earlier story", G.caseMatch({ project: "project mantis", agency: "", city: "" }, lib, { now }).storyId === "s1");
ok("same agency, city and seizure links too", G.caseMatch({ agency: "Peel Regional Police", city: "Brampton", details: ["handguns"] }, lib, { now }).linked === true);
const unsure = G.caseMatch({ agency: "Peel Regional Police", city: "Brampton", details: [] }, lib, { now });
ok("same agency and city alone is not enough: left unlinked, with the reason", unsure.linked === false && /not certain enough/.test(unsure.why), JSON.stringify(unsure));
ok("a story from two years ago is never linked", G.caseMatch({ project: "Project Mantis" }, [{ ...lib[0], night: "2024-06-01" }], { now }).linked === false);

console.log("— the Rising flag");
ok("double the three-month average with 3 stories: rising", G.isRising(4, [2, 2, 2]) === true);
ok("exactly double and exactly 3: rising", G.isRising(3, [1, 2, 1.5]) === true);
ok("below double: not rising", G.isRising(5, [3, 3, 3]) === false);
ok("double but only 2 stories: not rising", G.isRising(2, [0, 1, 0]) === false);
ok("new this month with 3 stories (nothing before): rising", G.isRising(3, [0, 0, 0]) === true);

console.log("— search as you type");
const S = [
  { id: "a", night: "2026-11-27", headline: "Fentanyl seized in Peel traffic stop", city: "Brampton", province: "ON", summary: "", commentary: "", keywords: { agency: ["Peel Regional Police"], specifics: ["fentanyl"] } },
  { id: "b", night: "2026-11-26", headline: "Montréal network sentenced", city: "Montréal", province: "QC", summary: "Fentanyl and cash", commentary: "", keywords: { agency: ["SQ"] } },
  { id: "c", night: "2026-11-25", headline: "Home invasion arrests", city: "Calgary", province: "AB", summary: "", commentary: "Organized crime in Peel too", keywords: {} },
];
ok("two words in any order must both match ('peel fentanyl')", G.searchStories(S, "peel fentanyl").map((s) => s.id).join() === "a");
ok("part of a word matches ('fent')", G.searchStories(S, "fent").length === 2);
ok("accents and case never matter ('MONTREAL')", G.searchStories(S, "MONTREAL").map((s) => s.id).join() === "b");
ok("quotes match an exact phrase", G.searchStories(S, '"home invasion"').map((s) => s.id).join() === "c" && G.searchStories(S, '"invasion home"').length === 0);
ok("best match first: a headline beats the commentary", G.searchStories(S, "peel").map((s) => s.id).join() === "a,c");

console.log("— a whole sample night, Claude stood in for");
// The stand-in answers each step by the tool it is asked to call, and records what it was sent.
const sent = [], drafts = {};
const youth = "Riley Fontaine";      // made up: the source names a young person
const client = { beta: { messages: { create: async (req) => {
  const name = req.tools.at(-1).name;
  sent.push({ name, req });
  const reply = (input) => ({ id: "m", type: "message", role: "assistant", model: "x", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t", name, input }], usage: { input_tokens: 1000, output_tokens: 200, server_tool_use: { web_search_requests: name === "report_items" ? 2 : 0 } } });
  const body = JSON.stringify(req.messages);
  if (name === "report_items") return reply({ items: [{ title: "Peel Regional Police seize three handguns, one 3D-printed, in Brampton", url: "https://www.peelpolice.ca/news/123", outlet: "Peel Regional Police", published: "2026-11-27", snippet: "Two adults charged.", official: true }, { title: "A release on an outlet's site", url: "https://www.cbc.ca/not-official", outlet: "CBC", published: "", snippet: "", official: true }] });
  if (name === "choose") {
    const items = body.split("\\n").filter((l) => /^\d+\. /.test(l));
    const n = (re) => items.findIndex((l) => re.test(l)) + 1;
    return reply({ picks: [
      { n: n(/handguns/), type: "guns", why: "ghost guns in the GTA", goodNews: false, bigPicture: true, significant: true, agency: "Peel Regional Police", city: "Brampton", province: "ON", project: "", details: ["handguns"] },
      { n: n(/shooting/), type: "youth", why: "youth with guns", goodNews: false, bigPicture: false, significant: false, agency: "Winnipeg Police Service", city: "Winnipeg", province: "MB", project: "", details: [] },
    ], updates: [], skipped: [{ n: n(/budget/), why: "off subject" }] });
  }
  if (name === "submit_draft") {
    const youthStory = /downtown shooting/.test(body);
    const url = body.match(/Source: [^\n]*?(https:\/\/\S+?)(\\n|\s)/)?.[1];
    const caption = youthStory ? `Police say ${youth}, 15, was charged after the shooting.` : "Peel police found three handguns, one of them 3D-printed, in a Brampton home. Two adults are charged. Printed guns have no serial number to trace. #ONGIA #GhostGuns #Peel";
    const d = { headline: youthStory ? "Two youths charged after shooting" : "Three handguns, one 3D-printed, found in Brampton", summary: "Police seized three handguns. 2 adults charged.", commentary: "Printed guns have no serial number.", captions: { linkedin: caption, instagram: caption, x: caption },
      image: { kicker: "SEIZURE · BRAMPTON, ON", headline: "Three handguns, one 3D-printed", figures: [{ value: "3", label: "handguns" }, { value: "2", label: "charged" }], view: "Printed guns have no serial number.", source: "Peel Regional Police news release" },
      keywords: { where: ["Brampton", "Ontario", "Canada"], agency: ["Peel Regional Police"], crime: ["guns"], specifics: ["ghost gun"], outcome: ["seizure", "charges"], people: ["adult"] }, hashtags: ["#ONGIA"],
      facts: [{ id: "f1", statement: "Police seized three handguns, 3 in total, one 3D-printed", kind: "number", sourceName: "Peel Regional Police", sourceUrl: "https://www.peelpolice.ca/news/123" }, { id: "f2", statement: "2 adults were charged", kind: "charge", sourceName: "Peel Regional Police", sourceUrl: "https://www.peelpolice.ca/news/123" }],
      comparisons: [], namesInSources: youthStory ? [youth] : [], photo: { url: "", description: "" }, andrewComment: /a comment from Andrew Hammond/.test(body) ? "Why are the guns getting harder to trace?\n\nI see it in every province. #ONGIA" : "" };
    drafts[url] = d;
    return reply(d);
  }
  if (name === "submit_check") {
    const d = drafts[body.match(/The story's source: (\S+?)\\n/)?.[1]];
    return reply({ facts: d.facts.map((f) => ({ id: f.id, verdict: "confirmed", corrected: "", sourceUrl: f.sourceUrl, note: "" })), captions: d.captions, image: d.image, headline: d.headline, summary: d.summary, commentary: d.commentary, andrewComment: d.andrewComment });
  }
  if (name === "submit_edit") {
    const d = Object.values(drafts).find((x) => body.includes(`HEADLINE: ${x.headline}`));
    return reply({ captions: d.captions, view: d.image.view, headline: d.headline, summary: d.summary, commentary: d.commentary, andrewComment: /none; return/.test(body) ? "" : d.andrewComment });
  }
  if (name === "submit_repair") {
    // Stubborn on purpose: hands the text back unchanged, so the youth story stays refused after its one repair.
    const d = Object.values(drafts).find((x) => body.includes(`HEADLINE: ${x.headline}`));
    return reply({ captions: d.captions, image: d.image, headline: d.headline, summary: d.summary, commentary: d.commentary, andrewComment: "" });
  }
  throw new Error(`unexpected tool ${name}`);
} } } };
// The feeds: CBSA has the Brampton story too (a duplicate across outlets), plus a shooting and an off-subject item.
const atom = (entries) => `<?xml version="1.0"?><feed>${entries.map((e) => `<entry><title>${e.t}</title><link href="${e.u}"/><updated>${e.d}</updated><summary>${e.s ?? ""}</summary></entry>`).join("")}</feed>`;
const fetchFn = async (url) => {
  const body = /gc\/news/.test(url) ? atom([{ t: "Three handguns including a 3D-printed gun seized in Brampton, Peel police say", u: "https://www.cbc.ca/news/brampton-guns", d: "2026-11-27T20:00:00Z" }, { t: "Two youths charged after downtown shooting in Winnipeg", u: "https://www.winnipeg.ca/police/news/shooting", d: "2026-11-27T21:00:00Z" }, { t: "Agency budget announced for gun buyback offices", u: "https://www.canada.ca/budget", d: "2026-11-27T21:00:00Z" }])
    : "<rss><channel></channel></rss>";
  return new Response(body, { status: 200, headers: { "content-type": "application/xml" } });
};
await N.saveSettings({ sources: { feeds: [{ name: "Test feed", agency: "Test Agency", kind: "atom", official: true, url: "https://api.io.canada.ca/io-server/gc/news/en/v2?dept=x" }], officialSites: [{ name: "Peel", agency: "Peel Regional Police", province: "ON", domain: "peelpolice.ca" }, { name: "Winnipeg", agency: "Winnipeg Police Service", province: "MB", domain: "winnipeg.ca" }], newsQueries: ["gang shooting"] } }, "test");
const log = await N.runNewsroom({ mode: "sample", client, fetchFn, now: new Date("2026-11-28T07:05:00Z"), by: "test" });
ok("the night ran without errors", !log.errors.length, JSON.stringify(log.errors));
ok("the official web search keeps only official sites (an outlet's page dropped)", !log.found.some((f) => /not-official/.test(f.url)));
ok("the same Brampton story from the feed and the search is one item, the official one kept", log.skipped.some((s) => /same story/.test(s.why) && /cbc/.test(s.url)) && log.picked.some((p) => /peelpolice/.test(p.url)), JSON.stringify(log.skipped));
ok("the off-subject item is skipped with Claude's reason", log.skipped.some((s) => /budget/i.test(s.title) && s.why === "off subject"));
ok("the story whose source names a youth is refused after one repair, and the log says where", log.refused.length === 1 && /names a person \(in: the LinkedIn caption, the Instagram caption, the X caption\).*after one repair/.test(log.refused[0].why.join(" ")), JSON.stringify(log.refused));
ok("…and the log itself never carries the name", !JSON.stringify(await getMeta(`news:night:${log.id}`)).includes("Riley"));
ok("…so the made-up youth's name is in no saved story", !JSON.stringify(await Promise.all(log.stories.map(N.getStory))).includes("Riley"));
ok("one story written up", log.picked.length === 1 && log.stories.length === 1, JSON.stringify(log.picked));
const story = await N.getStory(log.stories[0]);
ok("it is in the library as a sample, with keywords, facts each checked, and the source release", story.mode === "sample" && story.keywords.agency[0] === "Peel Regional Police" && story.facts.every((f) => f.verdict === "confirmed") && story.source.official, JSON.stringify(story).slice(0, 300));
ok("its captions carry no header or label", !/(Summary|The ONGIA Lens|Why it matters)\s*:/i.test(Object.values(story.captions).join(" ")));
ok("Andrew's comment is on the one significant story only", !!story.andrewComment && sent.filter((s) => s.name === "submit_draft").filter((s) => /a comment from Andrew Hammond/.test(JSON.stringify(s.req.messages))).length === 1);
const png = await N.getImage(story.imageKey);
ok("the post image was made: a PNG", png && png.subarray(1, 4).toString() === "PNG");
const idx = await N.getIndex();
ok("the library list has it, newest first", idx[0]?.id === story.id && idx[0].mode === "sample");
ok("a sample night marks nothing covered and leaves the next run's window alone", ((await getMeta("news:covered")) ?? []).length === 0 && !(await getMeta("newsroom:lastok")));
ok("the night's cost is counted", log.usage.calls >= 6 && log.usage.usd > 0 && log.usage.searches === 2, JSON.stringify(log.usage));
const draftReq = sent.find((s) => s.name === "submit_draft").req;
ok("the writer gets web fetch and search, the submit tool is strict, fallbacks on", draftReq.tools.some((t) => t.type === "web_fetch_20260209") && draftReq.tools.at(-1).strict === true && draftReq.fallbacks === "default" && draftReq.model === "claude-opus-5-5");
ok("the checker is a separate request", sent.filter((s) => s.name === "submit_check").length === 2);

console.log("— live night: one post per story");
await putMeta("news:story:s1", { id: "s1", night: "2026-11-12", mode: "live", city: "Brampton", province: "ON", headline: "Two arrested after Brampton traffic stop", type: "guns", caseKey: { project: "Project Mantis", agency: "Peel Regional Police", details: ["handguns"] }, keywords: { agency: ["Peel Regional Police"] }, thread: [] });
await N.saveToIndex([await getMeta("news:story:s1")]);
const client2 = { beta: { messages: { create: async (req) => {
  const name = req.tools.at(-1).name;
  const reply = (input) => ({ type: "message", role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t", name, input }], usage: { input_tokens: 10, output_tokens: 10 } });
  if (name === "report_items") return reply({ items: [{ title: "Charges laid in Project Mantis", url: "https://www.peelpolice.ca/news/200", outlet: "Peel", published: "", snippet: "", official: true }, { title: "Peel police make arrests in Brampton", url: "https://www.peelpolice.ca/news/201", outlet: "Peel", published: "", snippet: "", official: true }] });
  if (name === "choose") return reply({ picks: [], skipped: [], updates: [
    { n: 1, storyId: "s1", step: "charges", why: "same project", agency: "Peel Regional Police", city: "Brampton", project: "Project Mantis", details: [] },
    { n: 2, storyId: "s1", step: "arrests", why: "maybe the same", agency: "Peel Regional Police", city: "Brampton", project: "", details: [] }] });
  throw new Error(name);
} } } };
const live = await N.runNewsroom({ mode: "live", client: client2, fetchFn: async () => new Response("<rss></rss>"), now: new Date("2026-11-29T07:05:00Z") });
const s1 = await N.getStory("s1");
ok("a sure follow-up joins the earlier story's thread, with no new post", s1.thread.length === 1 && s1.thread[0].step === "charges" && live.picked.length === 0, JSON.stringify(s1.thread));
ok("an uncertain one is left unlinked and logged with the reason", live.updates.some((u) => !u.linked && /not certain enough/.test(u.why)), JSON.stringify(live.updates));
ok("a live night records when it last finished, for tomorrow's window", (await getMeta("newsroom:lastok"))?.log === live.id);

console.log("— the endpoint");
const H = (email) => ({ "x-admin-key": issueSession({ email, name: email }), "content-type": "application/json" });
const call = async (qs, init = {}, email = "president@ongia.ca") => endpoint(new Request(`http://x/api/newsroom${qs}`, { ...init, headers: H(email) }));
ok("another board member (even the VP) is turned away", (await call("", {}, "vp_operations@ongia.ca")).status === 403);
const home = await (await call("")).json();
ok("the president sees the settings (off by default), the sources and the nights", home.settings.on === false && home.sources.officialSites.length === 2 && home.nights.length >= 2, JSON.stringify(home).slice(0, 200));
const put = await (await call("", { method: "PUT", body: JSON.stringify({ perNight: { min: 0, max: 99 }, on: true }) })).json();
ok("stories a night are kept between 1 and 12", put.settings.perNight.min === 1 && put.settings.perNight.max === 12);
await call("", { method: "PUT", body: JSON.stringify({ on: false, perNight: { min: 5, max: 8 } }) });
const kw = await (await call(`?story=${story.id}`, { method: "PUT", body: JSON.stringify({ keywords: { specifics: ["ghost gun", "3D-printed", "ghost gun"] } }) })).json();
ok("Andrew's keyword edit is saved (no repeats) and reaches the library list", kw.story.keywords.specifics.join() === "ghost gun,3D-printed" && (await N.getIndex()).find((s) => s.id === story.id).keywords.specifics.length === 2);
const xl = await call("?xlsx=1", { method: "POST", body: JSON.stringify({ ids: [story.id] }) });
ok("Excel download of the current results", xl.status === 200 && /spreadsheetml/.test(xl.headers.get("content-type")));
const im = await image(new Request(`http://x/api/newsimg?id=${story.imageKey}`));
ok("the post image is at a public address Buffer can fetch", im.status === 200 && im.headers.get("content-type") === "image/png");
ok("a made-up image id is not found", (await image(new Request("http://x/api/newsimg?id=../../etc"))).status === 404);

console.log("— French: Québec's police and press");
const asked = [];
const frFeed = `<feed><entry><title>La SQ saisit des armes à feu et de la drogue à Laval</title><link href="https://www.sq.gouv.qc.ca/communiques/123"/><updated>${new Date().toISOString()}</updated></entry><entry><title>Avis de fermeture de route</title><link href="https://www.sq.gouv.qc.ca/communiques/124"/><updated>${new Date().toISOString()}</updated></entry></feed>`;
const fr = await N.gatherFeeds({ since: 0, src: { feeds: [{ name: "SQ", agency: "Sûreté du Québec", kind: "atom", official: true, url: "https://www.sq.gouv.qc.ca/feed" }], newsQueries: ["fr: gang de rue", "extortion shooting business"] },
  fetchFn: async (u) => { asked.push(u); return new Response(/sq\.gouv/.test(u) ? frFeed : "<rss></rss>"); } });
ok("a French release on the subjects is kept, a road closure is not", fr.items.length === 1 && /armes/.test(fr.items[0].title));
ok("'fr:' searches Google News in French, the rest in English", asked.some((u) => /hl=fr-CA/.test(u) && /gang%20de%20rue/.test(u)) && asked.some((u) => /hl=en-CA/.test(u) && /extortion/.test(u)));
ok("the four added subjects are searched by default", ["extortion", "auto theft", "money laundering", "sextortion"].every((t) => N.TOPICS.some((x) => x.includes(t))));

console.log("— one repair: a name taken out saves the story");
{
  const fx = { beta: { messages: { create: async (req) => {
    const name = req.tools.at(-1).name, body = JSON.stringify(req.messages);
    const rp = (input) => ({ type: "message", role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t", name, input }], usage: { input_tokens: 1, output_tokens: 1 } });
    const cap = "A spokesperson, Morgan Ellery, said 2 inmates were charged. #ONGIA";      // made up
    const fixedCap = "A spokesperson said 2 inmates were charged. #ONGIA";
    const im = { kicker: "SEIZURE · KINGSTON, ON", headline: "Contraband seized at a prison", figures: [], view: "Prison contraband is a business.", source: "CSC news release" };
    const f = [{ id: "f1", statement: "2 inmates were charged", kind: "charge", sourceName: "CSC", sourceUrl: "https://www.canada.ca/en/csc/news/1" }];
    if (name === "report_items") return rp({ items: [{ title: "Contraband seized at Kingston prison", url: "https://www.canada.ca/en/csc/news/1", outlet: "CSC", published: "", snippet: "", official: true }] });
    if (name === "choose") return rp({ picks: [{ n: 1, type: "drugs", why: "prison contraband", goodNews: false, bigPicture: false, significant: false, agency: "CSC", city: "Kingston", province: "ON", project: "", details: [] }], updates: [], skipped: [] });
    if (name === "submit_draft") return rp({ sourceName: "Correctional Service Canada", sourceUrl: "https://www.canada.ca/en/csc/news/1", sourceOfficial: true, city: "Kingston", province: "ON", headline: "Contraband seized at a Kingston prison", summary: "2 inmates were charged.", commentary: "Prison contraband is a business.", captions: { linkedin: cap, instagram: cap, x: cap }, image: im, keywords: { where: ["Kingston"], agency: ["Correctional Service Canada"], crime: ["drugs"], specifics: [], outcome: ["charges"], people: ["adult"] }, hashtags: [], facts: f, comparisons: [], namesInSources: ["Morgan Ellery"], photo: { url: "", description: "" }, andrewComment: "" });
    if (name === "submit_check") return rp({ facts: [{ id: "f1", verdict: "confirmed", corrected: "", sourceUrl: f[0].sourceUrl, note: "" }], captions: { linkedin: cap, instagram: cap, x: cap }, image: im, headline: "Contraband seized at a Kingston prison", summary: "2 inmates were charged.", commentary: "Prison contraband is a business.", andrewComment: "" });
    if (name === "submit_edit") return rp({ captions: { linkedin: cap, instagram: cap, x: cap }, view: im.view, headline: "Contraband seized at a Kingston prison", summary: "2 inmates were charged.", commentary: "Prison contraband is a business.", andrewComment: "" });
    if (name === "submit_repair") return rp({ captions: { linkedin: fixedCap, instagram: fixedCap, x: fixedCap }, image: im, headline: "Contraband seized at a Kingston prison", summary: "2 inmates were charged.", commentary: "Prison contraband is a business.", andrewComment: "" });
    throw new Error(name);
  } } } };
  await N.saveSettings({ sources: { feeds: [], officialSites: [{ name: "Government of Canada", agency: "", province: "", domain: "canada.ca" }], newsQueries: [] } }, "test");
  const r = await N.runNewsroom({ mode: "sample", client: fx, fetchFn: async () => new Response("<rss></rss>"), now: new Date("2026-11-30T07:05:00Z") });
  const st = r.stories[0] && await N.getStory(r.stories[0]);
  ok("the name is taken out and the story is kept", r.refused.length === 0 && st && !JSON.stringify(st).includes("Ellery") && /A spokesperson said/.test(st.captions.linkedin), JSON.stringify(r.refused));
  ok("the story records the release it was written from, and its city", st?.source.url === "https://www.canada.ca/en/csc/news/1" && st.source.official && st.city === "Kingston");
}

console.log("— an option the API turns down doesn't lose the night");
const seen = [];
const picky = { beta: { messages: { create: async (req) => {
  seen.push(req);
  if (req.fallbacks) throw Object.assign(new Error("fallbacks: not supported with this tool"), { status: 400 });
  return { type: "message", role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t", name: req.tools.at(-1).name, input: { items: [] } }], usage: { input_tokens: 1, output_tokens: 1 } };
} } } };
const u = N.newUsage();
const got = await N.ask({ client: picky, usage: u, system: "s", content: "c", submit: { name: "report_items", description: "d", schema: { type: "object" } } });
ok("turned down once, it is sent again without the fallback or strict format, and the answer comes back", Array.isArray(got.items) && seen.length === 2 && !seen[1].fallbacks && seen[1].tools.every((t) => !("strict" in t)) && /without the fallback/.test(u.notes?.[0] ?? ""));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
