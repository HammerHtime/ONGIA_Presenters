import { standardOf, PROVINCES } from "./agencies.mjs";
import { ABOUT, SESSION, OVERALL } from "./survey.mjs";

/**
 * An event's survey answers, added up (Andrew 27 Oct 2026: a PDF, a summary with charts, the individual responses,
 * Claude's read, and the infographic all come from this one set of numbers, so they always agree).
 *
 * Stars count 1 to 5; N/A is left out of every average. "Rated 4 or 5" is the share of star answers that were 4 or 5,
 * the figure the infographic leads with. Agencies are counted under their standard name; province is its own
 * question, so any agency can be broken down by province.
 */

const STAR_IDS = SESSION.filter((q) => q.kind === "stars").map((q) => q.id);
const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);
const round1 = (x) => Math.round(x * 10) / 10;

/** One star question's answers: average, share rating 4 or 5, how many of each, how many answered (N/A apart). */
export function starStats(values) {
  const v = values.filter((x) => typeof x === "number");
  const dist = [1, 2, 3, 4, 5].map((n) => v.filter((x) => x === n).length);
  return { n: v.length, na: values.filter((x) => x === "na").length, avg: v.length ? round1(v.reduce((a, b) => a + b, 0) / v.length) : null, top2: pct(dist[3] + dist[4], v.length), dist };
}

function choiceStats(values, options) {
  const v = values.filter((x) => Number.isInteger(x));
  return { n: v.length, counts: options.map((_, i) => v.filter((x) => x === i).length), pcts: options.map((_, i) => pct(v.filter((x) => x === i).length, v.length)) };
}

/** Everything the reports need, from the answers kept for an event. */
export function surveyResults(event, responses, agencyList = []) {
  const sessions = event.survey?.sessions ?? [];
  const about = responses.filter((r) => r.about).map((r) => r.about);
  const overall = responses.filter((r) => r.overall).map((r) => r.overall);
  const q = (list, id) => list.map((x) => x[id]).filter((x) => x !== undefined);

  // Who answered.
  const agencyOf = (raw) => standardOf(raw, agencyList) ?? null;
  const agencies = new Map();
  for (const a of about) {
    if (!a.agency) continue;
    const std = agencyOf(a.agency);
    const name = std?.name ?? a.agency;
    const g = agencies.get(name) ?? { agency: name, known: !!std, count: 0, provinces: {} };
    g.count++;
    if (a.province) g.provinces[a.province] = (g.provinces[a.province] ?? 0) + 1;
    agencies.set(name, g);
  }
  const provinceCounts = {};
  for (const a of about) if (a.province) provinceCounts[a.province] = (provinceCounts[a.province] ?? 0) + 1;
  const withProvince = Object.values(provinceCounts).reduce((x, y) => x + y, 0);
  const opt = (id) => ABOUT.find((x) => x.id === id).options;

  // Each session, rated by the people who were there (skipped ones apart).
  const perSession = sessions.map((s) => {
    const given = responses.map((r) => r.sessions?.[s.id]).filter(Boolean);
    const rated = given.filter((g) => !g.skipped);
    const byQ = Object.fromEntries(STAR_IDS.map((id) => [id, starStats(rated.map((g) => g[id]).filter((x) => x !== undefined))]));
    const all = starStats(rated.flatMap((g) => STAR_IDS.map((id) => g[id])).filter((x) => x !== undefined));
    const rebook = choiceStats(rated.map((g) => g.rebook).filter((x) => x !== undefined), SESSION.find((x) => x.id === "rebook").options.en);
    return { id: s.id, day: s.day, title: s.title, titleFr: s.titleFr || "", presenters: s.presenters, n: rated.length, skipped: given.length - rated.length,
      avg: all.avg, top2: all.top2, byQ, rebook: { yes: rebook.counts[0], maybe: rebook.counts[1], no: rebook.counts[2], yesPct: rebook.pcts[0] },
      comments: rated.map((g) => g.comment).filter(Boolean) };
  });

  // The event overall.
  const ov = Object.fromEntries(OVERALL.filter((x) => x.kind === "stars").map((x) => [x.id, starStats(q(overall, x.id))]));
  const pace = choiceStats(q(overall, "pace"), OVERALL.find((x) => x.id === "pace").options.en);
  const length = choiceStats(q(overall, "length"), OVERALL.find((x) => x.id === "length").options.en);
  const npsV = q(overall, "nps").filter((x) => Number.isInteger(x));
  const promoters = npsV.filter((x) => x >= 9).length, detractors = npsV.filter((x) => x <= 6).length;
  const where = {};
  for (const w of q(overall, "where")) if (PROVINCES[w]) where[w] = (where[w] ?? 0) + 1;

  // Every session's star answers together: the "rated 4 or 5" the banner leads with comes from the overall quality
  // question when people answered it, else from all the session ratings.
  const allSessionStars = starStats(responses.flatMap((r) => Object.values(r.sessions ?? {}).filter((g) => !g.skipped).flatMap((g) => STAR_IDS.map((id) => g[id]))).filter((x) => x !== undefined));
  const headline = ov.quality?.n ? ov.quality : allSessionStars;

  return {
    responses: responses.length, respondents: about.length,
    byPart: responses.reduce((m, r) => ({ ...m, [r.part]: (m[r.part] ?? 0) + 1 }), {}),
    languages: { en: responses.filter((r) => r.lang !== "fr").length, fr: responses.filter((r) => r.lang === "fr").length },
    agencies: [...agencies.values()].sort((a, b) => b.count - a.count || a.agency.localeCompare(b.agency)),
    provinces: Object.entries(provinceCounts).sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, name: PROVINCES[code] ?? code, count, pct: pct(count, withProvince) })),
    years: opt("years").en.map((label, i) => ({ label, count: about.filter((a) => a.years === i).length, pct: pct(about.filter((a) => a.years === i).length, about.filter((a) => Number.isInteger(a.years)).length) })),
    before: choiceStats(q(about, "before"), opt("before").en),
    again: choiceStats(q(about, "again"), opt("again").en),
    heard: opt("heard").en.map((label, i) => ({ label, count: about.filter((a) => a.heard === i).length })),
    sessions: perSession,
    topSessions: perSession.filter((s) => s.n).sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0) || b.n - a.n).slice(0, 5),
    sessionStars: allSessionStars,
    overall: { ...ov, pace: { ...pace, aboutRightPct: pace.pcts[1] }, length: { ...length, aboutRightPct: length.pcts[1] },
      nps: { n: npsV.length, score: npsV.length ? Math.round(100 * (promoters - detractors) / npsV.length) : null, promoters, detractors, passives: npsV.length - promoters - detractors },
      where: Object.entries(where).sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, name: PROVINCES[code], count })),
      topics: q(overall, "topics").filter(Boolean), anything: q(overall, "anything").filter(Boolean), present: q(overall, "present").filter((x) => x === 0).length },
    headline: { avg: headline.avg, top2: headline.top2, n: headline.n },
    comments: [...perSession.flatMap((s) => s.comments.map((text) => ({ text, about: s.title }))), ...q(overall, "anything").filter(Boolean).map((text) => ({ text, about: "The event overall" }))],
  };
}
