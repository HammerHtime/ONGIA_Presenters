import { json, fail, text } from "./lib/http.mjs";
import { signinConfig, verifyIdToken, mayUseDesk, issueSession, readSession, isOwner, mayCost } from "./lib/auth.mjs";
import { getRoster, putRoster } from "./lib/store.mjs";

/**
 * Desk sign-in with an ONGIA Microsoft account.
 *
 *   GET  /api/auth           what the sign-in screen offers (public: the tenant and
 *                            app ids are not secrets, Microsoft shows them to anyone)
 *   GET  /api/auth?me=1      who the current desk session belongs to
 *   POST /api/auth           { idToken, nonce } from Microsoft → a desk session
 */
export default async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET" && url.searchParams.get("me")) {
    const who = readSession(req.headers.get("x-admin-key"));
    return json({ who: who ? { email: who.email, name: who.name, owner: who.owner, canCost: mayCost(who), expires: who.expires } : null });
  }

  if (req.method === "GET") {
    const cfg = signinConfig();
    return json({ microsoft: cfg, keyLogin: process.env.DESK_KEY_LOGIN !== "off" });
  }

  if (req.method === "POST") {
    if (!signinConfig()) return fail("Microsoft sign-in isn't set up on this site yet.", 503);
    if (!process.env.ADMIN_KEY) return fail("ADMIN_KEY is not set on this site, so admin screens are locked.", 503);
    const body = await req.json().catch(() => null);
    let person;
    try { person = await verifyIdToken(text(body?.idToken, 20000), text(body?.nonce, 200)); }
    catch (e) { return fail(e.message, 401); }

    const roster = (await getRoster()) ?? [];
    if (!mayUseDesk(person.email, roster)) {
      return fail(`${person.email} isn't on the desk's sign-in list. Ask ONGIA's president to turn on desk access for you under Board members.`, 403);
    }
    // Remembered on the roster so the president can see who actually uses the desk.
    const member = roster.find((m) => String(m.email).toLowerCase() === person.email);
    if (member) { member.lastSignIn = new Date().toISOString(); await putRoster(roster); }
    const name = member?.name || person.name;
    return json({ session: issueSession({ email: person.email, name }), who: { email: person.email, name, owner: isOwner(person.email), canCost: mayCost({ email: person.email }) } });
  }

  return fail("Method not allowed.", 405);
};
