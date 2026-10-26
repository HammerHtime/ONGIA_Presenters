// The housekeeping questions for attendees (Andrew 26 Oct 2026, National Gang Summit): food allergies and the socials,
// one email to everyone registered, answers kept as two separate lists, each a spreadsheet.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const REPO = new URL("../../", import.meta.url).pathname;
process.env.RESEND_API_KEY = "test-key";
process.env.APP_URL = "https://events.example.org";
delete process.env.MS_MAIL_FROM;
const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.resend.com/")) {
    const p = JSON.parse(init.body);
    sent.push({ to: p.to, subject: p.subject, html: p.html, text: p.text });
    return new Response(JSON.stringify({ id: "m" + sent.length }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error("unexpected fetch " + url);
};
const F = REPO + "netlify/functions/";
const reply = (await import(F + "reply.mjs")).default;
const { putEvent, getEvent, putAttendees, getAttendees } = await import(F + "lib/store.mjs");
const { startingReply } = await import(F + "lib/reply.mjs");
const { runLetterRounds } = await import(F + "lib/sendletters.mjs");
const { issueSession } = await import(F + "lib/auth.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (qs, { method = "GET", body, headers = H } = {}) => {
  const res = await reply(new Request(`http://localhost/api/reply?${qs}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, body: type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer()), type };
};
const readXlsx = (bytes) => {
  const d = mkdtempSync(path.join(tmpdir(), "xl-")); const f = path.join(d, "x.xlsx"); writeFileSync(f, bytes);
  return JSON.parse(execFileSync("python3", ["-I", "-c", `import openpyxl,json,sys
wb=openpyxl.load_workbook(sys.argv[1]); ws=wb.active
print(json.dumps({"rows":[[c for c in r] for r in ws.iter_rows(values_only=True)],"merged":[str(m) for m in ws.merged_cells.ranges],"widths":{k:v.width for k,v in ws.column_dimensions.items()},"bold":ws["A4"].font.b,"fill":ws["A4"].fill.fgColor.rgb,"title":ws["A1"].font.sz}, default=str))`, f]).toString());
};

const ngs = { id: "ngs", title: "National Gang Summit", city: "Toronto, ON", venue: "Sample Hotel", dayOne: "2026-11-09", lastDay: "2026-11-12", board: [], attendeeMail: true,
  contact: { name: "Andrew Hammond", email: "president@ongia.ca" } };
await putEvent(ngs);
const person = (email, first, last, status = "ATTENDING") => ({ email, first, last, status, source: "wix" });
await putAttendees("ngs", { people: [person("a@example.ca", "Ann", "One"), person("b@example.ca", "Ben", "Two"), person("b@example.ca", "Guest", "OfBen"), person("c@example.ca", "Cat", "Three", "NOT_ATTENDING")] });

/* setting it up */
const defaults = startingReply(ngs, new Date("2026-10-26T15:00:00Z"));
ok("the reply-by date starts as the Friday of this week (Friday 30 October)", defaults.replyBy === "2026-10-30", defaults.replyBy);
ok("the two socials start on the Tuesday and the Wednesday of the Summit", defaults.socials[0].date === "2026-11-10" && /WATTS/.test(defaults.socials[0].label) && defaults.socials[1].date === "2026-11-11" && /band/.test(defaults.socials[1].label));
const board = { "x-admin-key": issueSession({ email: "secretary@ongia.ca", name: "Lee" }), "content-type": "application/json" };
ok("a board member who is not on this event cannot set it up", (await call("event=ngs", { method: "PUT", body: {}, headers: board })).status === 403);
const set = (await call("event=ngs", { method: "PUT", body: { replyBy: "2026-10-30" } })).body;
ok("setting it up gives a form link", /^https:\/\/events\.example\.org\/q\/[A-Za-z0-9_-]{16}$/.test(set.link), set.link);
ok("nothing is held back", set.problems.length === 0, set.problems.join(" | "));
const tok = set.link.split("/q/")[1];

/* the email */
const pv = (await call("event=ngs&preview=1", { method: "POST", body: {} })).body;
ok("the email names the event, the date to answer by, and both socials", /National Gang Summit/.test(pv.subject) && /Friday, October 30/.test(pv.text) && /Tuesday, November 10: Networking social, followed by a screening of the documentary WATTS/.test(pv.text) && /Wednesday, November 11: Social at the hotel, with a live band/.test(pv.text), pv.text);
ok("its button goes to the form", pv.html.includes(`https://events.example.org/q/${tok}`) && /Answer the questions/.test(pv.html));
ok("no blank left unfilled", !/\{[a-zA-Z0-9]+\}/.test(pv.text));
const test = (await call("event=ngs&test=1", { method: "POST", body: { to: "president@ongia.ca" } })).body;
ok("a test goes to one address, marked TEST", test.ok && sent.length === 1 && sent[0].to.includes("president@ongia.ca") && /^TEST: /.test(sent[0].subject));
sent.length = 0;

/* sending */
const s1 = (await call("event=ngs&send=1", { method: "POST", body: {} })).body;
ok("it goes once to each registered address that is coming (2: Ann, and Ben's registration with his guest)", s1.sent === 2 && sent.map((m) => m.to).flat().sort().join() === "a@example.ca,b@example.ca", JSON.stringify(s1));
ok("not to someone not coming", !sent.some((m) => String(m.to).includes("c@example.ca")));
const s2 = (await call("event=ngs&send=1", { method: "POST", body: {} })).body;
ok("pressing send again sends nobody a second copy", s2.sent === 0 && sent.length === 2, JSON.stringify(s2));
const st = (await call("event=ngs")).body.status;
ok("the card shows it reached everyone", st.had === 2 && st.reaches === 2, JSON.stringify(st));
// Someone registers later: the next night catches them, up to the reply-by date.
const people = (await getAttendees("ngs")).people; people.push(person("d@example.ca", "Dee", "Late")); await putAttendees("ngs", { ...(await getAttendees("ngs")), people });
await runLetterRounds([await getEvent("ngs")], { today: "2026-10-28", pace: async () => {} });
ok("someone who registers later gets it the next night", sent.length === 3 && String(sent[2].to).includes("d@example.ca"));
people.push(person("e@example.ca", "Eve", "TooLate")); await putAttendees("ngs", { ...(await getAttendees("ngs")), people });
await runLetterRounds([await getEvent("ngs")], { today: "2026-10-31", pace: async () => {} });
ok("but not after the reply-by date", sent.length === 3);

/* the form */
const form = (await call(`t=${tok}`)).body;
ok("the form shows the event, the date to answer by, and the two socials in both languages", form.title === "National Gang Summit" && form.dates === "November 9–12, 2026" && form.datesFr === "du 9 au 12 novembre 2026" && form.replyByLong === "Friday, October 30" && form.replyByLongFr === "vendredi 30 octobre" && form.socials.length === 2 && /^mardi 10 novembre : /.test(form.socials[0].fr), JSON.stringify(form));
ok("the form does not show who answered or any email address", !JSON.stringify(form).includes("@example.ca"));
const answer = (o) => call(`t=${tok}`, { method: "POST", body: { first: "Ann", last: "One", agency: "Toronto Police Service", email: "A@example.ca", allergy: false, socials: { s1: "yes", s2: "no" }, ...o } });
const bad = (await answer({ agency: "", allergy: true, dietary: "", socials: { s1: "yes" } })).body;
ok("a half-filled form says what is missing", bad.error === "missing" && ["agency", "dietary", "s2"].every((k) => bad.problems.includes(k)), JSON.stringify(bad));
ok("no allergy: nothing to fill in about food", (await answer({})).body.ok === true);
const again = (await answer({ allergy: true, dietary: "Allergic to shrimp", socials: { s1: "yes", s2: "yes" } })).body;
ok("the same person answering again replaces their first answer", again.ok && again.again === true);
await call(`t=${tok}`, { method: "POST", body: { first: "Guest", last: "OfBen", agency: "OPP", email: "b@example.ca", allergy: true, dietary: "Vegan", socials: { s1: "no", s2: "yes" } } });
await call(`t=${tok}`, { method: "POST", body: { first: "Ben", last: "Two", agency: "OPP", email: "b@example.ca", allergy: false, dietary: "should be dropped", socials: { s1: "yes", s2: "no" } } });
const all = (await call("event=ngs")).body.answers;
ok("three people answered: Ben and his guest at the same address are two rows", all.length === 3, JSON.stringify(all.map((a) => a.first)));
ok("a ticked-off allergy keeps no text", all.find((a) => a.first === "Ben").dietary === "");

/* the two lists */
const diet = await call("event=ngs&sheet=dietary");
ok("the dietary list downloads as a spreadsheet", diet.status === 200 && /spreadsheetml/.test(diet.type));
const D = readXlsx(diet.body);
ok("laid out like Andrew's sheet: title, event line, a blank row, then the header", D.rows[0][0] === "Allergy / Dietary List" && D.rows[1][0] === "ONGIA – National Gang Summit, November 9–12, 2026" && D.rows[2].every((c) => c === null) && D.rows[3].join("|") === "First Name|Last Name|Allergy / Dietary|Table Number\n(If Applicable)", JSON.stringify(D.rows.slice(0, 4)));
ok("only the people with an allergy, by last name", JSON.stringify(D.rows.slice(4)) === JSON.stringify([["Guest", "OfBen", "Vegan", null], ["Ann", "One", "Allergic to shrimp", null]]), JSON.stringify(D.rows.slice(4)));
ok("same widths, grey bold header, merged title", D.widths.A === 16 && D.widths.C === 48 && D.bold === true && D.fill === "FFD9D9D9" && D.title === 14 && D.merged.includes("A1:D1"), JSON.stringify(D));
const soc = readXlsx((await call("event=ngs&sheet=socials")).body);
ok("the socials list is separate: name, agency, yes or no to each", soc.rows[3].slice(0, 3).join("|") === "First Name|Last Name|Agency" && /Tuesday, November 10/.test(soc.rows[3][3]) && /Wednesday, November 11/.test(soc.rows[3][4]) && soc.rows.length === 4 + 3 + 1, JSON.stringify(soc.rows));
ok("with no food details in it", !JSON.stringify(soc.rows).includes("shrimp") && !JSON.stringify(soc.rows).includes("Vegan"));
ok("and totals underneath: 2 coming Tuesday, 2 Wednesday", JSON.stringify(soc.rows.at(-1)) === JSON.stringify(["Total coming", null, "3 answered", 2, 2]), JSON.stringify(soc.rows.at(-1)));

/* removing an answer, closing the form */
const ann = all.find((a) => a.first === "Ann");
ok("an answer can be removed", (await call(`event=ngs&answer=${ann.id}`, { method: "DELETE" })).body.answers.length === 2);
await call("event=ngs", { method: "PUT", body: { open: false } });
ok("a closed form takes no answers", (await answer({})).status === 409 && (await call(`t=${tok}`)).body.open === false);
ok("and the email will not send while it is closed", /closed/.test((await call("event=ngs")).body.problems.join(" ")));
ok("a made-up link finds nothing", (await call("t=notarealtoken123")).status === 404);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
