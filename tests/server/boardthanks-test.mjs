// The board's thank-you, from the Admin page (Andrew 16 Nov 2026): "a separate button for the board members so I can send
// them a thank you email, just a brief one … I've attached a thank you letter that you could forward to your … boss".
const REPO = new URL("../../", import.meta.url).pathname;
process.env.RESEND_API_KEY = "test-key"; process.env.APP_URL = "https://events.example.org"; process.env.ADMIN_KEY = "testkey";
delete process.env.MS_MAIL_FROM;
const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.resend.com/")) { const p = JSON.parse(init.body); sent.push({ to: String(p.to), subject: p.subject, text: p.text, html: p.html, files: p.attachments ?? [] }); return Response.json({ id: "m" + sent.length }); }
  throw new Error("unexpected fetch " + url);
};
const F = REPO + "netlify/functions/";
const S = await import(F + "lib/store.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };

await S.putRoster([
  { name: "Andrew Hammond", email: "president@ongia.ca", phone: "416-230-9802" },
  { name: "John Healy", email: "j.healy@ongia.ca" },
  { name: "Jacqulyn Taylor", email: "vp_operations@ongia.ca", phone: "905-555-0100" },
]);
const fn = (await import(F + "boardthanks.mjs")).default;
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = (q, method = "GET", body) => fn(new Request(`http://x/api/boardthanks${q}`, { method, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) }));

let v = await (await call("")).json();
ok("every board member, Andrew left off his own list", v.people.length === 3 && !v.people.find((p) => p.email === "president@ongia.ca").in && v.people.filter((p) => p.in).length === 2, JSON.stringify(v.people.map((p) => [p.email, p.in])));
ok("the standard words and letter", v.standard && v.letterStandard && /another successful year/.test(v.body) && /continued support of \{name\}/.test(v.letter));

const t = await call("?test=1", "POST", { to: "j.healy@ongia.ca" });
const m = sent.at(-1);
ok("a test, made out to whoever it goes to, marked TEST", t.status === 200 && m.to === "j.healy@ongia.ca" && /^TEST: Thank you for another year with ONGIA/.test(m.subject) && /Hi John,/.test(m.text));
ok("signed by Andrew, from the roster", /Andrew Hammond/.test(m.text) && /416-230-9802/.test(m.text), m.text.slice(-300));
ok("with a letter for John's employer, named for him", /^Healy John - Letter of appreciation - /.test(m.files[0]?.filename ?? ""));
{
  const { execFileSync } = await import("node:child_process"); const fs = await import("node:fs"); const os = await import("node:os");
  const f = os.tmpdir() + "/board-letter.pdf"; fs.writeFileSync(f, Buffer.from(m.files[0].content, "base64"));
  if (process.env.BOARD_LETTER_OUT) fs.writeFileSync(process.env.BOARD_LETTER_OUT, Buffer.from(m.files[0].content, "base64"));
  let txt = ""; try { txt = execFileSync("pdftotext", [f, "-"]).toString().replace(/\s+/g, " "); } catch {}
  if (txt) ok("the letter: one page, his name, the board, his employer thanked", /Pages:\s+1\b/.test(execFileSync("pdfinfo", [f]).toString()) && /continued support of John Healy, who serves on the Board of Directors of ONGIA/.test(txt) && /Thank you for allowing John/.test(txt), txt.slice(0, 400));
}
const n0 = sent.length;
let r = await (await call("?send=1", "POST", {})).json();
ok("Send: John and Jacqulyn, not Andrew", r.sent === 2 && sent.length === n0 + 2 && !sent.slice(n0).some((x) => x.to === "president@ongia.ca"));
r = await (await call("?send=1", "POST", {})).json();
ok("nobody gets this year's twice", r.sent === 0 && sent.length === n0 + 2);
r = await (await call(`?send=1&emails=${encodeURIComponent("president@ongia.ca")}`, "POST", {})).json();
ok("Send to the ones ticked: Andrew only", r.sent === 1 && sent.at(-1).to === "president@ongia.ca");
ok("Andrew's own is signed by the VP, not by himself", /Jacqulyn Taylor/.test(sent.at(-1).html) && /VP of Operations, ONGIA/.test(sent.at(-1).html) && !/President, ONGIA/.test(sent.at(-1).html), sent.at(-1).text.slice(-300));
{
  const { execFileSync } = await import("node:child_process"); const fs = await import("node:fs"); const os = await import("node:os");
  const f = os.tmpdir() + "/board-andrew.pdf"; fs.writeFileSync(f, Buffer.from(sent.at(-1).files[0].content, "base64"));
  if (process.env.ANDREW_LETTER_OUT) fs.writeFileSync(process.env.ANDREW_LETTER_OUT, fs.readFileSync(f));
  let txt = ""; try { txt = execFileSync("pdftotext", [f, "-"]).toString().replace(/\s+/g, " "); } catch {}
  if (txt) ok("…and his letter: continued support of Andrew Hammond, signed Jacqulyn Taylor, VP of Operations", /continued support of Andrew Hammond/.test(txt) && /Sincerely, Jacqulyn Taylor/.test(txt) && /VP of Operations – ONGIA/.test(txt) && !/President – ONGIA/.test(txt), txt.slice(-300));
}
const others = sent.filter((m) => m.to === "j.healy@ongia.ca").at(-1);
ok("everyone else's is signed President, ONGIA", /President, ONGIA/.test(others.html));
v = await (await call("", "PUT", { email: "president@ongia.ca", pick: "yes" })).json();
ok("Andrew added by hand", v.people.find((p) => p.email === "president@ongia.ca").in);
v = await (await call("", "PUT", { body: "Hi {frist}" })).json();
ok("a blank that isn't one is refused", /frist/.test(v.error ?? ""), JSON.stringify(v));
const pdf = await call("?letter=j.healy@ongia.ca");
ok("one member's letter downloads", pdf.status === 200 && pdf.headers.get("content-type") === "application/pdf");
process.env.ADMIN_KEY = "testkey";
ok("no key, no access", (await fn(new Request("http://x/api/boardthanks"))).status === 401);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
