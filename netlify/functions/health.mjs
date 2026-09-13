import { json, fail, requireAdmin } from "./lib/http.mjs";
import { graphConfigured, checkFolder, graphAccessToken, tokenRoles } from "./lib/graph.mjs";
import { mailTransport } from "./lib/mail.mjs";

/**
 * Which integrations this deploy can actually use — shown on the admin home so
 * a skipped email or a filing error is never a mystery.
 *
 *   GET /api/health                      configuration + a live Microsoft sign-in check
 *   GET /api/health?folder=<path>        also confirm that event folder exists in the library
 */
export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);

  const folder = new URL(req.url).searchParams.get("folder");
  const transport = mailTransport();
  const out = {
    email: transport ? { ok: true, ...transport } : { ok: false, reason: "No email transport: set MS_MAIL_FROM (Microsoft 365) or RESEND_API_KEY" },
    microsoft: graphConfigured() ? { ok: true } : { ok: false, reason: "MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET not all set" },
    sharepoint: null,
  };
  if (graphConfigured()) {
    out.sharepoint = await checkFolder(folder).then((r) => ({ ok: true, ...r })).catch((e) => ({ ok: false, error: e.message }));
    // Sending as a mailbox needs its own application permission; say so before
    // the first approval discovers it.
    if (transport?.kind === "microsoft") {
      const roles = await graphAccessToken().then(tokenRoles).catch(() => []);
      if (!roles.includes("Mail.Send")) out.email = { ok: false, ...transport, reason: "Mail.Send (Application) is not granted on the app yet — add it in Entra → API permissions and grant admin consent." };
    }
  }
  return json(out);
};
