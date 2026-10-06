import Anthropic from "@anthropic-ai/sdk";
import { formatDate, todayIso } from "./deadlines.mjs";
import { datesOf } from "./letters.mjs";

/**
 * Reading a hotel contract for the dates that matter.
 *
 * Claude reads the PDF and hands back the hotel, the rate and every date in it
 * that someone at ONGIA has to act on — each with the contract's own words, so
 * Andrew can see where it came from. Nothing here writes to the event: the
 * dates are suggestions until he puts them in the form and saves.
 */

// Andrew pasted the key under his own name first; either works.
export const anthropicKey = () => process.env.ANTHROPIC_API_KEY || process.env.Claude_API || "";

export const KINDS = {
  cutoff: "Room block cut-off",
  foodAndBev: "Food and beverage numbers due",
  roomingList: "Rooming list due",
  deposit: "Deposit due",
  payment: "Payment due",
  attrition: "Attrition or room block review",
  cancellation: "Cancellation charges change",
  other: "Other date",
};

const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["hotelName", "city", "rate", "arrival", "departure", "meetingFirst", "meetingLast", "dates", "notes"],
  properties: {
    hotelName: nullable({ type: "string" }),
    city: nullable({ type: "string" }),
    meetingFirst: nullable({ type: "string", format: "date" }),
    meetingLast: nullable({ type: "string", format: "date" }),
    rate: nullable({ type: "string" }),
    arrival: nullable({ type: "string", format: "date" }),
    departure: nullable({ type: "string", format: "date" }),
    dates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "what", "date", "quote", "page"],
        properties: {
          kind: { type: "string", enum: Object.keys(KINDS) },
          what: { type: "string" },
          date: { type: "string", format: "date" },
          quote: { type: "string" },
          page: nullable({ type: "integer" }),
        },
      },
    },
    notes: { type: "string" },
  },
};

const SYSTEM = `You read hotel group contracts for ONGIA, a Canadian non-profit that runs training events. Find the hotel's name, the city it is in, the group room rate, the arrival and departure dates of the room block, the days the group's meetings run, and every date in the contract that someone at ONGIA has to act on or keep an eye on.

The meeting days are the training itself: the first and last day the group has meeting space or food and beverage functions booked. Give them as "meetingFirst" and "meetingLast". They usually sit inside the room-block stay (people arrive the night before), so do not just copy the arrival and departure dates; if the contract books no meeting space or functions, leave both empty. Give "city" as city and province, as in "Regina, SK".

Date kinds:
- cutoff: the last day attendees can book at the group rate, after which unbooked rooms are released (also called the cut-off, release or reservation deadline).
- foodAndBev: when the final food and beverage numbers (the guarantee) are due. A deadline for choosing menus is "other".
- roomingList: when the rooming list or guest names are due to the hotel.
- deposit and payment: when a deposit or payment is due.
- attrition: when room pickup is reviewed, or the last day the block can be reduced without penalty.
- cancellation: the first day of each new cancellation charge (one entry per change, not the last day of the old one).
- other: any other date that needs action.

For each date, quote the contract's own words in "quote" (one sentence at most) and give the page number if you can tell. Write "what" in plain English, under twelve words. When the contract gives a deadline relative to arrival ("30 days prior to arrival"), work out the calendar date from the contract's arrival date and say so in "what". Leave out the nights of the stay themselves and the date the contract was signed. Give "rate" as an attendee booking a room should see it, because it goes into emails to attendees: the price, the room type and "plus taxes" (naming the taxes briefly if the contract lists them), under 100 characters. Never put commissions, rebates, attrition or any other term between ONGIA and the hotel in "rate"; if the rate includes a commission, say so in "notes" instead.

Never give a date the contract does not support. If something is unclear — two different cut-off dates, a deadline with no date, a year that does not match the event — say so briefly in "notes"; otherwise leave "notes" empty.`;

const isDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""))) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/**
 * The rate as attendees will read it. Anything about commission or rebates is
 * ONGIA's business with the hotel, not theirs, so a clause mentioning it is
 * dropped even if Claude slips one in; and a long rate is shortened at a whole
 * word rather than cut mid-word.
 */
export function cleanRate(raw, max = 120) {
  const INTERNAL = "(?:commis|rebate|kick-?back|override|attrition|concession)";
  let r = String(raw ?? "").replace(/\s+/g, " ").trim()
    // a bracketed aside that mentions it
    .replace(new RegExp(`\\s*\\([^()]*${INTERNAL}[^()]*\\)`, "gi"), "")
    // the clause that mentions it, from its comma or semicolon to the next one
    .replace(new RegExp(`[;,]\\s*[^;,()]*${INTERNAL}[^;,()]*`, "gi"), "")
    // or the same clause at the very start
    .replace(new RegExp(`^[^;,()]*${INTERNAL}[^;,()]*[;,]\\s*`, "i"), "")
    .replace(/[\s;,]+$/, "");
  // Still tangled up in it (inside brackets, say): no rate beats a leaked one.
  if (new RegExp(INTERNAL, "i").test(r)) return "";
  if (r.length > max) {
    r = r.slice(0, max + 1);
    r = r.slice(0, Math.max(r.lastIndexOf(" "), 1)).replace(/[\s;,(]+$/, "");
    if ((r.match(/\(/g) ?? []).length > (r.match(/\)/g) ?? []).length) r = r.replace(/\s*\([^)]*$/, "");
  }
  return r;
}

/**
 * Tidy what came back and check it against the event. A date that cannot be
 * real is dropped; one that is real but odd — already past, or a cut-off after
 * the training starts — is kept with a warning, because the contract is the
 * contract and Andrew decides.
 */
export function tidy(raw, event, today = todayIso()) {
  const seen = new Set();
  const dates = (Array.isArray(raw?.dates) ? raw.dates : [])
    .filter((d) => KINDS[d?.kind] && isDate(d?.date))
    .map((d) => ({ kind: d.kind, what: clip(d.what, 140), date: d.date, quote: clip(d.quote, 320), page: Number.isInteger(d.page) && d.page > 0 ? d.page : null }))
    .filter((d) => { const k = `${d.kind}|${d.date}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 25)
    .map((d) => {
      const warn = [];
      if (d.date < today) warn.push("already passed");
      if (event?.dayOne && ["cutoff", "foodAndBev", "roomingList"].includes(d.kind) && d.date >= event.dayOne) warn.push("on or after the training starts");
      if (event?.dayOne && Math.abs(Number(d.date.slice(0, 4)) - Number(event.dayOne.slice(0, 4))) > 1) warn.push("a different year from the event");
      return { ...d, label: KINDS[d.kind], dateReadable: formatDate(d.date), warn };
    });
  const first = isDate(raw?.meetingFirst) ? raw.meetingFirst : null;
  // No last day in the contract stays no last day: copying the first one in
  // would quietly make it a one-day training.
  const last = isDate(raw?.meetingLast) && first && raw.meetingLast >= first ? raw.meetingLast : null;
  return {
    hotelName: clip(raw?.hotelName, 200) || null,
    city: clip(raw?.city, 80) || null,
    meetingFirst: first,
    meetingLast: last,
    rate: cleanRate(raw?.rate) || null,
    arrival: isDate(raw?.arrival) ? raw.arrival : null,
    departure: isDate(raw?.departure) ? raw.departure : null,
    dates,
    notes: clip(raw?.notes, 800),
  };
}

/** Plain words for an API failure, for a screen Andrew reads. */
export function whyItFailed(e) {
  if (e instanceof Anthropic.AuthenticationError) return "The Anthropic API key was refused. Check ANTHROPIC_API_KEY in Netlify, then redeploy.";
  if (e instanceof Anthropic.PermissionDeniedError) return "The Anthropic API key is not allowed to do this. Check the key's workspace in the Anthropic console.";
  if (e instanceof Anthropic.RateLimitError) return "Anthropic is busy right now. Try again in a minute.";
  if (e instanceof Anthropic.BadRequestError) return `Claude could not read that file: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return "Could not reach Anthropic. Try again in a minute.";
  if (e instanceof Anthropic.APIError) return `Anthropic answered with an error (${e.status}). Try again in a minute.`;
  return e?.message || "Something went wrong reading the contract.";
}

/**
 * Read one contract. Returns the tidied result; throws with a reason Andrew
 * can act on. `client` is only passed by tests.
 */
export async function readContract(pdfBytes, event, { client = null, today = todayIso() } = {}) {
  const api = client ?? new Anthropic({ apiKey: anthropicKey() });
  const data = Buffer.from(pdfBytes).toString("base64");
  const about = event
    ? `This contract is for ${event.title}, ${datesOf(event)}${event.city ? `, in ${event.city}` : ""}. Today is ${formatDate(today)}.`
    : `The event has not been set up yet: its training days and city will be taken from this contract. Today is ${formatDate(today)}.`;
  const stream = api.beta.messages.stream({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    // If a safety check declines the request, Anthropic re-runs it on its
    // recommended fallback model rather than handing back nothing.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data } },
        { type: "text", text: `${about} List the room block details and the dates.` },
      ],
    }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("Claude declined to read this document. Put the dates in by hand.");
  if (message.stop_reason === "max_tokens") throw new Error("The contract was too long to read in one go. Put the dates in by hand.");
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error("Claude's answer could not be read. Try again."); }
  return tidy(raw, event, today);
}
