// The nightly backup: the 4 a.m. clock, what goes in, the checks, retention, failure alerts, status for the desk, restore.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
process.env.ADMIN_KEY = "s3cr3t-admin-key-zzz";
process.env.ANTHROPIC_API_KEY = "sk-ant-should-never-appear";
delete process.env.RESEND_API_KEY; delete process.env.MS_MAIL_FROM;
const F = REPO + "netlify/functions/";
const R = REPO + "";
const events = (await import(F + "events.mjs")).default;
const sowFn = (await import(F + "sow.mjs")).default;
const roster = (await import(F + "roster.mjs")).default;
const backups = (await import(F + "backups.mjs")).default;
const B = await import(F + "lib/backup.mjs");
const Z = await import(F + "lib/zip.mjs");
const store = await import(F + "lib/store.mjs");
const { issueSession } = await import(F + "lib/auth.mjs");
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const asEmail = (email) => ({ "x-admin-key": issueSession({ email, name: email }), "content-type": "application/json" });
const call = async (h, url, method = "GET", body, headers) => { const r = await h(new Request("http://localhost" + url, { method, headers, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
await call(roster, "/api/roster", "GET", undefined, asEmail("president@ongia.ca"));

console.log("— 4 a.m. in Vancouver, summer and winter");
const at = (iso) => B.wallClock(new Date(iso), "America/Vancouver");
ok("11:00 UTC in October (daylight time) is 4:00 there, and the date is the local one", at("2026-10-20T11:00:00Z").hour === 4 && at("2026-10-20T11:00:00Z").date === "2026-10-20");
ok("12:00 UTC in October is 5:00 there: the schedule's second wake-up does nothing", at("2026-10-20T12:00:00Z").hour === 5);
ok("12:00 UTC in December (standard time) is 4:00 there", at("2026-12-15T12:00:00Z").hour === 4);
ok("11:00 UTC in December is 3:00: the first wake-up does nothing", at("2026-12-15T11:00:00Z").hour === 3);
ok("exactly one of the two wake-ups lands on 4:00 every day of the year", (() => { for (let d = new Date("2026-01-01T00:00:00Z"); d < new Date("2027-01-01T00:00:00Z"); d = new Date(d.getTime() + 86400000)) { const day = d.toISOString().slice(0, 10); const hits = [11, 12].filter((h) => B.wallClock(new Date(`${day}T${h}:00:00Z`), "America/Vancouver").hour === 4).length; if (hits !== 1) return false; } return true; })());
ok("the date in the file's name is the local date, even when UTC has already turned over", B.wallClock(new Date("2026-10-21T02:30:00Z"), "America/Vancouver").date === "2026-10-20" && B.backupName("2026-10-20") === "ongia-desk-backup-2026-10-20.zip");
const cfg = readFileSync(F + "backup-schedule.mjs", "utf8");
ok("the schedule wakes at 11:00 and 12:00 UTC", /schedule: "0 11,12 \* \* \*"/.test(cfg));
const sched = (await import(F + "backup-schedule.mjs")).default;

console.log("— which old copies go");
const names = ["2026-10-20", "2026-10-19", "2026-09-25", "2026-09-19", "2026-09-02", "2026-09-01", "2026-08-15", "2026-08-02", "2025-12-01", "2025-09-01", "2024-01-05"].map((d) => `ongia-desk-backup-${d}.zip`).concat(["notes.docx", "ongia-desk-backup-final.zip"]);
const gone = B.expired(names, "2026-10-20");
ok("everything from the last 30 days stays", !gone.includes("ongia-desk-backup-2026-10-20.zip") && !gone.includes("ongia-desk-backup-2026-10-19.zip") && !gone.includes("ongia-desk-backup-2026-09-25.zip"));
ok("older than that, only the first of each month stays", !gone.includes("ongia-desk-backup-2026-09-01.zip") && gone.includes("ongia-desk-backup-2026-09-02.zip") && gone.includes("ongia-desk-backup-2026-09-19.zip") && !gone.includes("ongia-desk-backup-2026-08-02.zip") && gone.includes("ongia-desk-backup-2026-08-15.zip"));
ok("a monthly one is kept for a year and then goes", !gone.includes("ongia-desk-backup-2025-12-01.zip") && gone.includes("ongia-desk-backup-2025-09-01.zip") && gone.includes("ongia-desk-backup-2024-01-05.zip"));
ok("a file that isn't one of ours is never touched", !gone.includes("notes.docx") && !gone.includes("ongia-desk-backup-final.zip"));

console.log("— what goes in the zip");
const ev = (await call(events, "/api/events", "POST", { title: "ITP Backup RBH", city: "Montreal", dayOne: "2026-09-28", lastDay: "2026-10-02", invite: false, kind: "rbh", province: "QC", board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], presenters: [{ first: "Ann", last: "Presenter", email: "ann@example.ca", organization: "Org" }] }, asEmail("president@ongia.ca"))).event;
await call(sowFn, `/api/sow?event=${ev.id}&create=1`, "POST", { from: "standard" }, asEmail("president@ongia.ca"));
const photo = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 7) % 256))]);
await store.putReceiptFile(ev.id, "abc123def456", photo.buffer.slice(photo.byteOffset, photo.byteOffset + photo.byteLength), { name: "r.jpg", type: "image/jpeg" });
await store.putContract(ev.id, new TextEncoder().encode("%PDF-1.4 pretend contract é").buffer, { name: "contract.pdf", size: 27 });
const now = new Date("2026-10-20T11:00:00Z");
const b = await B.buildBackup({ now, root: R });
const entries = Z.readZip(b.zip);
const nameSet = new Set(entries.map((e) => e.name));
const allKeys = (await store.allBlobKeys()).filter((k) => k !== "meta:backup");
ok("the zip holds one file for every record in the store", b.manifest.blobs.count === allKeys.length && allKeys.every((k) => nameSet.has(`blobs/${encodeURIComponent(k)}`)) && allKeys.length >= 6, String(allKeys.length));
ok("binary files come back byte for byte (the photo, and a PDF with an accented letter)", Buffer.compare(entries.find((e) => e.name === `blobs/${encodeURIComponent(`receiptfile:${ev.id}:abc123def456`)}`).data, photo) === 0 && /pretend contract é/.test(entries.find((e) => e.name === `blobs/${encodeURIComponent(`contract:${ev.id}`)}`).data.toString("utf8")));
ok("the metadata of each record is in the manifest", b.manifest.blobs.items.find((x) => x.key === `contract:${ev.id}`).metadata.name === "contract.pdf");
ok("the code is in it: the desk page, the functions, the config", nameSet.has("code/public/admin.html") && nameSet.has("code/netlify/functions/lib/backup.mjs") && nameSet.has("code/netlify/functions/receipts.mjs") && nameSet.has("code/netlify.toml") && nameSet.has("code/package.json") && b.manifest.code.files > 40);
ok("node_modules and .git are not", ![...nameSet].some((n) => /node_modules|\.git\//.test(n)));
ok("the code in the zip is the code on disk", entries.find((e) => e.name === "code/public/admin.html").data.equals(readFileSync(R + "public/admin.html")));
ok("no key or password is in any file of the zip", !entries.some((e) => /s3cr3t-admin-key-zzz|sk-ant-should-never-appear/.test(e.data.toString("latin1"))));
ok("it has a restore note and a manifest", nameSet.has("README-RESTORE.txt") && nameSet.has("MANIFEST.json"));
const dir = mkdtempSync(path.join(tmpdir(), "bk-")); const zipPath = path.join(dir, b.name); writeFileSync(zipPath, b.zip);
ok("an ordinary unzip tool opens it and finds no errors", /No errors detected/.test(execFileSync("unzip", ["-t", zipPath]).toString()));
ok("verifying passes, and says how much it saw", B.verifyBackup(b.zip, b.manifest).blobs === b.manifest.blobs.count);

console.log("— the checks catch damage");
const flip = Buffer.from(b.zip); flip[200] ^= 0xff;
let err = ""; try { B.verifyBackup(flip, b.manifest); } catch (e) { err = e.message; }
ok("a damaged zip is refused", err !== "", err);
const swapped = Z.makeZip(entries.map((e) => (e.name === `blobs/${encodeURIComponent(`contract:${ev.id}`)}` ? { name: e.name, data: Buffer.from("tampered") } : e)));
err = ""; try { B.verifyBackup(swapped, b.manifest); } catch (e) { err = e.message; }
ok("a record that doesn't match its checksum is refused", /did not read back the same/.test(err), err);

console.log("— a run, start to finish");
const uploaded = new Map(), deleted = [];
const fakeSp = { put: async ({ folder, name, bytes }) => { uploaded.set(name, bytes); return { id: "i-" + name, name, url: "https://sp/x/" + name, folderUrl: "https://sp/x", size: bytes.length }; },
  list: async () => [...names.filter((n) => n.startsWith("ongia")).map((n) => ({ id: "id-" + n, name: n })), { id: "id-notes", name: "notes.docx" }], del: async (id) => { deleted.push(id); } };
let st = await B.runBackup({ now, ...fakeSp, build: (o) => B.buildBackup({ ...o, root: R }) });
ok("done, with the name, the size, the counts and 'verified'", st.state === "done" && st.name === "ongia-desk-backup-2026-10-20.zip" && st.size === uploaded.get(st.name).length && st.blobs === allKeys.length + 0 && st.codeFiles > 40 && st.verified === true, JSON.stringify(st));
ok("what went up is a good zip", Z.readZip(uploaded.get(st.name)).length > 40);
ok("old copies were removed by the retention rule, and nothing else", deleted.includes("id-ongia-desk-backup-2026-09-02.zip") && !deleted.includes("id-notes") && !deleted.includes("id-ongia-desk-backup-2026-10-19.zip") && st.removed === deleted.length, JSON.stringify(deleted));
const kept = await B.getBackupStatus();
ok("the status record is kept, with a history and the time of the last good one", kept.state === "done" && kept.lastGoodAt && kept.history.length === 1 && kept.history[0].ok === true);

console.log("— a failure is recorded, kept apart from the last good one, and not silent");
const goodAt = kept.lastGoodAt;
st = await B.runBackup({ now, ...fakeSp, put: async () => { throw new Error("SharePoint said no"); }, build: (o) => B.buildBackup({ ...o, root: R }), notify: false });
const f = await B.getBackupStatus();
ok("state failed with the reason", f.state === "failed" && /SharePoint said no/.test(f.error));
ok("the last good backup's time is not lost", f.lastGoodAt === goodAt && f.name === "ongia-desk-backup-2026-10-20.zip" && f.history.length === 2 && f.history[0].ok === false);
const delBefore = deleted.length;
await B.runBackup({ now, ...fakeSp, put: async () => { throw new Error("nope"); }, build: (o) => B.buildBackup({ ...o, root: R }), notify: false });
ok("nothing old is deleted when the new one did not go up", deleted.length === delBefore);
st = await B.runBackup({ now, ...fakeSp, build: async () => { const x = await B.buildBackup({ now, root: R }); x.zip[300] ^= 0xff; return x; }, notify: false });
ok("a zip that fails its own check is never uploaded", st.state === "failed" && uploaded.size === 1 && !/ongia-desk-backup-2026-10-20\.zip.*changed/.test(""));
st = await B.runBackup({ now, ...fakeSp, build: (o) => B.buildBackup({ ...o, root: R }) });
ok("and the next good run clears the failure", st.state === "done" && (await B.getBackupStatus()).state === "done");
ok("no code folder found: the data is still backed up, and it says the code was not in it", await (async () => { const x = await B.buildBackup({ now, root: null }); return x.manifest.code.found === false && x.manifest.blobs.count > 0; })());

console.log("— noticing a backup that never ran");
await store.putMeta("backup", null);
let w0 = await B.watchBackup({ now: new Date("2026-10-20T14:00:00Z") });
ok("before the very first backup nothing is raised on the first morning", w0.ok === true && w0.waiting === true);
w0 = await B.watchBackup({ now: new Date("2026-10-22T14:00:00Z") });
ok("but 30 hours after it began looking, no backup at all is told", w0.ok === false && w0.told === true);
await store.putMeta("backup", { state: "done", lastGoodAt: "2026-10-18T11:00:00Z" });
let w = await B.watchBackup({ now: new Date("2026-10-20T14:00:00Z") });
ok("more than 30 hours with no good backup is noticed and told", w.ok === false && w.told === true);
w = await B.watchBackup({ now: new Date("2026-10-20T15:00:00Z") });
ok("but only once a day", w.ok === false && w.told === true && (await B.getBackupStatus()).staleToldOn === "2026-10-20");
await store.putMeta("backup", { state: "done", lastGoodAt: "2026-10-20T11:05:00Z" });
ok("a backup from this morning is fine", (await B.watchBackup({ now: new Date("2026-10-20T14:00:00Z") })).ok === true);

console.log("— the desk's page: who and what");
const pres = asEmail("president@ongia.ca");
const raw = async (headers, method = "GET") => { const x = await backups(new Request("http://localhost/api/backups", { method, headers })); return { http: x.status, body: await x.json() }; };
let r = await raw(pres);
ok("the president sees the status, the folder name and the schedule", r.http === 200 && r.body.folder === "ONGIA Desk Backups" && r.body.schedule === "4:00 America/Vancouver" && "status" in r.body, JSON.stringify(r));
ok("the VP does too (same access as the president)", (await raw(asEmail("vp_operations@ongia.ca"))).http === 200);
ok("an event's lead does not", (await raw(asEmail("treasurer@ongia.ca"))).http === 403);
ok("nor can they start one", (await raw(asEmail("treasurer@ongia.ca"), "POST")).http === 403);
await store.putMeta("backup", { state: "running", startedAt: new Date(Date.now() - 30 * 60000).toISOString() });
r = await raw(pres);
ok("a run that has been 'running' for half an hour is shown as stopped, not running for ever", r.body.status.state === "failed" && /stopped/.test(r.body.status.error), JSON.stringify(r.body.status));
const nm = await backups(new Request("http://localhost/api/backups", { method: "POST", headers: pres })); 
ok("starting one with no Microsoft credentials says why instead of pretending", nm.status === 409 && /Microsoft/.test((await nm.json()).error));

console.log("— restoring");
const run = (...args) => spawnSync("node", ["--import", REPO + "tests/register.mjs", R + "scripts/restore-backup.mjs", ...args], { encoding: "utf8", env: { ...process.env } });
let o = run(zipPath);
ok("a dry run says what is in it and writes nothing", o.status === 0 && /dry run: nothing written/.test(o.stdout) && new RegExp(`${b.manifest.blobs.count} records`).test(o.stdout) && /every record matches its checksum/.test(o.stdout), o.stdout + o.stderr);
const outDir = mkdtempSync(path.join(tmpdir(), "code-"));
o = run(zipPath, "--code", outDir);
ok("it can unpack the code", o.status === 0 && existsSync(path.join(outDir, "public/admin.html")) && readFileSync(path.join(outDir, "public/admin.html")).equals(readFileSync(R + "public/admin.html")), o.stdout + o.stderr);
o = run(zipPath, "--apply");
ok("--apply without the site's id and token refuses", o.status === 2 && /NETLIFY_SITE_ID/.test(o.stderr));
o = spawnSync("node", ["--import", REPO + "tests/register.mjs", R + "scripts/restore-backup.mjs", zipPath, "--apply"], { encoding: "utf8", env: { ...process.env, NETLIFY_SITE_ID: "x", NETLIFY_AUTH_TOKEN: "y" } });
ok("with them, every record is written and read back the same", o.status === 0 && new RegExp(`restored ${b.manifest.blobs.count} records`).test(o.stdout) && new RegExp(`all ${b.manifest.blobs.count} read back the same`).test(o.stdout), o.stdout + o.stderr);
const bad = path.join(dir, "damaged.zip"); const dz = Buffer.from(b.zip); dz[400] ^= 0xff; writeFileSync(bad, dz);
o = run(bad, "--apply");
ok("a damaged backup is not restored", o.status !== 0 && !/restored/.test(o.stdout), o.stdout + o.stderr);

console.log("— the netlify config");
const toml = readFileSync(R + "netlify.toml", "utf8");
ok("the backup functions are told to carry the code files, and no other function is", /\[functions\."backup-run-background"\]\s+included_files = \[[^\]]*"public\/\*\*"[^\]]*"netlify\/functions\/\*\*"/.test(toml) && /\[functions\."backup-schedule"\]/.test(toml) && /included_files = \["public\/assets\/\*\*"\]/.test(toml));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
