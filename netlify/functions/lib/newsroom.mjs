/**
 * The Newsroom (spec 28 Nov 2026, Andrew's changes the same day): each night the desk finds new Canadian stories on
 * ONGIA's subjects, writes each up with ONGIA's view, checks every fact a second time, makes the branded image and,
 * once it is live, puts each post into Buffer as a draft for Andrew to approve there. Nothing is ever posted without him.
 *
 * One run, in order:
 *  1. gather   the official feeds (read directly), Google News for each subject (last day), and a web search limited to
 *              the police and agency sites, reading back to the last run that finished so a missed night is caught up
 *  2. collapse the same story from several outlets made one item (the official release kept), anything covered dropped
 *  3. rank     Claude picks 5–8 by relevance to ONGIA, a good-news story whenever there is one, and says which are a new
 *              step in a case already written up (those join that story's thread; one post per story, never a second)
 *  4. write    each pick: summary, ONGIA's view woven in, captions per channel, image text, keywords, facts with sources
 *  5. check    a separate call re-reads every factual statement against its source (the law only from government)
 *  6. edit     the humanizer's rules: plain Canadian English, no AI tells, facts unchanged, nothing added
 *  7. guard    code refuses a draft that names anyone, carries a number no checked source has, states the law
 *              unconfirmed, or has a photo that is not from an official release or may show a person
 *  8. image    rendered from the template; saved with the story in the library
 *
 * "sample" runs stop there: nothing goes to Buffer and nothing is marked covered, so Andrew can see whole nights
 * before it runs live.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { anthropicKey } from "./contract.mjs";
import { getMeta, putMeta, listMetaKeys, writeRaw, readRaw } from "./store.mjs";
import { collapse, refusals, caseMatch, canonUrl, onDomain, domainOf, fold } from "./newsguard.mjs";
import { renderPost, TYPES, typeOf } from "./newsimage.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCES_FILE = [path.join(HERE, "newsroom-sources.json"), path.resolve(process.cwd(), "netlify/functions/lib/newsroom-sources.json"), "/var/task/netlify/functions/lib/newsroom-sources.json"].find((f) => existsSync(f));
const FILE_SOURCES = SOURCES_FILE ? JSON.parse(readFileSync(SOURCES_FILE, "utf8")) : { feeds: [], officialSites: [], newsQueries: [], governmentDomains: [] };

export const MODEL = "claude-opus-5-5";
// Opus 5.5 list prices (per million tokens) and web search ($10 per 1,000), for the night's cost line.
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, search: 0.01 };

export const TOPICS = [
  "organized crime", "street gangs and gang activity", "guns, gun seizures and shootings", "drug seizures", "home invasions",
  "arrests and charges in these areas", "youth violence, youth arrested with guns, youth in shootings", "human trafficking",
  "illicit and contraband tobacco (seizures, importing, exporting)", "contraband nicotine pouches (Zyn and others)",
  "extortion (including the business extortion and shootings in BC, Alberta and Ontario)",
  "auto theft and carjacking by organized rings (stolen cars shipped out through the ports)", "money laundering by organized crime",
  "sextortion and online exploitation of young people",
  "good news: police and community programs that steer young people away from gangs and violence",
];
const DEFAULTS = { on: false, perNight: { min: 5, max: 8 }, topics: TOPICS, sources: null, comments: 2, bigPicture: 2 };

export async function settings() {
  const s = (await getMeta("newsroom:settings")) ?? {};
  return { ...DEFAULTS, ...s, perNight: { ...DEFAULTS.perNight, ...(s.perNight ?? {}) } };
}
export async function saveSettings(patch, who) {
  const cur = await settings();
  const next = { ...cur, ...patch, perNight: { ...cur.perNight, ...(patch.perNight ?? {}) }, changedBy: who ?? "", changedAt: new Date().toISOString() };
  const n = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);
  next.perNight.min = n(next.perNight.min, 1, 12, 5);
  next.perNight.max = n(next.perNight.max, next.perNight.min, 12, 8);
  next.topics = (Array.isArray(next.topics) ? next.topics : TOPICS).map((t) => String(t).trim().slice(0, 200)).filter(Boolean).slice(0, 40);
  next.on = !!next.on;
  await putMeta("newsroom:settings", next);
  return next;
}
/** The sources: the file in the repository, or the Control room's own list when Andrew has changed it there. */
export function sourcesFrom(s) {
  const o = s?.sources ?? {};
  return {
    feeds: o.feeds ?? FILE_SOURCES.feeds, officialSites: o.officialSites ?? FILE_SOURCES.officialSites,
    newsQueries: o.newsQueries ?? FILE_SOURCES.newsQueries, governmentDomains: FILE_SOURCES.governmentDomains,
  };
}

// ── storage ──────────────────────────────────────────────────────────────────────────────────────────────────────
// news:story:<id> one story (kept for good); news:index the compact list the library screen searches; news:night:<id>
// one night's log; news:covered what has been written up (addresses and headlines), so nothing is repeated;
// news:img:<id> the post image. Kept under meta: so the nightly backup and the restore carry them like everything else.
export const getStory = (id) => getMeta(`news:story:${id}`);
export const putStory = (s) => putMeta(`news:story:${s.id}`, s);
export const getIndex = async () => (await getMeta("news:index")) ?? [];
export const getNight = (id) => getMeta(`news:night:${id}`);
export async function listNights(limit = 30) {
  return (await listMetaKeys("news:night:")).map((k) => k.slice("news:night:".length)).sort().reverse().slice(0, limit);
}
export const getCovered = async () => (await getMeta("news:covered")) ?? [];
export const putImage = (id, bytes) => writeRaw(`meta:news:img:${id}`, bytes, { contentType: "image/png" });
export const getImage = async (id) => (await readRaw(`meta:news:img:${id}`))?.bytes ?? null;

/** The library list entry for a story: what the tiles and the search need, no more. */
export const indexEntry = (s) => ({
  id: s.id, night: s.night, mode: s.mode, type: s.type, typeLabel: typeOf(s.type).label, city: s.city, province: s.province,
  headline: s.headline, summary: s.summary, commentary: s.commentary, keywords: s.keywords, posted: s.buffer?.status ?? "none",
  thread: (s.thread ?? []).length, threadLatest: (s.thread ?? []).at(-1)?.step ?? "", image: !!s.imageKey,
});
export async function saveToIndex(stories) {
  const idx = await getIndex();
  const byId = new Map(idx.map((e) => [e.id, e]));
  for (const s of stories) byId.set(s.id, indexEntry(s));
  const next = [...byId.values()].sort((a, b) => String(b.night).localeCompare(String(a.night)) || String(b.id).localeCompare(String(a.id)));
  await putMeta("news:index", next);
  return next;
}

// ── the Toronto night ────────────────────────────────────────────────────────────────────────────────────────────
export function torontoDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
export function torontoHour(d = new Date()) {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hour: "numeric", hourCycle: "h23" }).format(d));
}
const longDate = (iso) => { try { return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); } catch { return iso; } };

// ── 1. gather ────────────────────────────────────────────────────────────────────────────────────────────────────
const unent = (s) => String(s ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)</${t}>`, "i")); return m ? unent(m[1]) : ""; };
/** The items of an RSS or Atom feed: title, link, when, summary, outlet. */
export function parseFeed(xml) {
  const items = [];
  for (const m of String(xml).matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)) {
    const x = m[0];
    const link = tag(x, "link") || (x.match(/<link\b[^>]*href="([^"]+)"/i)?.[1] ?? "");
    items.push({ title: tag(x, "title"), url: unent(link), published: tag(x, "pubDate") || tag(x, "updated") || tag(x, "published"), snippet: tag(x, "description") || tag(x, "summary"), outlet: tag(x, "source") || tag(x, "name") });
  }
  return items.filter((i) => i.title && i.url);
}
// English and French (Québec's police and press publish in French; the posts are still written in English).
const TOPIC_WORDS = /gang|organi[sz]ed crime|firearm|gun|shoot|weapon|drug|fentanyl|cocaine|meth|opioid|seiz|traffick|tobacco|cigarette|nicotine|zyn|pouch|home invasion|youth|teen|charged|arrest|extortion|launder|contraband|smuggl|border|prevention|mentor|carjack|auto theft|stolen vehicle|car theft|sextortion|exploitation|crime organisé|gang de rue|arme|fusillade|coups de feu|drogue|stupéfiant|saisie|traite de personnes|proxénétisme|tabac|cigarettes|sachets de nicotine|invasion de domicile|jeunes|adolescent|arrestation|accusé|extorsion|blanchiment|vol de véhicule|vol d'auto|sextorsion|prévention/i;

async function fetchText(url, fetchFn, ms = 12000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetchFn(url, { signal: ctl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; ONGIA-Newsroom/1.0; +https://ongia.ca)", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" } });
    if (!r.ok) throw new Error(`answered ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

/** The feeds and Google News, read directly (no cost). Each source's outcome goes in the log. */
export async function gatherFeeds({ src, since, until = Infinity, fetchFn = fetch }) {
  const out = [], notes = [];
  const fresh = (p) => { const t = Date.parse(p); return Number.isFinite(t) ? t >= since && t <= until : until === Infinity; };
  await Promise.all(src.feeds.map(async (f) => {
    try {
      const items = parseFeed(await fetchText(f.url, fetchFn)).filter((i) => fresh(i.published) && (f.official ? TOPIC_WORDS.test(`${i.title} ${i.snippet}`) : TOPIC_WORDS.test(i.title)));
      for (const i of items) out.push({ ...i, outlet: f.agency || i.outlet || f.name, agency: f.agency || "", official: !!f.official, via: f.name });
      notes.push({ source: f.name, found: items.length });
    } catch (e) { notes.push({ source: f.name, error: e.name === "AbortError" ? "no answer in 12 seconds" : e.message }); }
  }));
  await Promise.all(src.newsQueries.map(async (q) => {
    // "fr: …" searches Google News in French (Québec); everything else in English.
    const fr = /^fr:\s*/i.test(q), term = q.replace(/^fr:\s*/i, "");
    // An earlier day (a sample of a past night) asks Google for that day; otherwise the last day.
    const ymd = (t) => new Date(t).toISOString().slice(0, 10);
    const when = until === Infinity ? "when:1d" : `after:${ymd(since - 86400000)} before:${ymd(until + 86400000)}`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${term} ${when}`)}&hl=${fr ? "fr-CA" : "en-CA"}&gl=CA&ceid=CA:${fr ? "fr" : "en"}`;
    try {
      const items = parseFeed(await fetchText(url, fetchFn)).filter((i) => fresh(i.published)).slice(0, 12);
      for (const i of items) {
        const outlet = i.outlet || i.title.split(" - ").at(-1);
        out.push({ ...i, title: i.title.replace(/\s+-\s+[^-]+$/, ""), outlet, official: false, via: `Google News: ${q}` });
      }
      notes.push({ source: `Google News: ${q}`, found: items.length });
    } catch (e) { notes.push({ source: `Google News: ${q}`, error: e.message }); }
  }));
  return { items: out, notes };
}

// ── talking to Claude ────────────────────────────────────────────────────────────────────────────────────────────
let PLAIN = false;
export function newUsage() { return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0, fetches: 0, calls: 0 }; }
export const usd = (u) => Math.round(((u.input * PRICE.input + u.output * PRICE.output + u.cacheRead * PRICE.cacheRead + u.cacheWrite * PRICE.cacheWrite) / 1e6 + u.searches * PRICE.search) * 100) / 100;
function count(usage, m) {
  const u = m.usage ?? {};
  usage.calls++;
  usage.input += u.input_tokens ?? 0; usage.output += u.output_tokens ?? 0;
  usage.cacheRead += u.cache_read_input_tokens ?? 0; usage.cacheWrite += u.cache_creation_input_tokens ?? 0;
  usage.searches += u.server_tool_use?.web_search_requests ?? 0; usage.fetches += u.server_tool_use?.web_fetch_requests ?? 0;
}

/**
 * One request to Claude that must end with a call to `submit` (a tool whose input is the answer). Web search and web
 * fetch run on Anthropic's side; a paused turn is continued. Returns the submitted input.
 */
export async function ask({ client, usage, system, content, submit, web = null, effort = "medium", maxTokens = 16000 }) {
  const tools = [];
  if (web?.search) tools.push({ type: "web_search_20260209", name: "web_search", max_uses: web.search.max ?? 8, ...(web.search.domains?.length ? { allowed_domains: web.search.domains } : {}) });
  // A page is read up to about 8,000 tokens: a news release fits easily, and a long article's first part carries its facts.
  if (web?.fetch) tools.push({ type: "web_fetch_20260209", name: "web_fetch", max_uses: web.fetch.max ?? 4, max_content_tokens: 8000, ...(web.fetch.domains?.length ? { allowed_domains: web.fetch.domains } : {}) });
  tools.push({ name: submit.name, description: submit.description, input_schema: submit.schema, strict: true });
  const messages = [{ role: "user", content }];
  for (let turn = 0; turn < 6; turn++) {
    // Cached: each step of a story's conversation re-sends what came before, and cached text costs a tenth.
    const base = { model: MODEL, max_tokens: maxTokens, system, messages, tools, tool_choice: { type: "auto" }, output_config: { effort }, cache_control: { type: "ephemeral" } };
    let m;
    // The refusal fallback and the strict answer format are asked for; if the API turns either down for this request,
    // it is sent once more without them rather than losing the night.
    if (PLAIN) m = await client.beta.messages.create({ ...base, tools: tools.map(({ strict, ...t }) => t) });
    else {
      try { m = await client.beta.messages.create({ ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }); }
      catch (e) {
        if (e?.status !== 400) throw e;
        PLAIN = true; usage.notes = [...(usage.notes ?? []), `sent without the fallback and strict format: ${String(e.message).slice(0, 160)}`];
        m = await client.beta.messages.create({ ...base, tools: tools.map(({ strict, ...t }) => t) });
      }
    }
    count(usage, m);
    if (m.stop_reason === "refusal") throw new Error("Claude declined this one");
    const call = m.content.find((b) => b.type === "tool_use" && b.name === submit.name);
    if (call) return call.input;
    messages.push({ role: "assistant", content: m.content });
    if (m.stop_reason === "pause_turn") continue;
    messages.push({ role: "user", content: `Now give your answer by calling ${submit.name}.` });
  }
  throw new Error(`Claude did not give an answer (${submit.name})`);
}

const S = (props, req = Object.keys(props)) => ({ type: "object", additionalProperties: false, required: req, properties: props });
const str = { type: "string" }, bool = { type: "boolean" }, int = { type: "integer" };
const arr = (items) => ({ type: "array", items });

// ── 1b. the official sites, by web search ──────────────────────────────────────────────────────────────────────
const CANDS = S({ items: arr(S({ title: str, url: str, outlet: str, published: str, snippet: str, official: bool })) });
export async function gatherOfficial({ client, usage, src, topics, sinceIso, untilIso = "" }) {
  const domains = [...new Set(src.officialSites.map((s) => s.domain))].slice(0, 60);
  const r = await ask({
    client, usage, effort: "low",
    web: { search: { max: 6, domains } },
    submit: { name: "report_items", description: "Report the news releases found.", schema: CANDS },
    system: "You find official police and government news releases in Canada for ONGIA, a non-profit that trains police, educators and communities on gangs, organized crime and human trafficking. Use web search, which is limited to official police and agency sites. Report only releases published since the time given, on the subjects given, with their exact address. Never invent an address or a release.",
    content: `Find news releases published ${untilIso ? `between ${sinceIso} and ${untilIso}` : `since ${sinceIso}`} on these subjects:\n${topics.map((t) => `- ${t}`).join("\n")}\n\nSearch a few times across the subjects (for example "seized firearms", "charged trafficking", "contraband tobacco", "home invasion arrest", "youth charged shooting", "gang prevention program"). Report each release once, with official set to true.`,
  });
  return (r.items ?? []).filter((i) => onDomain(i.url, domains)).map((i) => ({ ...i, official: true, via: "official sites (web search)" }));
}

// ── 3. rank ──────────────────────────────────────────────────────────────────────────────────────────────────────
const RANK = S({
  picks: arr(S({ n: int, type: { type: "string", enum: Object.keys(TYPES) }, why: str, goodNews: bool, bigPicture: bool, significant: bool, agency: str, city: str, province: str, project: str, details: arr(str) })),
  updates: arr(S({ n: int, storyId: str, step: str, why: str, agency: str, city: str, project: str, details: arr(str) })),
  skipped: arr(S({ n: int, why: str })),
});
export async function rank({ client, usage, items, library, set, topics }) {
  const list = items.map((c, i) => `${i + 1}. ${c.title}\n   ${c.official ? "OFFICIAL RELEASE" : c.outlet || domainOf(c.url)} · ${c.published || "date not given"} · ${c.url}${c.also?.length ? `\n   also reported by: ${c.also.map((a) => a.name).join(", ")}` : ""}\n   ${String(c.snippet ?? "").slice(0, 300)}`).join("\n");
  const recent = library.slice(0, 120).map((s) => `${s.id} · ${s.night} · ${s.city}, ${s.province} · ${s.keywords?.agency?.[0] ?? ""} · ${s.headline}`).join("\n");
  return ask({
    client, usage, effort: "medium",
    submit: { name: "choose", description: "Give the night's picks, the updates to stories already written up, and why each other item was skipped.", schema: RANK },
    system: "You are the editor of ONGIA's nightly news posts. ONGIA is Canada's non-profit for training on street gangs, youth violence, organized crime and human trafficking; its audience is police, corrections, educators, social workers, parents and youth. You choose which stories ONGIA writes up tonight. Never invent anything about an item beyond what is listed.",
    content: `Tonight's items (numbered):\n${list}\n\nStories ONGIA has already written up (id · night · place · agency · headline):\n${recent || "(none yet)"}\n\nSubjects: ${topics.join("; ")}.\n\nChoose ${set.perNight.min} to ${set.perNight.max} items, the most relevant to ONGIA first, Canadian only. Always include one good-news item when there is one (police or community programs steering young people away from gangs and violence). Mark bigPicture on at most ${set.bigPicture} picks where the story genuinely connects to a wider pattern across Canada (a network, a supply route, youth used by adults, similar crimes in other provinces). Mark significant on at most ${set.comments} picks that truly merit a comment from ONGIA's president, and none if nothing does. For each pick give its agency, city, province (two letters), any named police project, and the details that identify the case (what was seized, the charges).\n\nOne post per story: if an item is a new development in a case already written up (charges, court, sentencing, a project update), put it under updates with that story's id, the step, and the item's own agency, city, named project and identifying details, never under picks. Only do this when you are sure it is the same case; if unsure, treat it as a new item.\n\nEvery item not picked and not an update goes under skipped with a short reason (off subject, not Canadian, too minor, duplicate of item N, opinion piece).`,
  });
}

// ── 4. write ─────────────────────────────────────────────────────────────────────────────────────────────────────
const KEYS = S({ where: arr(str), agency: arr(str), crime: arr(str), specifics: arr(str), outcome: arr(str), people: arr(str) });
const FACT = S({ id: str, statement: str, kind: { type: "string", enum: ["number", "date", "place", "agency", "charge", "law", "comparison", "other"] }, sourceName: str, sourceUrl: str });
const DRAFT = S({
  sourceName: str, sourceUrl: str, sourceOfficial: bool, city: str, province: str,
  headline: str, summary: str, commentary: str,
  captions: S({ linkedin: str, instagram: str, x: str }),
  image: S({ kicker: str, headline: str, figures: arr(S({ value: str, label: str })), view: str, source: str }),
  keywords: KEYS, hashtags: arr(str),
  facts: arr(FACT),
  comparisons: arr(S({ text: str, storyId: str, sourceUrl: str })),
  namesInSources: arr(str),
  photo: S({ url: str, description: str }),
  andrewComment: str,
});
const VOICE = `Andrew Hammond's voice (for his comment only): opens with a plain line or a question ("Why are the kids getting younger?"); short paragraphs, one idea each, first person, grounded in experience ("As I travel across Canada speaking with police officers, prosecutors, educators…"); explains the pattern behind the story (recruitment moved onto the phone; organized crime uses youth as tools and stays insulated; guns trafficked across the border), often as numbered causes, then "So what do we do?" with practical steps; balanced, enforcement plus prevention, mentorship and real exits ("None of this asks anyone to go soft."); never names a young person; ends on a short line that lands; hashtags at the end, #ONGIA plus three to six topical.`;
const RULES = `Hard rules, every word:
- Never name any person. Not the accused, not a victim, not a young person, not an officer. Agencies and places only. List every person named in your sources under namesInSources so the desk can check none slipped through.
- Never identify a young person charged or convicted under the Youth Criminal Justice Act, or a victim or survivor (trafficking especially): no names, schools, ages with places, or other details that point to them.
- Only what police, a court or the source made public. No speculation about guilt: "charged with", "accused", never "the trafficker".
- Facts only as the release or report gives them. Numbers from the official release, not a news rewrite; if a release contradicts itself, use its stated total and say so in that fact.
- Any number or statistic in the commentary must come from a named source (CISC, RCMP, CBSA, Public Safety Canada, Statistics Canada, or ONGIA training material) that you have read, and goes in facts with its address. No invented figures. Every number anywhere in the captions or image must be in facts.
- A statement about the law, regulations or what is legal (for example which nicotine pouches are legal) must be checked on the government's own page (Health Canada, Justice Laws, the Canada Gazette, the agency); add it to facts with kind "law" and that page's address. If you cannot read the government page, leave the statement out. (Example of the care needed: some nicotine pouches, such as Zonnic, are authorized by Health Canada for adults as a quit-smoking aid, sold only from behind a pharmacy counter; convenience-store and gas-station sales are illegal. So never say "no nicotine pouches are legal".)
- Tie a case to a gang, group or another province only when police, a court or the source say so; otherwise write it as a pattern ONGIA sees across the country, never as a claim about this case or these accused.
- Summaries and commentary in your own words; never copy the article.
- Nothing operational or restricted.
- No headers or labels anywhere: never "Summary", "The ONGIA Lens", "Why it matters". Each caption reads as one natural piece: what happened, then ONGIA's view woven straight in.
- Plain Canadian English (police, organize, defence, centre, neighbour). No AI tells: no "not just X but Y", no "pivotal", "crucial", "underscores", "testament", "landscape", no rule-of-three padding, no em dashes.`;

export async function writeStory({ client, usage, pick, item, similar, gov, official, allowComment, bigPicture }) {
  const lib = similar.map((s) => `${s.id} · ${s.night} · ${s.city}, ${s.province} · ${s.headline} · ${s.sourceUrl ?? ""}`).join("\n");
  const urls = [item.url, ...(item.also ?? []).map((a) => a.url)];
  return ask({
    client, usage, effort: "medium", maxTokens: 20000,
    web: { fetch: { max: 4 }, search: { max: 2 } },
    submit: { name: "submit_draft", description: "Submit the finished draft.", schema: DRAFT },
    system: `You write ONGIA's social media posts about Canadian news. ONGIA is Canada's non-profit for training on street gangs, youth violence, organized crime and human trafficking; its board includes court-qualified experts, so ONGIA's view speaks with that authority. You write for ONGIA's own channels (Instagram, its LinkedIn page, X).\n\n${RULES}`,
    content: `The story (${typeOf(pick.type).label}, ${pick.city}, ${pick.province}):\n${item.title}\nSource: ${item.official ? "official release" : item.outlet} ${item.url}\n${item.also?.length ? `Also reported at:\n${item.also.map((a) => `- ${a.name} ${a.url}`).join("\n")}\n` : ""}Why it was picked: ${pick.why}\n\nIf the source is in French, read it in French and write everything in English. Read the source first with web_fetch (prefer the official release; if the source is a news story, look for the agency's own release with web search and read it). Base every fact on what you read.\n\nWrite:\n- sourceName, sourceUrl, sourceOfficial: the page you based the story on (the agency's own release when you found it, else the news story), its real address (never a news.google.com link), and whether it is the agency's own.\n- city and province (two letters) where it happened; empty only if the source gives no place.\n- headline: short and factual, no names.\n- summary: two or three sentences in ONGIA's own words, facts only.\n- commentary: a full paragraph of ONGIA's expert view, the pattern behind the story and why it matters.\n${bigPicture ? `- This is one of tonight's bigger-picture stories: in the commentary explain how it connects beyond this city or offender (the network, other provinces, the groups that profit, the supply route, how young people are recruited and used as pawns while the adults directing them stay insulated), usually by pointing to similar crimes in other provinces. Each comparison must be real: from this list of ONGIA's earlier stories (give its id) or from an official release you read (give its address), and listed under comparisons and facts.\n  Earlier stories:\n${lib || "  (none yet)"}\n` : "- Keep the commentary on this story itself; no comparisons to other provinces tonight (comparisons empty).\n"}- captions.linkedin: professional, the summary then the full view woven in as one piece, the source link at the end of the story text, then hashtags. 120 to 220 words.\n- captions.instagram: shorter (70 to 130 words), the same story and view, ends with "Link in bio", then hashtags.\n- captions.x: one short line plus the source link, under 250 characters with the link, one or two hashtags.\n- Mention the agency by its name in the text (the desk adds @mentions where the agency's account is confirmed). Hashtags: the city and province (e.g. #Brampton #Peel #Ontario), two or three topic tags (#ContrabandTobacco #GhostGuns #HumanTrafficking), and #ONGIA. About 5 to 8 on Instagram, 4 to 6 on LinkedIn, 2 or 3 on X. Put the full list under hashtags too.\n- image: kicker like "SEIZURE · LACOLLE, QC" (the outcome and the place), a headline under 90 characters, up to three key figures from the release: amounts, quantities and counts only (e.g. "$100,000" damage, "3" handguns, "2" charged), never dates; none if the release gives none, view: two or three sentences of ONGIA's view, source: the agency and "news release" (or the outlet).\n- keywords: where (city, province, country), agency (full official names), crime (from: gangs, organized crime, guns, shootings, drugs, human trafficking, contraband tobacco, nicotine pouches, extortion, home invasions, money laundering, youth violence, auto theft, carjacking, sextortion, fraud), specifics (drug names, firearm types incl. ghost gun / 3D-printed, named projects, importation or exportation, port or border crossing), outcome (seizure, arrest, charges, sentencing, warrant, good news), people by category only (youth, adult, victims).\n- facts: every factual statement in your text (numbers, dates, places, agencies, charges, laws, comparisons), each with the source name and address you read it at. Ids f1, f2, ...\n- photo: only if the official release itself has a photo of what was seized or the scene (drugs, guns, cash, cartons, pouches, vehicles) with no person in it, give the image address and what it shows; otherwise empty strings. Never a news outlet's photo, never a person.\n- andrewComment: ${allowComment ? `a comment from Andrew Hammond, ONGIA's president, to post under ONGIA's LinkedIn post, as an expert and as president, as long as the story needs. ${VOICE} Any number in it must be in facts.` : "empty string."}\n\nAllowed addresses to read include: ${urls.join(", ")}. Government sources for the law: ${gov.slice(0, 12).join(", ")}. Official sites: ${official.slice(0, 30).join(", ")}.`,
  });
}

// ── 5. check ─────────────────────────────────────────────────────────────────────────────────────────────────────
const CHECK = S({
  facts: arr(S({ id: str, verdict: { type: "string", enum: ["confirmed", "corrected", "removed"] }, corrected: str, sourceUrl: str, note: str })),
  captions: S({ linkedin: str, instagram: str, x: str }),
  image: S({ kicker: str, headline: str, figures: arr(S({ value: str, label: str })), view: str, source: str }),
  headline: str, summary: str, commentary: str, andrewComment: str,
});
export async function checkStory({ client, usage, draft, item, gov }) {
  const facts = draft.facts.map((f) => `${f.id} [${f.kind}] ${f.statement} (source: ${f.sourceName} ${f.sourceUrl})`).join("\n");
  return ask({
    client, usage, effort: "high", maxTokens: 20000,
    web: { fetch: { max: 4 }, search: { max: 1 } },
    submit: { name: "submit_check", description: "Submit the verdict on every statement and the corrected texts.", schema: CHECK },
    system: "You are ONGIA's fact-checker, separate from the writer. You re-read every factual statement against its source and mark it confirmed, corrected or removed. Statements about laws, regulations and what is legal are checked only against the government's own page (Health Canada, Justice Laws, the Canada Gazette, the agency's page), never a news summary or memory; if that page cannot be read, the statement is removed. Numbers come from the release, not a news rewrite. Anything you cannot confirm is removed, never softened into a guess. Then you return the texts with every correction applied and every removed statement taken out, changing nothing else.",
    content: `The story's source: ${item.url}\n\nStatements to check:\n${facts}\n\nThe texts:\nHEADLINE: ${draft.headline}\nSUMMARY: ${draft.summary}\nCOMMENTARY: ${draft.commentary}\nLINKEDIN: ${draft.captions.linkedin}\nINSTAGRAM: ${draft.captions.instagram}\nX: ${draft.captions.x}\nIMAGE: ${JSON.stringify(draft.image)}\nANDREW'S COMMENT: ${draft.andrewComment || "(none)"}\n\nRead each source with web_fetch. For a law statement, read the government page (${gov.slice(0, 10).join(", ")}). Give a verdict for every id, the address you confirmed it at, and for corrected ones the corrected statement. Return all texts with the corrections applied and removed statements taken out (keep them otherwise word for word; an empty comment stays empty).`,
  });
}

// ── 6. edit (the humanizer's rules) ──────────────────────────────────────────────────────────────────────────────
const EDIT = S({ captions: S({ linkedin: str, instagram: str, x: str }), view: str, headline: str, summary: str, commentary: str, andrewComment: str });
export async function humanize({ client, usage, t }) {
  return ask({
    client, usage, effort: "low",
    submit: { name: "submit_edit", description: "Submit the edited texts.", schema: EDIT },
    system: `You are a line editor removing the tells of AI writing from text ONGIA will post. Change the texture, never the substance: every fact, number, date, place, agency, hashtag, link and claim stays, meaning the same thing. Add nothing: no new examples, caveats, transitions or context. Cut inflated significance ("stands as a testament", "plays a pivotal role", "marks a turning point"), "not just X but Y", rule-of-three padding, AI vocabulary (delve, tapestry, testament, underscore, pivotal, crucial, vibrant, robust, foster, showcase, leverage, seamless, landscape, navigate, elevate, resonate), "-ing" tails that editorialize, "serves as"/"stands as" (use is/has), em dashes (use commas, colons or full stops), puffery, signposting ("it's important to note", "moreover", "in conclusion"). Vary sentence length. Plain Canadian English. Never add a header or label. If a text is already clean, make only light touches. Keep links and hashtags exactly as they are.`,
    content: `HEADLINE: ${t.headline}\nSUMMARY: ${t.summary}\nCOMMENTARY: ${t.commentary}\nIMAGE VIEW: ${t.view}\nLINKEDIN: ${t.captions.linkedin}\nINSTAGRAM: ${t.captions.instagram}\nX: ${t.captions.x}\nANDREW'S COMMENT: ${t.andrewComment || "(none; return an empty string)"}`,
  });
}

// ── repair: take out a name or a figure the guards caught, nothing else ─────────────────────────────────────────────
const REPAIR = S({ captions: S({ linkedin: str, instagram: str, x: str }), image: S({ kicker: str, headline: str, figures: arr(S({ value: str, label: str })), view: str, source: str }), headline: str, summary: str, commentary: str, andrewComment: str });
export async function repair({ client, usage, t, why, names, facts }) {
  const ok = facts.filter((f) => f.verdict === "confirmed" || f.verdict === "corrected").map((f) => `- ${f.verdict === "corrected" && f.corrected ? f.corrected : f.statement}`).join("\n");
  return ask({
    client, usage, effort: "low",
    submit: { name: "submit_repair", description: "Submit the texts with the problems removed.", schema: REPAIR },
    system: "You make the smallest change that removes a problem from text ONGIA will post. Never add anything. Keep everything else word for word.",
    content: `Problems found: ${why.join("; ")}.\nNever name any person (these appear in the sources: ${(names ?? []).join(", ") || "none listed"}); refer to them by role or not at all.\nEvery number must be one of the checked facts below; take out any other number (a numbered point may become a plain sentence). A key figure on the image that is not in the facts is removed.\nChecked facts:\n${ok}\n\nHEADLINE: ${t.headline}\nSUMMARY: ${t.summary}\nCOMMENTARY: ${t.commentary}\nLINKEDIN: ${t.captions.linkedin}\nINSTAGRAM: ${t.captions.instagram}\nX: ${t.captions.x}\nIMAGE: ${JSON.stringify(t.image)}\nANDREW'S COMMENT: ${t.andrewComment || "(none; return an empty string)"}`,
  });
}

// ── photos: official release only, never a person ────────────────────────────────────────────────────────────────
const PHOTO = S({ person: bool, crest: bool, items: bool, describe: str });
async function checkPhoto({ client, usage, url, officialSites, fetchFn }) {
  const site = officialSites.find((s) => onDomain(url, [s.domain]));
  if (!site) return { ok: false, why: "not from an official release" };
  if (!site.photos) return { ok: false, why: `${site.name}'s photo terms are not cleared for reuse yet` };
  const r = await fetchFn(url); if (!r.ok) return { ok: false, why: `the photo answered ${r.status}` };
  const type = r.headers.get("content-type") ?? "";
  if (!/^image\/(jpeg|png|webp)/.test(type)) return { ok: false, why: "not a photo" };
  const bytes = Buffer.from(await r.arrayBuffer());
  if (bytes.length > 4.5e6) return { ok: false, why: "photo too large" };
  const v = await ask({
    client, usage, effort: "low",
    submit: { name: "photo", description: "Describe the photo.", schema: PHOTO },
    system: "You look at a photo from a police news release before it is used on a public post. Be strict.",
    content: [{ type: "image", source: { type: "base64", media_type: type.split(";")[0], data: bytes.toString("base64") } }, { type: "text", text: "Does it show any person or part of a person (face, hands, a body, an officer, a mugshot)? Does it show a police crest or badge? Does it show seized items or a scene (drugs, guns, cash, cartons, pouches, vehicles)?" }],
  });
  if (v.person) return { ok: false, why: "shows a person" };
  if (v.crest) return { ok: false, why: "shows a police crest" };
  if (!v.items) return { ok: false, why: "does not show seized items" };
  return { ok: true, src: `data:${type.split(";")[0]};base64,${bytes.toString("base64")}`, credit: site.name, describe: v.describe };
}

/** An answer with any field missing filled from what came before, or left empty, so a short answer can't stop the night. */
function settle(a, prev = {}) {
  const t = (k) => (typeof a?.[k] === "string" ? a[k] : typeof prev[k] === "string" ? prev[k] : "");
  const caps = { ...{ linkedin: "", instagram: "", x: "" }, ...(prev.captions ?? {}), ...(a?.captions ?? {}) };
  const image = { kicker: "", headline: "", figures: [], view: "", source: "", ...(prev.image ?? {}), ...(a?.image ?? {}) };
  image.figures = Array.isArray(image.figures) ? image.figures : [];
  const keys = ["where", "agency", "crime", "specifics", "outcome", "people"];
  const keywords = Object.fromEntries(keys.map((k) => [k, Array.isArray(a?.keywords?.[k]) ? a.keywords[k] : prev.keywords?.[k] ?? []]));
  return { ...prev, ...a, headline: t("headline"), summary: t("summary"), commentary: t("commentary"), andrewComment: t("andrewComment"), view: t("view"),
    captions: caps, image, keywords, facts: Array.isArray(a?.facts) ? a.facts : prev.facts ?? [], comparisons: Array.isArray(a?.comparisons) ? a.comparisons : prev.comparisons ?? [],
    namesInSources: Array.isArray(a?.namesInSources) ? a.namesInSources : prev.namesInSources ?? [], hashtags: Array.isArray(a?.hashtags) ? a.hashtags : prev.hashtags ?? [],
    photo: a?.photo ?? prev.photo ?? { url: "", description: "" } };
}

// ── the run ──────────────────────────────────────────────────────────────────────────────────────────────────────
const newId = () => `${torontoDate().replace(/-/g, "")}-${randomBytes(5).toString("hex")}`;
async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i).catch((e) => ({ error: e.message })); } }));
  return out;
}

/**
 * One night. `mode` "sample" (the default) writes the stories into the library marked as samples, with nothing sent
 * and nothing marked covered; "live" will also send to Buffer once that is switched on.
 */
export async function runNewsroom({ daysAgo = 0, mode = "sample", client = null, fetchFn = fetch, now = new Date(), by = "the nightly run", deadline = Date.now() + 14 * 60 * 1000 } = {}) {
  if (!client && !anthropicKey()) throw new Error("The desk has no Anthropic API key, so the Newsroom cannot run.");
  const api = client ?? new Anthropic({ apiKey: anthropicKey() });
  const set = await settings();
  const src = sourcesFrom(set);
  const usage = newUsage();
  // A sample can be of an earlier night (daysAgo 1 or 2), so Andrew sees three different nights in one go; a live
  // night always reads back to the last night that finished.
  if (mode === "live") daysAgo = 0;
  daysAgo = Math.max(0, Math.min(6, Math.round(Number(daysAgo) || 0)));
  const end = now.getTime() - daysAgo * 86400000;
  const until = daysAgo ? end : Infinity;
  const night = torontoDate(new Date(end));
  const lastOk = await getMeta("newsroom:lastok");
  const since = daysAgo ? end - 86400000 : Math.min(now.getTime() - 24 * 3600 * 1000, lastOk?.at ? Date.parse(lastOk.at) : Infinity);
  const log = { id: `${night}-${mode}-${randomBytes(2).toString("hex")}`, night, mode, by, startedAt: now.toISOString(), since: new Date(since).toISOString(), until: daysAgo ? new Date(end).toISOString() : null, sources: [], found: [], picked: [], skipped: [], updates: [], refused: [], errors: [], stories: [] };
  const save = async () => { log.usage = { ...usage, usd: usd(usage) }; await putMeta(`news:night:${log.id}`, log); };
  await save();
  try {
    // 1. gather
    const feeds = await gatherFeeds({ src, since, until, fetchFn });
    log.sources.push(...feeds.notes);
    let official = [];
    try { official = await gatherOfficial({ client: api, usage, src, topics: set.topics, sinceIso: new Date(since).toISOString(), untilIso: daysAgo ? new Date(end).toISOString() : "" }); log.sources.push({ source: "official sites (web search)", found: official.length }); }
    catch (e) { log.errors.push(`official sites search: ${e.message}`); }
    const all = [...official, ...feeds.items];
    log.found = all.map((c) => ({ title: c.title, url: c.url, outlet: c.outlet, official: !!c.official }));

    // 2. collapse
    const covered = await getCovered();
    const { kept, dropped } = collapse(all, covered);
    log.skipped.push(...dropped);
    const items = kept.slice(0, 80);
    if (!items.length) { log.note = "Nothing new tonight."; return log; }

    // 3. rank
    const index = await getIndex();
    const liveLibrary = index.filter((s) => s.mode === "live");
    const ranked = await rank({ client: api, usage, items, library: liveLibrary, set, topics: set.topics });
    for (const s of ranked.skipped ?? []) { const c = items[s.n - 1]; if (c) log.skipped.push({ title: c.title, url: c.url, why: s.why }); }
    // One post per story: an update joins its story's thread, but only when the case truly matches.
    for (const u of ranked.updates ?? []) {
      const c = items[u.n - 1]; if (!c) continue;
      const story = liveLibrary.find((s) => s.id === u.storyId) ? await getStory(u.storyId) : null;
      const m = story ? caseMatch({ agency: u.agency, city: u.city, project: u.project, details: u.details }, [story], { now: now.getTime() }) : { linked: false, why: "the story it names is not in the library" };
      if (story && m.linked && mode === "live") {
        (story.thread ??= []).push({ at: now.toISOString(), step: u.step, headline: c.title, url: c.url, posted: false });
        await putStory(story); await saveToIndex([story]);
      }
      log.updates.push({ title: c.title, url: c.url, storyId: u.storyId, step: u.step, linked: !!(story && m.linked), why: story && m.linked ? `${u.why} (${m.why})` : `not linked: ${m.why}`, ...(mode !== "live" ? { sample: true } : {}) });
    }
    const picks = (ranked.picks ?? []).filter((p) => items[p.n - 1]).slice(0, set.perNight.max);
    let comments = 0, big = 0;

    // 4–8 for each pick, four at a time.
    const results = await pool(picks, 4, async (p) => {
      const item = items[p.n - 1];
      if (Date.now() > deadline) return { item, skipped: "ran out of time tonight" };
      const similar = index.filter((s) => s.type === p.type && s.province !== p.province).slice(0, 8);
      const allowComment = p.significant && comments < set.comments && (comments += 1);
      const bigPicture = p.bigPicture && big < set.bigPicture && (big += 1);
      const draft = settle(await writeStory({ client: api, usage, pick: p, item, similar, gov: src.governmentDomains, official: src.officialSites.map((s) => s.domain), allowComment, bigPicture }));
      const check = settle(await checkStory({ client: api, usage, draft, item, gov: src.governmentDomains }), draft);
      const verdict = new Map((check.facts ?? []).map((f) => [f.id, f]));
      const facts = draft.facts.map((f) => { const v = verdict.get(f.id); return { ...f, verdict: v?.verdict ?? null, corrected: v?.corrected ?? "", checkedAt: v?.sourceUrl || f.sourceUrl, note: v?.note ?? "", sourceUrl: v?.sourceUrl || f.sourceUrl }; });
      const edited = settle(await humanize({ client: api, usage, t: { ...check, view: check.image.view, andrewComment: allowComment ? check.andrewComment : "" } }), { ...check, view: check.image.view });
      let photo = null;
      if (draft.photo?.url) {
        const ph = await checkPhoto({ client: api, usage, url: draft.photo.url, officialSites: src.officialSites, fetchFn }).catch((e) => ({ ok: false, why: e.message }));
        photo = ph.ok ? { url: draft.photo.url, credit: ph.credit, src: ph.src, person: false, describe: ph.describe } : null;
        if (!ph.ok) log.errors.push(`photo left out for "${item.title}": ${ph.why}`);
      }
      let image = { ...check.image, view: edited.view, source: check.image.source || item.outlet };
      const guardOpts = { governmentDomains: src.governmentDomains, officialDomains: src.officialSites.map((s) => s.domain) };
      const textsOf = (e, im) => ({
        texts: [e.headline, e.summary, e.commentary, e.captions.linkedin, e.captions.instagram, e.captions.x, im.kicker, im.headline, im.view, ...im.figures.flatMap((f) => [f.value, f.label]), e.andrewComment],
        labels: ["the headline", "the summary", "the commentary", "the LinkedIn caption", "the Instagram caption", "the X caption", "the image", "the image", "the image", ...im.figures.flatMap(() => ["the image", "the image"]), "Andrew's comment"],
      });
      let why = refusals({ ...textsOf(edited, image), names: draft.namesInSources, facts, photo }, guardOpts);
      // A name or an unsourced figure can usually just come out: one repair, then the same guards again.
      let final = edited;
      if (why.length && why.every((w) => /^names a person|^has numbers/.test(w))) {
        const fixed = settle(await repair({ client: api, usage, t: { ...edited, image }, why, names: draft.namesInSources, facts }), { ...edited, image });
        const im2 = { ...image, ...fixed.image, figures: Array.isArray(fixed.image?.figures) ? fixed.image.figures : image.figures };
        const again = refusals({ ...textsOf(fixed, im2), names: draft.namesInSources, facts, photo }, guardOpts);
        if (!again.length) { final = fixed; image = im2; why = []; } else why = again.map((w) => `${w} (after one repair)`);
      }
      if (why.length) return { item, refused: why };
      const id = newId();
      const story = {
        id, night, mode, createdAt: new Date().toISOString(), by,
        type: p.type, city: draft.city || p.city || (draft.keywords.where ?? [])[0] || "", province: (draft.province || p.province || "").slice(0, 2).toUpperCase(), country: "Canada",
        headline: final.headline, summary: final.summary, commentary: final.commentary,
        captions: final.captions, andrewComment: final.andrewComment || "",
        image: { ...image, date: longDate(night) }, photo: photo ? { url: photo.url, credit: photo.credit, describe: photo.describe } : null,
        // The page the story was written from (the agency's release when one was found), not the search result that led to it.
        source: /^https?:\/\//.test(draft.sourceUrl) && !/news\.google\./.test(draft.sourceUrl)
          ? { name: draft.sourceName || domainOf(draft.sourceUrl), url: draft.sourceUrl, official: !!draft.sourceOfficial || onDomain(draft.sourceUrl, src.officialSites.map((s) => s.domain)), published: item.published ?? "", foundVia: item.url }
          : { name: item.outlet || domainOf(item.url), url: item.url, official: !!item.official, published: item.published ?? "" },
        otherSources: item.also ?? [], facts, comparisons: draft.comparisons ?? [], keywords: draft.keywords, hashtags: draft.hashtags ?? [],
        bigPicture: !!bigPicture, caseKey: { project: p.project ?? "", agency: p.agency ?? "", details: p.details ?? [] },
        thread: [], buffer: { status: "none" }, why: p.why,
      };
      const png = await renderPost({ type: story.type, kicker: image.kicker, headline: image.headline, figures: image.figures, view: image.view, source: image.source, date: story.image.date, photo: photo ? { src: photo.src, credit: photo.credit } : null });
      await putImage(id, png);
      story.imageKey = id;
      await putStory(story);
      return { item, story };
    });

    const stories = [];
    for (const r of results) {
      if (!r) continue;
      if (r.error) log.errors.push(r.error);
      else if (r.refused) log.refused.push({ title: r.item.title, url: r.item.url, why: r.refused });
      else if (r.skipped) log.skipped.push({ title: r.item.title, url: r.item.url, why: r.skipped });
      else if (r.story) { stories.push(r.story); log.picked.push({ title: r.item.title, url: r.item.url, why: r.story.why, storyId: r.story.id }); }
    }
    log.stories = stories.map((s) => s.id);
    if (stories.length) await saveToIndex(stories);
    // Only a live night marks what it wrote as covered; a sample night leaves tomorrow's real run free to take them.
    if (mode === "live") {
      const add = stories.flatMap((s) => [s.source.url, ...s.otherSources.map((o) => o.url)].map((u) => ({ url: canonUrl(u), headline: s.headline, storyId: s.id, at: night })));
      const keep = covered.filter((c) => Date.now() - Date.parse(c.at) < 400 * 86400000);
      await putMeta("news:covered", [...keep, ...add]);
      await putMeta("newsroom:lastok", { at: now.toISOString(), log: log.id });
    }
    return log;
  } catch (e) {
    log.errors.push(e.message);
    return log;
  } finally {
    log.finishedAt = new Date().toISOString();
    await save().catch(() => {});
  }
}
