import { createHash } from "node:crypto";
import { tokensMatch } from "./ids.mjs";
import { readSession, mayEditEvent, VIEW_ONLY } from "./auth.mjs";
/** Small helpers so every function answers in the same shape. */

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export const fail = (message, status = 400) => json({ error: message }, status);

/**
 * Admin screens take either a desk session (a board member signed in with their
 * ONGIA Microsoft account; see auth.mjs) or the shared ADMIN_KEY, which the
 * background jobs use to call each other.
 */
export function requireAdmin(req) {
  const expected = process.env.ADMIN_KEY;
  if (!expected) return "ADMIN_KEY is not set on this site, so admin screens are locked.";
  const supplied = req.headers.get("x-admin-key") ?? "";
  if (supplied.startsWith("s1.")) return readSession(supplied) ? null : "Your sign-in has expired. Please sign in again.";
  // Hashed first, then compared in constant time. The hash makes both sides the
  // same length, so a wrong key of the wrong length is refused exactly like a
  // wrong key of the right one and the length of ADMIN_KEY stays private.
  const digest = (v) => createHash("sha256").update(String(v)).digest("hex");
  if (!tokensMatch(digest(supplied), digest(expected))) return "Not authorized.";
  return null;
}

/** Who is at the desk: a signed-in board member, or { key: true } for the shared key. */
export function adminWho(req) {
  const supplied = req.headers.get("x-admin-key") ?? "";
  return readSession(supplied) ?? { key: true, name: "Desk key", email: "" };
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

/** Refuse a change to an event from someone who may only look at it (see mayEditEvent). Null when allowed. */
export function editGuard(req, event) {
  return mayEditEvent(adminWho(req), event) ? null : fail(VIEW_ONLY, 403);
}
