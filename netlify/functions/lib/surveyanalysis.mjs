import Anthropic from "@anthropic-ai/sdk";
import { anthropicKey } from "./contract.mjs";

/**
 * Claude's read of an event's survey (Andrew 27 Oct 2026: "some feedback as to what the attendees liked, didn't
 * like"), and the 4 or 5 comments the infographic quotes ("say there's 20 quotes … just pick out maybe 4 or 5 good
 * ones"). Every point carries the figure or comment it rests on; a quote is kept only if it is word for word one of the
 * comments, so nothing is put in an attendee's mouth.
 */

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["summary", "liked", "improve", "presenters", "quotes", "nextTime"],
  properties: {
    summary: { type: "string" },
    liked: { type: "array", items: { type: "object", additionalProperties: false, required: ["point", "evidence"], properties: { point: { type: "string" }, evidence: { type: "string" } } } },
    improve: { type: "array", items: { type: "object", additionalProperties: false, required: ["point", "evidence"], properties: { point: { type: "string" }, evidence: { type: "string" } } } },
    presenters: { type: "array", items: { type: "object", additionalProperties: false, required: ["session", "note"], properties: { session: { type: "string" }, note: { type: "string" } } } },
    quotes: { type: "array", items: { type: "object", additionalProperties: false, required: ["text", "about"], properties: { text: { type: "string" }, about: { type: "string" } } } },
    nextTime: { type: "array", items: { type: "string" } },
  },
};

const SYSTEM = `You read the results of a survey from a training event run by ONGIA, a Canadian non-profit that trains law enforcement, corrections, justice and community partners on street gangs, organized crime and human trafficking. You write for ONGIA's president, plainly and briefly.

Give:
- summary: three or four sentences on how the event was received, with the headline figures.
- liked: up to five things attendees valued most. Each with its evidence: a figure from the results ("4.8 of 5 from 41 people") or a short paraphrase of what several comments said.
- improve: up to five things to change, the same way. Only what the results show; if little needs improving, say less.
- presenters: one short note for each session that stands out, high or low, naming the session title.
- quotes: the four or five best comments for a public infographic: specific, positive, varied across sessions and the event, and free of anyone's name, agency or anything identifying. Copy each comment's words exactly; you may shorten one by cutting whole sentences, never by rewording.
- nextTime: up to four concrete suggestions for the next event, drawn from the topics people asked for and the comments.

Never invent a figure or a comment. If there are too few answers to say something, say so.`;

/** Claude's read. `client` is for tests. */
export async function analyseSurvey(event, results, { client = null } = {}) {
  if (!client && !anthropicKey()) throw new Error("The desk has no Anthropic API key, so Claude cannot read the results.");
  if (!results.responses) throw new Error("There are no answers yet to read.");
  const api = client ?? new Anthropic({ apiKey: anthropicKey() });
  const brief = {
    event: event.title, city: event.city, answers: results.responses, people: results.respondents,
    headline: results.headline, overall: results.overall, pace: results.overall.pace, length: results.overall.length, nps: results.overall.nps,
    agencies: results.agencies.slice(0, 15).map((a) => `${a.agency} (${a.count})`), provinces: results.provinces.map((p) => `${p.name} ${p.pct}%`),
    sessions: results.sessions.map((s) => ({ title: s.title, presenters: s.presenters, day: s.day, rated: s.n, avg: s.avg, top2: s.top2, rebookYesPct: s.rebook.yesPct })),
    topicsAskedFor: results.overall.topics.slice(0, 60),
  };
  const comments = results.comments.slice(0, 300).map((c, i) => `${i + 1}. [${c.about}] ${c.text}`).join("\n");
  const message = await api.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 6000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: `The results:\n${JSON.stringify(brief)}\n\nThe comments, as written:\n${comments || "(none)"}` }],
  });
  if (message.stop_reason === "refusal") throw new Error("Claude declined to read these results.");
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let out;
  try { out = JSON.parse(text); } catch { throw new Error("Claude's answer could not be read. Try again."); }
  return { ...out, quotes: verbatim(out.quotes ?? [], results.comments).slice(0, 5), at: new Date().toISOString() };
}

export const squash = (s) => String(s ?? "").toLowerCase().replace(/[“”"’‘']/g, "").replace(/\s+/g, " ").trim();

/**
 * Which comments are critical or mixed, so the presenter results show them in red or orange (Andrew 17 Nov 2026: "Any
 * comments that are a little negative, can you make the text orange or red, so they stand out"). Returns
 * { [squashed comment]: "negative" | "mixed" }; anything not listed is positive or neutral. Its own call, so the read's
 * summary and the infographic's quotes are not touched.
 */
const TONE_SCHEMA = { type: "object", additionalProperties: false, required: ["flagged"], properties: { flagged: { type: "array", items: {
  type: "object", additionalProperties: false, required: ["n", "tone"], properties: { n: { type: "integer" }, tone: { type: "string", enum: ["negative", "mixed"] } } } } } };
const TONE_SYSTEM = `You sort attendees' comments about sessions at a training event. List only the comments that are critical: "negative" when the comment is mainly a complaint or criticism (too long, hard to hear, off topic, poorly prepared, not useful), "mixed" when it praises something but also criticizes or suggests a real improvement ("good, but too fast"). Leave out comments that are positive, neutral, or only thanks. Go by what the words say, not by guessing.`;
export async function toneComments(results, { client = null } = {}) {
  const all = [...new Set(results.sessions.flatMap((s) => s.comments).map((c) => String(c).trim()).filter(Boolean))];
  if (!all.length) return {};
  const api = client ?? new Anthropic({ apiKey: anthropicKey() });
  const out = {};
  for (let i = 0; i < all.length; i += 150) {
    const chunk = all.slice(i, i + 150);
    const message = await api.messages.create({
      model: "claude-sonnet-5-5", max_tokens: 4000,
      output_config: { format: { type: "json_schema", schema: TONE_SCHEMA } },
      system: TONE_SYSTEM,
      messages: [{ role: "user", content: chunk.map((c, j) => `${j + 1}. ${c}`).join("\n") }],
    });
    const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    for (const f of JSON.parse(text).flagged ?? []) { const c = chunk[f.n - 1]; if (c) out[squash(c)] = f.tone; }
  }
  return out;
}

/** Only quotes that are an attendee's own words (whole, or whole sentences of it). */
export function verbatim(quotes, comments) {
  const all = comments.map((c) => squash(c.text));
  return quotes.filter((q) => {
    const want = squash(q.text);
    if (want.length < 12) return false;
    return all.some((c) => c.includes(want) || want.split(/(?<=[.!?])\s+/).every((sentence) => !sentence || c.includes(sentence)));
  });
}
