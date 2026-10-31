import { siteUrl } from "./lib/site.mjs";
import { putMeta, getMeta } from "./lib/store.mjs";
import { certRecord, certificatePdf, certFileName, findTemplate, hasFrench } from "./lib/certs.mjs";
import { timingSafeEqual } from "node:crypto";

/**
 * The "Download your certificate" link in the certificate email (Andrew 31 Oct 2026). Public, but only with the
 * certificate's own download token, which only its email carries. The first download is noted on the certificate,
 * so the desk can show who fetched theirs; a withdrawn certificate isn't handed out.
 *
 *   GET /api/certfile?c=ABCD-EF23&d=<token>
 */
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export default async (req) => {
  const url = new URL(req.url);
  const code = String(url.searchParams.get("c") ?? "").trim().toUpperCase(), token = String(url.searchParams.get("d") ?? "");
  const fr = url.searchParams.get("lang") === "fr";
  // "Email me a sample" sends a sample certificate (number SAMP-LE00, which verifies nothing) with a link of its own.
  const rec = code === "SAMP-LE00" ? await getMeta(`certs:sample:${token.replace(/[^A-Za-z0-9_-]/g, "")}`) : await certRecord(code);
  if (!rec || !rec.dl || !token || !same(rec.dl, token)) return page(404, fr ? "Ce lien de certificat n'est pas valide." : "This certificate link isn't valid.");
  if (rec.sample && rec.until < new Date().toISOString()) return page(410, fr ? "Ce lien d'exemple a expiré." : "This sample link has expired.");
  if (rec.revokedAt) return page(410, fr ? "Ce certificat a été retiré. Communiquez avec ONGIA." : "This certificate was withdrawn. Please contact ONGIA.");
  if (rec.code !== "SAMP-LE00" && rec.mail && !rec.mail.downloadedAt) await putMeta(`certs:code:${rec.code}`, { ...rec, mail: { ...rec.mail, downloadedAt: new Date().toISOString() } });
  // The French button in the email gives the French certificate (Andrew 31 Oct 2026); a design without one stays English.
  const tpl = await findTemplate(rec.template);
  const lang = fr && (!tpl || hasFrench(tpl)) ? "fr" : "en";
  const name = certFileName(rec, lang);
  return new Response(await certificatePdf(rec, { origin: siteUrl(req), lang }), { headers: { "content-type": "application/pdf",
    "content-disposition": `attachment; filename="${encodeURIComponent(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`, "cache-control": "no-store" } });
};

const page = (status, words) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ONGIA certificate</title>
<body style="margin:0;background:#f2efe8;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#12161f"><div style="max-width:480px;margin:60px auto;padding:24px;background:#fafaf7;border:1px solid #ddd7c8;border-radius:18px">
<p style="font-size:17px;line-height:1.5;margin:0">${words}</p></div></body>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
