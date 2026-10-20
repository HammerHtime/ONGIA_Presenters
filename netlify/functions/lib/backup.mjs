import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeZip, readZip } from "./zip.mjs";
import { allBlobKeys, readRaw, getMeta, putMeta } from "./store.mjs";
import { putBackupFile, listBackupFiles, deleteBackupFile } from "./graph.mjs";
import { sendMail, officersTo, layout } from "./mail.mjs";

/**
 * The nightly backup of the whole desk, at 4 a.m. Pacific, into a folder on SharePoint.
 *
 * One zip a day holds everything that is not a password:
 *   blobs/   every record and file the desk keeps: events, presenters, agreements, headshots, contracts, receipts,
 *            statements of work, letters, the board list, counters (each file named by its key, URL-encoded)
 *   code/    the desk as deployed: the pages, the functions, netlify.toml, package files (not node_modules)
 *   MANIFEST.json            what is inside, with a checksum for every record
 *   README-RESTORE.txt       how to put it back
 * Settings kept in Netlify (the keys and passwords in its environment) are deliberately not in it: a restore needs
 * them set up again, and a stolen backup then cannot sign in anywhere.
 *
 * Each zip is checked (every file re-read against its checksum) before it is sent, and SharePoint is checked to have
 * kept every byte. Anything wrong is shown on the desk and emailed to the president and the VP.
 */
export const BACKUP_FOLDER = () => process.env.BACKUP_FOLDER || "ONGIA Desk Backups";
export const BACKUP_TZ = () => process.env.BACKUP_TZ || "America/Vancouver";
export const BACKUP_HOUR = () => Number(process.env.BACKUP_HOUR ?? 4);
const NAME = /^ongia-desk-backup-(\d{4})-(\d{2})-(\d{2})\.zip$/;
const STALE_HOURS = 30;

/** The clock on the wall in `tz`: { date: "2026-10-20", hour: 4 }. */
export function wallClock(now = new Date(), tz = BACKUP_TZ()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
export const backupName = (date) => `ongia-desk-backup-${date}.zip`;

/** Which of the zips in the folder to delete: keep every one from the last 30 days, and the first of each month for a year. */
export function expired(names, today) {
  const days = (iso) => Math.round((Date.parse(today) - Date.parse(iso)) / 86400000);
  const mine = names.map((n) => { const m = NAME.exec(n); return m ? { n, iso: `${m[1]}-${m[2]}-${m[3]}`, month: `${m[1]}-${m[2]}` } : null; }).filter(Boolean);
  const firstOfMonth = new Map();
  for (const x of mine.sort((a, b) => a.iso.localeCompare(b.iso))) if (!firstOfMonth.has(x.month)) firstOfMonth.set(x.month, x.n);
  return mine.filter((x) => { const age = days(x.iso); return age > 30 && !(age <= 366 && firstOfMonth.get(x.month) === x.n); }).map((x) => x.n);
}

/* ---------- what goes in ---------- */
const CODE_DIRS = ["public", "netlify", "scripts"];
const CODE_FILES = ["netlify.toml", "package.json", "package-lock.json", "README.md", "CLAUDE.md"];
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Where the deployed code is on disk: next to the functions when run locally, the function's task root on Netlify. */
export function codeRoot() {
  const roots = [process.env.BACKUP_CODE_ROOT, process.env.LAMBDA_TASK_ROOT, "/var/task", path.resolve(HERE, "../../.."), process.cwd()].filter(Boolean);
  return roots.find((r) => existsSync(path.join(r, "public", "admin.html"))) ?? null;
}

async function walk(root, rel, out) {
  for (const e of await readdir(path.join(root, rel), { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git" || e.name.startsWith(".DS_Store")) continue;
    const r = path.posix.join(rel, e.name);
    if (e.isDirectory()) await walk(root, r, out);
    else if (e.isFile()) out.push(r);
  }
}
export async function collectCode(root) {
  if (!root) return [];
  const files = [];
  for (const d of CODE_DIRS) if (existsSync(path.join(root, d))) await walk(root, d, files);
  for (const f of CODE_FILES) if (existsSync(path.join(root, f))) files.push(f);
  const out = [];
  for (const rel of files.sort()) out.push({ name: `code/${rel}`, data: await readFile(path.join(root, rel)), date: (await stat(path.join(root, rel))).mtime });
  return out;
}

const RESTORE_TEXT = `ONGIA Briefing Room: backup
===========================

blobs/   Every record and file the desk keeps. A file's name is its key, URL-encoded (decodeURIComponent).
         MANIFEST.json lists each one with its size, SHA-256 and metadata.
code/    The desk as it was deployed. The git repository on GitHub is the master copy of the code; this is the
         exact version that was running.
Not in here: the keys and passwords (ADMIN_KEY, Microsoft and Anthropic keys, ...). They live in Netlify's
environment variables and have to be set again on a new site.

To restore the data (dry run first):
  node scripts/restore-backup.mjs <this-file>.zip              lists what it would do
  NETLIFY_SITE_ID=... NETLIFY_AUTH_TOKEN=... node scripts/restore-backup.mjs <this-file>.zip --apply
To get just the code out: unzip the file and open the code/ folder.
`;

/** Build the zip. `blobs` is injectable for tests. */
export async function buildBackup({ now = new Date(), keys = allBlobKeys, read = readRaw, root = codeRoot() } = {}) {
  const tz = BACKUP_TZ(), { date } = wallClock(now, tz);
  const entries = [], listing = [];
  let bytes = 0;
  // The backup's own status record is not part of what is kept: a restored "running" would only confuse.
  for (const key of (await keys()).filter((k) => k !== "meta:backup")) {
    const blob = await read(key);
    if (!blob) continue;          // deleted while the backup ran
    entries.push({ name: `blobs/${encodeURIComponent(key)}`, data: blob.bytes, date: now });
    listing.push({ key, size: blob.bytes.length, sha256: createHash("sha256").update(blob.bytes).digest("hex"), metadata: blob.metadata });
    bytes += blob.bytes.length;
  }
  const code = await collectCode(root);
  const manifest = {
    app: "ONGIA Briefing Room", createdAt: now.toISOString(), localDate: date, timeZone: tz,
    blobs: { count: listing.length, bytes, items: listing },
    code: { found: !!root, files: code.length, bytes: code.reduce((n, f) => n + f.data.length, 0), commit: process.env.COMMIT_REF ?? null },
  };
  const zip = makeZip([
    { name: "MANIFEST.json", data: Buffer.from(JSON.stringify(manifest, null, 1)), date: now },
    { name: "README-RESTORE.txt", data: Buffer.from(RESTORE_TEXT), date: now },
    ...entries, ...code,
  ], now);
  return { zip, name: backupName(date), date, manifest };
}

/** Read the zip back and check it against its own manifest. Throws on the first problem. */
export function verifyBackup(zip, manifest) {
  const got = new Map(readZip(zip).map((e) => [e.name, e.data]));    // readZip checks every file's CRC
  const m = JSON.parse(got.get("MANIFEST.json") ?? "null");
  if (!m) throw new Error("the backup has no manifest");
  for (const b of m.blobs.items) {
    const data = got.get(`blobs/${encodeURIComponent(b.key)}`);
    if (!data || data.length !== b.size || createHash("sha256").update(data).digest("hex") !== b.sha256) throw new Error(`the record ${b.key} did not read back the same`);
  }
  if ([...got.keys()].filter((n) => n.startsWith("code/")).length !== m.code.files) throw new Error("the code files did not all read back");
  if (manifest && m.blobs.count !== manifest.blobs.count) throw new Error("the record count changed");
  return { blobs: m.blobs.count, codeFiles: m.code.files };
}

/* ---------- running it ---------- */
export const getBackupStatus = () => getMeta("backup");

/**
 * One backup, start to finish. `put`, `list` and `del` are SharePoint by default; tests pass their own.
 * Always leaves a status record, and says so by email when it fails.
 */
export async function runBackup({ now = new Date(), put = putBackupFile, list = listBackupFiles, del = deleteBackupFile, build = buildBackup, notify = true, by = "the nightly run" } = {}) {
  const prev = (await getBackupStatus().catch(() => null)) ?? {};
  const startedAt = new Date().toISOString();
  await putMeta("backup", { ...prev, state: "running", startedAt, by });
  try {
    const b = await build({ now });
    const checked = verifyBackup(b.zip, b.manifest);
    const stored = await put({ folder: BACKUP_FOLDER(), name: b.name, bytes: b.zip });
    // Old ones go only after the new one is safely there, and only files named like ours.
    let removed = [];
    try {
      const names = new Map((await list(BACKUP_FOLDER())).map((f) => [f.name, f]));
      for (const n of expired([...names.keys()], b.date)) { await del(names.get(n).id); removed.push(n); }
    } catch (e) { console.log(`backup: tidying old copies failed (${e.message})`); }
    const done = {
      state: "done", startedAt, finishedAt: new Date().toISOString(), by, name: b.name, size: stored.size, url: stored.url, folderUrl: stored.folderUrl,
      blobs: checked.blobs, codeFiles: checked.codeFiles, blobBytes: b.manifest.blobs.bytes, codeFound: b.manifest.code.found, verified: true, removed: removed.length,
    };
    const history = [{ at: done.finishedAt, name: done.name, size: done.size, ok: true }, ...(prev.history ?? [])].slice(0, 40);
    await putMeta("backup", { ...done, lastGoodAt: done.finishedAt, history });
    console.log(`backup ok: ${done.name} ${done.size} bytes, ${done.blobs} records, ${done.codeFiles} code files, ${removed.length} old removed`);
    return done;
  } catch (e) {
    const failed = { state: "failed", startedAt, finishedAt: new Date().toISOString(), by, error: e.message, lastGoodAt: prev.lastGoodAt ?? null, name: prev.name, size: prev.size, url: prev.url, folderUrl: prev.folderUrl, blobs: prev.blobs, codeFiles: prev.codeFiles };
    failed.history = [{ at: failed.finishedAt, ok: false, error: e.message }, ...(prev.history ?? [])].slice(0, 40);
    await putMeta("backup", failed);
    console.error(`backup FAILED: ${e.message}`);
    if (notify) await tell("The nightly backup did not run", `The backup of the desk failed: ${e.message}`, failed.lastGoodAt);
    return failed;
  }
}

async function tell(subject, what, lastGoodAt) {
  const when = lastGoodAt ? new Date(lastGoodAt).toLocaleString("en-CA", { timeZone: BACKUP_TZ(), dateStyle: "medium", timeStyle: "short" }) : "never";
  const html = layout({ heading: subject, lines: [what, `The last good backup was: <b>${when}</b>.`, "Open the desk's home page, press <b>Back up now</b> in the backup line, and if it fails again the reason is shown there."], footer: "This is sent by the desk's nightly backup." });
  await sendMail({ to: officersTo(), subject: `[Desk] ${subject}`, html, text: `${what}\nThe last good backup was: ${when}.` }).catch((e) => console.log(`backup: could not send the alert (${e.message})`));
}

/**
 * Called each morning: if there has been no good backup for more than 30 hours (the schedule did not fire, the
 * function was stopped), say so, once a day.
 */
export async function watchBackup({ now = new Date() } = {}) {
  const s = (await getBackupStatus().catch(() => null)) ?? {};
  // Before the very first backup there is no "last good": count from the first morning this was looked at, so a
  // deploy at 8 a.m. does not raise an alarm about a 4 a.m. run that could not have happened yet.
  if (!s.lastGoodAt && !s.watchSince) { await putMeta("backup", { ...s, watchSince: now.toISOString() }); return { ok: true, waiting: true }; }
  const age = (now - Date.parse(s.lastGoodAt ?? s.watchSince)) / 3600000;
  if (age <= STALE_HOURS) return { ok: true, ageHours: Math.round(age) };
  const today = wallClock(now).date;
  if (s.staleToldOn === today) return { ok: false, told: true };
  await putMeta("backup", { ...s, staleToldOn: today });
  await tell("No backup in more than a day", s.state === "failed" ? `The last attempt failed: ${s.error}` : "No backup has been made in the last 30 hours, and the last attempt did not report a failure, so the schedule may not be running.", s.lastGoodAt);
  return { ok: false, told: true, ageHours: Math.round(age) };
}
