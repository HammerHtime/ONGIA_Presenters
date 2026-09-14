/**
 * North American numbers as 416-555-0100, with an optional " x123" extension.
 * Anything that is clearly not North American (a + prefix other than +1) is left as typed.
 * The same function, minus the caret handling, lives in agreement.html and admin.html.
 */
export function formatPhone(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^\+(?!1)/.test(s)) return s;
  const m = s.match(/(?:x|ext\.?|poste|#)\s*(\d{0,6})\s*$/i);
  let ext = m ? m[1] : "", hasExt = !!m;
  let digits = (m ? s.slice(0, m.index) : s).replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") digits = digits.slice(1);
  digits = digits.slice(0, 10); // a mask, so stray extra digits are dropped; an extension needs an "x"
  const a = digits.slice(0, 3), b = digits.slice(3, 6), c = digits.slice(6, 10);
  let out = a;
  if (b) out += "-" + b;
  if (c) out += "-" + c;
  if (hasExt) out += " x" + ext;
  return out.trim();
}
