import { json, fail, requireAdmin } from "./lib/http.mjs";
import { graphConfigured, checkFolder } from "./lib/graph.mjs";

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
  const out = {
    email: process.env.RESEND_API_KEY ? { ok: true, from: process.env.MAIL_FROM || "ONGIA Training <agreements@send.ongia.ca>" } : { ok: false, reason: "RESEND_API_KEY not set" },
    microsoft: graphConfigured() ? { ok: true } : { ok: false, reason: "MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET not all set" },
    sharepoint: null,
  };
  if (graphConfigured()) {
    out.sharepoint = await checkFolder(folder).then((r) => ({ ok: true, ...r })).catch((e) => ({ ok: false, error: e.message }));
  }
  return json(out);
};
