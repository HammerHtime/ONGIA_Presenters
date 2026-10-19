import Anthropic from "@anthropic-ai/sdk";
import { anthropicKey } from "./contract.mjs";
import { money } from "./sow.mjs";

/**
 * Receipts for an RBH event. A photo or a PDF goes in; Claude reads the vendor, the date and the amounts; a person
 * checks them, says which line of the statement of work they belong to (or "Other"), and only then is anything
 * counted. Claude never decides what goes on an invoice: it fills in the boxes, the person confirms them.
 *
 * What counts toward a line is the amount BEFORE tax. The invoice adds sales tax once, at the bottom, so a
 * receipt's own GST/QST is kept beside it but never added to the line.
 */

export const MAX_BYTES = 5 * 1024 * 1024;               // a function's request body tops out at 6 MB
export const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf" };
export const OTHER = "other";

const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["isReceipt", "vendor", "date", "subtotal", "tax", "total", "currency", "confidence", "suggestedLine", "notes"],
  properties: {
    isReceipt: { type: "boolean" },
    vendor: nullable({ type: "string" }),
    date: nullable({ type: "string", format: "date" }),
    subtotal: nullable({ type: "number" }),
    tax: nullable({ type: "number" }),
    total: nullable({ type: "number" }),
    currency: nullable({ type: "string" }),
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    suggestedLine: nullable({ type: "string" }),
    notes: nullable({ type: "string" }),
  },
};

const SYSTEM = `You read one receipt or invoice, shown as a photo or a PDF, for ONGIA's accountant.
Report only what is printed on it. If a figure is not there, say null rather than working it out.
- vendor: the business's name as printed.
- date: the purchase date (the invoice date for an invoice), as YYYY-MM-DD.
- subtotal: the amount before sales tax. tax: all sales tax together (GST, QST, HST, PST). total: the amount charged, tax included.
- currency: the three-letter code if printed or clear from the symbol (CAD, USD...), else null.
- confidence: "high" when the figures are sharp and agree (subtotal + tax = total); "low" when the picture is blurry, cut off, handwritten or the figures disagree.
- suggestedLine: the best fit from the list of lines you are given, copied exactly, or "Other" if none fits.
- notes: one short sentence if anything is odd (a tip, a refund, several receipts in one photo, a second page). Otherwise null.
If this is not a receipt or an invoice at all, set isReceipt to false and leave the rest null.`;

/** A reason a person can act on, not an SDK error. */
export function whyItFailed(e) {
  if (e instanceof Anthropic.AuthenticationError) return "The Anthropic API key was refused, so Claude could not read it. Fill the boxes in by hand.";
  if (e instanceof Anthropic.RateLimitError) return "Anthropic is busy right now. Fill the boxes in by hand, or discard it and try again in a minute.";
  if (e instanceof Anthropic.BadRequestError) return "Claude could not read that file. Fill the boxes in by hand, or take the photo again.";
  if (e instanceof Anthropic.APIConnectionError) return "Could not reach Anthropic. Fill the boxes in by hand, or try again in a minute.";
  return e?.message ? `Claude could not read it (${e.message}). Fill the boxes in by hand.` : "Claude could not read it. Fill the boxes in by hand.";
}

/** Tidy what Claude said into what the form shows. Numbers are dollars to the cent; anything odd is dropped. */
export function tidy(raw, lineNames = []) {
  const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : money(Number(v)));
  const subtotal = num(raw.subtotal), tax = num(raw.tax), total = num(raw.total);
  const counted = subtotal ?? (total !== null ? money(total - (tax ?? 0)) : null);
  const agree = subtotal !== null && tax !== null && total !== null ? Math.abs(subtotal + tax - total) < 0.03 : null;
  const suggested = lineNames.find((n) => n === raw.suggestedLine) ?? (/^other$/i.test(String(raw.suggestedLine ?? "")) ? "Other" : null);
  return {
    isReceipt: raw.isReceipt !== false,
    vendor: String(raw.vendor ?? "").trim().slice(0, 120),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.date ?? "")) ? raw.date : "",
    subtotal, tax, total, counted,
    currency: /^[A-Za-z]{3}$/.test(String(raw.currency ?? "")) ? String(raw.currency).toUpperCase() : "",
    // Low when Claude says so, or when the figures it read do not add up.
    confidence: agree === false ? "low" : ["high", "medium", "low"].includes(raw.confidence) ? raw.confidence : "low",
    suggestedLine: suggested,
    notes: String(raw.notes ?? "").trim().slice(0, 240),
  };
}

/** Read one receipt. `client` is only passed by tests. Throws with a plain reason. */
export async function readReceipt(bytes, type, lineNames = [], { client = null } = {}) {
  if (!TYPES[type]) throw new Error("That kind of file can't be read. Use a photo (JPEG or PNG) or a PDF.");
  const api = client ?? new Anthropic({ apiKey: anthropicKey() });
  const data = Buffer.from(bytes).toString("base64");
  const file = type === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: type, data } }
    : { type: "image", source: { type: "base64", media_type: type, data } };
  const message = await api.beta.messages.create({
    model: "claude-sonnet-5-5",
    max_tokens: 1500,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: [file, { type: "text", text: `The lines on the statement of work are: ${lineNames.length ? lineNames.join("; ") : "(none yet)"}, and Other. Read this receipt.` }] }],
  });
  if (message.stop_reason === "refusal") throw new Error("Claude declined to read this one.");
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error("Claude's answer could not be read."); }
  return tidy(raw, lineNames);
}

/**
 * What a person confirmed, checked before it is kept. Returns { problem } or { ok }.
 * `lineIds` are the lines of the statement of work; the only other place a receipt can go is "other".
 */
export function cleanConfirm(body, lineIds, payers = null) {
  // Who paid: a board member, so the expense claim they send in later can be matched to the receipt.
  let paidBy = null;
  if (payers) {
    const email = String(body?.paidBy ?? "").trim().toLowerCase();
    const who = payers.find((x) => x.email.toLowerCase() === email);
    if (!who) return { problem: "Pick the board member who paid for this, or who is claiming it." };
    paidBy = { email: who.email.toLowerCase(), name: who.name };
  }
  const lineId = String(body?.lineId ?? "");
  if (lineId !== OTHER && !lineIds.includes(lineId)) return { problem: "Pick which line of the statement of work this receipt belongs to, or Other." };
  const otherNote = String(body?.otherNote ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (lineId === OTHER && !otherNote) return { problem: "For Other, say what it was for." };
  const vendor = String(body?.vendor ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!vendor) return { problem: "Who was it from? Type the vendor's name." };
  const date = String(body?.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { problem: "Give the date on the receipt." };
  const amount = Number(body?.amount);
  if (!(amount >= 0) || !Number.isFinite(amount) || body?.amount === "" || body?.amount === null) return { problem: "Type the amount before tax." };
  const optional = (v) => (v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : money(Number(v)));
  return { ok: { ...(paidBy ? { paidBy } : {}), lineId, otherNote: lineId === OTHER ? otherNote : "", vendor, date, amount: money(amount), tax: optional(body?.tax), total: optional(body?.total), currency: /^[A-Za-z]{3}$/.test(String(body?.currency ?? "")) ? String(body.currency).toUpperCase() : "CAD" } };
}

/** What a line's receipts come to, and what is under Other. */
export function receiptSums(items) {
  const byLine = {};
  let other = 0;
  const notes = [];
  for (const r of items ?? []) {
    if (r.lineId === OTHER) { other = money(other + r.amount); if (r.otherNote && !notes.includes(r.otherNote)) notes.push(r.otherNote); }
    else byLine[r.lineId] = money((byLine[r.lineId] ?? 0) + r.amount);
  }
  return { byLine, other, otherNotes: notes };
}

/** The same vendor, date and total already on this event. */
export const isDuplicate = (items, c) => (items ?? []).some((r) => r.vendor.toLowerCase() === c.vendor.toLowerCase() && r.date === c.date && money(r.total ?? r.amount) === money(c.total ?? c.amount));

/**
 * The SOW with its receipts folded in, for showing and for the invoice PDF (never saved back: the receipts are
 * their own record). Each line gets `receiptsTotal`; whatever is under Other (or against a line since removed) is
 * `receiptsOther`.
 */
export function withReceipts(sow, items) {
  const ids = new Set((sow.lines ?? []).map((l) => l.id));
  const sums = receiptSums((items ?? []).map((r) => (r.lineId === OTHER || ids.has(r.lineId) ? r : { ...r, lineId: OTHER })));
  const count = {};
  for (const r of items ?? []) count[ids.has(r.lineId) ? r.lineId : OTHER] = (count[ids.has(r.lineId) ? r.lineId : OTHER] ?? 0) + 1;
  return {
    ...sow,
    lines: (sow.lines ?? []).map((l) => ({ ...l, receiptsTotal: sums.byLine[l.id] ?? 0, receiptCount: count[l.id] ?? 0 })),
    receiptsOther: sums.other, otherNotes: sums.otherNotes, otherCount: count[OTHER] ?? 0,
  };
}

/**
 * Who a receipt can be attached to. The board members on the event come first; then everyone else on the board,
 * because someone not going (the president paying a hotel deposit, say) still pays for things. Anyone already
 * attached to a receipt stays in the list even if they have since left the roster.
 */
export function payerChoices(event, roster, items = []) {
  const seen = new Map();
  // The roster's spelling of a name wins, so one person is one name everywhere, whatever the event's board says.
  const rosterName = new Map((roster ?? []).map((m) => [String(m.email ?? "").trim().toLowerCase(), m.name]));
  const add = (name, email, onEvent) => {
    const e = String(email ?? "").trim().toLowerCase();
    if (e && !seen.has(e)) seen.set(e, { email: e, name: String(rosterName.get(e) || name || email).trim(), onEvent });
  };
  for (const m of event.board ?? []) add(m.name, m.email, true);
  for (const m of roster ?? []) add(m.name, m.email, false);
  for (const r of items) if (r.paidBy) add(r.paidBy.name, r.paidBy.email, false);
  return [...seen.values()];
}

/** What each person has paid, so the claims can be checked against it: the total paid (tax included) and the part that counts. */
export function paidByPerson(items) {
  const m = new Map();
  for (const r of items ?? []) {
    const k = r.paidBy?.email ?? "";
    const x = m.get(k) ?? { email: k, name: r.paidBy?.name ?? "(nobody named)", count: 0, paid: 0, counted: 0 };
    x.count++; x.counted = money(x.counted + r.amount);
    x.paid = money(x.paid + (r.total ?? money(r.amount + (r.tax ?? 0))));
    m.set(k, x);
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
}
