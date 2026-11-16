// The board's hand-filed expense files given names that say whose, which claim and the merchant (Andrew 16 Nov 2026).
const REPO = new URL("../../", import.meta.url).pathname;
const H = await import(REPO + "netlify/functions/lib/handrename.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };

const r = (o) => ({ kind: "receipt", last: "Hammond", first: "Andrew", month: "2026-10", event: null, what: "", merchant: "Delta Hotels", amount: 658.12, ...o });
ok("a receipt: last name, the claim's month, merchant and amount", H.newName(r(), "IMG_2912.jpg") === "Hammond - Oct 2026 claim - Delta Hotels $658.12.jpg", H.newName(r(), "IMG_2912.jpg"));
ok("filed under an event: the event names the claim", H.newName(r({ month: null, event: "Calgary 2025" }), "a.pdf") === "Hammond - Calgary 2025 claim - Delta Hotels $658.12.pdf");
ok("no amount it could see: merchant only", H.newName(r({ amount: null }), "a.pdf") === "Hammond - Oct 2026 claim - Delta Hotels.pdf");
ok("no merchant either: the file's own name kept after the claim", H.newName(r({ merchant: null, amount: null }), "mi_folio_e15388506.pdf") === "Hammond - Oct 2026 claim - mi_folio_e15388506.pdf");
ok("a claim form: last first, what, the month in full", H.newName({ ...r(), kind: "claim", what: "Expense claim" }, "Hammond October Expense Claim_1.xlsx") === "Hammond Andrew - Expense claim - October 2026.xlsx");
ok("a stipend sheet says so", H.newName({ ...r(), kind: "claim", what: "Stipends", month: null, event: "Sept-Dec 2026" }, "Hammond Stipends_Sept_Dec 2026.xlsx") === "Hammond Andrew - Stipends - Sept-Dec 2026.xlsx");
ok("a template, or no person, or no month or event: left as it is", H.newName({ ...r(), kind: "other" }, "t.xltx") === null && H.newName(r({ last: "" }), "a.jpg") === null && H.newName(r({ month: null, event: null }), "a.jpg") === null);
ok("characters a file name can't hold are dropped", H.newName(r({ merchant: "A/B: Co?" }), "a.jpg") === "Hammond - Oct 2026 claim - A B Co $658.12.jpg", H.newName(r({ merchant: "A/B: Co?" }), "a.jpg"));
const plans = H.uniqueInFolder([{ from: "a.jpg", to: "Hammond - Oct 2026 claim - Green P $18.00.jpg" }, { from: "b.jpg", to: "Hammond - Oct 2026 claim - Green P $18.00.jpg" }, { from: "c.jpg", to: null }], ["a.jpg", "b.jpg", "c.jpg", "Hammond - Oct 2026 claim - Esso $40.00.jpg"]);
ok("two alike in one folder: the second gets (2)", plans[0].to === "Hammond - Oct 2026 claim - Green P $18.00.jpg" && plans[1].to === "Hammond - Oct 2026 claim - Green P $18.00 (2).jpg", JSON.stringify(plans));
const p2 = H.uniqueInFolder([{ from: "x.jpg", to: "Hammond - Oct 2026 claim - Esso $40.00.jpg" }], ["x.jpg", "Hammond - Oct 2026 claim - Esso $40.00.jpg"]);
ok("never the name of a file already there", p2[0].to === "Hammond - Oct 2026 claim - Esso $40.00 (2).jpg", p2[0].to);

// Claude, stood in: what it is shown.
let shown = null;
const client = { beta: { messages: { create: async (q) => { shown = q; return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(r()) }] }; } } } };
const facts = await H.readFileFacts({ path: "ONGIA Board/x/Board Members Expenses/2026/Andrew Hammond/October 2026/IMG_1.jpg", name: "IMG_1.jpg" }, Buffer.from("img"), "image/jpeg", { client });
ok("Claude is shown the picture and the folder path, and its answer is used", facts.merchant === "Delta Hotels" && shown.messages[0].content[0].type === "image" && /2026\/Andrew Hammond\/October 2026/.test(shown.messages[0].content[1].text));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
