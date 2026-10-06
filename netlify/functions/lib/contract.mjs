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
  required: ["hotelName", "rate", "arrival", "departure", "dates", "notes"],
  properties: {
    hotelName: nullable({ type: "string" }),
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

const SYSTEM = `You read hotel group contracts for ONGIA, a Canadian non-profit that runs training events. Find the hotel's name, the group room rate, the arrival and departure dates of the room block, and every date in the contract that someone at ONGIA has to act on or keep an eye on.

Date kinds:
- cutoff: the last day attendees can book at the group rate, after which unbooked rooms are released (also called the cut-off, release or reservation deadline).
- foodAndBev: when the final food and beverage numbers (the guarantee) are due. A deadline for choosing menus is "other".
- roomingList: when the rooming list or guest names are due to the hotel.
- deposit and payment: when a deposit or payment is due.
- attrition: when room pickup is reviewed, or the last day the block can be reduced without penalty.
- cancellation: the first day of each new cancellation charge (one entry per change, not the last day of the old one).
- other: any other date that needs action.

For each date, quote the contract's own words in "quote" (one sentence at most) and give the page number if you can tell. Write "what" in plain English, under twelve words. When the contract gives a deadline relative to arrival ("30 days prior to arrival"), work out the calendar date from the contract's arrival date and say so in "what". Leave out the nights of the stay themselves and the date the contract was signed. Give the rate as written, including currency, room type and taxes if stated.

Never give a date the contract does not support. If something is unclear — two different cut-off dates, a deadline with no date, a year that does not match the event — say so briefly in "notes"; otherwise leave "notes" empty.`;

const isDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""))) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

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
  return {
    hotelName: clip(raw?.hotelName, 200) || null,
    rate: clip(raw?.rate, 120) || null,
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
    : `Today is ${formatDate(today)}.`;
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
