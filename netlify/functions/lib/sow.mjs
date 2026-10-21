/**
 * Costing for an RBH event: the statement of work (SOW) and the final invoice.
 *
 * Laid out the way ONGIA's own SOW sheet is (Andrew, 19 Oct 2026):
 *   header lines, each with a total, and an optional free-text description under it;
 *   SUBTOTAL, then ONGIA SERVICE FEE (always 20% of the subtotal), DEPOSIT PAID,
 *   NEW SUBTOTAL, the tax lines for where the event is held, and TOTAL BALANCE DUE.
 *
 * The same lines carry both numbers: `estimate` is the SOW, `actual` the invoice. A line is
 * either a FIXED FEE (the actual is the estimate unless changed) or AT COST (the actual is
 * what the receipts add up to). `actual` is only ever a hand-typed override; blank means "work it out".
 */

export const SERVICE_FEE_RATE = 0.2;
export const STATUSES = ["draft", "submitted", "approved", "invoiced", "paid"];
export const STATUS_WORDS = { draft: "Draft", submitted: "Sent to RBH", approved: "Approved", invoiced: "Invoiced", paid: "Paid" };

/** The lines ONGIA's ITP sheet starts with. */
export const STANDARD_LINES = [
  { name: "Hotel", type: "fixed" },
  { name: "AV", type: "cost" },
  { name: "Dinners", type: "cost" },
  { name: "Transportation", type: "cost" },
  { name: "Via Rail Train Tickets", type: "cost" },
  { name: "On Site Management", type: "fixed" },
  { name: "Presenter Support / Creative Development", type: "fixed" },
  { name: "Pre/Post Event Management", type: "fixed" },
];

/**
 * Other starting points for a statement of work. The Canadian Forum Against Organized Crime (CFAOC) runs one-day
 * forums with their own, longer list of lines (Andrew's sheet "ONGIA RBH 1 Day Training", Victoria tab, 20 Oct 2026).
 * The generic forum template has no rebranding/signage line; the Victoria preset is that sheet as it stands,
 * with its amounts, its notes under each line and the rebranding/signage line, for the December 2026 forum.
 */
const L = (name, type, estimate = 0, description = "") => ({ name, type, estimate, description });
const FORUM_LINES = (withRebrand) => [
  L("Hotel", "cost"), L("Meeting Space", "cost"), L("Hotel F&B", "cost"), L("A/V — Main Conference", "cost"),
  L("On Site Management", "fixed"), L("Pre-Event & Post Management", "fixed"), L("Presenter Support / Creative Development", "fixed"),
  ...(withRebrand ? [L("Rebranding / Signage", "fixed")] : []),
  L("Incidentals", "cost"), L("Gratuities", "cost"),
];
export const TEMPLATES = {
  cfaoc: {
    title: "CFAOC one-day forum",
    blurb: "The forum's lines: hotel, meeting space, hotel F&B, A/V, on-site and pre/post management, presenter support, incidentals, gratuities. Amounts empty.",
    lines: FORUM_LINES(false), note: "",
  },
  "cfaoc-victoria": {
    title: "Victoria forum, December 2026",
    blurb: "Your sheet's Victoria tab as it stands, amounts and notes included, with Rebranding / Signage ($6,000).",
    note: "Based on approx. 70 people",
    lines: [
      L("Hotel", "cost", 4000, "4 rooms × 3 nights $2,500 (about $700 per room for the stay) · 1 suite $1,500"),
      L("Meeting Space", "cost", 2500, "Meeting room rental"),
      L("Hotel F&B", "cost", 17550, "Based on 60 people: continental breakfast $30 each ($1,800) · coffee / breaks $10 each ($600) · lunch $35 each ($2,100) · dinner / cocktails ($9,000) · gratuity 30% ($4,050)"),
      L("A/V — Main Conference", "cost", 5000),
      L("On Site Management", "fixed", 7000, "Event managers / per diems / transportation: flights 3 × $1,000 · on site 3 × $750 / $1,000"),
      L("Pre-Event & Post Management", "fixed", 8400, "Marketing / registrations, certificates / surveys etc."),
      L("Presenter Support / Creative Development", "fixed", 3500),
      L("Rebranding / Signage", "fixed", 6000),
      L("Incidentals", "cost", 4000),
      L("Gratuities", "cost", 0),
    ],
  },
};

/**
 * Sales tax by province, as the standard federal and provincial rates. Provincial sales tax on
 * services (BC, Saskatchewan, Manitoba) has its own rules, so only GST is preset there: add a
 * line if it applies. The tax lines can be edited on every SOW.
 */
export const PROVINCES = {
  AB: { name: "Alberta", taxes: [{ name: "GST", rate: 5 }] },
  BC: { name: "British Columbia", taxes: [{ name: "GST", rate: 5 }] },
  MB: { name: "Manitoba", taxes: [{ name: "GST", rate: 5 }] },
  NB: { name: "New Brunswick", taxes: [{ name: "HST", rate: 15 }] },
  NL: { name: "Newfoundland and Labrador", taxes: [{ name: "HST", rate: 15 }] },
  NS: { name: "Nova Scotia", taxes: [{ name: "HST", rate: 14 }] },
  NT: { name: "Northwest Territories", taxes: [{ name: "GST", rate: 5 }] },
  NU: { name: "Nunavut", taxes: [{ name: "GST", rate: 5 }] },
  ON: { name: "Ontario", taxes: [{ name: "HST", rate: 13 }] },
  PE: { name: "Prince Edward Island", taxes: [{ name: "HST", rate: 15 }] },
  QC: { name: "Quebec", taxes: [{ name: "GST", rate: 5 }, { name: "QST", rate: 9.975 }] },
  SK: { name: "Saskatchewan", taxes: [{ name: "GST", rate: 5 }] },
  YT: { name: "Yukon", taxes: [{ name: "GST", rate: 5 }] },
};
export const provinceTaxes = (code) => (PROVINCES[code]?.taxes ?? []).map((t) => ({ ...t }));

export const money = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

/** What a line comes to. `which` is "estimate" (the SOW) or "actual" (the invoice). */
export function lineAmount(line, which) {
  if (which === "estimate") return money(num(line.estimate) ?? 0);
  const typed = num(line.actual);
  if (typed !== null) return money(typed);
  return money(line.type === "fixed" ? (num(line.estimate) ?? 0) : (num(line.receiptsTotal) ?? 0));
}

/** The whole page of figures for the SOW or the invoice. */
export function totals(sow, which = "estimate") {
  const lines = (sow.lines ?? []).map((l) => ({ id: l.id, amount: lineAmount(l, which) }));
  // "Other" is receipts that fit no line of the SOW. It exists only on the invoice (the SOW has no such line).
  const other = which === "actual" ? money(num(sow.otherActual) ?? num(sow.receiptsOther) ?? 0) : 0;
  const subtotal = money(lines.reduce((n, l) => n + l.amount, 0) + other);
  const fee = money(subtotal * SERVICE_FEE_RATE);
  const deposit = money(num(sow.deposit) ?? 0);
  const newSubtotal = money(subtotal + fee - deposit);
  const base = sow.taxBase === "subtotal" ? subtotal : money(subtotal + fee);
  const taxes = (sow.taxes ?? []).map((t) => ({ name: t.name, rate: Number(t.rate) || 0, amount: money(base * (Number(t.rate) || 0) / 100) }));
  const taxTotal = money(taxes.reduce((n, t) => n + t.amount, 0));
  return { lines, other, subtotal, fee, deposit, newSubtotal, taxBase: base, taxes, taxTotal, total: money(newSubtotal + taxTotal) };
}

/** A first guess at the province from the city, so the tax line starts right; the desk always shows it to be changed. */
const CITY_PROVINCE = [
  [/montr[eé]al|qu[eé]bec|laval|gatineau|sherbrooke|trois-rivi/i, "QC"],
  [/toronto|ottawa|hamilton|london|kingston|mississauga|brampton|windsor|niagara|barrie|sudbury|thunder bay|kitchener|waterloo/i, "ON"],
  [/vancouver|victoria|kelowna|surrey|burnaby|nanaimo/i, "BC"],
  [/calgary|edmonton|red deer|lethbridge/i, "AB"],
  [/winnipeg|brandon/i, "MB"], [/regina|saskatoon/i, "SK"],
  [/halifax|sydney/i, "NS"], [/moncton|fredericton|saint john/i, "NB"], [/st\.? john'?s|corner brook/i, "NL"], [/charlottetown/i, "PE"],
];
export const guessProvince = (city) => CITY_PROVINCE.find(([re]) => re.test(String(city ?? "")))?.[1] ?? "";

/**
 * Under ONGIA's contract with RBH, an invoice that comes to 20% or more above the statement of work needs a
 * written explanation. Compared on the subtotal: the fee and the tax scale with it, so the percentage is the same.
 */
export const INCREASE_LIMIT = 20;
export function increase(sow) {
  const est = totals(sow, "estimate").subtotal, act = totals(sow, "actual").subtotal;
  const pct = est > 0 ? Math.round((act - est) / est * 1000) / 10 : 0;
  return { pct, over: est > 0 && pct >= INCREASE_LIMIT, limit: INCREASE_LIMIT };
}

/**
 * What an RBH event looks like to someone who may not see its costs (anyone but the president and the VP, the
 * event's lead included): the hotel's name, contact and dates stay, because the lead books the rooms; the rate
 * and the notes from the contract go. `hotelCostsHidden` tells the desk why they are blank.
 */
export function redactEvent(event) {
  if (event?.kind !== "rbh") return event;
  return { ...event, hotel: event.hotel ? { ...event.hotel, rate: "", notes: "" } : event.hotel, hotelCostsHidden: true };
}
/** A hotel's offer is a price list: out of sight on an RBH event for anyone who may not see costs. */
export const withoutOffers = (items) => (items ?? []).filter((x) => x.kind !== "offer");

/* ---------- invoice numbers ---------- */
/**
 * What an RBH event's invoice numbers start with, unless someone types another (Andrew, 20 Oct 2026): the ITP
 * trainings use ITP, the Canadian Forum Against Organized Crime uses CFAOC, and every other RBH event RBH.
 */
export function defaultPrefix(title = "") {
  const t = String(title);
  if (/ITP\b|illicit trade/i.test(t)) return "ITP";
  if (/organi[sz]ed crime|\bCFAOC\b/i.test(t)) return "CFAOC";
  return "RBH";
}
export const cleanPrefix = (p) => String(p ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 8) || "RBH";
export const invoiceNumber = (prefix, year, seq) => `${cleanPrefix(prefix)}-${year}-${String(seq).padStart(3, "0")}`;

/* ---------- cleaning what the desk sends ---------- */
const clip = (s, n) => String(s ?? "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, n);
let counter = 0;
const newId = () => `l${Date.now().toString(36)}${(counter++).toString(36)}`;

export function cleanLines(lines, had = []) {
  const known = new Map(had.map((l) => [l.id, l]));
  return (Array.isArray(lines) ? lines : []).slice(0, 60).map((l) => {
    const id = clip(l.id, 40) && known.has(l.id) ? l.id : newId();
    return {
      id,
      name: clip(l.name, 120),
      description: clip(l.description, 400),
      type: l.type === "cost" ? "cost" : "fixed",
      estimate: money(Math.max(0, num(l.estimate) ?? 0)),
      actual: num(l.actual) === null ? null : money(Math.max(0, num(l.actual))),
    };
  }).filter((l) => l.name);
}

export function cleanTaxes(taxes) {
  return (Array.isArray(taxes) ? taxes : []).slice(0, 6)
    .map((t) => ({ name: clip(t.name, 20), rate: Math.min(100, Math.max(0, Number(t.rate) || 0)) })).filter((t) => t.name);
}

/** Dates the status passed through, kept so the page can say when. */
export function stampStatus(sow, status, now = new Date().toISOString()) {
  sow.status = status;
  sow.statusAt = { ...(sow.statusAt ?? {}), [status]: now };
}
// The amounts lock the moment it is sent to RBH (Andrew 21 Oct 2026), not only once RBH approves: what RBH has is what stands.
export const isLocked = (sow) => STATUSES.indexOf(sow.status) >= STATUSES.indexOf("submitted") && !sow.unlocked;

/** The copy RBH was sent: kept when it is marked sent, to say exactly what has changed since. */
export const sentCopy = (sow, at = new Date().toISOString()) => ({ at, lines: sow.lines.map((l) => ({ id: l.id, name: l.name, type: l.type, estimate: l.estimate })), taxes: sow.taxes });

/** Each line whose name or amount differs from the copy RBH was sent, and lines added or taken out since. */
export function changesSinceSent(sow) {
  const sent = sow.sent;
  if (!sent?.lines) return [];
  const now = new Map(sow.lines.map((l) => [l.id, l])), then = new Map(sent.lines.map((l) => [l.id, l]));
  const out = [];
  for (const l of sent.lines) {
    const n = now.get(l.id);
    if (!n) out.push({ name: l.name, was: l.estimate, now: null, what: "taken out" });
    else if (n.estimate !== l.estimate || n.name !== l.name || n.type !== l.type) out.push({ name: n.name, was: l.estimate, now: n.estimate, what: n.name !== l.name ? `renamed from "${l.name}"` : n.type !== l.type ? "type changed" : "amount changed" });
  }
  for (const n of sow.lines) if (!then.has(n.id)) out.push({ name: n.name, was: null, now: n.estimate, what: "added" });
  return out;
}
