// Receipts from the server's side: who may, what Claude reads (against a stand-in Anthropic), confirming, duplicates, sums, the invoice.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
import http from "node:http";
process.env.ADMIN_KEY = "testkey";
// A stand-in for Anthropic's API: whatever `reply` holds is what Claude "read".
let reply = null, seen = [];
const fake = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
    seen.push({ url: req.url, body: JSON.parse(body || "{}") });
    if (reply?.error) { res.writeHead(reply.error, { "content-type": "application/json" }); return res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "bad key" } })); }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [{ type: "text", text: JSON.stringify(reply) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }));
  });
});
await new Promise((r) => fake.listen(0, "127.0.0.1", r));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fake.address().port}`;
process.env.ANTHROPIC_API_KEY = "sk-test";
const F = REPO + "netlify/functions/";
const events = (await import(F + "events.mjs")).default;
const sowFn = (await import(F + "sow.mjs")).default;
const rec = (await import(F + "receipts.mjs")).default;
const bg = (await import(F + "receipt-read-background.mjs")).default;
const roster = (await import(F + "roster.mjs")).default;
const { issueSession } = await import(F + "lib/auth.mjs");
const { totals, increase } = await import(F + "lib/sow.mjs");
const { tidy, cleanConfirm, receiptSums, withReceipts, isDuplicate } = await import(F + "lib/receipts.mjs");
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const pdfText = (buf) => { const d = mkdtempSync(path.join(tmpdir(), "pdf-")); writeFileSync(path.join(d, "x.pdf"), buf); return execFileSync("pdftotext", ["-layout", path.join(d, "x.pdf"), "-"]).toString(); };
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const as = (email) => ({ "x-admin-key": issueSession({ email, name: email }), "content-type": "application/json" });
const PRES = as("president@ongia.ca"), VP = as("vp_operations@ongia.ca"), LEAD = as("treasurer@ongia.ca"), MEMBER = as("j.healy@ongia.ca"), OUTSIDER = as("other.board@ongia.ca");
const call = async (h, url, method = "GET", body, headers = H) => { const r = await h(new Request("http://localhost" + url, { method, headers, body: body ? JSON.stringify(body) : undefined })); const ct = r.headers.get("content-type") ?? ""; return { status: r.status, res: r, ...(ct.includes("json") ? await r.json() : {}) }; };
const upload = async (id, bytes, who = PRES, name = "r.jpg") => { const r = await rec(new Request(`http://localhost/api/receipts?event=${id}`, { method: "POST", headers: { "x-admin-key": who["x-admin-key"], "x-file-name": name }, body: bytes })); return { status: r.status, ...(await r.json()) }; };
// The reader runs "in the background": run it by hand, as Netlify would after answering 202.
const runReader = async (id, draftId) => bg(new Request(`http://localhost/api/receipt-read-background?event=${id}&id=${draftId}`, { method: "POST", headers: H }));
await call(roster, "/api/roster");
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(200, 2)]);
const board = [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }, { name: "J Healy", email: "j.healy@ongia.ca", lead: false }];
const mk = async (extra) => (await call(events, "/api/events", "POST", { title: "ITP Training", city: "Montreal", dayOne: "2026-09-28", lastDay: "2026-10-02", invite: false, kind: "rbh", province: "QC", invoicePrefix: "ITP", board, presenters: [], ...extra })).event;

console.log("— the reading, tidied");
let t = tidy({ isReceipt: true, vendor: " Via Rail ", date: "2026-09-29", subtotal: 100, tax: 14.98, total: 114.98, currency: "cad", confidence: "high", suggestedLine: "Dinners", notes: null }, ["Hotel", "Dinners"]);
ok("a clean receipt: vendor trimmed, currency upper-cased, the line suggested, high confidence", t.vendor === "Via Rail" && t.currency === "CAD" && t.suggestedLine === "Dinners" && t.confidence === "high" && t.counted === 100);
t = tidy({ isReceipt: true, vendor: "X", date: "2026-09-29", subtotal: 100, tax: 14.98, total: 130, currency: null, confidence: "high", suggestedLine: "Nothing", notes: null }, ["Hotel"]);
ok("figures that don't add up are marked low whatever Claude said; a line that isn't on the SOW is not suggested", t.confidence === "low" && t.suggestedLine === null);
t = tidy({ isReceipt: true, vendor: "X", date: "bad", subtotal: null, tax: 15, total: 115, currency: null, confidence: "medium", suggestedLine: "Other", notes: null }, []);
ok("with no subtotal, the amount counted is the total less the tax; a bad date is blank; Other is accepted", t.counted === 100 && t.date === "" && t.suggestedLine === "Other");
ok("negative or junk numbers are dropped", tidy({ vendor: "X", subtotal: -5, tax: "x", total: null }, []).subtotal === null);

console.log("— confirming is checked");
const lineIds = ["a", "b"];
const payers = [{ email: "Treasurer@ongia.ca", name: "Raj Jaswal" }];
ok("a line that isn't on the SOW is refused", !!cleanConfirm({ lineId: "zz", vendor: "V", date: "2026-09-29", amount: 5 }, lineIds).problem);
ok("with a list of payers, one must be named, and it is matched without regard to case", !!cleanConfirm({ lineId: "a", vendor: "V", date: "2026-09-29", amount: 5 }, lineIds, payers).problem && cleanConfirm({ lineId: "a", vendor: "V", date: "2026-09-29", amount: 5, paidBy: "TREASURER@ongia.ca" }, lineIds, payers).ok.paidBy.name === "Raj Jaswal");
ok("Other needs a note", !!cleanConfirm({ lineId: "other", vendor: "V", date: "2026-09-29", amount: 5 }, lineIds).problem && !cleanConfirm({ lineId: "other", otherNote: "taxi", vendor: "V", date: "2026-09-29", amount: 5 }, lineIds).problem);
ok("vendor, date and the amount before tax are required; zero is allowed", !!cleanConfirm({ lineId: "a", date: "2026-09-29", amount: 5 }, lineIds).problem && !!cleanConfirm({ lineId: "a", vendor: "V", amount: 5 }, lineIds).problem && !!cleanConfirm({ lineId: "a", vendor: "V", date: "2026-09-29", amount: "" }, lineIds).problem && !cleanConfirm({ lineId: "a", vendor: "V", date: "2026-09-29", amount: 0 }, lineIds).problem);
ok("currency defaults to CAD and amounts round to the cent", (() => { const c = cleanConfirm({ lineId: "a", vendor: "V", date: "2026-09-29", amount: "12.345" }, lineIds).ok; return c.currency === "CAD" && c.amount === 12.35; })());
const sums = receiptSums([{ lineId: "a", amount: 10.1 }, { lineId: "a", amount: 0.2 }, { lineId: "other", amount: 5, otherNote: "taxi" }, { lineId: "other", amount: 1, otherNote: "taxi" }]);
ok("sums by line and under Other, with the notes listed once", sums.byLine.a === 10.3 && sums.other === 6 && sums.otherNotes.join() === "taxi");

console.log("— who may");
const ev = await mk();
const plain = await mk({ kind: "", title: "Not RBH" });
const sowR = await call(sowFn, `/api/sow?event=${ev.id}&create=1`, "POST", { from: "standard" }, PRES);
const L = Object.fromEntries(sowR.sow.lines.map((l) => [l.name, l.id]));
const g = (id, who) => call(rec, `/api/receipts?event=${id}`, "GET", undefined, who);
ok("the president, the VP, the lead and another board member on the event may", (await g(ev.id, PRES)).status === 200 && (await g(ev.id, VP)).status === 200 && (await g(ev.id, LEAD)).status === 200 && (await g(ev.id, MEMBER)).status === 200);
ok("a board member not on this event may not", (await g(ev.id, OUTSIDER)).status === 403);
ok("an upload by them is refused too", (await upload(ev.id, JPEG, OUTSIDER)).status === 403);
// ONGIA's own events keep receipts too (Andrew 30 Oct 2026), optional ones: the test is at the end.
ok("an ordinary event's receipts are for the same people", (await g(plain.id, PRES)).status === 200 && (await g(plain.id, OUTSIDER)).status === 403);
const lv = await g(ev.id, LEAD);
ok("the lead sees the names of the lines but no amounts and no sums", lv.lines.length === 8 && lv.lines.every((l) => Object.keys(l).sort().join() === "id,name") && lv.sums === null && lv.canCost === false);
ok("the president sees the sums", (await g(ev.id, PRES)).sums !== null);

console.log("— uploading");
ok("a file that isn't a photo or a PDF is refused", (await upload(ev.id, Buffer.from("hello world, plain text"), LEAD)).status === 415);
ok("an empty file is refused", (await upload(ev.id, Buffer.alloc(0), LEAD)).status === 400);
ok("a file over 5 MB is refused", (await upload(ev.id, Buffer.concat([JPEG, Buffer.alloc(5.1 * 1024 * 1024)]), LEAD)).status === 413);
ok("the type comes from the bytes, not the name: a JPEG called .pdf is a JPEG", (await upload(ev.id, JPEG, LEAD, "oops.pdf")).drafts?.at(-1)?.type === "image/jpeg");
reply = { isReceipt: true, vendor: "La Belle Province", date: "2026-09-29", subtotal: 200, tax: 29.95, total: 229.95, currency: "CAD", confidence: "high", suggestedLine: "Dinners", notes: null };
let up = await upload(ev.id, JPEG, LEAD, "dinner.jpg");
const d1 = up.drafts.at(-1);
ok("uploading answers 202 with a pending one that is being read", up.status === 202 && d1.read.state === "reading" || d1.read.state === "failed", JSON.stringify(d1.read));
// the real fetch to the background function goes nowhere in a test, so run it by hand
await runReader(ev.id, d1.id);
let v = await g(ev.id, LEAD);
const dd = v.drafts.find((x) => x.id === d1.id);
ok("once read: the vendor, date and amounts are there, and the line it suggests", dd.read.state === "done" && dd.read.found.vendor === "La Belle Province" && dd.read.found.counted === 200 && dd.read.found.suggestedLine === "Dinners", JSON.stringify(dd.read));
const sent = seen.at(-1).body;
ok("Claude is shown the image and the names of the lines, not their amounts", sent.messages[0].content.some((c) => c.type === "image") && /Dinners/.test(JSON.stringify(sent.messages)) && !/15000|estimate/i.test(JSON.stringify(sent.messages)));
reply = { error: 401 };
const d2 = (await upload(ev.id, PDF, LEAD, "bill.pdf")).drafts.at(-1);
await runReader(ev.id, d2.id);
const failedRead = (await g(ev.id, LEAD)).drafts.find((x) => x.id === d2.id);
ok("when Claude can't read it, the screen is told in plain words and the boxes can be filled by hand", failedRead.read.state === "failed" && /key was refused/.test(failedRead.read.why), failedRead.read.why);
ok("a PDF is sent as a document", seen.at(-1).body.messages[0].content.some((c) => c.type === "document"));

console.log("— confirming it");
const conf = (id, draft, body, who = LEAD) => call(rec, `/api/receipts?event=${id}&confirm=${draft}`, "POST", { paidBy: "treasurer@ongia.ca", ...body }, who);
ok("nothing is counted before it is confirmed", (await g(ev.id, PRES)).items.length === 0);
let r = await conf(ev.id, d1.id, { lineId: "nope", vendor: "La Belle Province", date: "2026-09-29", amount: 200 });
ok("a line that isn't on the SOW is refused", r.status === 400);
r = await conf(ev.id, d1.id, { lineId: L.Dinners, vendor: "La Belle Province", date: "2026-09-29", amount: 200, tax: 29.95, total: 229.95 });
ok("confirmed against Dinners: kept, with who added it, that Claude read it, and a note that SharePoint was skipped", r.status === 201 && r.items.length === 1 && r.items[0].lineId === L.Dinners && r.items[0].readBy === "claude" && r.items[0].addedBy.email === "treasurer@ongia.ca" && !r.items[0].filed && /Microsoft|SharePoint|folder/i.test(r.items[0].filedProblem ?? ""), JSON.stringify(r.items?.[0]));
ok("it is no longer pending", r.drafts.every((x) => x.id !== d1.id));
r = await call(rec, `/api/receipts?event=${ev.id}&file=${d1.id}`, "GET", undefined, LEAD);
ok("the photo can be opened again", r.status === 200 && r.res.headers.get("content-type") === "image/jpeg" && Buffer.from(await r.res.arrayBuffer()).length === JPEG.length);
await upload(ev.id, JPEG, MEMBER, "dinner-again.jpg");
const dup = (await g(ev.id, MEMBER)).drafts.at(-1);
r = await conf(ev.id, dup.id, { lineId: L.Dinners, vendor: "la belle province", date: "2026-09-29", amount: 200, total: 229.95 }, MEMBER);
ok("the same vendor, date and total again is stopped as a likely duplicate", r.status === 409 && /already/.test(r.error), JSON.stringify(r));
r = await conf(ev.id, dup.id, { lineId: L.Dinners, vendor: "la belle province", date: "2026-09-29", amount: 200, total: 229.95, force: true }, MEMBER);
ok("and goes through when they say it really is another", r.status === 201 && r.items.length === 2);

console.log("— Other, and the sums");
await upload(ev.id, PDF, PRES, "taxi.pdf");
const tx = (await g(ev.id, PRES)).drafts.find((x) => x.name === "taxi.pdf");
ok("Other without a note is refused", (await conf(ev.id, tx.id, { lineId: "other", vendor: "Taxi Coop", date: "2026-09-30", amount: 41.5 }, PRES)).status === 400);
r = await conf(ev.id, tx.id, { lineId: "other", otherNote: "Taxi to the studio", vendor: "Taxi Coop", date: "2026-09-30", amount: 41.5 }, PRES);
ok("Other with a note is kept", r.status === 201 && r.sums.other === 41.5 && r.sums.otherNotes[0] === "Taxi to the studio");
ok("the president's sums: Dinners 400 and Other 41.50", r.sums.byLine[L.Dinners] === 400 && r.sums.other === 41.5, JSON.stringify(r.sums));
r = await call(sowFn, `/api/sow?event=${ev.id}`, "GET", undefined, PRES);
const dn = r.sow.lines.find((l) => l.name === "Dinners");
ok("the SOW sees them: Dinners at cost is 400, Other is 41.50, and the invoice subtotal is the fixed lines plus both", dn.receiptsTotal === 400 && dn.receiptCount === 2 && r.sow.receiptsOther === 41.5 && r.actual.other === 41.5 && r.actual.subtotal === 441.5, JSON.stringify(r.actual));
ok("the SOW's own estimate is not touched by receipts", r.estimate.subtotal === 0 && r.estimate.other === 0);
const raw = await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines: r.sow.lines, taxes: r.sow.taxes, otherActual: "" }, PRES);
ok("saving the SOW doesn't write the receipts into it", raw.status === 200 && raw.actual.subtotal === 441.5);
r = await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines: r.sow.lines, taxes: r.sow.taxes, otherActual: 50 }, PRES);
ok("the invoice's Other can be typed over: 50 instead of 41.50", r.status === 200 && r.actual.other === 50 && r.actual.subtotal === 450, JSON.stringify(r.actual));
r = await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines: r.sow.lines.map((l) => (l.name === "Dinners" ? { ...l, actual: 380 } : l)), taxes: r.sow.taxes, otherActual: "" }, PRES);
ok("a line's typed total still wins over its receipts, and a blank Other goes back to the receipts", r.actual.subtotal === 380 + 41.5, JSON.stringify(r.actual));
const noDin = r.sow.lines.filter((l) => l.name !== "Dinners");
r = await call(sowFn, `/api/sow?event=${ev.id}`, "PUT", { lines: noDin, taxes: r.sow.taxes }, PRES);
ok("a line that has receipts can't be deleted", r.status === 409 && /Dinners/.test(r.error), JSON.stringify(r).slice(0, 200));
// the invoice PDF
const withDin = await call(sowFn, `/api/sow?event=${ev.id}`, "GET", undefined, PRES);
const pdf = await call(sowFn, `/api/sow?event=${ev.id}&doc=invoice`, "GET", undefined, PRES);
const txt = pdfText(Buffer.from(await pdf.res.arrayBuffer()));
ok("the invoice PDF has an OTHER line with its note and amount, and the receipts-based totals", /OTHER\s+\$41\.50/.test(txt) && /Taxi to the studio/.test(txt) && /\$380\.00/.test(txt), txt.slice(0, 900));
const pdf2 = await call(sowFn, `/api/sow?event=${ev.id}&doc=sow`, "GET", undefined, PRES);
ok("the SOW PDF has no Other line", !/OTHER/.test(pdfText(Buffer.from(await pdf2.res.arrayBuffer()))));

console.log("— changing and removing");
const mine = (await g(ev.id, LEAD)).items;
const leadsOne = mine.find((x) => x.vendor === "La Belle Province" && x.addedBy.email === "treasurer@ongia.ca");
const membersOne = mine.find((x) => x.addedBy.email === "j.healy@ongia.ca");
ok("the screen marks which are the viewer's own", mine.find((x) => x.id === leadsOne.id).mine === true && mine.find((x) => x.id === membersOne.id).mine === false);
const put = (id, item, body, who) => call(rec, `/api/receipts?event=${id}&item=${item}`, "PUT", body, who);
const body = (x) => ({ paidBy: x.paidBy.email, otherNote: x.otherNote, lineId: x.lineId, vendor: x.vendor, date: x.date, amount: x.amount, total: x.total, tax: x.tax });
ok("a board member can't change someone else's receipt", (await put(ev.id, membersOne.id, { ...body(membersOne), amount: 1 }, LEAD)).status === 403);
r = await put(ev.id, leadsOne.id, { ...body(leadsOne), amount: 210 }, LEAD);
ok("but can change their own", r.status === 200 && r.items.find((x) => x.id === leadsOne.id).amount === 210);
r = await put(ev.id, membersOne.id, { ...body(membersOne), lineId: L.AV }, PRES);
ok("the president can change anyone's, including moving it to another line", r.status === 200 && r.sums.byLine[L.AV] === 200);
ok("a board member can't remove someone else's", (await call(rec, `/api/receipts?event=${ev.id}&item=${membersOne.id}`, "DELETE", undefined, LEAD)).status === 403);
r = await call(rec, `/api/receipts?event=${ev.id}&item=${membersOne.id}`, "DELETE", undefined, PRES);
ok("the president removes it; the file goes too", r.status === 200 && r.items.length === 2 && (await call(rec, `/api/receipts?event=${ev.id}&file=${membersOne.id}`, "GET", undefined, PRES)).status === 404);
await upload(ev.id, JPEG, LEAD, "pending.jpg");
const pend = (await g(ev.id, LEAD)).drafts.at(-1);
r = await call(rec, `/api/receipts?event=${ev.id}&draft=${pend.id}`, "DELETE", undefined, LEAD);
ok("a pending upload can be discarded", r.status === 200 && r.drafts.every((x) => x.id !== pend.id));
ok("confirming a discarded one is a clear error", (await conf(ev.id, pend.id, { lineId: L.AV, vendor: "V", date: "2026-09-29", amount: 1 })).status === 404);

console.log("— after the invoice goes out");
await call(sowFn, `/api/sow?event=${ev.id}&status=invoiced`, "PUT", undefined, PRES);
ok("a board member can no longer add, change or remove", (await upload(ev.id, JPEG, LEAD)).status === 403 && (await put(ev.id, leadsOne.id, { ...body(leadsOne), amount: 5 }, LEAD)).status === 403 && (await call(rec, `/api/receipts?event=${ev.id}&item=${leadsOne.id}`, "DELETE", undefined, LEAD)).status === 403);
ok("the lead still sees the list, and is told it is closed", (await g(ev.id, LEAD)).closed === true);
ok("the president still can", (await upload(ev.id, JPEG, PRES)).status === 202);


console.log("— who paid");
{
  const ev2 = await mk({ title: "Deposit RBH" });
  await call(sowFn, `/api/sow?event=${ev2.id}&create=1`, "POST", { from: "standard" }, PRES);
  const choices = (await g(ev2.id, LEAD)).payers;
  ok("the board members on the event come first, then the rest of the board", choices[0].email === "treasurer@ongia.ca" && choices[0].onEvent === true && choices[1].email === "j.healy@ongia.ca" && choices[1].onEvent === true && choices.slice(2).every((x) => !x.onEvent) && choices.some((x) => x.email === "president@ongia.ca" && !x.onEvent), JSON.stringify(choices.slice(0, 4)));
  ok("each person is listed once", new Set(choices.map((x) => x.email)).size === choices.length);
  const dr = async (who = PRES) => (await upload(ev2.id, JPEG, who, "r.jpg")).drafts.at(-1);
  let d = await dr();
  const base = { lineId: "other", otherNote: "Hotel deposit", vendor: "Humaniti Hotel", date: "2026-08-01", amount: 1000 };
  let r = await call(rec, `/api/receipts?event=${ev2.id}&confirm=${d.id}`, "POST", base, PRES);
  ok("confirming without saying who paid is refused", r.status === 400 && /board member/.test(r.error), JSON.stringify(r));
  r = await call(rec, `/api/receipts?event=${ev2.id}&confirm=${d.id}`, "POST", { ...base, paidBy: "stranger@example.com" }, PRES);
  ok("someone who isn't on the board can't be named", r.status === 400);
  r = await call(rec, `/api/receipts?event=${ev2.id}&confirm=${d.id}`, "POST", { ...base, paidBy: "President@ongia.ca" }, PRES);
  ok("the president, who isn't on this event, can be named for a deposit he paid", r.status === 201 && r.items[0].paidBy.email === "president@ongia.ca" && r.items[0].paidBy.name === "Andrew Hammond", JSON.stringify(r.items?.[0]?.paidBy));
  d = await dr(LEAD);
  r = await conf(ev2.id, d.id, { ...base, vendor: "Taxi", amount: 40, tax: 6, total: 46, date: "2026-09-29", paidBy: "j.healy@ongia.ca" }, LEAD);
  ok("a board member can say a colleague on the event paid", r.status === 201 && r.items.find((x) => x.vendor === "Taxi").paidBy.email === "j.healy@ongia.ca");
  ok("the lead does not get the per-person totals", r.byPayer === null);
  const pv = await g(ev2.id, PRES);
  ok("the president gets each person's total paid (tax included) and the count", pv.byPayer.length === 2 && pv.byPayer.find((x) => x.email === "j.healy@ongia.ca").paid === 46 && pv.byPayer.find((x) => x.email === "president@ongia.ca").paid === 1000 && pv.byPayer[0].count === 1, JSON.stringify(pv.byPayer));
  const taxi = pv.items.find((x) => x.vendor === "Taxi");
  r = await put(ev2.id, taxi.id, { ...body(taxi), paidBy: "treasurer@ongia.ca" }, PRES);
  ok("who paid can be changed afterwards", r.status === 200 && r.items.find((x) => x.id === taxi.id).paidBy.email === "treasurer@ongia.ca", JSON.stringify(r).slice(0, 300));
  r = await put(ev2.id, taxi.id, { ...body(taxi), paidBy: "" }, PRES);
  ok("but not cleared", r.status === 400);
}

console.log("— no key / no SOW");
const bare = await mk({ title: "Bare RBH" });
delete process.env.ANTHROPIC_API_KEY;
up = await upload(bare.id, JPEG, LEAD);
ok("with no Anthropic key the upload is kept and the screen says to type it in", up.status === 202 && up.drafts[0].read.state === "failed" && /no Anthropic API key/.test(up.drafts[0].read.why));
ok("with no SOW yet there are no lines, only Other", up.lines.length === 0 && up.hasSow === false);
r = await conf(bare.id, up.drafts[0].id, { lineId: "other", otherNote: "taxi", vendor: "V", date: "2026-09-29", amount: 9 }, LEAD);
ok("and Other can still be used", r.status === 201 && r.items[0].readBy === "hand");
const wr = withReceipts({ lines: [{ id: "a", name: "A", type: "cost", estimate: 10 }] }, [{ lineId: "gone", amount: 7 }, { lineId: "a", amount: 3 }]);
ok("a receipt against a line that has since gone counts as Other", wr.receiptsOther === 7 && wr.lines[0].receiptsTotal === 3);
ok("the duplicate check compares the total when there is one, else the amount", isDuplicate([{ vendor: "A", date: "d", amount: 10, total: 11.5 }], { vendor: "a", date: "d", amount: 10, total: 11.5 }) && !isDuplicate([{ vendor: "A", date: "d", amount: 10, total: 11.5 }], { vendor: "a", date: "d", amount: 10, total: 12 }));

console.log("— one of ONGIA's own events: receipts optional");
// Andrew 30 Oct 2026: "every single line item is not going to have a receipt attached, but at least people could upload
// it, and the event will store those receipts ... the receipts aren't mandatory."
process.env.ANTHROPIC_API_KEY = "sk-test";
const { putMeta } = await import(F + "lib/store.mjs");
await putMeta(`budget:${plain.id}`, { budget: { other: [{ id: "o1", group: "Venue & AV", name: "AV for the virtual component", planned: 4200 }, { id: "o2", name: "" }] } });
let pv = await g(plain.id, PRES);
ok("its lines are the budget's: hotel rooms, food and beverage, and each line under Everything else", pv.linesFrom === "budget" && pv.optional === true && pv.lines.map((l) => l.name).join("|") === "Hotel rooms|Food & beverage|AV for the virtual component" && pv.lines[2].estimate === 4200, JSON.stringify(pv.lines));
ok("a board member on the event sees the names, not what each line is planned at", (await g(plain.id, LEAD)).lines.every((l) => l.estimate === undefined));
reply = { isReceipt: true, vendor: "Ottawa AV Rentals", date: "2026-09-29", subtotal: 3900, tax: 507, total: 4407, currency: "CAD", confidence: "high", suggestedLine: "AV for the virtual component", notes: null };
up = await upload(plain.id, JPEG, LEAD);
await runReader(plain.id, up.started);
pv = await g(plain.id, LEAD);
ok("Claude is given the budget's lines and suggests one", pv.drafts[0].read.state === "done" && pv.drafts[0].read.found.suggestedLine === "AV for the virtual component" && /AV for the virtual component/.test(JSON.stringify(seen.at(-1).body)));
r = await conf(plain.id, up.started, { paidBy: "", lineId: "b-o1", vendor: "Ottawa AV Rentals", date: "2026-09-29", amount: 3900, tax: 507, total: 4407 }, LEAD);
ok("kept under its budget line, with nobody named as having paid it (ONGIA paid directly)", r.status === 201 && r.items[0].lineId === "b-o1" && !r.items[0].paidBy, JSON.stringify(r).slice(0, 200));
up = await upload(plain.id, PDF, PRES);
r = await conf(plain.id, up.started, { vendor: "Corner Store", date: "2026-09-30", amount: 18.5 }, PRES);
ok("no line and no note is fine: it's kept, unsorted", r.status === 201 && r.items.some((x) => x.vendor === "Corner Store" && x.lineId === "other" && x.otherNote === ""), JSON.stringify(r).slice(0, 300));
pv = await g(plain.id, PRES);
ok("the president sees what's been spent against each line", pv.sums.byLine["b-o1"] === 3900 && pv.sums.other === 18.5 && pv.total === 3918.5);
r = await conf(plain.id, (await upload(plain.id, JPEG, PRES)).started, { lineId: "b-zz", vendor: "X", date: "2026-09-30", amount: 1 }, PRES);
ok("a line that isn't in the budget is still refused", r.status === 400 && /isn't in the budget/.test(r.error ?? ""), JSON.stringify(r).slice(0, 200));

fake.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
