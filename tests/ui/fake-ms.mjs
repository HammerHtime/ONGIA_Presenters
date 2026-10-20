// A stand-in for login.microsoftonline.com: OIDC metadata, keys, authorize (auto-approves
// as whoever /set chose) and token (checks PKCE, signs an RS256 ID token).
import http from "node:http";
import { generateKeyPairSync, createHash, sign, randomBytes } from "node:crypto";
export const TENANT = "11111111-2222-3333-4444-555555555555", CLIENT = "client-desk-123";
const PORT = 8799, BASE = `http://127.0.0.1:${PORT}`;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" };
const codes = new Map();
export const state = { email: "president@ongia.ca", name: "Andrew Hammond", aud: CLIENT, cancel: false, lastAuthorize: null };
const b64u = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
export function idToken(claims, key = privateKey, kid = "k1") {
  const head = b64u({ alg: "RS256", typ: "JWT", kid }), body = b64u(claims);
  return `${head}.${body}.${sign("RSA-SHA256", Buffer.from(`${head}.${body}`), key).toString("base64url")}`;
}
export const claimsFor = (over = {}) => { const t = Math.floor(Date.now() / 1000);
  return { aud: CLIENT, iss: `${BASE}/${TENANT}/v2.0`, tid: TENANT, iat: t, nbf: t, exp: t + 3600, name: state.name, preferred_username: state.email, ...over }; };
export const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };
export const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, BASE);
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  if (u.pathname === `/${TENANT}/v2.0/.well-known/openid-configuration`) {
    res.writeHead(200, { "content-type": "application/json", ...cors });
    return res.end(JSON.stringify({ issuer: `${BASE}/{tenantid}/v2.0`, jwks_uri: `${BASE}/keys` }));
  }
  if (u.pathname === "/keys") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ keys: [jwk] })); }
  if (u.pathname === `/${TENANT}/oauth2/v2.0/authorize`) {
    const q = u.searchParams; state.lastAuthorize = Object.fromEntries(q);
    const back = new URL(q.get("redirect_uri"));
    if (state.cancel) { back.hash = new URLSearchParams({ error: "access_denied", error_description: "AADSTS65004: User declined to consent.\r\nTrace ID: abc", state: q.get("state") }); }
    else {
      const code = randomBytes(12).toString("hex");
      codes.set(code, { nonce: q.get("nonce"), challenge: q.get("code_challenge"), redirect: q.get("redirect_uri"), email: state.email, name: state.name });
      back.hash = new URLSearchParams({ code, state: q.get("state"), session_state: "x" });
    }
    res.writeHead(302, { location: back.toString() }); return res.end();
  }
  if (u.pathname === `/${TENANT}/oauth2/v2.0/token` && req.method === "POST") {
    let raw = ""; for await (const c of req) raw += c;
    const f = new URLSearchParams(raw), c = codes.get(f.get("code"));
    codes.delete(f.get("code"));
    const ok = c && f.get("client_id") === CLIENT && f.get("redirect_uri") === c.redirect &&
      createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url") === c.challenge;
    res.writeHead(ok ? 200 : 400, { "content-type": "application/json", ...cors });
    if (!ok) return res.end(JSON.stringify({ error: "invalid_grant", error_description: "AADSTS54005: OAuth2 Authorization code was already redeemed." }));
    return res.end(JSON.stringify({ id_token: idToken(claimsFor({ nonce: c.nonce, preferred_username: c.email, name: c.name, aud: state.aud })), token_type: "Bearer" }));
  }
  res.writeHead(404); res.end();
});
