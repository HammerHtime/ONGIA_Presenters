import { createHash, randomBytes } from "node:crypto";
import { readZip } from "./zip.mjs";
import { allBlobKeys, readRaw, writeRaw, deleteKey, getMeta, putMeta, listEvents } from "./store.mjs";

/**
 * Looking inside a night's backup and comparing it with the desk as it is now, one record at a time, before putting
 * anything back (Andrew 26 Nov 2026: "a way for me to open a back up and look through the info and compare before
 * restoring"). A restore puts back one record; what it replaces is kept, so the restore can be undone.
 */

// The kinds of record, in words a person knows. A key belongs to the first group it fits.
export const GROUPS = [
  ["events", "Events", (k) => k.startsWith("event:")],
  ["money", "Statements of work and receipts", (k) => /^(sow|receipts|receiptfile):/.test(k) || k.startsWith("meta:invseq:") || k.startsWith("meta:budget")],
  ["presenters", "Presenters and agreements", (k) => /^(presenter|pdf|headshot|token|contract|contractread|contractsign|contractsigned|agenda|agendaread|wfile):/.test(k)],
  ["attendees", "Attendees and replies", (k) => /^(attendees|reply|surveycontact|volunteer|vtoken):/.test(k)],
  ["expenses", "Expense claims", (k) => /^exp/.test(k)],
  ["board", "Board list and settings", (k) => k === "roster" || (k.startsWith("meta:") && !k.startsWith("meta:certs") && !k.startsWith("meta:sm") && !k.startsWith("meta:restore"))],
  ["surveys", "Survey answers", (k) => /^(surveyresp|surveydone):/.test(k)],
  ["certs", "Certificates", (k) => k.startsWith("meta:certs")],
  ["other", "Everything else", () => true],
];
export const groupOf = (key) => GROUPS.find(([, , fits]) => fits(key))[0];
// Never shown, compared or put back from here: the backup's own status, the restores themselves, and Andrew's signature.
const HIDDEN = (k) => k === "meta:backup" || k.startsWith("meta:restore") || k === "meta:letter-signature";
const MAX_ITEMS = 400;

const sha = (b) => createHash("sha256").update(b).digest("hex");
const asJson = (b) => { try { return JSON.parse(Buffer.from(b).toString("utf8")); } catch { return undefined; } };

/** What is in the zip: each record's key, size, checksum and metadata, from its MANIFEST (nothing else unpacked). */
export function manifestOf(zip) {
  const [m] = readZip(zip, (n) => n === "MANIFEST.json");
  const items = asJson(m?.data)?.blobs?.items ?? [];
  return new Map(items.filter((i) => !HIDDEN(i.key)).map((i) => [i.key, i]));
}

/** How many records of each kind the backup holds. */
export function groupCounts(manifest) {
  const n = Object.fromEntries(GROUPS.map(([id]) => [id, 0]));
  for (const k of manifest.keys()) n[groupOf(k)]++;
  return GROUPS.map(([id, name]) => ({ id, name, count: n[id] }));
}

/** A name a person recognises for a record: its title or name, with the event it belongs to. */
function labelOf(key, value, titles) {
  const v = value && typeof value === "object" ? value : {};
  const own = v.title || v.name || [v.first, v.last].filter(Boolean).join(" ") || v.paidTo || v.what || v.program?.title || "";
  const ev = Object.entries(titles).find(([id]) => key.includes(id))?.[1] ?? "";
  const kind = key.split(":")[0];
  return [own && own !== ev ? own : "", ev, !own && !ev ? key : kind].filter(Boolean).join(" · ");
}

/** One kind of record: each in the backup, in the desk now, or both, and whether it differs. */
export async function browse(zip, group, { manifest = manifestOf(zip), search = "" } = {}) {
  const fits = (k) => !HIDDEN(k) && groupOf(k) === group;
  const then = [...manifest.keys()].filter(fits);
  const nowKeys = (await allBlobKeys()).filter(fits);
  const keys = [...new Set([...then, ...nowKeys])].sort();
  const titles = Object.fromEntries(((await listEvents()) ?? []).map((e) => [e.id, e.title]));
  const wanted = new Set(keys.slice(0, MAX_ITEMS).map((k) => `blobs/${encodeURIComponent(k)}`));
  const old = new Map(readZip(zip, (n) => wanted.has(n)).map((e) => [decodeURIComponent(e.name.slice(6)), e.data]));
  const items = [];
  // The desk's current copies, read a few at a time rather than one after another.
  const current = new Map();
  const list = keys.slice(0, MAX_ITEMS);
  for (let i = 0; i < list.length; i += 25) await Promise.all(list.slice(i, i + 25).map(async (k) => current.set(k, await readRaw(k))));
  for (const key of list) {
    const m = manifest.get(key), cur = current.get(key);
    const status = !m ? "new" : !cur ? "gone" : sha(cur.bytes) === m.sha256 ? "same" : "changed";
    const value = asJson(old.get(key)) ?? (cur ? asJson(cur.bytes) : undefined);
    const label = labelOf(key, value, titles);
    if (search && !`${label} ${key}`.toLowerCase().includes(search.toLowerCase())) continue;
    items.push({ key, label, status, size: m?.size ?? cur?.bytes.length ?? 0 });
  }
  return { group, items, more: Math.max(0, keys.length - MAX_ITEMS) };
}

/** The differences between two JSON values, field by field ("lines.2.estimate": 8000 → 8334). */
export function differences(a, b, path = "", out = []) {
  if (out.length >= 300) return out;
  const isObj = (x) => x && typeof x === "object";
  if (isObj(a) && isObj(b) && Array.isArray(a) === Array.isArray(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])]) differences(a[k], b[k], path ? `${path}.${k}` : k, out);
    return out;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path: path || "(the whole record)", then: a ?? null, now: b ?? null });
  return out;
}

/** One record then and now. A file (a PDF, a photo) is compared by size, not shown. */
export async function compare(zip, key, { manifest = manifestOf(zip) } = {}) {
  if (HIDDEN(key)) return { key, hidden: true };
  const [hit] = readZip(zip, (n) => n === `blobs/${encodeURIComponent(key)}`);
  const cur = await readRaw(key);
  const then = hit ? asJson(hit.data) : undefined, now = cur ? asJson(cur.bytes) : undefined;
  const file = (hit && then === undefined) || (cur && now === undefined);
  return { key, inBackup: !!hit, inDeskNow: !!cur, file,
    ...(file ? { thenSize: hit?.data.length ?? 0, nowSize: cur?.bytes.length ?? 0, same: !!hit && !!cur && sha(hit.data) === sha(cur.bytes) }
      : { then: then ?? null, now: now ?? null, differences: differences(then, now) }),
    metadata: manifest.get(key)?.metadata ?? null };
}

/** Put one record back as it was in the backup. What it replaces (or that there was nothing) is kept for an undo. */
export async function restore(zip, key, date, by, { manifest = manifestOf(zip) } = {}) {
  if (HIDDEN(key)) return { error: "That record can't be restored from here." };
  const [hit] = readZip(zip, (n) => n === `blobs/${encodeURIComponent(key)}`);
  if (!hit) return { error: "That record isn't in this backup." };
  const cur = await readRaw(key);
  const id = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  await putMeta(`restore:${id}`, { key, had: cur ? Buffer.from(cur.bytes).toString("base64") : null, metadata: cur?.metadata ?? null });
  await writeRaw(key, hit.data, manifest.get(key)?.metadata ?? {});
  const log = (await getMeta("restorelog")) ?? { items: [] };
  const entry = { id, key, date, by, at: new Date().toISOString() };
  await putMeta("restorelog", { items: [entry, ...log.items].slice(0, 100) });
  return { restored: entry };
}

/** Undo a restore: the record goes back to what it was just before (or away again, if there was nothing). */
export async function undoRestore(id, by) {
  const saved = await getMeta(`restore:${id}`);
  const log = (await getMeta("restorelog")) ?? { items: [] };
  const entry = log.items.find((x) => x.id === id);
  if (!saved || !entry) return { error: "There's nothing to undo for that restore." };
  if (entry.undoneAt) return { error: "That restore has already been undone." };
  if (saved.had) await writeRaw(saved.key, Buffer.from(saved.had, "base64"), saved.metadata ?? {});
  else await deleteKey(saved.key);
  entry.undoneAt = new Date().toISOString(); entry.undoneBy = by;
  await putMeta("restorelog", log);
  return { undone: entry };
}
export const restoreLog = async () => ((await getMeta("restorelog")) ?? { items: [] }).items;
