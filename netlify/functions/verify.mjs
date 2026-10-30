import { json } from "./lib/http.mjs";
import { siteUrl } from "./lib/site.mjs";
import { formatLong } from "./lib/deadlines.mjs";
import { certRecord, linkedInUrl } from "./lib/certs.mjs";

/**
 * Is this certificate genuine? (Andrew 30 Oct 2026: "yes to qr code".) Public: the QR code in the corner of every
 * certificate opens verify.html, which asks here. It says only what the certificate itself says: the name, the agency,
 * the training and the date issued. A certificate withdrawn because it was issued in error says so.
 *
 *   GET /api/verify?c=ABCD-EF23
 */
export default async (req) => {
  const code = String(new URL(req.url).searchParams.get("c") ?? "").trim().toUpperCase();
  const rec = await certRecord(code);
  if (!rec) return json({ valid: false, code }, 404);
  if (rec.revokedAt) return json({ valid: false, revoked: true, code });
  const origin = siteUrl(req);
  return json({ valid: true, code, name: rec.name, agency: rec.agency, training: rec.course || rec.eventTitle || "", date: formatLong(rec.date, "en", { weekday: false }) || rec.date, issuer: "ONGIA", linkedin: linkedInUrl(rec, origin) });
};
