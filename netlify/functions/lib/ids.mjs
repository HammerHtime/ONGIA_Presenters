import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Presenter links carry a token instead of an account. It has to be long enough
 * that nobody guesses another presenter's agreement, and readable enough that a
 * presenter reading it off a phone screen to a colleague doesn't garble it.
 */
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no l/o/0/1 — misread too easily

export function token(length = 24) {
  const bytes = randomBytes(length);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** Constant-time compare, so a token can't be recovered by timing the failures. */
export function tokensMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

export function eventId(year, city) {
  const slug = String(city).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${year}-${slug}-${token(6)}`;
}

/** Human-quotable submission reference that appears on the PDF. */
export function reference(eventKey, seq) {
  const compact = String(eventKey).replace(/[^a-z0-9]/gi, "").slice(0, 10).toUpperCase();
  return `AGR-${compact}-${String(seq).padStart(4, "0")}`;
}

/**
 * SharePoint rejects " * : < > ? / \ | and trims trailing dots and spaces.
 * A presenter typing O'Brien-Smith, Jr. would otherwise fail the upload
 * silently. The name inside the document keeps whatever they typed.
 */
export function safeFileName(name, fallback = "Presenter") {
  const cleaned = String(name ?? "")
    .replace(/[""*:<>?/\\|]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  return cleaned || fallback;
}
