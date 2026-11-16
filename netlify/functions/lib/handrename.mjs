import Anthropic from "@anthropic-ai/sdk";
import { anthropicKey } from "./contract.mjs";
import { safeFileName } from "./ids.mjs";

/**
 * Names for the board's own expense files, filed by hand before the Briefing Room (Andrew 16 Nov 2026: "rename all of
 * them. Also, name the receipts … to correspond to which claim and last name and merchant"; 2025 and 2026 only).
 *
 *   A claim form:  "Hammond Andrew - Expense claim - October 2026.xlsx"
 *   A receipt:     "Hammond - Oct 2026 claim - Delta Hotels $658.12.jpg"
 *
 * The folders don't follow one pattern ("11. Nov 2026", "Calgary", "Calgary Presenters Per Diem/Shawn Kane"), so Claude
 * reads each file with its folder path and says whose it is, which claim, and for a receipt the merchant and amount.
 * Anything it can't place keeps its name.
 */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const READABLE = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", pdf: "application/pdf" };

const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["kind", "last", "first", "month", "event", "what", "merchant", "amount"],
  properties: {
    kind: { type: "string", enum: ["claim", "receipt", "other"] },
    last: { type: "string" }, first: { type: "string" },
    month: { type: ["string", "null"] }, event: { type: ["string", "null"] },
    what: { type: "string" }, merchant: { type: ["string", "null"] }, amount: { type: ["number", "null"] },
  },
};
const SYSTEM = `You help rename the files in ONGIA's board expense folders on SharePoint. ONGIA is a Canadian non-profit; board members file expense claims (a spreadsheet or PDF form) with their receipts, in folders by year, member and month or event.
You are given one file's full folder path and name, and for a receipt or invoice its picture or PDF. Say:
- kind: "claim" for a claim form or claim spreadsheet (including stipend, honorarium or per diem claims and their PDF copies); "receipt" for a receipt, invoice, booking confirmation, folio, statement or anything showing a purchase; "other" for anything else (a blank template, instructions, a photo that isn't a receipt).
- last and first: the person the claim belongs to, from the member folder (e.g. ".../2026/Andrew Hammond/..." is Hammond, Andrew; ".../Calgary Presenters Per Diem/Shawn Kane/..." is Kane, Shawn). Empty strings if no person can be told.
- month: the claim's month as YYYY-MM, from the month folder ("11. Nov 2026" is 2026-11; "January & February 2025" is 2025-01) or else the file name; null if it is filed under an event rather than a month.
- event: when the folder is an event or trip rather than a month ("Calgary", "Strat Weekend Jan 2026", "Kingston 2025", "NGS Expenses"), a short name for it with its year if known, like "Calgary 2025" or "Strat Weekend Jan 2026"; else null.
- what: for a claim, what kind it is in two or three words ("Expense claim", "Stipends", "Per diem", "Honorarium"); else "".
- merchant: for a receipt, the business as a person would write it ("Delta Hotels", "Air Canada", "Petro-Canada"), from what is printed; if you can't see the receipt, from the file name if it plainly names one; else null.
- amount: for a receipt, the total paid as a number, from what is printed; null if you can't see it.
Report only what the path or the file shows. Never guess a person, a month or an amount.`;

/** What Claude says about one file. `bytes` only for a receipt it can see. */
export async function readFileFacts({ path, name }, bytes = null, type = "", { client = null } = {}) {
  const api = client ?? new Anthropic({ apiKey: anthropicKey() });
  const content = [];
  if (bytes && type) {
    const data = Buffer.from(bytes).toString("base64");
    content.push(type === "application/pdf" ? { type: "document", source: { type: "base64", media_type: type, data } } : { type: "image", source: { type: "base64", media_type: type, data } });
  }
  content.push({ type: "text", text: `Folder path: ${path.split("/").slice(0, -1).join("/")}\nFile name: ${name}${bytes ? "" : "\n(The file itself isn't shown.)"}` });
  const message = await api.beta.messages.create({
    model: "claude-sonnet-5-5", max_tokens: 800,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM, messages: [{ role: "user", content }],
  });
  if (message.stop_reason === "refusal") throw new Error("Claude declined to read this one.");
  return JSON.parse(message.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
}

const clean = (s) => safeFileName(String(s ?? "").replace(/[\\/:*?"<>|#%]+/g, " ").replace(/\s+/g, " ").trim(), "");
const extOf = (name) => (String(name).match(/\.([A-Za-z0-9]+)$/)?.[1] ?? "");
const baseOf = (name) => String(name).replace(/\.[A-Za-z0-9]+$/, "");

/** The new name for a file, from what Claude said; null to leave it as it is. */
export function newName(facts, name) {
  const ext = extOf(name), last = clean(facts?.last), first = clean(facts?.first);
  if (!facts || facts.kind === "other" || !last) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(facts.month ?? "");
  const monthLong = m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
  const monthShort = m ? `${MONTHS[Number(m[2]) - 1].slice(0, 3)} ${m[1]}` : "";
  const event = clean(facts.event);
  if (!monthLong && !event) return null;
  if (facts.kind === "claim") {
    return `${[last, first].filter(Boolean).join(" ")} - ${clean(facts.what) || "Expense claim"} - ${monthLong || event}${ext ? `.${ext}` : ""}`;
  }
  const merchant = clean(facts.merchant);
  const amount = Number.isFinite(facts.amount) && facts.amount > 0 ? ` $${facts.amount.toFixed(2)}` : "";
  const tail = merchant ? `${merchant}${amount}` : clean(baseOf(name)) || "receipt";
  return `${last} - ${monthShort || event} claim - ${tail}${ext ? `.${ext}` : ""}`.replace(/\s+/g, " ");
}

/** Within one folder, no two files end up with the same name: the second gets (2), the third (3). */
export function uniqueInFolder(plans, existingNames) {
  const taken = new Map();
  for (const n of existingNames) taken.set(String(n).toLowerCase(), true);
  for (const p of plans) if (p.to) taken.delete(String(p.from).toLowerCase());
  for (const p of plans) {
    if (!p.to) continue;
    let to = p.to, i = 2;
    while (taken.has(to.toLowerCase()) && to.toLowerCase() !== String(p.from).toLowerCase()) to = p.to.replace(/(\.[A-Za-z0-9]+)?$/, (e) => ` (${i++})${e}`);
    p.to = to; taken.set(to.toLowerCase(), true);
  }
  return plans;
}
