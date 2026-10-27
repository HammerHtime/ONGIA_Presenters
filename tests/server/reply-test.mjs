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
    sent.push({ to: p.to, subject: p.subject, html: p.html, text: p.text, replyTo: p.reply_to });
    return new Response(JSON.stringify({ id: "m" + sent.length }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error("unexpected fetch " + url);
};
const F = REPO + "netlify/functions/";
const reply = (await import(F + "reply.mjs")).default;
const { putEvent, getEvent, putAttendees, getAttendees } = await import(F + "lib/store.mjs");
const { startingReply } = await import(F + "lib/reply.mjs");
const { personalId } = await import(F + "lib/letters.mjs");
const { xlsx } = await import(F + "lib/xlsx.mjs");
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
ok("the two socials start on the Tuesday and the Wednesday of the Summit", defaults.socials[0].date === "2026-11-10" && /WATTS/.test(defaults.socials[0].label) && defaults.socials[1].date === "2026-11-11" && /District 6/.test(defaults.socials[1].label));
const board = { "x-admin-key": issueSession({ email: "secretary@ongia.ca", name: "Lee" }), "content-type": "application/json" };
ok("a board member who is not on this event cannot set it up", (await call("event=ngs", { method: "PUT", body: {}, headers: board })).status === 403);
const set = (await call("event=ngs", { method: "PUT", body: { replyBy: "2026-10-30" } })).body;
ok("setting it up gives a form link", /^https:\/\/events\.example\.org\/q\/[A-Za-z0-9_-]{16}$/.test(set.link), set.link);
ok("nothing is held back", set.problems.length === 0, set.problems.join(" | "));
const tok = set.link.split("/q/")[1];

/* the email */
const pv = (await call("event=ngs&preview=1", { method: "POST", body: {} })).body;
ok("the email speaks to the community partners on the 10th and 11th too", /attending the full Summit November 9-12 or joining us as a community partner on November 10 and 11/.test(pv.text), pv.text);
ok("the email names the event, the date to answer by, and both socials", /National Gang Summit/.test(pv.subject) && /Friday, October 30/.test(pv.text) && /Tuesday, November 10: Networking Reception followed by a screening of the documentary WATTS/.test(pv.text) && /Wednesday, November 11: Evening Social at the hotel featuring a live performance by District 6/.test(pv.text), pv.text);
ok("its button goes to the form", pv.html.includes(`https://events.example.org/q/${tok}`) && /Complete the survey/.test(pv.html));
ok("no blank left unfilled", !/\{[a-zA-Z0-9]+\}/.test(pv.text));
// Signed by the board with the Summit's inbox, not by the lead (Andrew 27 Oct 2026).
ok("the Summit email is signed ONGIA Board, with ngs@ongia.ca, and no 'lead for' line", /ONGIA Board/.test(pv.html) && /mailto:ngs@ongia\.ca/.test(pv.html) && !/lead for/.test(pv.html) && /Replies to this email go straight to ONGIA Board/.test(pv.html) && /acheminées directement à ONGIA Board/.test(pv.html), pv.html.slice(-1500));
// Andrew's own Summit email was saved before the signature fields existed: it is still signed by the board.
{ const e = await getEvent("ngs"); const keep = { ...e.reply }; delete e.reply.signName; delete e.reply.signEmail; await putEvent(e);
  const old = (await call("event=ngs&preview=1", { method: "POST", body: {} })).body;
  ok("an email saved before the signature fields existed is still signed ONGIA Board, not the lead", /ONGIA Board/.test(old.html) && /ngs@ongia\.ca/.test(old.html) && !/lead for/.test(old.html), old.html.slice(-800));
  e.reply = keep; await putEvent(e); }
// Two halves (Andrew 27 Oct 2026): English with its button, then French with a button that opens the questions in French.
ok("the email has an English half with its button, then a French half with its own", pv.text.indexOf("Complete the survey: https://events.example.org/q/" + tok + "?lang=en") > 0 && pv.text.indexOf("Complete the survey:") < pv.text.indexOf("FRANÇAIS") && pv.text.indexOf("FRANÇAIS") < pv.text.indexOf("Répondre au sondage: https://events.example.org/q/" + tok + "?lang=fr"), pv.text);
ok("the French half has the date to answer by and both socials in French", /d'ici le vendredi 30 octobre/.test(pv.text) && /mardi 10 novembre : Réception de réseautage/.test(pv.text) && /mercredi 11 novembre : Soirée à l'hôtel/.test(pv.text), pv.text);
ok("each button appears once, where it was put, and none is added at the bottom", (pv.html.match(/>Complete the survey</g) ?? []).length === 1 && (pv.html.match(/>Répondre au sondage</g) ?? []).length === 1 && pv.html.lastIndexOf("Répondre au sondage") > pv.html.lastIndexOf("Le comité organisateur"));
ok("a person's own French link carries who they are and the language", (await import(REPO + "netlify/functions/lib/reply.mjs")).renderReply(await getEvent("ngs"), { first: "Ann", email: "ann@example.ca" }).text.match(/q\/[A-Za-z0-9_-]{16}\/[0-9a-f]{16}\?lang=fr/));
const trial = (await call("event=ngs&preview=1", { method: "POST", body: { subject: "Two quick questions", body: "Hello {first},\n\nShort and sweet." } })).body;
ok("the preview shows words being edited, before they are saved", trial.subject === "Two quick questions" && /Short and sweet/.test(trial.text) && (await getEvent("ngs")).reply.subject !== "Two quick questions");
ok("and checks them the same way: a typo in a blank is caught", /not a blank the desk knows/.test((await call("event=ngs&preview=1", { method: "POST", body: { body: "Hello {frist}" } })).body.problems.join(" ")));
const asAndrew = { "x-admin-key": issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" }), "content-type": "application/json" };
const test = (await call("event=ngs&test=1", { method: "POST", body: { to: "president@ongia.ca" }, headers: asAndrew })).body;
ok("a test goes to one address, marked TEST", test.ok && sent.length === 1 && sent[0].to.includes("president@ongia.ca") && /^TEST: /.test(sent[0].subject));
const testLink = sent[0].html.match(/\/q\/[A-Za-z0-9_-]+\/([a-f0-9]{16})/);
const testYou = testLink ? (await call(`t=${tok}&p=${testLink[1]}`)).body.you : null;
const multi = (await call("event=ngs&test=1", { method: "POST", body: { to: "a@example.ca, colleague@example.ca" } })).body;
const toAnn = sent.find((m) => m.subject.startsWith("TEST") && String(m.to).includes("a@example.ca"));
const annPid = toAnn?.html.match(/\/q\/[A-Za-z0-9_-]+\/([a-f0-9]{16})/)?.[1];
const annYou = annPid ? (await call(`t=${tok}&p=${annPid}`)).body.you : null;
const toCol = sent.find((m) => m.subject.startsWith("TEST") && String(m.to).includes("colleague@example.ca"));
const colYou = (await call(`t=${tok}&p=${toCol?.html.match(/\/q\/[A-Za-z0-9_-]+\/([a-f0-9]{16})/)?.[1]}`)).body.you;
ok("a test can go to several addresses at once", multi.ok && multi.to === "a@example.ca, colleague@example.ca", JSON.stringify(multi));
ok("a test to someone registered fills in their real registration", annYou?.first === "Ann" && annYou?.email === "a@example.ca", JSON.stringify(annYou));
ok("a test to anyone else fills in their address", colYou?.email === "colleague@example.ca" && !colYou.first, JSON.stringify(colYou));
ok("test people are never counted as attendees", (await call("event=ngs")).body.status.reaches === 2);
ok("more than five test addresses, or a bad one, is refused", (await call("event=ngs&test=1", { method: "POST", body: { to: "a@x.ca,b@x.ca,c@x.ca,d@x.ca,e@x.ca,f@x.ca" } })).status === 400 && (await call("event=ngs&test=1", { method: "POST", body: { to: "not-an-address" } })).status === 400);
sent.length = 1;
ok("the test email's button fills in the form as the person who sent it, with ONGIA", testYou && testYou.first === "Andrew" && testYou.last === "Hammond" && testYou.email === "president@ongia.ca" && testYou.agency === "ONGIA", JSON.stringify(testYou));
sent.length = 0;

/* nobody who has already told us is emailed: an answer, or Andrew's sheet matched by name (26 Oct 2026) */
{
  await putEvent({ id: "ngs2", title: "National Gang Summit", city: "Toronto, ON", venue: "Sample Hotel", dayOne: "2026-11-09", lastDay: "2026-11-12", board: [], attendeeMail: true, contact: { name: "Andrew Hammond", email: "president@ongia.ca" } });
  await putAttendees("ngs2", { people: [person("x1@example.ca", "Xena", "Asked"), person("x2@example.ca", "Ryan", "Sheet"), person("x3@example.ca", "Ola", "Formed"), person("x4@example.ca", "Ned", "New")] });
  const set2 = (await call("event=ngs2", { method: "PUT", body: { replyBy: "2026-10-30" } })).body;
  const tok2 = set2.link.split("/q/")[1];
  await call("event=ngs2&add=1", { method: "POST", body: { first: "Ryan", last: "Sheet", dietary: "Allergic to shrimp" } });          // on Andrew's sheet, no email
  await call(`t=${tok2}`, { method: "POST", body: { first: "Ola", last: "Formed", agency: "OPP", email: "x3@example.ca", allergy: "no", socials: { s1: "yes", s2: "yes" } } });   // answered already
  const st2 = (await call("event=ngs2")).body.status;
  ok("the send count leaves out people who already told us (2 of 4)", st2.toSend === 2 && st2.alreadyTold === 2, JSON.stringify(st2));
  const before2 = sent.length;
  await call("event=ngs2&send=1", { method: "POST", body: {} });
  const to2 = sent.slice(before2).map((m) => String(m.to)).sort();
  ok("the email skips someone on Andrew's sheet (matched by name) and someone who already answered", to2.join() === "x1@example.ca,x4@example.ca", to2.join());
  const b3 = sent.length;
  await runLetterRounds([await getEvent("ngs2")], { today: "2026-10-28", pace: async () => {} });
  ok("and so do the reminders", sent.slice(b3).filter((m) => /^Reminder( \/ Rappel)?:/.test(m.subject)).map((m) => String(m.to)).sort().join() === "x1@example.ca,x4@example.ca");
  sent.length = before2;
}

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
const mains = () => sent.filter((m) => !/^Reminder( \/ Rappel)?:/.test(m.subject));
ok("someone who registers later gets it the next night", mains().length === 3 && String(mains()[2].to).includes("d@example.ca"));
people.push(person("e@example.ca", "Eve", "TooLate")); await putAttendees("ngs", { ...(await getAttendees("ngs")), people });
await runLetterRounds([await getEvent("ngs")], { today: "2026-10-31", pace: async () => {} });
ok("but not after the reply-by date", mains().length === 3);

/* reminders on Wednesday and Friday, to those who have not answered (Andrew 26 Oct 2026) */
ok("reminders start on the Wednesday and the Friday (two days before the reply-by date, and the day itself)", JSON.stringify((await call("event=ngs")).body.status.reminders.map((r) => r.date)) === JSON.stringify(["2026-10-28", "2026-10-30"]));
const remPv = (await call("event=ngs&preview=1&reminder=1", { method: "POST", body: {} })).body;
ok("the reminder is the same email, marked as a reminder", /^Reminder \/ Rappel: National Gang Summit/.test(remPv.subject) && /A quick reminder: we haven't had your answers yet/.test(remPv.text) && remPv.text.indexOf("A quick reminder") > remPv.text.indexOf("Hello Alex") && /Friday, October 30/.test(remPv.text), remPv.text.slice(0, 400));
ok("and the French half carries the reminder in French", remPv.text.indexOf("Petit rappel") > remPv.text.indexOf("Bonjour Alex"), remPv.text);
// Ann answers before Wednesday; Ben (and his guest) and Dee have not.
await call(`t=${tok}`, { method: "POST", body: { first: "Ann", last: "One", agency: "TPS", email: "a@example.ca", allergy: "no", socials: { s1: "yes", s2: "no" } } });
const n0 = sent.length;
await runLetterRounds([await getEvent("ngs")], { today: "2026-10-27", pace: async () => {} });
ok("no reminder on a day that isn't a reminder date (Eve, who registered late, gets the email itself that day)", !sent.slice(n0).some((m) => /^Reminder( \/ Rappel)?:/.test(m.subject)) && sent.slice(n0).some((m) => String(m.to).includes("e@example.ca")));
await runLetterRounds([await getEvent("ngs")], { today: "2026-10-28", pace: async () => {} });
const wed = sent.slice(n0).filter((m) => /^Reminder( \/ Rappel)?:/.test(m.subject)).map((m) => String(m.to)).sort();
ok("Wednesday's reminder goes to those who haven't answered, once per address, and not to Ann who has", wed.join() === "b@example.ca,d@example.ca,e@example.ca", wed.join());
const n1 = sent.length;
await runLetterRounds([await getEvent("ngs")], { today: "2026-10-28", pace: async () => {} });
ok("running again the same day sends nobody a second reminder", sent.slice(n1).filter((m) => /^Reminder( \/ Rappel)?:/.test(m.subject)).length === 0);
await call(`t=${tok}`, { method: "POST", body: { first: "Guest", last: "OfBen", agency: "OPP", email: "b@example.ca", allergy: "no", socials: { s1: "no", s2: "no" } } });
const n2 = sent.length;
await runLetterRounds([await getEvent("ngs")], { today: "2026-10-30", pace: async () => {} });
const fri = sent.slice(n2).filter((m) => /^Reminder( \/ Rappel)?:/.test(m.subject)).map((m) => String(m.to));
ok("Friday's reminder skips an address where someone has now answered", fri.sort().join() === "d@example.ca,e@example.ca", fri.join());
await call("event=ngs", { method: "PUT", body: { reminders: ["2026-10-29"] } });
ok("the reminder dates can be changed on the event page", JSON.stringify((await call("event=ngs")).body.reply.reminders) === JSON.stringify(["2026-10-29"]));
ok("and the page says how many still haven't answered", (await call("event=ngs")).body.status.stillToAnswer === 2);
// Someone emailed for the first time in a run is not reminded in that same run.
const fx = await getAttendees("ngs"); fx.people.push({ email: "f@example.ca", first: "Fay", last: "Fresh", status: "ATTENDING", source: "wix" }); await putAttendees("ngs", fx);
await call("event=ngs", { method: "PUT", body: { reminders: ["2026-10-29"] } });
const n3 = sent.length;
await runLetterRounds([await getEvent("ngs")], { today: "2026-10-29", pace: async () => {} });
const thu = sent.slice(n3);
ok("someone registered late gets the email, and is not reminded straight after it in the same run", thu.some((m) => String(m.to).includes("f@example.ca") && !/^Reminder( \/ Rappel)?:/.test(m.subject)) && !thu.some((m) => String(m.to).includes("f@example.ca") && /^Reminder( \/ Rappel)?:/.test(m.subject)), thu.map((m) => m.to + " " + m.subject.slice(0, 9)).join(" | "));
// The answers given here are cleared so the rest of the test starts as before.
for (const a of (await call("event=ngs")).body.answers) await call(`event=ngs&answer=${a.id}`, { method: "DELETE" });

/* the form */
const form = (await call(`t=${tok}`)).body;
ok("the form shows the event, the date to answer by, and the two socials in both languages", form.title === "National Gang Summit" && form.dates === "November 9–12, 2026" && form.datesFr === "du 9 au 12 novembre 2026" && form.replyByLong === "Friday, October 30" && form.replyByLongFr === "vendredi 30 octobre" && form.socials.length === 2 && /^mardi 10 novembre : /.test(form.socials[0].fr), JSON.stringify(form));
ok("the form does not show who answered or any email address", !JSON.stringify(form).includes("@example.ca"));
const answer = (o) => call(`t=${tok}`, { method: "POST", body: { first: "Ann", last: "One", agency: "Toronto Police Service", email: "A@example.ca", allergy: "no", socials: { s1: "yes", s2: "no" }, ...o } });
const bad = (await answer({ agency: "", allergy: "yes", dietary: "", socials: { s1: "yes" } })).body;
ok("a half-filled form says what is missing", bad.error === "missing" && ["agency", "dietary", "s2"].every((k) => bad.problems.includes(k)), JSON.stringify(bad));
ok("the food question is yes or no: skipping it is not a no", (await answer({ allergy: undefined })).body.problems?.includes("allergy"));
ok("no allergy: nothing to fill in about food", (await answer({})).body.ok === true);
const again = (await answer({ allergy: "yes", dietary: "Allergic to shrimp", socials: { s1: "yes", s2: "yes" } })).body;
ok("the same person answering again replaces their first answer", again.ok && again.again === true);
await call(`t=${tok}`, { method: "POST", body: { first: "Guest", last: "OfBen", agency: "OPP", email: "b@example.ca", allergy: "yes", dietary: "Vegan", socials: { s1: "no", s2: "yes" } } });
await call(`t=${tok}`, { method: "POST", body: { first: "Ben", last: "Two", agency: "OPP", email: "b@example.ca", allergy: "no", dietary: "should be dropped", socials: { s1: "yes", s2: "no" } } });
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

/* each person's own link fills in the form */
const ngsNow = await getEvent("ngs");
const annRow = (await getAttendees("ngs")).people.find((p) => p.email === "a@example.ca");
const pid = personalId(ngsNow.reply.token, annRow);
const sentToAnn = sent.find((m) => String(m.to).includes("a@example.ca"));
ok("answers to the email go to ngs@ongia.ca", sentToAnn?.replyTo === "ngs@ongia.ca", String(sentToAnn?.replyTo));
ok("the email to each person carries their own link", sentToAnn.html.includes(`/q/${tok}/${pid}`) && !sent.find((m) => String(m.to).includes("b@example.ca")).html.includes(`/q/${tok}/${pid}`));
const mine = (await call(`t=${tok}&p=${pid}`)).body.you;
ok("their link fills in their name and email, and what they already answered", mine.first === "Ann" && mine.last === "One" && mine.email === "a@example.ca" && mine.agency === "Toronto Police Service" && mine.allergy === "yes" && mine.dietary === "Allergic to shrimp" && mine.socials.s2 === "yes", JSON.stringify(mine));
ok("a made-up person id fills in nothing", (await call(`t=${tok}&p=0123456789abcdef`)).body.you === null);

/* people who had already told Andrew: by hand, and from his sheet */
const byHand = (await call("event=ngs&add=1", { method: "POST", body: { first: "Pat", last: "Hand", dietary: "Gluten-free", table: "7" } })).body;
ok("someone can be added to the dietary list by hand", byHand.answers.some((a) => a.first === "Pat" && a.source === "desk" && a.table === "7"));
ok("adding by hand needs what the allergy is", (await call("event=ngs&add=1", { method: "POST", body: { first: "No", last: "Detail" } })).status === 400);
const sheet = xlsx({ title: "Allergy / Dietary List", subtitle: "ONGIA – National Gang Summit, November 9–12, 2026", columns: [{ head: "First Name" }, { head: "Last Name" }, { head: "Allergy / Dietary" }, { head: "Table Number\n(If Applicable)" }],
  rows: [["Sam", "Sheet", "No pork", ""], ["Ann", "One", "Allergic to shrimp and crab", 3], ["", "", "", ""]] });
const up = await reply(new Request("http://localhost/api/reply?event=ngs&upload=1", { method: "POST", headers: { "x-admin-key": "testkey", "content-type": "application/octet-stream" }, body: sheet }));
const upOut = await up.json();
ok("Andrew's sheet uploads: everyone on it goes on the dietary list", up.status === 200 && upOut.uploaded.added === 2 && upOut.uploaded.skipped.length === 0, JSON.stringify(upOut.uploaded));
const D2 = readXlsx((await call("event=ngs&sheet=dietary")).body);
const names2 = D2.rows.slice(4).map((r) => `${r[0]} ${r[1]}`);
ok("someone on the sheet who also answered the form is listed once, with the latest (and the sheet's table number)", names2.filter((n) => n === "Ann One").length === 1 && D2.rows.find((r) => r[0] === "Ann")[2] === "Allergic to shrimp and crab" && String(D2.rows.find((r) => r[0] === "Ann")[3]) === "3", JSON.stringify(D2.rows.slice(4)));
ok("hand and sheet entries are on the dietary list, not the socials list", names2.includes("Pat Hand") && names2.includes("Sam Sheet") && !JSON.stringify(readXlsx((await call("event=ngs&sheet=socials")).body).rows).includes("Pat"));
const notXlsx = await reply(new Request("http://localhost/api/reply?event=ngs&upload=1", { method: "POST", headers: { "x-admin-key": "testkey" }, body: "first,last\nA,B" }));
ok("a file that isn't .xlsx is refused with a reason", notXlsx.status === 400);

/* every event asks about food; only the Summit asks about socials */
await putEvent({ id: "itp", title: "RBH ITP Training", city: "Halifax, NS", dayOne: "2026-12-01", lastDay: "2026-12-02", board: [], contact: { name: "Andrew Hammond", email: "president@ongia.ca" } });
const itp = (await call("event=itp", { method: "PUT", body: {} })).body;
ok("another event asks only about food", itp.reply.socials.length === 0 && itp.problems.length === 0, JSON.stringify(itp.problems));
const itpMail = (await call("event=itp&preview=1", { method: "POST", body: {} })).body;
ok("its email asks one question and mentions no socials or community days", /food allergy/.test(itpMail.text) && !/social|community/i.test(itpMail.text), itpMail.text);
ok("and there is no socials list to download", (await call("event=itp&sheet=socials")).status === 400);

/* removing an answer, closing the form */
const ann = all.find((a) => a.first === "Ann");
const before = (await call("event=ngs")).body.answers.length;
ok("an answer can be removed", (await call(`event=ngs&answer=${ann.id}`, { method: "DELETE" })).body.answers.length === before - 1);
await call("event=ngs", { method: "PUT", body: { open: false } });
ok("a closed form takes no answers", (await answer({})).status === 409 && (await call(`t=${tok}`)).body.open === false);
ok("and the email will not send while it is closed", /closed/.test((await call("event=ngs")).body.problems.join(" ")));
ok("a made-up link finds nothing", (await call("t=notarealtoken123")).status === 404);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
