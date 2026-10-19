import { createHmac, createPublicKey, verify as verifySig } from "node:crypto";
import { tokensMatch } from "./ids.mjs";

/**
 * Board members sign in to the desk with their own ONGIA Microsoft account
 * (Andrew, 18 Oct 2026). Microsoft proves who they are; this file checks that
 * proof and then hands the desk a session of its own, so every other function
 * keeps its quick, synchronous requireAdmin check.
 *
 *   MS_TENANT_ID          ONGIA's Microsoft 365 tenant (already set for email)
 *   MS_SIGNIN_CLIENT_ID   the "ONGIA Events desk sign-in" app registration
 *   DESK_OWNERS           who can never be locked out and who alone decides who
 *                         else may sign in (default president@ongia.ca)
 *
 * The shared ADMIN_KEY stays: background jobs call each other with it, and it
 * signs the sessions. Retiring it for people means changing it to a long random
 * value nobody is told.
 */

const SESSION_HOURS = 12;
const AUTHORITY = () => (process.env.MS_AUTHORITY || "https://login.microsoftonline.com").replace(/\/+$/, "");

export function signinConfig() {
  const tenant = process.env.MS_TENANT_ID, client = process.env.MS_SIGNIN_CLIENT_ID;
  if (!tenant || !client) return null;
  return { authority: `${AUTHORITY()}/${tenant}`, client };
}

export const deskOwners = () =>
  String(process.env.DESK_OWNERS || "president@ongia.ca").split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);

export const isOwner = (email) => deskOwners().includes(String(email ?? "").toLowerCase());

/**
 * Who may open the logistics sheet check: the desk owners and the VP of operations (Andrew, 19 Oct 2026).
 * SHEET_VIEWERS replaces the VP's address if it ever changes; it grants nothing else, so a viewer cannot
 * change who may sign in to the desk.
 */
export const sheetViewers = () => [...new Set([...deskOwners(),
  ...String(process.env.SHEET_VIEWERS || "vp_operations@ongia.ca").split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean)])];
/**
 * Who may open an RBH event's costing (the SOW, the estimates, the invoice): the president and the VP only.
 * An event's lead does not touch contracts or costs. COSTING_USERS replaces the VP's address if it changes.
 */
export const costingUsers = () => [...new Set([...deskOwners(),
  ...String(process.env.COSTING_USERS || "vp_operations@ongia.ca").split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean)])];
export const mayCost = (who) => who?.key === true || costingUsers().includes(String(who?.email ?? "").toLowerCase());

export const maySeeSheetCheck = (who) => who?.key === true || sheetViewers().includes(String(who?.email ?? "").toLowerCase());

/** May this person sign in? An owner always may; anyone else needs the switch on in Board members. */
export function mayUseDesk(email, roster) {
  const e = String(email ?? "").toLowerCase();
  if (!e) return false;
  if (isOwner(e)) return true;
  return (roster ?? []).some((m) => String(m.email).toLowerCase() === e && m.desk === true);
}

/* ---------- sessions ---------- */
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const sessionKey = () => createHmac("sha256", String(process.env.ADMIN_KEY ?? "")).update("desk-session-v1").digest();
const sign = (body) => createHmac("sha256", sessionKey()).update(body).digest("base64url");

export function issueSession({ email, name }, now = Date.now()) {
  const body = b64u(JSON.stringify({ e: String(email).toLowerCase(), n: String(name ?? ""), x: now + SESSION_HOURS * 3600e3 }));
  return `s1.${body}.${sign(body)}`;
}

/** The person behind a desk session, or null if it is forged, garbled or expired. */
export function readSession(value, now = Date.now()) {
  if (!process.env.ADMIN_KEY) return null;
  const [tag, body, mac] = String(value ?? "").split(".");
  if (tag !== "s1" || !body || !mac || !tokensMatch(mac, sign(body))) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
  if (!p?.e || !(p.x > now)) return null;
  return { email: p.e, name: p.n, expires: p.x, owner: isOwner(p.e) };
}

/* ---------- Microsoft's proof ---------- */
let METADATA = null; // { at, issuer, keys }

async function metadata() {
  if (METADATA && Date.now() - METADATA.at < 3600e3) return METADATA;
  const cfg = signinConfig();
  const oidc = await fetch(`${cfg.authority}/v2.0/.well-known/openid-configuration`).then((r) => {
    if (!r.ok) throw new Error(`Microsoft sign-in settings did not load (${r.status}).`);
    return r.json();
  });
  const jwks = await fetch(oidc.jwks_uri).then((r) => {
    if (!r.ok) throw new Error(`Microsoft's signing keys did not load (${r.status}).`);
    return r.json();
  });
  METADATA = { at: Date.now(), issuer: oidc.issuer, keys: jwks.keys ?? [] };
  return METADATA;
}

/**
 * Check a Microsoft ID token: Microsoft signed it, for this app, for ONGIA's
 * tenant, recently, and in answer to this sign-in (the nonce). Throws with a
 * plain reason otherwise.
 */
export async function verifyIdToken(idToken, nonce, now = Date.now()) {
  const cfg = signinConfig();
  if (!cfg) throw new Error("Microsoft sign-in isn't set up on this site yet.");
  const parts = String(idToken ?? "").split(".");
  if (parts.length !== 3) throw new Error("That sign-in reply was not readable.");
  let header, payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch { throw new Error("That sign-in reply was not readable."); }
  if (header.alg !== "RS256") throw new Error("That sign-in reply was not signed the way Microsoft signs.");

  let meta = await metadata();
  let jwk = meta.keys.find((k) => k.kid === header.kid);
  if (!jwk) { METADATA = null; meta = await metadata(); jwk = meta.keys.find((k) => k.kid === header.kid); } // Microsoft rotated its keys
  if (!jwk) throw new Error("That sign-in reply was signed with a key Microsoft doesn't list.");
  const ok = verifySig("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"));
  if (!ok) throw new Error("That sign-in reply's signature doesn't check out.");

  const skew = 5 * 60;
  const t = Math.floor(now / 1000);
  if (payload.aud !== cfg.client) throw new Error("That sign-in was for a different app.");
  // ONGIA's own tenant, never the one the token claims: a token from any other
  // Microsoft organization is refused even if Microsoft signed it.
  const tenantId = /^[0-9a-f-]{36}$/i.test(process.env.MS_TENANT_ID ?? "") ? process.env.MS_TENANT_ID.toLowerCase()
    : (String(meta.issuer).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? "").toLowerCase();
  const issuer = String(meta.issuer).replace("{tenantid}", tenantId);
  if (!tenantId || String(payload.tid ?? "").toLowerCase() !== tenantId || payload.iss !== issuer) {
    throw new Error("That sign-in came from outside ONGIA's Microsoft account.");
  }
  if (!(payload.exp + skew > t) || (payload.nbf && payload.nbf - skew > t)) throw new Error("That sign-in has expired. Please try again.");
  if (!nonce || payload.nonce !== nonce) throw new Error("That sign-in reply doesn't match this sign-in. Please try again.");

  const email = String(payload.preferred_username || payload.email || "").toLowerCase();
  if (!email) throw new Error("Microsoft didn't say which account signed in.");
  return { email, name: String(payload.name || email) };
}

/** For tests: forget the cached Microsoft keys. */
export const resetAuthCache = () => { METADATA = null; };
