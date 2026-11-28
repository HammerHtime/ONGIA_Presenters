/**
 * The Newsroom's rules, kept apart from the engine so each can be tested on its own (Newsroom spec, 28 Nov 2026):
 * the same story from several outlets is one item; a story already covered is never repeated; one post per story, so
 * a later development joins the case thread instead of becoming a second post (Andrew, 28 Nov 2026); no young person,
 * victim or anyone else is named; every number on a post comes from a checked source; a statement about the law comes
 * from a government source; photos only from official releases; and the Rising flag on the trends.
 *
 * These are code, not instructions to Claude: whatever the writing step produces, a draft that breaks one of them is
 * refused and logged, never sent.
 */

const STOP = new Set("a an the and or of in on at to for from with by after as is are was were be been has have had over into near its it this that than their his her they he she police say says said".split(" "));

export const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** A web address reduced to what identifies the page: no www, tracking, fragment or trailing slash. */
export function canonUrl(u) {
  try {
    const x = new URL(String(u).trim());
    x.hash = "";
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid|cmp|ref$|taxo)/i.test(k)) x.searchParams.delete(k);
    const host = x.hostname.toLowerCase().replace(/^www\./, "");
    return `${host}${x.pathname.replace(/\/+$/, "")}${x.search}`.toLowerCase();
  } catch { return String(u ?? "").trim().toLowerCase(); }
}
export function domainOf(u) {
  try { return new URL(String(u)).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}
/** Is this address on one of these domains (or a subdomain of one)? */
export const onDomain = (u, domains) => { const d = domainOf(u); return !!d && domains.some((x) => d === x || d.endsWith(`.${x}`)); };

/** The words of a headline that carry its meaning, lightly stemmed ("seized" and "seize" are one word). */
const stem = (w) => (w.length > 4 ? w.replace(/(ings?|ed|es|e|s)$/, "") : w);
export const words = (title) => new Set(fold(title).replace(/[^a-z0-9$ ]+/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)).map(stem));
// The names in a headline (capitalized words after the first): two headlines naming different places are different stories.
const proper = (title) => new Set(String(title ?? "").split(/\s+/).slice(1).map((w) => w.replace(/[^\p{L}'-]/gu, "")).filter((w) => /^\p{Lu}\p{Ll}/u.test(w)).map(fold));
export function likeness(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  const pa = proper(a), pb = proper(b);
  if (pa.size && pb.size && ![...pa].some((w) => pb.has(w))) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / Math.min(A.size, B.size);
}
const SAME = 0.7;

/** Has this candidate already been covered (by address or by a near-identical headline)? */
export function coveredBy(cand, covered) {
  const url = canonUrl(cand.url);
  return covered.find((c) => (c.url && c.url === url) || (c.headline && likeness(c.headline, cand.title) >= SAME)) ?? null;
}

/**
 * The night's candidates with the same story from several outlets made one item, the official release kept as the
 * source and the others listed under it, and anything already covered dropped. Returns what is left and why each
 * other one went.
 */
export function collapse(cands, covered = []) {
  const kept = [], dropped = [];
  const rank = (c) => (c.official ? 0 : 1);
  for (const c of [...cands].sort((a, b) => rank(a) - rank(b))) {
    if (!c?.url || !c?.title) continue;
    const old = coveredBy(c, covered);
    if (old) { dropped.push({ title: c.title, url: c.url, why: `already covered: ${old.headline ?? old.url}` }); continue; }
    const twin = kept.find((k) => canonUrl(k.url) === canonUrl(c.url) || likeness(k.title, c.title) >= SAME);
    if (twin) { (twin.also ??= []).push({ name: c.outlet ?? domainOf(c.url), url: c.url }); dropped.push({ title: c.title, url: c.url, why: `same story as "${twin.title}"` }); continue; }
    kept.push({ ...c });
  }
  return { kept, dropped };
}

/**
 * Names a draft must not carry. The writing step lists every person named in its sources; none of them may appear
 * in any text that goes out (Andrew's own name in his comment aside). Matching ignores case and accents, and a
 * surname alone counts.
 */
export function namesFound(texts, names) {
  const hay = ` ${fold(texts.filter(Boolean).join(" \n ")).replace(/[^a-z0-9'-]+/g, " ")} `;
  const hits = new Set();
  for (const n of names ?? []) {
    const parts = fold(n).replace(/[^a-z0-9'-]+/g, " ").split(" ").filter(Boolean);
    if (!parts.length) continue;
    const whole = parts.join(" ");
    if (hay.includes(` ${whole} `)) { hits.add(n); continue; }
    const last = parts[parts.length - 1];
    if (parts.length > 1 && last.length >= 3 && hay.includes(` ${last} `)) hits.add(n);
  }
  return [...hits];
}

// Numbers that are fine anywhere: the trafficking hotline, "24/7".
const FREE = ["1-833-900-1010", "1 833 900 1010", "24/7"];
/** Every number in a piece of text, normalized ("1,100" and "1100" are the same; "$25 million" keeps its scale). */
export function numbersIn(text) {
  let t = String(text ?? "");
  for (const f of FREE) t = t.split(f).join(" ");
  t = t.replace(/#\w+/g, " ").replace(/https?:\/\/\S+/g, " ").replace(/\b\d+D\b/gi, " ");
  const out = [];
  for (const m of t.matchAll(/(\d[\d,]*(?:\.\d+)?)(\s*(?:million|billion|thousand|k)\b)?/gi)) {
    const n = m[1].replace(/,/g, "").replace(/\.0+$/, "");
    out.push(m[2] ? `${n} ${m[2].trim().toLowerCase()}` : n);
  }
  return out;
}
/** Numbers in the post that no confirmed fact carries: each one is a figure from nowhere, and the draft is refused. */
export function unsourcedNumbers(texts, facts) {
  const known = new Set((facts ?? []).filter((f) => f.verdict === "confirmed" || f.verdict === "corrected").flatMap((f) => numbersIn(`${f.statement} ${f.corrected ?? ""}`)));
  // A scaled figure ("25 million") is sourced if the fact says it either way ("25 million" or "25,000,000").
  const scale = { thousand: 1e3, k: 1e3, million: 1e6, billion: 1e9 };
  for (const k of [...known]) { const [n, s] = k.split(" "); if (s && scale[s]) known.add(String(Number(n) * scale[s])); }
  const missing = new Set();
  for (const n of texts.filter(Boolean).flatMap(numbersIn)) {
    const [v, s] = n.split(" ");
    if (known.has(n) || known.has(v) || (s && known.has(String(Number(v) * (scale[s] ?? 1))))) continue;
    missing.add(n);
  }
  return [...missing];
}

/** A statement about the law kept on a draft must be confirmed from a government source, not a news story or memory. */
export function lawProblems(facts, governmentDomains) {
  return (facts ?? []).filter((f) => f.kind === "law" && f.verdict !== "removed" && !(onDomain(f.sourceUrl, governmentDomains) && (f.verdict === "confirmed" || f.verdict === "corrected")))
    .map((f) => `"${f.statement}" is about the law but is not confirmed from a government source`);
}

/**
 * Everything that refuses a draft. Empty means it may go on. `draft.texts` are the captions, the image text and
 * Andrew's comment; `draft.names` every person named in the sources; `draft.facts` the checked statements.
 */
export function refusals(draft, { governmentDomains = [], officialDomains = [] } = {}) {
  const why = [];
  const texts = draft.texts ?? [];
  const names = namesFound(texts, draft.names ?? []);
  if (names.length) why.push(`names a person (${names.length}): ${names.join(", ")}`);
  const nums = unsourcedNumbers(texts, draft.facts ?? []);
  if (nums.length) why.push(`has numbers no checked source carries: ${nums.join(", ")}`);
  why.push(...lawProblems(draft.facts, governmentDomains));
  if ((draft.facts ?? []).some((f) => !f.verdict)) why.push("a statement was never checked");
  if (draft.photo?.url && !onDomain(draft.photo.url, officialDomains)) why.push("the photo is not from an official release");
  if (draft.photo?.url && draft.photo.person !== false) why.push("the photo may show a person");
  return why;
}

/**
 * One post per story (Andrew, 28 Nov 2026): a new report on a case ONGIA already wrote up is linked to that story's
 * thread, not posted again. Linked only on solid ground: the same named project, or the same agency and city with the
 * same seizure or charges within eighteen months. Anything less is not linked, and the reason is logged.
 */
export function caseMatch(item, library, { now = Date.now() } = {}) {
  const k = (s) => fold(s).trim();
  const within = (d) => now - Date.parse(d ?? 0) < 548 * 86400000;
  let best = null;
  for (const s of library) {
    if (!within(s.night ?? s.createdAt)) continue;
    let score = 0; const why = [];
    if (item.project && s.caseKey?.project && k(item.project) === k(s.caseKey.project)) { score += 3; why.push(`same project (${s.caseKey.project})`); }
    const sameAgency = item.agency && (s.caseKey?.agency || s.keywords?.agency?.[0]) && k(item.agency) === k(s.caseKey?.agency ?? s.keywords.agency[0]);
    const sameCity = item.city && s.city && k(item.city) === k(s.city);
    if (sameAgency) { score += 1; why.push("same agency"); }
    if (sameCity) { score += 1; why.push("same city"); }
    const shared = (item.details ?? []).filter((d) => [...(s.keywords?.specifics ?? []), ...(s.caseKey?.details ?? [])].some((x) => k(x) === k(d)));
    if (shared.length) { score += 1; why.push(`same ${shared.slice(0, 2).join(", ")}`); }
    if (!best || score > best.score) best = { storyId: s.id, headline: s.headline, score, why };
  }
  if (!best || best.score < 3) return { linked: false, best, why: best?.score ? `possible match "${best.headline}" (${best.why.join(", ")}), not certain enough to link` : "no earlier story matches" };
  return { linked: true, storyId: best.storyId, headline: best.headline, why: best.why.join(", ") };
}

/**
 * Rising (spec, Trends): a keyword is rising this month when it has at least 3 stories and at least double its average
 * over the three months before.
 */
export function isRising(thisMonth, previousThree) {
  const prev = [0, 1, 2].map((i) => previousThree[i] ?? 0);
  const avg = (prev[0] + prev[1] + prev[2]) / 3;
  return thisMonth >= 3 && thisMonth >= 2 * avg;
}

/**
 * Search as you type (spec): every word must match somewhere, in any order; "quoted words" must match as a phrase;
 * part of a word matches; case and accents never matter. Best match first: headline, then keywords, then summary,
 * then the commentary.
 */
export function parseQuery(q) {
  const phrases = [], terms = [];
  String(q ?? "").replace(/"([^"]+)"|(\S+)/g, (_, ph, w) => { if (ph) phrases.push(fold(ph).trim()); else if (w) terms.push(fold(w)); return ""; });
  return { phrases: phrases.filter(Boolean), terms: terms.filter(Boolean) };
}
export function searchStories(stories, q) {
  const { phrases, terms } = parseQuery(q);
  if (!phrases.length && !terms.length) return stories;
  const fields = (s) => [[fold(s.headline), 8], [fold(Object.values(s.keywords ?? {}).flat().join(" ")), 5], [fold(`${s.city} ${s.province} ${s.typeLabel ?? ""}`), 4], [fold(s.summary), 3], [fold(s.commentary), 1]];
  const out = [];
  for (const s of stories) {
    const f = fields(s);
    let score = 0, ok = true;
    for (const t of [...phrases, ...terms]) {
      const hit = f.filter(([txt]) => txt.includes(t));
      if (!hit.length) { ok = false; break; }
      score += hit.reduce((n, [, w]) => n + w, 0);
    }
    if (ok) out.push([score, s]);
  }
  return out.sort((a, b) => b[0] - a[0] || String(b[1].night).localeCompare(String(a[1].night))).map(([, s]) => s);
}
