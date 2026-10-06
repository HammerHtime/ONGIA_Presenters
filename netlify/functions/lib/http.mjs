import { createHash } from "node:crypto";
import { tokensMatch } from "./ids.mjs";
/** Small helpers so every function answers in the same shape. */

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export const fail = (message, status = 400) => json({ error: message }, status);

/**
 * Admin screens are gated by a shared key held in the ADMIN_KEY environment
 * variable. That is deliberately simple for now — it is one coordinator and a
 * handful of directors, not a user directory. When more than a couple of people
 * need their own sign-in, this is the seam to replace.
 */
export function requireAdmin(req) {
  const expected = process.env.ADMIN_KEY;
  if (!expected) return "ADMIN_KEY is not set on this site, so admin screens are locked.";
  const supplied = req.headers.get("x-admin-key") ?? "";
  // Hashed first, then compared in constant time. The hash makes both sides the
  // same length, so a wrong key of the wrong length is refused exactly like a
  // wrong key of the right one and the length of ADMIN_KEY stays private.
  const digest = (v) => createHash("sha256").update(String(v)).digest("hex");
  if (!tokensMatch(digest(supplied), digest(expected))) return "Not authorized.";
  return null;
}

/** Trim and cap free text so a runaway paste can't fill the store. */
export const text = (value, max = 2000) => String(value ?? "").trim().slice(0, max);

export const yesNo = (value) => (value === "yes" || value === "no" ? value : null);

/**
 * A filename arrives url-encoded in a header. decodeURIComponent throws on a
 * malformed escape, which would turn a bad header into a 500, so a name that
 * will not decode is simply taken as it came.
 */
export function fileName(header, fallback) {
  const raw = String(header ?? "");
  let name;
  try { name = decodeURIComponent(raw); } catch { name = raw; }
  return text(name.replace(/[\\/]/g, "").replace(/[\u0000-\u001f]/g, ""), 200) || fallback;
}

export const isEmail = (value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value ?? "").trim());
