/**
 * Put a nightly backup back.
 *
 *   node scripts/restore-backup.mjs ongia-desk-backup-2026-10-20.zip                 dry run: what is in it, nothing written
 *   node scripts/restore-backup.mjs <zip> --code <folder>                            also unpack the code/ folder there
 *   NETLIFY_SITE_ID=… NETLIFY_AUTH_TOKEN=… node scripts/restore-backup.mjs <zip> --apply
 *                                                                                    write every record and file back to the site's store
 *
 * A restore writes each record in the backup over the one in the store with the same key; records the backup does
 * not have are left alone. The keys and passwords (Netlify environment variables) are not in a backup.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readZip } from "../netlify/functions/lib/zip.mjs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const apply = args.includes("--apply");
const codeAt = args.includes("--code") ? args[args.indexOf("--code") + 1] : null;
if (!file) { console.error("Usage: node scripts/restore-backup.mjs <backup.zip> [--apply] [--code <folder>]"); process.exit(2); }

const entries = readZip(await readFile(file));             // throws if the zip is damaged
const by = new Map(entries.map((e) => [e.name, e.data]));
const manifest = JSON.parse(by.get("MANIFEST.json"));
console.log(`${path.basename(file)}: made ${manifest.createdAt} (${manifest.localDate}, ${manifest.timeZone})`);
console.log(`  ${manifest.blobs.count} records, ${manifest.blobs.bytes} bytes; ${manifest.code.files} code files${manifest.code.found ? "" : " (the code was NOT in this backup)"}`);

const bad = manifest.blobs.items.filter((b) => { const d = by.get(`blobs/${encodeURIComponent(b.key)}`); return !d || createHash("sha256").update(d).digest("hex") !== b.sha256; });
if (bad.length) { console.error(`  ${bad.length} records fail their checksum, e.g. ${bad[0].key}. Not restoring from a damaged file.`); process.exit(1); }
console.log("  every record matches its checksum");

if (codeAt) {
  let n = 0;
  for (const e of entries.filter((x) => x.name.startsWith("code/"))) {
    const to = path.join(codeAt, e.name.slice(5));
    await mkdir(path.dirname(to), { recursive: true }); await writeFile(to, e.data); n++;
  }
  console.log(`  unpacked ${n} code files into ${codeAt}`);
}

if (!apply) { console.log("  dry run: nothing written. Add --apply to restore the records."); process.exit(0); }
const { getStore } = await import("@netlify/blobs");
const siteID = process.env.NETLIFY_SITE_ID, token = process.env.NETLIFY_AUTH_TOKEN;
if (!siteID || !token) { console.error("Set NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN to restore into the real site."); process.exit(2); }
const store = getStore({ name: "ongia-agreements", consistency: "strong", siteID, token });
let n = 0;
for (const b of manifest.blobs.items) {
  const data = by.get(`blobs/${encodeURIComponent(b.key)}`);
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  await store.set(b.key, buf, { metadata: b.metadata ?? {} });
  n++;
}
console.log(`  restored ${n} records.`);
// Read every one back and compare, so "restored" means it is there and the same.
let off = 0;
for (const b of manifest.blobs.items) {
  const got = await store.get(b.key, { type: "arrayBuffer" });
  if (!got || createHash("sha256").update(Buffer.from(got)).digest("hex") !== b.sha256) { off++; console.error(`  ${b.key} did not read back the same`); }
}
if (off) { console.error(`  ${off} records did not read back the same.`); process.exit(1); }
console.log(`  all ${n} read back the same.`);
