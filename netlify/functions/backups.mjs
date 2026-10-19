import { json, fail, requireAdmin, adminWho } from "./lib/http.mjs";
import { isOwner } from "./lib/auth.mjs";
import { getBackupStatus, BACKUP_FOLDER, BACKUP_TZ, BACKUP_HOUR } from "./lib/backup.mjs";
import { putMeta } from "./lib/store.mjs";
import { graphConfigured } from "./lib/graph.mjs";
import { siteOrigin } from "./lib/nightly.mjs";

/**
 * The backup's status for the desk's home page, and "Back up now". The desk owners (the president) only.
 *
 *   GET  /api/backups        { status, folder, schedule, configured }
 *   POST /api/backups        start a backup now (it runs in the background; the page asks back)
 */
const STALE_MS = 20 * 60 * 1000;

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const who = adminWho(req);
  if (!(who.key === true || isOwner(who.email))) return fail("The backups are for the desk owners.", 403);

  let status = await getBackupStatus();
  // A run that died without a word (Netlify stops a background function at 15 minutes) must not say "running" for ever.
  if (status?.state === "running" && Date.now() - Date.parse(status.startedAt) > STALE_MS) status = { ...status, state: "failed", error: "The last backup was stopped before it finished." };

  if (req.method === "POST") {
    if (status?.state === "running") return json({ status, ...info() }, 202);
    if (!graphConfigured()) return fail("Microsoft credentials are not set on this site, so there is nowhere to put a backup.", 409);
    const origin = siteOrigin(new URL(req.url).origin);
    await putMeta("backup", { ...(status ?? {}), state: "running", startedAt: new Date().toISOString(), by: who.name || who.email || "the desk" });
    try {
      const r = await fetch(`${origin}/api/backup-run-background?by=${encodeURIComponent(who.name || who.email || "the desk")}`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "" } });
      if (r.status >= 400) throw new Error(`the backup job answered ${r.status}`);
    } catch (e) {
      await putMeta("backup", { ...(status ?? {}), state: "failed", error: `Could not start the backup (${e.message}).`, finishedAt: new Date().toISOString() });
    }
    return json({ status: await getBackupStatus(), ...info() }, 202);
  }
  if (req.method === "GET") return json({ status, ...info() });
  return fail("Method not allowed.", 405);
};

const info = () => ({ folder: BACKUP_FOLDER(), schedule: `${BACKUP_HOUR()}:00 ${BACKUP_TZ()}`, configured: graphConfigured() });
