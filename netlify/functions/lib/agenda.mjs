import Anthropic from "@anthropic-ai/sdk";
import { anthropicKey } from "./contract.mjs";
import { formatDate, todayIso } from "./deadlines.mjs";

/**
 * An event's agenda, and the day-by-day times that come out of it.
 *
 * Claude reads the PDF for each training day's start and end and the room, and
 * the venue if the agenda names it. That is a suggestion: Andrew sees it on the
 * event page, corrects it if he needs to, and saves it as the event's schedule.
 * Only the saved schedule goes into letters.
 */

const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["days", "venue", "address", "notes"],
  properties: {
    days: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["date", "start", "end", "where"],
        properties: {
          date: { type: "string", format: "date" },
          start: nullable({ type: "string" }),
          end: nullable({ type: "string" }),
          where: nullable({ type: "string" }),
        },
      },
    },
    venue: nullable({ type: "string" }),
    address: nullable({ type: "string" }),
    notes: { type: "string" },
  },
};

const SYSTEM = `You read training agendas for ONGIA, a Canadian non-profit that runs training events. For each day of the training, find when the training starts and ends, and the room or place it is held in if the agenda says. Also give the venue's name and street address if the agenda names them.

"start" is when the first session of the day begins; registration or breakfast before it does not count. "end" is when the last session of the day ends. Write times as "8:30 AM". If the agenda does not give a day's start or end, leave it empty; never guess one. Give "where" only if the agenda names a room or place for that day, as written, under 60 characters.

Only list days that appear in the agenda. Give each day's calendar date; if the agenda names weekdays but no dates, work the dates out from the event dates you are given and say so in "notes". If anything is unclear, such as two different start times for the same day, say so briefly in "notes"; otherwise leave "notes" empty.`;

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? "")) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** "8:30", "08:30", "8.30am", "1 pm", "13:00" → "8:30 AM" / "1:00 PM". Null if it is not a time. */
export function cleanTime(v) {
  const s = String(v ?? "").trim().toLowerCase().replace(/\./g, ":").replace(/\s+/g, "");
  if (!s) return "";
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?(:?)(a|am|a:m:|p|pm|p:m:|h)?$/);
  if (!m) return null;
  let h = Number(m[1]); const min = m[2] ?? "00";
  if (Number(min) > 59) return null;
  const ap = m[4]?.startsWith("a") ? "AM" : m[4]?.startsWith("p") ? "PM" : null;
  if (ap) { if (h < 1 || h > 12) return null; return `${h}:${min} ${ap}`; }
  if (h > 23) return null;
  // No AM or PM is only read as a 24-hour clock when it plainly is one — "08:30"
  // or "16:30", as a time box sends it. A bare "4:30" could be either, and a
  // letter to everyone is no place to guess.
  if (m[1].length < 2 && h !== 0) return null;
  const out = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${out}:${min} ${h < 12 ? "AM" : "PM"}`;
}

/** The days of an event, first to last. */
export function trainingDays(event) {
  if (!isDate(event?.dayOne)) return [];
  const last = isDate(event.lastDay) && event.lastDay >= event.dayOne ? event.lastDay : event.dayOne;
  const out = [];
  for (let d = event.dayOne; d <= last && out.length < 14; d = new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10)) out.push(d);
  return out;
}

/**
 * A schedule typed or confirmed on the desk, checked before it is kept: one
 * row per training day, a real time or nothing in each box, and the end after
 * the start. Returns the rows or the first problem in plain words.
 */
export function cleanSchedule(rows, event) {
  const days = new Set(trainingDays(event));
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!days.has(r?.date)) continue;                            // a day the training no longer has
    const start = cleanTime(r.start), end = cleanTime(r.end);
    const label = formatDate(r.date);
    if (start === null) return { problem: `${label}: "${r.start}" is not a time. Write it like 8:30 AM.` };
    if (end === null) return { problem: `${label}: "${r.end}" is not a time. Write it like 4:30 PM.` };
    if (start && end && minutes(end) <= minutes(start)) return { problem: `${label}: it ends before it starts.` };
    const where = clip(r.where, 60);
    if (start || end || where) out.push({ date: r.date, start, end, where });
  }
  return { schedule: out.sort((a, b) => a.date.localeCompare(b.date)) };
}

const minutes = (t) => {
  const [, h, m, ap] = t.match(/^(\d+):(\d+) (AM|PM)$/);
  return ((Number(h) % 12) + (ap === "PM" ? 12 : 0)) * 60 + Number(m);
};

/** What came back from Claude, tidied: only real dates of this training, real times. */
export function tidyAgenda(raw, event) {
  const days = new Set(trainingDays(event));
  const seen = new Set();
  const found = (Array.isArray(raw?.days) ? raw.days : [])
    .filter((d) => isDate(d?.date) && !seen.has(d.date) && seen.add(d.date))
    .map((d) => ({ date: d.date, start: cleanTime(d.start) || "", end: cleanTime(d.end) || "", where: clip(d.where, 60), inEvent: days.has(d.date) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const outside = found.filter((d) => !d.inEvent);
  const notes = [clip(raw?.notes, 600),
    outside.length ? `The agenda has ${outside.map((d) => formatDate(d.date)).join(", ")}, which ${outside.length === 1 ? "is" : "are"} not one of this event's training days.` : ""].filter(Boolean).join(" ");
  return {
    days: found.filter((d) => d.inEvent).map(({ inEvent, ...d }) => d),
    venue: clip(raw?.venue, 200) || null,
    address: clip(raw?.address, 300) || null,
    notes,
  };
}

/** Read one agenda. Throws with a reason Andrew can act on. `client` is for tests. */
export async function readAgenda(pdfBytes, event, { client = null, today = todayIso() } = {}) {
  const api = client ?? new Anthropic({ apiKey: anthropicKey() });
  const data = Buffer.from(pdfBytes).toString("base64");
  const days = trainingDays(event).map((d) => formatDate(d)).join(", ");
  const stream = api.beta.messages.stream({
    model: "claude-opus-5-5",
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data } },
        { type: "text", text: `This is the agenda for ${event.title}, in ${event.city || "a city not given"}. Its training days are ${days || "not set yet"}. Today is ${formatDate(today)}. Give each day's start, end and room.` },
      ],
    }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("Claude declined to read this document. Type the times in by hand.");
  if (message.stop_reason === "max_tokens") throw new Error("The agenda was too long to read in one go. Type the times in by hand.");
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error("Claude's answer could not be read. Try again."); }
  return tidyAgenda(raw, event);
}
