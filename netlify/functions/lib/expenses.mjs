import { createHmac, createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { anthropicKey } from "./contract.mjs";
import { tokensMatch } from "./ids.mjs";
import { readSession } from "./auth.mjs";
import { todayIso } from "./deadlines.mjs";

/**
 * ONGIA Expenses (Andrew, Nov 2026): a board member's expense claims, in an app of its own on the phone. Receipts are
 * kept the moment they are photographed, a claim builds over days with a running total, and nothing is sent until
 * Submit. Claude reads the vendor, the date and the total off each receipt and the person checks them; a line is
 * green when what is claimed matches the receipt.
 *
 * Three kinds of line:
 *   receipt    a photo or a PDF of the receipt
 *   mileage    typed in by hand: kilometres at the mileage rate ($0.62/km), paid to the board member
 *   noreceipt  a written statement of why there is no receipt, with a screenshot of the card statement
 *
 * Who signs off (Andrew, 2 Nov 2026): a board member's claim, and the VP's, go to the President and the Treasurer; the
 * President's to the VP and the Treasurer; the Treasurer's to the President and the VP. Nobody approves their own.
 */

/** The ten categories on ONGIA's expense claim template, in its order and its words. */
export const CATEGORIES = [
  [1, "Advertising & Promotion"], [2, "Donations"], [3, "Insurance"], [4, "Memberships"], [5, "Officer & General"],
  [6, "Professional Fees"], [7, "Training & Development"], [8, "Travel"], [9, "Interest & Bank Charges"], [10, "Speaker Stipend"],
];
export const categoryName = (n) => CATEGORIES.find(([k]) => k === Number(n))?.[1] ?? "";
export const TRAVEL = 8;
/**
 * A speaker stipend is paid by ONGIA, not spent by the member: there is no receipt, card charge or reason to show
 * (Andrew, 3 Nov 2026: "Any receipt line for stipend, does not need a reason nor an upload or screenshot").
 */
export const STIPEND = 10;
export const isStipend = (l) => Number(l?.category) === STIPEND;
/**
 * The HST in a line (Andrew, 3 Nov 2026, over the template's 13% of every amount, which put $130 of HST on a $1,000
 * stipend and overstated every receipt): none on mileage or a speaker stipend, and on anything bought, the tax already
 * inside the total, amount × 13 ÷ 113.
 */
export const HST_RATE = 13;
export const noHst = (l) => l?.kind === "mileage" || isStipend(l);
export const hstOf = (l) => (noHst(l) || !Number.isFinite(Number(l?.amount)) ? 0 : Math.round(Number(l.amount) * HST_RATE / (100 + HST_RATE) * 100) / 100);

/** Dollars per kilometre. EXPENSE_MILEAGE_RATE replaces it if the board changes the rate. */
export function mileageRate() {
  const r = Number(process.env.EXPENSE_MILEAGE_RATE);
  return Number.isFinite(r) && r > 0 && r < 5 ? r : 0.62;
}

export const money = (n) => Math.round(Number(n) * 100) / 100;
const lc = (v) => String(v ?? "").trim().toLowerCase();

/* ---------- who is who ---------- */

const first = (v, fallback) => String(v || fallback).split(/[,\s]+/).map(lc).filter(Boolean)[0];
/**
 * The three officers who sign off, by ONGIA's role mailboxes, which pass from one officer to the next. Each can be
 * replaced by its own setting if a mailbox ever changes. (Deliberately not DESK_OWNERS: that is a list, and which of
 * its addresses is the President would depend on the order someone typed them in.)
 */
export function officers() {
  return {
    president: first(process.env.EXPENSE_PRESIDENT, "president@ongia.ca"),
    vp: first(process.env.EXPENSE_VP, "vp_operations@ongia.ca"),
    treasurer: first(process.env.EXPENSE_TREASURER, "treasurer@ongia.ca"),
  };
}
export const ROLE_TITLE = { president: "President", vp: "VP of Operations", treasurer: "Treasurer", member: "Board member" };
export function roleOf(email) {
  const e = lc(email), o = officers();
  return e === o.president ? "president" : e === o.vp ? "vp" : e === o.treasurer ? "treasurer" : "member";
}
/** The two officers a claim goes to, by role. Never the person claiming. */
export function approversFor(email) {
  const role = roleOf(email);
  if (role === "president") return ["vp", "treasurer"];
  if (role === "treasurer") return ["president", "vp"];
  return ["president", "treasurer"];
}
/** Anyone on the board roster may claim, and the three officers always may. */
export function mayClaim(email, roster) {
  const e = lc(email);
  if (!e) return false;
  if (roleOf(e) !== "member") return true;
  return (roster ?? []).some((m) => lc(m.email) === e);
}
/** The name the board roster gives someone, else what Microsoft said. */
export const rosterName = (email, roster, fallback = "") => (roster ?? []).find((m) => lc(m.email) === lc(email))?.name || fallback || email;

/** A short, stable stand-in for an address, for record keys (an address is not a good key: it has dots, @ and case). */
export const whoKey = (email) => createHash("sha256").update(lc(email)).digest("hex").slice(0, 16);

/* ---------- sign-in ---------- */

/**
 * The expense app keeps its own session: 30 days, so a phone app opened at a hotel counter does not ask for a Microsoft
 * sign-in every time. It is NOT a desk session: requireAdmin refuses it, so it opens expense claims and nothing else.
 * Every request still checks the person is on the board roster, so taking someone off the roster ends it at once.
 */
const SESSION_DAYS = 30;
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const sessionKey = () => createHmac("sha256", String(process.env.ADMIN_KEY ?? "")).update("expense-session-v1").digest();
const sign = (body) => createHmac("sha256", sessionKey()).update(body).digest("base64url");

export function issueExpenseSession({ email, name }, now = Date.now()) {
  const body = b64u(JSON.stringify({ e: lc(email), n: String(name ?? ""), x: now + SESSION_DAYS * 86400e3 }));
  return `x1.${body}.${sign(body)}`;
}
export function readExpenseSession(value, now = Date.now()) {
  if (!process.env.ADMIN_KEY) return null;
  const [tag, body, mac] = String(value ?? "").split(".");
  if (tag !== "x1" || !body || !mac || !tokensMatch(mac, sign(body))) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
  if (!p?.e || !(p.x > now)) return null;
  return { email: p.e, name: p.n, expires: p.x };
}
/** The person behind a request: an expense session, or a Briefing Room session. The shared desk key is nobody, so it gets nothing. */
export function expenseWho(req) {
  const v = req.headers.get("x-expense-key") ?? "";
  if (v.startsWith("x1.")) return readExpenseSession(v);
  if (v.startsWith("s1.")) { const s = readSession(v); return s ? { email: s.email, name: s.name, expires: s.expires } : null; }
  return null;
}

/* ---------- lines ---------- */

export const KINDS = ["receipt", "mileage", "noreceipt"];
const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) && !Number.isNaN(Date.parse(v)) ? String(v) : "");
const amountOf = (v) => (v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : money(Number(v)));

/**
 * What a person typed into a line, tidied. Lenient on purpose: a claim is saved as it is built, so a line can be kept
 * half-filled and finished later. What is still missing is listed by lineProblems, and only Submit insists.
 * `events` are the ones a line may name (id → title).
 */
export function cleanLine(kind, body, { events = [], rate = mileageRate() } = {}) {
  const ev = events.find((e) => e.id === String(body?.eventId ?? ""));
  const out = {
    date: isoDate(body?.date),
    category: CATEGORIES.some(([k]) => k === Number(body?.category)) ? Number(body.category) : null,
    eventId: ev ? ev.id : "", eventTitle: ev ? ev.title : "",
    purpose: str(body?.purpose, 240),
  };
  if (kind === "mileage") {
    const km = Number(body?.km);
    out.km = Number.isFinite(km) && km > 0 ? Math.min(Math.round(km * 10) / 10, 10000) : null;
    out.from = str(body?.from, 120); out.to = str(body?.to, 120);
    out.rate = Number(body?.rate) > 0 ? Number(body.rate) : rate;
    out.amount = out.km ? money(out.km * out.rate) : null;
    if (out.category === null) out.category = TRAVEL;
  } else {
    out.paidTo = str(body?.paidTo, 120);
    out.amount = amountOf(body?.amount);
  }
  if (kind === "noreceipt") out.statement = String(body?.statement ?? "").replace(/[ \t]+/g, " ").trim().slice(0, 1500);
  return out;
}

/**
 * A line as the app shows it: what the person saved, with any box they have left empty filled from what Claude read
 * off the receipt (`fromRead` names those boxes). Nothing Claude read ever replaces something a person typed.
 */
export function viewLine(line, read) {
  const v = { ...line, fromRead: [] };
  const f = read?.state === "done" ? read.found : null;
  if (line.kind === "receipt" && f?.isReceipt !== false && f) {
    const fill = (k, val) => { if ((v[k] === "" || v[k] === null || v[k] === undefined) && val !== "" && val !== null && val !== undefined) { v[k] = val; v.fromRead.push(k); } };
    fill("paidTo", f.vendor); fill("date", f.date); fill("amount", f.total); fill("category", f.category); fill("purpose", f.what);
  }
  v.check = receiptCheck(v, read);
  v.problems = lineProblems(v);
  return v;
}

/**
 * Does the amount claimed match the receipt? "match" is the green tick. "differs" says what the receipt shows.
 * Mileage and no-receipt lines have nothing to match, and say what stands in for a receipt instead.
 */
export function receiptCheck(line, read) {
  if (line.kind === "mileage") return { state: "mileage" };
  if (line.kind === "noreceipt" && isStipend(line)) return { state: "stipend" };
  if (line.kind === "noreceipt") return { state: line.shot && String(line.statement ?? "").trim().length >= MIN_REASON ? "statement" : "statement-missing" };
  if (!line.file) return { state: "nofile" };
  if (!read || read.state === "reading") return { state: "reading" };
  if (read.state === "failed") return { state: "unread", why: read.why };
  const f = read.found;
  if (f?.isReceipt === false) return { state: "notreceipt" };
  if (f?.total === null || f?.total === undefined) return { state: "nototal" };
  if (line.amount === null || line.amount === undefined) return { state: "noamount", total: f.total };
  const foreign = f.currency && f.currency !== "CAD" ? f.currency : "";
  if (Math.abs(money(line.amount) - money(f.total)) < 0.005) return { state: "match", total: f.total, ...(foreign ? { currency: foreign } : {}) };
  return { state: "differs", total: f.total, ...(foreign ? { currency: foreign } : {}) };
}

/**
 * A reason for no receipt counts from 3 characters: "Lost it" was taken as no reason at all at 10, with nothing saying
 * why (Andrew, 3 Nov 2026). The approvers judge whether it is enough, as they do a reason for sending a claim back.
 */
export const MIN_REASON = 3;
/** "a, b and c": a list a person reads as a sentence. */
export const andList = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** What a line still needs before the claim can go for approval, in words the person can act on. */
export function lineProblems(v) {
  const p = [];
  if (v.kind === "receipt" && !v.file) p.push("the receipt");
  if (v.kind !== "mileage" && !v.paidTo) p.push("who it was paid to");
  if (!v.date) p.push("the date");
  if (v.kind === "mileage") {
    if (!v.km) p.push("the kilometres");
    if (!v.from || !v.to) p.push("where from and to");
  } else if (!(v.amount > 0)) p.push("the amount");
  if (!v.category) p.push("a category");
  if (!v.purpose && !v.eventId) p.push("what it was for");
  if (v.kind === "noreceipt" && !isStipend(v)) {
    if (String(v.statement ?? "").trim().length < MIN_REASON) p.push("a reason there's no receipt");
    if (!v.shot) p.push("a screenshot of the card statement");
  }
  return p;
}

/** The claim's total and counts, from its lines as shown. */
export function claimSums(lines) {
  const total = money((lines ?? []).reduce((n, l) => n + (Number(l.amount) || 0), 0));
  const count = (k) => (lines ?? []).filter((l) => l.kind === k).length;
  return { total, lines: (lines ?? []).length, receipts: count("receipt"), mileage: count("mileage"), noreceipt: count("noreceipt") };
}

/** "November 2026" for a date, in Toronto time: the month a claim is filed under. */
export function monthLabel(iso = todayIso()) {
  const [y, m] = String(iso).split("-").map(Number);
  return `${new Date(Date.UTC(y, m - 1, 15)).toLocaleString("en-CA", { month: "long", timeZone: "UTC" })} ${y}`;
}

/** Events a line can name: recent and coming ones, never a practice event. Newest first. */
export function eventChoices(events, today = todayIso()) {
  const day = (d) => Date.parse(`${d}T12:00:00Z`);
  const t = day(today);
  return (events ?? [])
    .filter((e) => !e.practice && e.dayOne && day(e.dayOne) >= t - 200 * 86400e3 && day(e.dayOne) <= t + 120 * 86400e3)
    .sort((a, b) => String(b.dayOne).localeCompare(String(a.dayOne)))
    .map((e) => ({ id: e.id, title: String(e.title ?? "").trim() || e.id, date: e.dayOne, city: e.city ?? "" }));
}

/* ---------- reading a receipt ---------- */

export const MAX_BYTES = 5 * 1024 * 1024;
export const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf" };
export const SHOT_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf" };

const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["isReceipt", "vendor", "date", "total", "tax", "currency", "category", "what", "confidence", "notes"],
  properties: {
    isReceipt: { type: "boolean" },
    vendor: nullable({ type: "string" }),
    date: nullable({ type: "string", format: "date" }),
    total: nullable({ type: "number" }),
    tax: nullable({ type: "number" }),
    currency: nullable({ type: "string" }),
    category: nullable({ type: "integer", enum: CATEGORIES.map(([k]) => k) }),
    what: nullable({ type: "string" }),
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    notes: nullable({ type: "string" }),
  },
};

const SYSTEM = `You read one receipt or invoice, shown as a photo or a PDF, for a board member's expense claim at ONGIA, a Canadian non-profit.
Report only what is printed on it. If something is not there, say null rather than guessing.
- vendor: the business's name as a person would write it (e.g. "Delta Hotels", not the legal entity).
- date: the purchase date (the invoice date for an invoice; the check-out date for a hotel folio), as YYYY-MM-DD.
- total: the amount actually charged, with tax and any tip. On a hotel folio, the balance charged to the card.
- tax: all sales tax together (HST, GST, QST, PST), or null.
- currency: the three-letter code if printed or clear from the symbol (CAD, USD...), else null. A Canadian address with $ is CAD.
- category: the best fit from ONGIA's list, by number:
  1 Advertising & Promotion (promotional items, ads, gifts and gift cards)
  2 Donations
  3 Insurance
  4 Memberships
  5 Officer & General (office supplies, printing, postage, meeting refreshments)
  6 Professional Fees (accounting, legal)
  7 Training & Development (courses, conference registrations)
  8 Travel (hotels, flights, trains, taxis and rideshare, parking, car rental, fuel, meals while travelling)
  9 Interest & Bank Charges
  10 Speaker Stipend (payment to a presenter)
- what: what was bought, in four words or fewer, plain and lower-key ("Hotel, 3 nights", "Airport parking", "Taxi").
- confidence: "high" when the figures are sharp and clear; "low" when the picture is blurry, cut off, faded or handwritten.
- notes: one short sentence if anything is odd (a tip written in by hand, a refund, two receipts in one photo, a foreign currency, a date that is hard to read). Otherwise null.
If this is not a receipt or an invoice at all, set isReceipt to false and leave the rest null.`;

/** A reason a person can act on, not an SDK error. */
export function whyItFailed(e) {
  if (e instanceof Anthropic.AuthenticationError) return "Claude couldn't read it this time (the reading service refused the desk's key). Type the details in yourself.";
  if (e instanceof Anthropic.RateLimitError) return "Claude is busy right now. Type the details in, or press Read it again in a minute.";
  if (e instanceof Anthropic.BadRequestError) return "Claude couldn't read that file. Type the details in, or take the photo again.";
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Type the details in, or press Read it again in a minute.";
  return "Claude couldn't read it. Type the details in, or press Read it again.";
}

/** Tidy what Claude said into what a line shows. */
export function tidyRead(raw) {
  const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : money(Number(v)));
  return {
    isReceipt: raw?.isReceipt !== false,
    vendor: str(raw?.vendor, 120),
    date: isoDate(raw?.date),
    total: num(raw?.total), tax: num(raw?.tax),
    currency: /^[A-Za-z]{3}$/.test(String(raw?.currency ?? "")) ? String(raw.currency).toUpperCase() : "",
    category: CATEGORIES.some(([k]) => k === Number(raw?.category)) ? Number(raw.category) : null,
    what: str(raw?.what, 60),
    confidence: ["high", "medium", "low"].includes(raw?.confidence) ? raw.confidence : "low",
    notes: str(raw?.notes, 240),
  };
}

/** Read one receipt. `client` is only passed by tests. Throws; whyItFailed turns that into words. */
export async function readExpenseReceipt(bytes, type, { client = null } = {}) {
  if (!TYPES[type]) throw new Error("That kind of file can't be read.");
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
    messages: [{ role: "user", content: [file, { type: "text", text: "Read this receipt." }] }],
  });
  if (message.stop_reason === "refusal") throw new Error("Claude declined to read this one.");
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error("Claude's answer could not be read."); }
  return tidyRead(raw);
}

/** What the file really is, from its first bytes, whatever the browser called it. */
export function sniff(b) {
  const s = (from, to) => String.fromCharCode(...b.slice(from, to));
  if (s(0, 5) === "%PDF-") return "application/pdf";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && s(1, 4) === "PNG") return "image/png";
  if (s(0, 4) === "GIF8") return "image/gif";
  if (s(0, 4) === "RIFF" && s(8, 12) === "WEBP") return "image/webp";
  return null;
}

/* ---------- the executives, hand-offs, and who holds each sign-off ---------- */

/**
 * The executives an officer may hand their approvals to while away (Andrew, 3 Nov 2026): the President, the VP, the
 * Treasurer, the Executive Officer and the Legal Advisor. Each mailbox can be replaced by its own setting.
 */
export function executives() {
  const o = officers();
  return [
    { email: o.president, title: "President" },
    { email: o.vp, title: "VP of Operations" },
    { email: o.treasurer, title: "Treasurer" },
    { email: first(process.env.EXPENSE_EXEC_OFFICER, "executiveofficer@ongia.ca"), title: "Executive Officer" },
    { email: first(process.env.EXPENSE_LEGAL, "j.healy@ongia.ca"), title: "Legal Advisor" },
  ];
}
export const OFFICER_ROLES = ["president", "vp", "treasurer"];
/** The VP sends the e-transfers and records them (Andrew, 3 Nov 2026), her own claims included, once two others approve. */
export const PAYER = "vp";
export const MAX_AWAY_DAYS = 60;

/** A hand-off in force on `today` (a Toronto date), or null. `from` and `until` are both days away. */
export const inForce = (d, today = todayIso()) => (d?.to && d.from <= today && today <= d.until ? d : null);

/** A hand-off as asked for, checked. Returns { problem } or { ok }. */
export function cleanAway(role, body, today = todayIso()) {
  if (!OFFICER_ROLES.includes(role)) return { problem: "Only the President, the VP and the Treasurer hand off approvals." };
  const me = officers()[role], ex = executives().map((x) => x.email);
  const to = lc(body?.to), backup = lc(body?.backup);
  if (!ex.includes(to) || to === me) return { problem: "Pick who will stand in for you. It has to be one of the executives, and not you." };
  if (backup && (!ex.includes(backup) || backup === me || backup === to)) return { problem: "The second person has to be another executive: not you, and not your stand-in." };
  const from = isoDate(body?.from) || today, until = isoDate(body?.until);
  if (!until) return { problem: "Say the last day you're away." };
  if (until < from) return { problem: "The last day away can't be before the first." };
  if (until < today) return { problem: "Those dates are already over." };
  if ((Date.parse(until) - Date.parse(from)) / 86400e3 + 1 > MAX_AWAY_DAYS) return { problem: `A hand-off can run for up to ${MAX_AWAY_DAYS} days.` };
  return { ok: { role, to, backup: backup || "", from, until } };
}

/** Is this person an officer who is away today? */
const awayToday = (email, aways, today) => OFFICER_ROLES.some((r) => officers()[r] === email && inForce(aways?.[r], today));

/**
 * Who holds each sign-off on a claim today. Always two different people, and never the person claiming. An officer
 * who is away hands theirs to the stand-in they named; when the stand-in can't take this one (it is their own claim,
 * or they already hold the other sign-off) it goes to the second person they named; when neither can, it stays with
 * the officer. A sign-off already given (`decided`, role → { email }) stays with whoever gave it.
 * Each slot: { role, email, for?: the officer's role when a stand-in holds it, done?, stuck? }.
 */
export function holders(ownerEmail, aways = {}, today = todayIso(), decided = {}, { practice = false } = {}) {
  const o = officers(), owner = lc(ownerEmail);
  // A test claim is practice (Andrew, 3 Nov 2026: "how do I send to myself for testing so I can see how it functions"):
  // every sign-off comes back to the person who made it, one role at a time, so they can try each step alone. A real
  // claim never does: two real approvers, never the claimant.
  if (practice) return approversFor(owner).map((role) => (decided[role]?.email ? { role, email: decided[role].email, done: true, practice: true } : { role, email: owner, practice: true }));
  const slots = approversFor(owner).map((role) => ({ role }));
  const taken = new Set([owner]);
  for (const s of slots) if (decided[s.role]?.email) { s.email = decided[s.role].email; s.done = true; if (decided[s.role].for) s.for = s.role; taken.add(s.email); }
  for (const s of slots) if (!s.done && !inForce(aways[s.role], today)) { s.email = o[s.role]; taken.add(s.email); }
  for (const s of slots) if (!s.done && !s.email) {
    const d = inForce(aways[s.role], today);
    const pick = [d.to, d.backup].filter(Boolean).find((e) => !taken.has(e) && !awayToday(e, aways, today));
    if (pick) { s.email = pick; s.for = s.role; } else { s.email = o[s.role]; s.stuck = true; }
    taken.add(s.email);
  }
  return slots;
}

/** Who records the payment on a claim today: the VP, or while she's away her stand-in (never on their own claim), else her second person. */
export function payerOf(ownerEmail, aways = {}, today = todayIso(), { practice = false } = {}) {
  if (practice) return { email: lc(ownerEmail), practice: true };   // a test claim: its maker records the pretend payment
  const vp = officers()[PAYER];
  const d = inForce(aways[PAYER], today);
  if (!d) return { email: vp };
  const pick = [d.to, d.backup].filter(Boolean).find((e) => e !== lc(ownerEmail) && !awayToday(e, aways, today));
  return pick ? { email: pick, for: PAYER } : { email: vp, stuck: true };
}

/**
 * What a hand-off would do, before it is saved: for each kind of claim the officer signs off, who takes it. `names`
 * maps an address to a name. Returns [{ label, email, stuck }].
 */
export function awayPreview(role, d, aways = {}, today = todayIso(), names = (e) => e) {
  const o = officers();
  const all = { ...aways, [role]: { ...d, from: today, until: today } };
  const rows = [];
  const kinds = [["member", "Board members' claims", "someone@board.invalid"], ...OFFICER_ROLES.filter((r) => r !== role).map((r) => [r, `${names(o[r])}'s claims`, o[r]])];
  // A stand-in or second person who isn't an officer claims like any board member: their own claims are a kind of their own.
  for (const e of [d.to, d.backup].filter(Boolean)) if (roleOf(e) === "member") kinds.push([e, `${names(e)}'s own claims`, e]);
  for (const [kind, label, owner] of kinds) {
    if (!approversFor(owner).includes(role)) continue;
    const s = holders(owner, all, today).find((x) => x.role === role);
    // A stand-in's own claims get a row only when they go somewhere other than every board member's do.
    if (kind.includes("@") && rows[0] && rows[0].email === s.email) continue;
    rows.push({ label, email: s.email, stuck: !!s.stuck });
  }
  if (role === PAYER) {
    const p = payerOf("someone@board.invalid", all, today);
    rows.push({ label: "Recording payments", email: p.email, stuck: !!p.stuck });
    for (const e of [d.to, d.backup].filter(Boolean)) {
      const q = payerOf(e, all, today);
      if (q.email !== p.email) rows.push({ label: `Paying ${names(e)}'s own claims`, email: q.email, stuck: !!q.stuck });
    }
  }
  return rows;
}

/* ---------- checking a claim before it goes, and for the approvers ---------- */

/** "Nov 1": how a date reads in a sentence. */
export const shortDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }) : String(iso ?? ""));
const sameLine = (a, b) => lc(a.paidTo) === lc(b.paidTo) && a.date === b.date && money(a.amount) === money(b.amount);

/** What stops a claim from being sent. Lines are as shown (viewLine). */
export function submitProblems(lines, today = todayIso()) {
  if (!lines?.length) return ["Add a receipt, mileage or a line with no receipt first."];
  const p = [];
  // A day's grace past Toronto's date: late in the evening it is already tomorrow in Halifax.
  const latest = new Date(Date.parse(`${today}T12:00:00Z`) + 86400e3).toISOString().slice(0, 10);
  for (const l of lines) if (l.date && l.date > latest) p.push(`${l.paidTo || (l.kind === "mileage" ? "A mileage line" : "A line")} is dated ${shortDate(l.date)}, which hasn't come yet. Check the date.`);
  if (lines.some((l) => l.check?.state === "reading")) p.push("Claude is still reading a receipt. Give it a moment.");
  for (const l of lines) if (l.problems?.length) p.push(`${l.paidTo || (l.kind === "mileage" ? "A mileage line" : "A line")}${l.date ? ` (${shortDate(l.date)})` : ""} still needs ${andList(l.problems)}.`);
  const seen = [];
  for (const l of lines) { if (seen.some((s) => sameLine(s, l))) p.push(`${l.paidTo}, ${shortDate(l.date)}, ${dollars(l.amount)} is on this claim twice.`); seen.push(l); }
  return p;
}

/**
 * Claude's check, for the person approving: every receipt against what's claimed, the same receipt claimed before,
 * dates outside the claim's month, foreign currency. `earlier` are lines on the person's other sent claims.
 * { ok: true } when there is nothing to look at; otherwise { ok: false, notes: [...] }.
 */
export function claimChecks(lines, { month = "", earlier = [] } = {}) {
  const notes = [];
  const receipts = lines.filter((l) => l.kind === "receipt");
  const matched = receipts.filter((l) => l.check?.state === "match").length;
  for (const l of receipts) {
    const c = l.check ?? {};
    if (c.state === "differs") notes.push(`${l.paidTo}: the receipt says ${dollars(c.total)}, and ${dollars(l.amount)} is claimed.`);
    else if (c.state !== "match") notes.push(`${l.paidTo || "A receipt"}: Claude couldn't check it against the receipt. Look at the photo.`);
    if (c.currency) notes.push(`${l.paidTo}: the receipt is in ${c.currency}. Check that ${dollars(l.amount)} is what the card was charged in Canadian dollars.`);
  }
  // A card statement isn't read, so a no-receipt line's amount is unconfirmed: flagged for the approvers to look at, never
  // a reason to refuse the claim (Andrew, 3 Nov 2026: "don't reject it ... flag it as unverified amount"). Without this the
  // check said "everything checks out" though no one had compared the amount.
  for (const l of lines) if (l.kind === "noreceipt" && !isStipend(l)) notes.push(`${l.paidTo || "A line with no receipt"}: no receipt, so ${dollars(l.amount)} isn't confirmed. Check it against the card statement.`);
  for (const l of lines) if (earlier.some((e) => sameLine(e, l))) notes.push(`${l.paidTo || "A line"}, ${shortDate(l.date)}, ${dollars(l.amount)}: the same amount to the same place on the same day was claimed before.`);
  const [mName, mYear] = String(month).split(" ");
  const mIdx = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].indexOf(mName);
  if (mIdx >= 0) {
    // An item forgotten from last month is normal (Andrew's own October claim had one from September); older is worth a look.
    const start = Date.parse(`${mYear}-${String(mIdx + 1).padStart(2, "0")}-01`);
    for (const l of lines) if (l.date && Date.parse(l.date) < start - 62 * 86400e3) notes.push(`${l.paidTo || "A line"} is dated ${shortDate(l.date)} ${l.date.slice(0, 4)}, more than two months before ${month}.`);
  }
  const noRec = lines.filter((l) => l.kind === "noreceipt" && !isStipend(l));
  const stipends = lines.filter((l) => l.kind === "noreceipt" && isStipend(l));
  const miles = lines.filter((l) => l.kind === "mileage");
  const rate = miles[0]?.rate ?? mileageRate();
  const summary = [
    receipts.length ? (matched === receipts.length ? (receipts.length === 1 ? "The receipt matches what's claimed" : `All ${receipts.length} receipts match what's claimed`) : `${matched} of ${receipts.length} receipts match what's claimed`) : "",
    miles.length ? `Mileage is at ${dollars(rate)} a kilometre` : "",
    noRec.length ? (noRec.length === 1 ? "The line with no receipt has a reason and the card statement" : `The ${noRec.length} lines with no receipt each have a reason and the card statement`) : "",
    stipends.length ? (stipends.length === 1 ? "The speaker stipend needs no receipt" : `The ${stipends.length} speaker stipends need no receipt`) : "",
  ].filter(Boolean);
  return { ok: notes.length === 0, notes, summary };
}
const dollars = (n) => `$${money(n).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export { dollars };

/** What a claim is waiting for, in words for its list row. */
export function statusWords(c) {
  return { draft: "Not sent yet", submitted: "Waiting for approval", rejected: "Sent back", approved: "Approved, waiting for payment", paid: "Paid" }[c.status] ?? c.status;
}
