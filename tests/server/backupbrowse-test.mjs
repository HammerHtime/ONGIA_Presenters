// Looking inside a backup and comparing before restoring (Andrew 26 Nov 2026). A made-up backup of made-up records.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const { createHash } = await import("node:crypto");
const { makeZip } = await import(REPO + "netlify/functions/lib/zip.mjs");
const S = await import(REPO + "netlify/functions/lib/store.mjs");
const B = await import(REPO + "netlify/functions/lib/backupbrowse.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };

// The backup, as the nightly one makes it: blobs/<key> and a MANIFEST with each one's checksum.
const then = {
  "event:ev1": { id: "ev1", title: "Sample ITP Training" },
  "sow:ev1": { status: "invoiced", invoice: { number: "ITP-2026-002" }, lines: [{ name: "Hotel", estimate: 8000 }] },
  "sow:ev2": { status: "draft", lines: [] },
  "roster": [{ name: "Pat", email: "pat@example.ca" }],
  "meta:letter-signature": { svg: "<svg/>" },
};
const entries = [], items = [];
for (const [key, v] of Object.entries(then)) {
  const data = Buffer.from(JSON.stringify(v));
  entries.push({ name: `blobs/${encodeURIComponent(key)}`, data });
  items.push({ key, size: data.length, sha256: createHash("sha256").update(data).digest("hex"), metadata: {} });
}
entries.push({ name: "MANIFEST.json", data: Buffer.from(JSON.stringify({ blobs: { count: items.length, items } })) });
const zip = makeZip(entries);

// The desk now: ev1's statement of work emptied, ev2's unchanged, a new one since.
await S.putEvent({ id: "ev1", title: "Sample ITP Training" });
const raw = (k, v) => S.writeRaw(k, Buffer.from(JSON.stringify(v)));
await raw("sow:ev1", { status: "draft", lines: [] });
await raw("sow:ev2", then["sow:ev2"]);
await raw("sow:ev3", { status: "draft", lines: [] });

const man = B.manifestOf(zip);
ok("the signature is never listed", !man.has("meta:letter-signature"));
const counts = Object.fromEntries(B.groupCounts(man).map((g) => [g.id, g.count]));
ok("records are counted by kind", counts.money === 2 && counts.events === 1 && counts.board === 1, JSON.stringify(counts));
const money = await B.browse(zip, "money", { manifest: man });
const st = Object.fromEntries(money.items.map((i) => [i.key, i.status]));
ok("each statement of work: changed, same, or new since the backup", st["sow:ev1"] === "changed" && st["sow:ev2"] === "same" && st["sow:ev3"] === "new", JSON.stringify(st));
ok("named by its event", money.items.find((i) => i.key === "sow:ev1").label.includes("Sample ITP Training"), money.items.find((i) => i.key === "sow:ev1").label);
const c = await B.compare(zip, "sow:ev1", { manifest: man });
ok("compared field by field: the status and the invoice number then and now", c.differences.some((d) => d.path === "status" && d.then === "invoiced" && d.now === "draft") && c.differences.some((d) => d.path === "invoice" || d.path === "invoice.number"), JSON.stringify(c.differences));
ok("comparing changes nothing", JSON.parse(Buffer.from((await S.readRaw("sow:ev1")).bytes).toString()).status === "draft");

const r = await B.restore(zip, "sow:ev1", "2026-11-20", "Andrew Hammond", { manifest: man });
ok("restored: the record is as it was that night", r.restored && JSON.parse(Buffer.from((await S.readRaw("sow:ev1")).bytes).toString()).status === "invoiced");
ok("…and it's in the list of restores", (await B.restoreLog())[0].key === "sow:ev1");
const u = await B.undoRestore(r.restored.id, "Andrew Hammond");
ok("undone: back to what it was just before", u.undone && JSON.parse(Buffer.from((await S.readRaw("sow:ev1")).bytes).toString()).status === "draft");
ok("an undo can't be done twice", !!(await B.undoRestore(r.restored.id, "x")).error);
await S.deleteKey("event:ev9");
const r2 = await B.restore(zip, "sow:ev2", "2026-11-20", "A", { manifest: man });
ok("a record that didn't exist before goes away again on undo", r2.restored && (await B.undoRestore(r2.restored.id, "A")).undone);
ok("the signature can't be restored from here", !!(await B.restore(zip, "meta:letter-signature", "2026-11-20", "A", { manifest: man })).error);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
