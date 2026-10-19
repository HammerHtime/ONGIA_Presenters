import { requireAdmin } from "./lib/http.mjs";
import { runBackup } from "./lib/backup.mjs";

/** The backup itself, in the background (15 minutes). Started by backup-schedule.mjs at 4 a.m. and by "Back up now". */
export default async (req) => {
  if (requireAdmin(req)) return new Response("Not authorized.", { status: 401 });
  const by = new URL(req.url).searchParams.get("by") || "the nightly run";
  await runBackup({ by });
  return new Response(null, { status: 202 });
};
