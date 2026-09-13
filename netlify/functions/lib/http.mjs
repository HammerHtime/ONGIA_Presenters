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
  if (supplied !== expected) return "Not authorised.";
  return null;
}

/** Trim and cap free text so a runaway paste can't fill the store. */
export const text = (value, max = 2000) => String(value ?? "").trim().slice(0, max);

export const yesNo = (value) => (value === "yes" || value === "no" ? value : null);

export const isEmail = (value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value ?? "").trim());
