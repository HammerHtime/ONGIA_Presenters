import { wallClock, BACKUP_HOUR, BACKUP_TZ, runBackup } from "./lib/backup.mjs";
import { siteOrigin } from "./lib/nightly.mjs";

/**
 * Netlify's schedules are in UTC, and 4 a.m. in Vancouver is 11:00 UTC in summer and 12:00 UTC in winter. So this
 * wakes at both and only goes on when it really is 4 a.m. there (BACKUP_TZ and BACKUP_HOUR change that), which
 * keeps the time right across the clock change without anyone touching it.
 *
 * It then hands the work to backup-run-background (15 minutes; a scheduled function gets 30 seconds).
 */
export const config = { schedule: "0 11,12 * * *" };

export default async () => {
  const { hour } = wallClock(new Date(), BACKUP_TZ());
  if (hour !== BACKUP_HOUR()) return new Response(`it is ${hour}:00 in ${BACKUP_TZ()}, not ${BACKUP_HOUR()}:00; nothing to do`, { status: 200 });
  const origin = siteOrigin();
  try {
    if (!origin) throw new Error("the site address is not known (APP_URL / URL)");
    const r = await fetch(`${origin}/api/backup-run-background`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "" } });
    if (r.status !== 202) throw new Error(`the background run answered ${r.status}`);
    console.log("backup started in the background");
    return new Response(null, { status: 202 });
  } catch (e) {
    console.log(`could not start the background backup (${e.message}); running it here`);
    const out = await runBackup({ by: "the nightly run (inline)" });
    return new Response(JSON.stringify({ state: out.state, error: out.error }), { headers: { "content-type": "application/json" } });
  }
};
