import { json, fail, requireAdmin, adminWho } from "./lib/http.mjs";
import { isOwner } from "./lib/auth.mjs";
import { getBackupStatus, BACKUP_FOLDER, BACKUP_TZ, BACKUP_HOUR } from "./lib/backup.mjs";
import { putMeta } from "./lib/store.mjs";
import { graphConfigured, listBackupFiles, getBackupFile } from "./lib/graph.mjs";
import { readZip } from "./lib/zip.mjs";
import { manifestOf, groupCounts, browse, compare, restore, undoRestore, restoreLog } from "./lib/backupbrowse.mjs";
import { siteOrigin } from "./lib/site.mjs";

/**
 * The backup's status for the desk's home page, and "Back up now". The desk owners (the president) only.
 *
 *   GET  /api/backups        { status, folder, schedule, configured }
 *   POST /api/backups        start a backup now (it runs in the background; the page asks back)
 *   GET  /api/backups?list=1                          the backups on SharePoint, newest first
 *   GET  /api/backups?date=YYYY-MM-DD&prefix=sow:     the record keys in that night's backup starting with the prefix
 *   GET  /api/backups?date=YYYY-MM-DD&key=sow:…       one record as it was that night (read only; nothing is put back)
 * Looking inside a backup (Andrew 26 Nov 2026: a statement of work gone missing) is for finding what was lost.
 *   GET  /api/backups?date=…&groups=1                 how many records of each kind it holds
 *   GET  /api/backups?date=…&group=events[&q=]        each record of that kind: same, changed, gone now or new since
 *   GET  /api/backups?date=…&compare=<key>            one record then and now, field by field
 *   POST /api/backups?date=…&restore=<key>            { confirm: "RESTORE" } put that one record back as it was
 *   POST /api/backups?undo=<id>                       undo a restore
 *   GET  /api/backups?restores=1                      what has been restored, newest first
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
  const q = (k) => new URL(req.url).searchParams.get(k);
  const by = who.name || who.email || "the desk";
  if (req.method === "GET" && q("restores")) return json({ restores: await restoreLog() });
  if (req.method === "POST" && q("undo")) { const r = await undoRestore(q("undo"), by); return r.error ? fail(r.error, 409) : json(r); }
  if (q("date") && (q("groups") || q("group") || q("compare") || q("restore"))) {
    if (!graphConfigured()) return fail("Microsoft isn't set up on this site, so the backups can't be read.", 409);
    const file = (await listBackupFiles(BACKUP_FOLDER())).find((f) => f.name === `ongia-desk-backup-${q("date")}.zip`);
    if (!file) return fail(`No backup for ${q("date")}.`, 404);
    const zip = await getBackupFile(file.id);
    const manifest = manifestOf(zip);
    if (req.method === "GET" && q("groups")) return json({ date: q("date"), groups: groupCounts(manifest) });
    if (req.method === "GET" && q("group")) return json({ date: q("date"), ...(await browse(zip, q("group"), { manifest, search: q("q") ?? "" })) });
    if (req.method === "GET" && q("compare")) return json({ date: q("date"), ...(await compare(zip, q("compare"), { manifest })) });
    if (req.method === "POST" && q("restore")) {
      const body = await req.json().catch(() => ({}));
      if (String(body.confirm ?? "").trim().toUpperCase() !== "RESTORE") return fail("Type RESTORE to put it back.", 400);
      const r = await restore(zip, q("restore"), q("date"), by, { manifest });
      return r.error ? fail(r.error, 409) : json(r);
    }
  }
  if (req.method === "GET" && (q("list") || q("date"))) {
    if (!graphConfigured()) return fail("Microsoft isn't set up on this site, so the backups can't be read.", 409);
    const files = (await listBackupFiles(BACKUP_FOLDER())).filter((f) => /^ongia-desk-backup-\d{4}-\d{2}-\d{2}\.zip$/.test(f.name)).sort((a, b) => b.name.localeCompare(a.name));
    if (q("list")) return json({ backups: files.map((f) => ({ date: f.name.slice(18, 28), size: f.size })) });
    const file = files.find((f) => f.name === `ongia-desk-backup-${q("date")}.zip`);
    if (!file) return fail(`No backup for ${q("date")}.`, 404);
    const zip = await getBackupFile(file.id);
    const key = q("key"), prefix = q("prefix") ?? "";
    if (key) {
      const [hit] = readZip(zip, (n) => n === `blobs/${encodeURIComponent(key)}`);
      if (!hit) return json({ date: q("date"), key, found: false });
      let value = null; try { value = JSON.parse(hit.data.toString("utf8")); } catch {}
      return json({ date: q("date"), key, found: true, bytes: hit.data.length, value });
    }
    // Only the names are looked at: nothing is unpacked.
    const names = [];
    let total = 0;
    readZip(zip, (n) => { if (n.startsWith("blobs/")) { total++; const k = decodeURIComponent(n.slice(6)); if (k.startsWith(prefix)) names.push(k); } return false; });
    return json({ date: q("date"), prefix, keys: names.sort(), total });
  }
  if (req.method === "GET") return json({ status, ...info() });
  return fail("Method not allowed.", 405);
};

const info = () => ({ folder: BACKUP_FOLDER(), schedule: `${BACKUP_HOUR()}:00 ${BACKUP_TZ()}`, configured: graphConfigured() });
