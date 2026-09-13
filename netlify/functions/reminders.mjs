import { json, fail, requireAdmin } from "./lib/http.mjs";
import { siteUrl } from "./lib/site.mjs";
import { runReminders } from "./lib/reminders.mjs";

/**
 * The reminder job, on demand (the scheduled one can't be called by URL).
 *   GET /api/reminders?dry=1      what today's run would send, sending nothing
 *   GET /api/reminders?run=1      run it now
 *   GET /api/reminders?digest=1   include the lead's weekly summary whatever the weekday (combine with dry=1 to preview)
 */
export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const url = new URL(req.url);
  const out = await runReminders({ dry: url.searchParams.has("dry"), forceDigest: url.searchParams.has("digest"), origin: siteUrl(req) });
  return json(out);
};
