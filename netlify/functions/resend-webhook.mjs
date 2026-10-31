import { createHmac, timingSafeEqual } from "node:crypto";
import { noteMailEvent } from "./lib/certmail.mjs";

/**
 * Resend tells us what became of each attendee email (Andrew 31 Oct 2026: bounces go to Resend, not to anyone's
 * inbox, and show on the person's row). Resend signs every call (Svix): RESEND_WEBHOOK_SECRET is the signing secret
 * from the webhook's page in Resend. Without it, or with a bad signature or an old timestamp, nothing is recorded.
 *
 *   POST /api/resend-webhook     email.delivered, email.bounced, email.complained
 */
export function verifySvix(secret, id, timestamp, body, signatures, now = Date.now()) {
  if (!secret || !id || !timestamp || !signatures) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;   // replays older than five minutes are refused
  const key = Buffer.from(String(secret).replace(/^whsec_/, ""), "base64");
  const want = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return String(signatures).split(" ").some((s) => {
    const sig = Buffer.from(s.replace(/^v1,/, ""), "base64");
    return sig.length === want.length && timingSafeEqual(sig, want);
  });
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed.", { status: 405 });
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return new Response("Not set up.", { status: 503 });
  const body = await req.text();
  const h = (k) => req.headers.get(k);
  if (!verifySvix(secret, h("svix-id"), h("svix-timestamp"), body, h("svix-signature"))) return new Response("Bad signature.", { status: 401 });
  let evt = null;
  try { evt = JSON.parse(body); } catch { return new Response("Bad body.", { status: 400 }); }
  const noted = await noteMailEvent(evt?.type, evt?.data).catch(() => false);
  return new Response(JSON.stringify({ ok: true, noted }), { headers: { "content-type": "application/json" } });
};
