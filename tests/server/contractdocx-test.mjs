// A hotel contract sent as a Word document (Andrew 7 Nov 2026: "The app doesn't allow me to upload ms word documents").
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const F = REPO + "netlify/functions/";
const { makeZip } = await import(F + "lib/zip.mjs");
const { isDocx, docxText, readContract } = await import(F + "lib/contract.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Group: ONGIA &amp; partners</w:t></w:r></w:p>
<w:p><w:r><w:t>Arrival</w:t></w:r><w:r><w:tab/><w:t>April 12, 2027</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cut-off</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>March 12, 2027</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`;
const docx = makeZip([{ name: "[Content_Types].xml", data: Buffer.from("<Types/>") }, { name: "word/document.xml", data: Buffer.from(xml) }]);
ok("a .docx is recognised; a PDF and random bytes aren't", isDocx(docx) && !isDocx(Buffer.from("%PDF-1.4")) && !isDocx(Buffer.from("PK nonsense")));
const t = docxText(docx);
ok("its text comes out: paragraphs, tabs, table cells, & decoded", /Group: ONGIA & partners/.test(t) && /Arrival\tApril 12, 2027/.test(t) && /Cut-off \| March 12, 2027/.test(t), JSON.stringify(t));
let sent = null;
const client = { beta: { messages: { stream: (req) => { sent = req; return { finalMessage: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ hotelName: "Hotel PUR", rate: "", city: "Quebec", meetingFirst: "2027-04-13", meetingLast: "2027-04-14", arrival: "2027-04-12", departure: "2027-04-14", dates: [], notes: "" }) }] }) }; } } } };
try { await readContract(docx, { title: "Royalties", city: "Quebec", dayOne: "2027-04-13", lastDay: "2027-04-14" }, { client }); } catch (e) { console.log("   (reader said:", e.message, ")"); }
const src = sent?.messages?.[0]?.content?.[0]?.source;
ok("Claude is given the Word contract as text, not as a PDF", src?.type === "text" && /March 12, 2027/.test(src.data), JSON.stringify(src).slice(0, 160));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
