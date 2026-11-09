import Anthropic from "@anthropic-ai/sdk";
import { anthropicKey } from "./contract.mjs";
import { text } from "./http.mjs";

/**
 * A plain line under each session title on the infographic (Andrew 9 Nov 2026: "people who did attend the training
 * wouldn't know what Project Poppy was … It would be great to have a title that describes the presentation").
 * Claude drafts it from the title and the presenter's outline; Andrew can change any of them on the Survey tab.
 * The infographic is shared publicly, so a line says what the session is about in general terms only.
 */

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["sessions"],
  properties: { sessions: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "en", "fr"], properties: { id: { type: "string" }, en: { type: "string" }, fr: { type: "string" } } } } },
};

const SYSTEM = `You write one short line for each session of a training event run by ONGIA, a Canadian non-profit that trains police, corrections, justice and community partners on street gangs, organized crime, extremism and human trafficking. The line goes under the session's title on a public infographic, so that someone who wasn't there understands what the session covered, even when the title is a code name ("Project Poppy") or a brand ("ONGIA's Coast to Coast").

For each session give:
- en: 4 to 9 words, plain English, sentence case, no full stop. Say the subject, e.g. "A national roundup of gang trends", "Building cases that hold up in court".
- fr: the same line in Canadian French.

Rules:
- General terms only. Never name a person, victim, suspect, informant, agency unit, address, case number, court file or operational detail, even if the outline has them. Never say an investigation is ongoing.
- Don't repeat the title's words when you can say more; don't add claims the title and outline don't support.
- If there's too little to go on, describe the title's plain subject.`;

/** Draft lines for the sessions given. `sessions` are [{ id, title, presenters, outline }]. Returns { [id]: { en, fr } }. */
export async function describeSessions(sessions, { client = null } = {}) {
  if (!sessions.length) return {};
  if (!client && !anthropicKey()) throw new Error("The desk has no Anthropic API key, so Claude can't draft the lines.");
  const api = client ?? new Anthropic({ apiKey: anthropicKey() });
  const brief = sessions.map((s) => ({ id: s.id, title: s.title, presenters: s.presenters, outline: text(s.outline, 1500) }));
  const message = await api.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: `The sessions:\n${JSON.stringify(brief)}` }],
  });
  if (message.stop_reason === "refusal") throw new Error("Claude declined to draft these lines.");
  const raw = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let out;
  try { out = JSON.parse(raw); } catch { throw new Error("Claude's answer could not be read. Try again."); }
  const ids = new Set(sessions.map((s) => s.id));
  return Object.fromEntries((out.sessions ?? []).filter((x) => ids.has(x.id)).map((x) => [x.id, { en: text(x.en, 90).replace(/\.$/, ""), fr: text(x.fr, 110).replace(/\.$/, "") }]));
}
