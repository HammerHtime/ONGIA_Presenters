/**
 * How every file the desk gives out is named (Andrew 14 Nov 2026: "change the naming convention whenever I download a
 * file or the file sent out … last name space first name. And date … for all downloads, including certificates").
 *
 *   A person's file:  "Tarsitano Melissa - Letter of appreciation - 2026-11-25.pdf"
 *   An event's file:  "Western Symposium - Registration list - 2026-11-14.xlsx"
 *
 * The date is the document's own where it has one (the day an agreement was approved, the day on a certificate, the
 * day a letter is dated), and otherwise the day it was made. Written year-month-day, so files sort in date order.
 * Files people uploaded (receipts, agendas, contracts) keep the names they were given.
 */
const clean = (s) => String(s ?? "").normalize("NFC").replace(/[^\p{L}\p{N} .,'&()-]+/gu, " ").replace(/\s+/g, " ").replace(/^[ .-]+|[ .-]+$/g, "").trim();

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
/** "2026-11-25", a timestamp, or "November 12, 2026" / "12 novembre 2026" as 2026-11-25; "" if it isn't a date. */
export function isoDay(v) {
  const s = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    // A timestamp is the day it was in Toronto, not in UTC.
    if (s.length > 10) { const d = new Date(s); if (!isNaN(d)) return d.toLocaleDateString("en-CA", { timeZone: "America/Toronto" }); }
    return s.slice(0, 10);
  }
  const words = s.toLowerCase();
  const m = MONTHS.findIndex((x) => words.includes(x));
  const y = words.match(/\b(20\d{2})\b/)?.[1];
  // The first day named ("November 9 to 12, 2026" is the 9th; a range ends on the last, so take the last number before the year).
  const nums = [...words.replace(/\b20\d{2}\b/, "").matchAll(/\b(\d{1,2})(?:er|st|nd|rd|th)?\b/g)].map((x) => Number(x[1])).filter((n) => n >= 1 && n <= 31);
  if (m < 0 || !y || !nums.length) return "";
  return `${y}-${String((m % 12) + 1).padStart(2, "0")}-${String(nums.at(-1)).padStart(2, "0")}`;
}
export const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });

/** Last name then first name. From { first, last }, or from a whole name ("Melissa Tarsitano" → "Tarsitano Melissa"). */
export function lastFirst(p) {
  let first = clean(p?.first), last = clean(p?.last);
  if (!first && !last) {
    const parts = clean(p?.name).split(" ").filter(Boolean);
    if (parts.length > 1) { last = parts.pop(); first = parts.join(" "); } else last = parts[0] ?? "";
  }
  return [last, first].filter(Boolean).join(" ");
}

/** An event's short name: the title before a colon ("National Gang Summit"), or the part after "Canadian Forum … -". */
export function eventShort(event) {
  const t = clean(String(event?.title ?? event?.eventTitle ?? "").split(/\s*:\s*/)[0]);
  const m = t.match(/^Canadian Forum Against Organized Crime\s*-\s*(.+)$/i);
  return (m ? m[1] : t).slice(0, 60).trim();
}

const join = (parts, ext) => `${parts.map(clean).filter(Boolean).join(" - ")}.${ext}`;

/** "Last First - What - date.ext". */
export const personFile = (person, what, date = "", ext = "pdf") => join([lastFirst(person) || "Unnamed", what, isoDay(date) || today()], ext);
/** "Event - What - date.ext". */
export const eventFile = (event, what, date = "", ext = "pdf") => join([eventShort(event) || "ONGIA", what, isoDay(date) || today()], ext);

/** For a content-disposition header: a plain-ASCII fallback, and the real name for every browser made since 2012. */
export const disposition = (name, how = "attachment") =>
  `${how}; filename="${name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`;
