import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { anthropicKey } from "./contract.mjs";

/**
 * Fill in and sign a hotel contract (Andrew 17 Nov 2026: "I want to fill in and sign it via the app … when I want to
 * sign and add bonvoy, claude does it"). The contract's lines are read with where each sits on its page; Claude says
 * which line is which blank (the Bonvoy member name and number, the box saying he can receive points, the signer's
 * name, signature, title and date, the electronic-signature box, any "please initial", the chosen form of payment);
 * the desk writes the values there. The original is never changed: the filled copy is a new file, for Andrew to look
 * over and send to the hotel himself.
 */

/** Every line of text on every page, with its position (PDF points, origin bottom-left). */
export async function pdfLines(bytes) {
  // The worker loaded here, in the same thread: pdfjs then uses it rather than looking for its file at run time, which
  // the deployed function didn't carry (17 Nov 2026: "Cannot find module … pdf.worker.mjs").
  globalThis.pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const { width, height } = page.getViewport({ scale: 1 });
    const items = (await page.getTextContent()).items.filter((i) => typeof i.str === "string" && i.str.length)
      .map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || i.height || 10 }));
    // Items on the same baseline (within 2pt) make one line, left to right.
    const rows = [];
    for (const it of items.sort((a, b) => b.y - a.y || a.x - b.x)) {
      const row = rows.find((r) => Math.abs(r.y - it.y) < 2);
      if (row) row.items.push(it); else rows.push({ y: it.y, items: [it] });
    }
    for (const r of rows) {
      const its = r.items.sort((a, b) => a.x - b.x);
      const text = its.map((i) => i.s).join(" ").replace(/\s+/g, " ").trim();
      if (!text) continue;
      out.push({ id: out.length + 1, page: n, pageW: width, pageH: height, y: r.y, x: its[0].x, x2: Math.max(...its.map((i) => i.x + i.w)), h: Math.max(...its.map((i) => i.h)), text, items: its });
    }
  }
  return out;
}

const FIELDS = ["bonvoyEligible", "memberName", "bonvoyNumber", "bonvoyEmail", "signName", "signature", "signTitle", "signDate", "esignBox", "payment"];
const LINE = { anyOf: [{ type: "integer" }, { type: "null" }] };
const PLACE_SCHEMA = {
  type: "object", additionalProperties: false,
  required: [...FIELDS, "initials", "paymentOptions", "notes"],
  properties: {
    ...Object.fromEntries(FIELDS.filter((f) => f !== "payment").map((f) => [f, LINE])),
    payment: LINE,
    initials: { type: "array", items: { type: "integer" } },
    paymentOptions: { type: "array", items: { type: "object", additionalProperties: false, required: ["line", "kind"], properties: { line: { type: "integer" }, kind: { type: "string", enum: ["cash", "card", "cheque", "other"] } } } },
    notes: { type: "string" },
  },
};
const PLACE_SYSTEM = `You help fill in a hotel group contract for ONGIA, a Canadian non-profit. You are given the contract's lines of text, each with an id, its page, and where it sits. Say which line holds each blank that ONGIA's signer fills in, by its id, or null if the contract has no such blank or it is already filled in.

- bonvoyEligible: the checkbox line saying the contact is eligible to receive Marriott Bonvoy points (not the one declining them).
- memberName: the "Member Name" line in the Bonvoy section.
- bonvoyNumber: the "Marriott Bonvoy Membership Number" (or loyalty number) line.
- bonvoyEmail: a line asking for the email on the Bonvoy account, if there is one.
- signName, signature, signTitle, signDate: ONGIA's (the group's or customer's) name, signature, title and date lines in the acceptance or signature block. Never the hotel's.
- esignBox: ONGIA's "Electronic Signature … replace empty box" line, if there is one. Never the hotel's.
- initials: every line asking ONGIA to initial ("please initial", "Initials ____").
- paymentOptions: each checkbox line for ONGIA's form of payment, with its kind (cash, card, cheque for cheque or EFT or bank transfer, other).
- payment: null (it is chosen later).

Only choose lines that are blanks to fill: a label followed by an empty line, underscores, or an empty box. If a blank already has something written in it, use null. Say anything odd briefly in "notes".`;

/** Which line is which blank, from Claude. `client` is for tests. */
export async function locateFields(lines, { client = null } = {}) {
  const api = client ?? new Anthropic({ apiKey: anthropicKey() });
  const listing = lines.map((l) => `${l.id}\tp${l.page}\tx${Math.round(l.x)}\ty${Math.round(l.y)}\t${l.text.slice(0, 200)}`).join("\n");
  const message = await api.messages.create({
    model: "claude-sonnet-5-5", max_tokens: 4000,
    output_config: { format: { type: "json_schema", schema: PLACE_SCHEMA } },
    system: PLACE_SYSTEM,
    messages: [{ role: "user", content: `The contract's lines (id, page, x, y from the bottom, text):\n${listing}` }],
  });
  if (message.stop_reason === "refusal") throw new Error("Claude wouldn't place the fields on this contract.");
  const raw = JSON.parse(message.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
  const byId = new Map(lines.map((l) => [l.id, l]));
  const one = (id) => (Number.isInteger(id) && byId.has(id) ? id : null);
  return {
    ...Object.fromEntries(FIELDS.map((f) => [f, one(raw[f])])),
    initials: [...new Set((raw.initials ?? []).filter((id) => byId.has(id)))],
    paymentOptions: (raw.paymentOptions ?? []).filter((o) => byId.has(o.line)),
    notes: String(raw.notes ?? "").slice(0, 400),
  };
}

// Where to write on a line: at the start of its blank (underscores), else just past the label; a box is ticked where it is.
const BOX = /[□☐❏▢❑❎▯]|^\s*\[\s*\]/;
function spot(line) {
  const under = line.items.find((i) => /_{3,}/.test(i.s));
  if (under) { const k = under.s.indexOf("_"); return { x: under.x + (k / Math.max(1, under.s.length)) * under.w + 3, y: line.y + 2 }; }
  return { x: line.x2 + 8, y: line.y };
}
// A box drawn in a symbol font (Wingdings' "q" comes through as U+F071) is a one-character item with no letter in it.
const lone = (i) => { const t = i.s.trim(); return [...t].length === 1 && !/[\p{L}\p{N}(),.:;*“”"'’-]/u.test(t); };
function boxSpot(line) {
  // "[ ]": the X goes between the brackets.
  const br = line.items.find((i) => /\[\s*\]/.test(i.s));
  if (br) { const cw = br.w / Math.max(1, br.s.length), k = br.s.indexOf("["); return { x: br.x + (k + 0.75) * cw, y: br.y, h: br.h }; }
  const box = line.items.find((i) => BOX.test(i.s)) ?? [...line.items].reverse().find(lone);
  if (box) { const k = Math.max(0, box.s.search(/\S/)); return { x: box.x + (k / Math.max(1, box.s.length)) * box.w + box.w * 0.12, y: box.y + 0.5, h: box.h }; }
  return { x: line.x2 + 4, y: line.y, h: line.h };
}

/**
 * The filled-in copy. `values`: { name, title, date, number, email, initials, payment }; `signature`: PNG bytes of
 * Andrew's signature, or null. Returns { bytes, filled: [what was written, for the screen] }.
 */
export async function fillContract(bytes, lines, placed, values, signature = null) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const ink = rgb(0.05, 0.1, 0.35);
  const byId = new Map(lines.map((l) => [l.id, l]));
  const filled = [];
  const write = (id, text, what) => {
    const l = byId.get(id); if (!l || !text) return;
    const p = spot(l);
    pages[l.page - 1].drawText(String(text), { x: p.x, y: p.y, size: Math.min(11, Math.max(8, l.h)), font, color: ink });
    filled.push({ what, page: l.page, text: String(text) });
  };
  const tick = (id, what) => {
    const l = byId.get(id); if (!l) return;
    const b = boxSpot(l), s = Math.max(7, Math.min(11, b.h));
    pages[l.page - 1].drawText("X", { x: b.x + 0.5, y: b.y, size: s, font, color: ink });
    filled.push({ what, page: l.page, text: "X" });
  };
  if (values.number) { tick(placed.bonvoyEligible, "Eligible for Bonvoy points"); write(placed.memberName, values.name, "Bonvoy member name"); write(placed.bonvoyNumber, values.number, "Bonvoy number"); write(placed.bonvoyEmail, values.email, "Bonvoy email"); }
  // The signature block's lines are often drawn rules with no underscores: everything in it starts in one column, the
  // furthest any of its labels reaches, so "Date:" doesn't write short of where "Name: (Print)" does.
  const block = [placed.signName, placed.signature, placed.signTitle, placed.signDate].map((id) => byId.get(id)).filter(Boolean);
  const col = block.length ? Math.max(...block.map((l) => spot(l).x)) : null;
  if (col) for (const l of block) byId.set(l.id, { ...l, items: [], x2: col - 8 });
  write(placed.signName, values.name, "Name");
  write(placed.signTitle, values.title, "Title");
  write(placed.signDate, values.date, "Date");
  // "______ please initial": the blank is the line just before the words, so the initials go there.
  for (const id of placed.initials) {
    const l = byId.get(id), pi = l?.items.find((i) => /^\s*please\s+initial/i.test(i.s));
    if (pi) { pages[l.page - 1].drawText(String(values.initials), { x: Math.max(l.x, pi.x - 40), y: l.y + 1, size: 10, font, color: ink }); filled.push({ what: "Initials", page: l.page, text: String(values.initials) }); }
    else write(id, values.initials, "Initials");
  }
  if (values.payment) { const o = placed.paymentOptions.find((x) => x.kind === values.payment); if (o) tick(o.line, `Form of payment: ${values.payment}`); }
  // The signature: his handwriting where a signature line is; the electronic-signature box ticked.
  if (placed.signature && signature) {
    const l = byId.get(placed.signature), p = spot(l);
    const img = await pdf.embedPng(signature);
    // As tall as the room above the line allows (up to 26pt), so it never rides into the line above.
    const above = lines.filter((x) => x.page === l.page && x.y > l.y + 2).reduce((m, x) => Math.min(m, x.y - l.y), 999);
    const h = Math.max(14, Math.min(26, above - 6)), w = (img.width / img.height) * h;
    pages[l.page - 1].drawImage(img, { x: p.x, y: l.y - 4, width: Math.min(w, 170), height: Math.min(w, 170) === w ? h : (170 / w) * h });
    filled.push({ what: "Signature", page: l.page, text: "signed" });
  } else if (placed.signature) write(placed.signature, values.name, "Signature (typed)");
  if (placed.esignBox) tick(placed.esignBox, "Electronic signature box");
  return { bytes: Buffer.from(await pdf.save()), filled };
}
