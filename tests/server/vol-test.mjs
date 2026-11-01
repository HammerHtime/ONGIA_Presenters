// Volunteer agreements from the server's side: adding, the volunteer's form, signing, the PDF,
// delivery, corrections, removal, and that presenters are untouched.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const F = REPO + "netlify/functions/";
const OUT = new URL(".", import.meta.url).pathname;
const events = (await import(F + "events.mjs")).default;
const volunteers = (await import(F + "volunteers.mjs")).default;
const volunteer = (await import(F + "volunteer.mjs")).default;
const rooming = (await import(F + "rooming.mjs")).default;
const rosterFn = (await import(F + "roster.mjs")).default;
const { listPresenters, listVolunteers, getVolunteer, getPdf, getEvent } = await import(F + "lib/store.mjs");
const { countStatuses } = await import(F + "events.mjs");
const { volunteerInvitationMail, volunteerSignedMail, volunteerNoticeMail, volunteerReceivedMail, volunteerReviewNeededMail } = await import(F + "lib/mail.mjs");
const { describeEvent, todayIso } = await import(F + "lib/deadlines.mjs");
const { runReminders } = await import(F + "lib/reminders.mjs");
const { putVolunteer } = await import(F + "lib/store.mjs");
const { VOLUNTEER_TERMS } = await import(F + "lib/terms.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (h, url, method = "GET", body, headers = H) => { const r = await h(new Request("http://localhost" + url, { method, headers, body: body ? JSON.stringify(body) : undefined }));
  const ct = r.headers.get("content-type") ?? ""; return { status: r.status, res: r, ...(ct.includes("json") ? await r.json() : {}) }; };
const board = [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }];

const ev = (await call(events, "/api/events", "POST", { title: "National Gang Summit: Organized Crime, Gangs & Youth: Building Solutions for a Safer Future", city: "Toronto",
  venue: "Delta Hotels Toronto Airport & Conference Centre", dayOne: "2026-11-09", lastDay: "2026-11-12", board, invite: false,
  presenters: [{ first: "Dana", last: "Presenter", email: "dana@example.ca", organization: "Test Police" }] })).event;
const presentersBefore = JSON.stringify(countStatuses(await listPresenters(ev.id)));

console.log("— adding");
let r = await call(volunteers, `/api/volunteers?event=${ev.id}`, "POST", { invite: true, volunteers: [
  { first: "Vera", last: "Volunteer", email: "vera@example.ca", organization: "Peel Regional Police" },
  { first: "Marc", last: "Thibault", email: "m.thibault@example.ca", organization: "Service de police de la Ville de Montréal" },
  { first: "No", last: "Email", email: "nope" },
  { first: "", last: "Nameless", email: "n@example.ca" },
  { first: "Vera", last: "Again", email: "VERA@example.ca" },
] });
ok("three of five are accepted… no: two accepted, three turned away with reasons", r.status === 201 && r.added.length === 2 && r.rejected.length === 3, JSON.stringify(r.rejected));
ok("each rejection says why", r.rejected.some((x) => /not an email/.test(x.why)) && r.rejected.some((x) => /first and last name/.test(x.why)) && r.rejected.some((x) => /already a volunteer/.test(x.why)));
ok("with no mail transport here, the send is reported rather than lost", r.notSent.length === 2 && r.notSent.every((x) => /transport|configured/i.test(x.why)), JSON.stringify(r.notSent));
ok("references are VOL-…-0001 and 0002", /^VOL-[A-Z0-9]+-0001$/.test(r.added[0].reference) && /-0002$/.test(r.added[1].reference), r.added[0].reference);
ok("their links are /v/…", r.added.every((a) => /^\/v\/[a-z0-9]{24}$/.test(a.link)));
let list = await call(volunteers, `/api/volunteers?event=${ev.id}`);
ok("the desk lists both, waiting, both with a failed send on record", list.volunteers.length === 2 && list.counts.waiting === 2 && list.volunteers.every((v) => v.lastSendError), JSON.stringify(list.counts));
ok("an unsent link counts as never sent", list.counts.uninvited === 2);
ok("presenters' counts did not move", JSON.stringify(countStatuses(await listPresenters(ev.id))) === presentersBefore);
ok("a presenter is not a volunteer: no volunteer rows leak onto the rooming list", !(await call(rooming, `/api/rooming?event=${ev.id}`)).rows?.some((x) => /Vera/.test(x.name)));
ok("the desk key is needed", (await call(volunteers, `/api/volunteers?event=${ev.id}`, "GET", null, { "content-type": "application/json" })).status === 401);

console.log("— the volunteer's form");
const [vera, marc] = list.volunteers;
const form = await call(volunteer, `/api/volunteer?t=${vera.token}`, "GET", null, {});
ok("the form gets the event, who they are, and the terms in both languages", form.event.title.startsWith("National Gang Summit") && form.volunteer.first === "Vera" && form.terms.en.items.length === 10 && form.terms.fr.items.length === 10);
ok("it does not hand over their token or the others", !JSON.stringify(form).includes(vera.token) && !JSON.stringify(form).includes("Marc"));
ok("opening it is recorded", !!(await getVolunteer(ev.id, vera.id)).openedAt);
ok("a made-up link is refused", (await call(volunteer, `/api/volunteer?t=nothing`, "GET", null, {})).status === 404);
ok("no signed copy before signing", (await call(volunteer, `/api/volunteer?t=${vera.token}&pdf=1`, "GET", null, {})).status === 404);

console.log("— signing");
const good = { first: "Vera", last: "Volunteer", email: "vera@example.ca", phone: "4165550123", organization: "Peel Regional Police", accommodation: "no", termsAccepted: true, standing: true, signature: "Vera Volunteer", agreed: true, language: "fr" };
const send = (b, v = vera) => call(volunteer, `/api/volunteer?t=${v.token}`, "POST", b, { "content-type": "application/json" });
r = await send({});
ok("an empty form is refused with every reason", r.status === 422 && r.problems.length === 8, JSON.stringify(r.problems));
for (const [what, patch, re] of [
  ["no phone", { phone: "12" }, /contact number/], ["no answer about a hotel", { accommodation: undefined }, /hotel accommodation/], ["terms unticked", { termsAccepted: false }, /Volunteer Terms/],
  ["standing unticked", { standing: false }, /good standing/], ["no signature", { signature: "  " }, /type your name/], ["signature box unticked", { agreed: false }, /electronic signature/],
  ["a bad email", { email: "x" }, /email address/]]) {
  r = await send({ ...good, ...patch });
  ok(`${what}: refused`, r.status === 422 && r.problems.some((p) => re.test(p)), JSON.stringify(r));
}
ok("nothing was saved by the refusals", (await getVolunteer(ev.id, vera.id)).status === "invited");
r = await send(good);
ok("a complete form signs", r.status === 200 && r.ok && /^VOL-/.test(r.reference), JSON.stringify(r));
const v = await getVolunteer(ev.id, vera.id);
ok("the record is signed with what they typed, phone formatted", v.status === "signed" && v.language === "fr" && v.submission.phone === "416-555-0123" && v.submission.signature === "Vera Volunteer" && v.submission.termsVersion === 1);
ok("each delivery is recorded separately (no transport and no SharePoint here, so none succeed, and none threw)", v.delivery.filing && v.delivery.volunteerEmail && v.delivery.boardEmail && !v.delivery.filing.ok, JSON.stringify(v.delivery));
r = await send(good);
ok("signing twice is refused", r.status === 409);
r = await call(volunteer, `/api/volunteer?t=${vera.token}`, "GET", null, {});
ok("reopening shows it as signed", r.volunteer.status === "signed" && r.volunteer.phone === "416-555-0123");

console.log("— the signed copy");
const pdfRes = await call(volunteer, `/api/volunteer?t=${vera.token}&pdf=1`, "GET", null, {});
const pdf = Buffer.from(await pdfRes.res.arrayBuffer());
ok("they can download it", pdfRes.status === 200 && pdfRes.res.headers.get("content-type") === "application/pdf" && /Volunteer Agreement\.pdf/.test(pdfRes.res.headers.get("content-disposition")) && pdf.slice(0, 4).toString() === "%PDF");
ok("the desk can too", (await call(volunteers, `/api/volunteers?event=${ev.id}&id=${vera.id}&pdf=1`)).status === 200);
ok("and it is kept", !!(await getPdf(`vol:${ev.id}:${vera.id}`)));
writeFileSync(OUT + "volunteer-agreement.pdf", pdf);
let txt = ""; try { txt = execFileSync("pdftotext", ["-layout", OUT + "volunteer-agreement.pdf", "-"]).toString(); } catch (e) { txt = "NO PDFTOTEXT " + e.message; }
txt = txt.replace(/\s+/g, " ");
const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [OUT + "volunteer-agreement.pdf"]).toString())?.[1]);
ok("the PDF has the event, the volunteer, every term, both statements and the signature", /Organized Crime, Gangs & Youth/.test(txt) && /Vera Volunteer/.test(txt) && /416-555-0123/.test(txt) && /Peel Regional Police/.test(txt)
  && VOLUNTEER_TERMS.en.items.every(([h]) => txt.includes(h)) && /good standing with my agency or organization/.test(txt) && /not currently subject to any formal investigation/.test(txt) && /Reference VOL-/.test(txt));
ok("it is in English even though she signed in French, and says nothing of presenter fees", !/Biography|Presenter Agreement|speaker fee/i.test(txt));
ok(`it fits ${pages} page(s)`, pages >= 1 && pages <= 2, String(pages));

console.log("— emails");
const evd = describeEvent(await getEvent(ev.id));
const inv = volunteerInvitationMail({ event: evd, volunteer: marc, link: "https://x/v/abc" });
ok("the invitation is bilingual, names the event and date, and carries the link", /Thank you for volunteering/.test(inv.text) && /Merci de faire du bénévolat/.test(inv.text) && /November 9, 2026/.test(inv.text) && /9 novembre 2026/.test(inv.text) && inv.html.includes("https://x/v/abc"), inv.text);
ok("it says what the agreement is about", /good standing/.test(inv.text) && /formal investigation/.test(inv.text) && /Français/.test(inv.text));
ok("the plain text keeps no HTML or entities", !/<[a-z]/i.test(inv.text) && !/&amp;/.test(inv.text), inv.text);
const rem = volunteerInvitationMail({ event: evd, volunteer: marc, link: "https://x/v/abc", remind: true });
ok("the reminder is a reminder", /Reminder/.test(rem.subject) && /haven't yet received/.test(rem.text) && !/good standing/.test(rem.text));
const copyFr = volunteerSignedMail({ event: evd, volunteer: { ...v } });
ok("her signed copy email is in French", /Merci d'avoir signé/.test(copyFr.text) && /VOL-/.test(copyFr.text));
const copyEn = volunteerSignedMail({ event: evd, volunteer: { ...v, language: "en" } });
ok("and in English for an English signer", /Thank you for signing/.test(copyEn.text));
const note = volunteerNoticeMail({ event: evd, volunteer: v, filing: { folderUrl: "https://sp/folder" } });
ok("the board notice names who, where from and where it is filed", /Signed: Vera Volunteer \(volunteer\)/.test(note.subject) && /Peel Regional Police/.test(note.text) && /https:\/\/sp\/folder/.test(note.text));
ok("on a phone the folder is a short link, not a SharePoint address running off the screen; the text copy keeps the address",
  /href="https:\/\/sp\/folder"[^>]*>open the folder<\/a>/.test(note.html) && !/>https:\/\/sp\/folder</.test(note.html) && /Filed to SharePoint: https:\/\/sp\/folder/.test(note.text));
ok("without a SharePoint link, it says so and the PDF travels attached", /not attempted|No SharePoint|not set/i.test(volunteerNoticeMail({ event: evd, volunteer: v, filing: { skipped: true, reason: "No SharePoint folder is set on this event." } }).text));

console.log("— corrections, retries, removal");
r = await call(volunteers, `/api/volunteers?event=${ev.id}&id=${marc.id}`, "PUT", { first: "Marc", last: "Thibault", email: "marc.t@example.ca", organization: "SPVM" });
ok("a mistyped address is corrected, and the failed-send note cleared", r.ok && r.emailChanged && !(await getVolunteer(ev.id, marc.id)).lastSendError);
ok("two people cannot share an address", (await call(volunteers, `/api/volunteers?event=${ev.id}&id=${marc.id}`, "PUT", { first: "Marc", last: "T", email: "vera@example.ca" })).status === 409);
ok("their token is untouched, so a link already sent still works", (await getVolunteer(ev.id, marc.id)).token === marc.token);
r = await call(volunteers, `/api/volunteers?event=${ev.id}&id=${vera.id}&action=redeliver`, "POST", { rebuild: true });
ok("redelivery retries everything that didn't land and says so", r.ok && r.retried.filing && r.retried.volunteerEmail && r.retried.boardEmail);
ok("an unsigned one cannot be redelivered", (await call(volunteers, `/api/volunteers?event=${ev.id}&id=${marc.id}&action=redeliver`, "POST", {})).status === 409);
r = await call(volunteers, `/api/volunteers?event=${ev.id}&action=invite`, "POST", {});
ok("'email everyone outstanding' tries only the unsigned one", r.failed.length === 1 && r.failed[0].name === "Marc Thibault" && !r.sent.length, JSON.stringify(r));
r = await call(volunteers, `/api/volunteers?event=${ev.id}&id=${vera.id}`, "DELETE", { reason: "Withdrew" });
ok("a signed agreement needs the second confirmation", r.status === 409);
r = await call(volunteers, `/api/volunteers?event=${ev.id}&id=${vera.id}&final=1`, "DELETE", { reason: "Withdrew; asked to be taken off" });
ok("removed with it", r.ok && !(await getVolunteer(ev.id, vera.id)) && !(await getPdf(`vol:${ev.id}:${vera.id}`)));
ok("her link stops working", (await call(volunteer, `/api/volunteer?t=${vera.token}`, "GET", null, {})).status === 404);
const after = await getEvent(ev.id);
ok("the event keeps a line saying who was removed, why, and that they were a volunteer", after.removedPresenters.at(-1).role === "volunteer" && /Withdrew/.test(after.removedPresenters.at(-1).reason) && after.removedPresenters.at(-1).status === "signed");
ok("an event delete takes the rest with it", (await call(events, `/api/events?id=${ev.id}`, "DELETE")).removedVolunteers === 1 && !(await listVolunteers(ev.id)).length);

console.log("— reminders");
const ev2 = (await call(events, "/api/events", "POST", { title: "Western Symposium", city: "Calgary", dayOne: "2026-12-01", lastDay: "2026-12-02", board, invite: false, presenters: [] })).event;
const days = (n) => new Date(Date.now() - n * 86400000).toISOString();
const seed = async (first, extra) => { const rr = await call(volunteers, `/api/volunteers?event=${ev2.id}`, "POST", { invite: false, volunteers: [{ first, last: "Test", email: `${first.toLowerCase()}@example.ca` }] }); const v = await getVolunteer(ev2.id, rr.added[0].id); Object.assign(v, extra); await putVolunteer(v); return v; };
await seed("Old", { mail: [{ type: "invitation", at: days(8) }] });
await seed("Recent", { mail: [{ type: "invitation", at: days(3) }] });
await seed("Never", { mail: [] });
await seed("Done", { status: "signed", mail: [{ type: "invitation", at: days(20) }] });
await seed("Tired", { mail: [{ type: "invitation", at: days(40) }, { type: "reminder-auto", at: days(33) }, { type: "reminder-auto", at: days(26) }, { type: "reminder-auto", at: days(19) }] });
const plan = (await runReminders({ dry: true, origin: "http://x", onlyEvent: ev2.id })).results.filter((x) => x.kind === "volunteer");
ok("only the one a week past their last email is nudged", plan.length === 1 && plan[0].name === "Old Test", JSON.stringify(plan));
ok("not the recent, the never-sent, the signed, or the one already reminded three times", !plan.some((x) => /Recent|Never|Done|Tired/.test(x.name)));
const real = (await runReminders({ dry: false, origin: "http://x", onlyEvent: ev2.id })).results.filter((x) => x.kind === "volunteer");
ok("with no mail transport the send is reported, not lost", real.length === 1 && real[0].sent === false && /transport|configured/i.test(real[0].error), JSON.stringify(real));

console.log("— the volunteer lead");
await call(rosterFn, "/api/roster");   // the board list is made on first read
const ev3 = (await call(events, "/api/events", "POST", { title: "Lead Test", city: "Ottawa", dayOne: "2026-12-05", lastDay: "2026-12-06",
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }, { name: "Raj Jaswal", email: "treasurer@ongia.ca" }], invite: false, presenters: [] })).event;
let L = await call(volunteers, `/api/volunteers?event=${ev3.id}`);
ok("with no volunteer lead chosen, volunteers deal with the event lead", L.lead === null && L.contact.email === "president@ongia.ca", JSON.stringify(L.contact));
r = await call(volunteers, `/api/volunteers?event=${ev3.id}&lead=1`, "PUT", { email: "stranger@example.com" });
ok("someone not on the board cannot be picked", r.status === 400 && /board list/.test(r.error));
r = await call(volunteers, `/api/volunteers?event=${ev3.id}&lead=1`, "PUT", { email: "J.HEALY@ongia.ca" });
ok("a board member from the roster can, whatever the case of the address", r.ok && r.lead.name === "John Healy" && r.lead.email === "j.healy@ongia.ca", JSON.stringify(r));
ok("the choice is kept on the event and does not disturb its own lead", (await getEvent(ev3.id)).volunteerLead.email === "j.healy@ongia.ca" && (await getEvent(ev3.id)).reviewer.email === "president@ongia.ca");
await call(volunteers, `/api/volunteers?event=${ev3.id}`, "POST", { invite: false, volunteers: [{ first: "Lena", last: "Lead", email: "lena@example.ca", organization: "OPS" }] });
const lena = (await call(volunteers, `/api/volunteers?event=${ev3.id}`)).volunteers[0];
const evx = describeEvent(await getEvent(ev3.id));
const inv3 = volunteerInvitationMail({ event: evx, volunteer: lena, link: "https://x/v/y" });
ok("the invitation's signature names the volunteer lead, not the event lead", /John Healy/.test(inv3.text) && !/Andrew Hammond/.test(inv3.text), inv3.text.slice(-200));
const fm = await call(volunteer, `/api/volunteer?t=${lena.token}`, "GET", null, {});
ok("the form tells the volunteer to contact the volunteer lead", fm.event.contact.name === "John Healy");
const signed3 = await call(volunteer, `/api/volunteer?t=${lena.token}`, "POST", { first: "Lena", last: "Lead", email: "lena@example.ca", phone: "6135550100", organization: "OPS", accommodation: "no", termsAccepted: true, standing: true, signature: "Lena Lead", agreed: true }, { "content-type": "application/json" });
ok("she signs", signed3.status === 200 && /John Healy/.test(signed3.contact));
const pdfL = Buffer.from(await (await call(volunteer, `/api/volunteer?t=${lena.token}&pdf=1`, "GET", null, {})).res.arrayBuffer());
writeFileSync(OUT + "lead-agreement.pdf", pdfL);
const tL = execFileSync("pdftotext", ["-layout", OUT + "lead-agreement.pdf", "-"]).toString().replace(/\s+/g, " ");
ok("the signed PDF's ONGIA contact is the volunteer lead", /ONGIA CONTACT INFORMATION Name: John Healy/.test(tL) && /j\.healy@ongia\.ca/.test(tL), tL.slice(tL.indexOf("ONGIA CONTACT"), tL.indexOf("ONGIA CONTACT") + 160));
r = await call(volunteers, `/api/volunteers?event=${ev3.id}&lead=1`, "PUT", { email: "" });
ok("clearing it puts the event lead back", r.ok && r.lead === null && r.contact.email === "president@ongia.ca" && !(await getEvent(ev3.id)).volunteerLead);
ok("an ordinary event edit does not drop the choice", await (async () => {
  await call(volunteers, `/api/volunteers?event=${ev3.id}&lead=1`, "PUT", { email: "treasurer@ongia.ca" });
  const e = await getEvent(ev3.id);
  await call(events, `/api/events?id=${ev3.id}`, "PUT", { title: e.title, city: e.city, venue: "New hotel", dayOne: e.dayOne, lastDay: e.lastDay, board: e.board });
  return (await getEvent(ev3.id)).volunteerLead?.email === "treasurer@ongia.ca";
})());

console.log("— hotel nights: the board member's step");
const ev4 = (await call(events, "/api/events", "POST", { title: "Hotel Test", city: "Toronto", venue: "Delta", dayOne: "2026-11-09", lastDay: "2026-11-12",
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }], invite: false, presenters: [] })).event;
await call(volunteers, `/api/volunteers?event=${ev4.id}`, "POST", { invite: false, volunteers: [
  { first: "Hana", last: "Hotel", email: "hana@example.ca", organization: "OPP" }, { first: "Noah", last: "Nohotel", email: "noah@example.ca", organization: "OPP" },
  { first: "Gus", last: "Guestpays", email: "gus@example.ca", organization: "OPP" }, { first: "Zed", last: "Zeroroom", email: "zed@example.ca", organization: "OPP" }] });
const vl = (await call(volunteers, `/api/volunteers?event=${ev4.id}`)).volunteers;
const by = (n) => vl.find((x) => x.first === n);
const signAs = (v, over = {}) => call(volunteer, `/api/volunteer?t=${v.token}`, "POST", { first: v.first, last: v.last, email: v.email, phone: "4165550111", organization: "OPP", accommodation: "yes", termsAccepted: true, standing: true, signature: `${v.first} ${v.last}`, agreed: true, language: "en", ...over }, { "content-type": "application/json" });

r = await signAs(by("Noah"), { accommodation: "no" });
ok("a volunteer who needs no room is final at once", r.status === 200 && r.review === false && /volunteer\?t=.*&pdf=1/.test(r.pdf) && (await getVolunteer(ev4.id, by("Noah").id)).status === "signed");
r = await signAs(by("Hana"));
const hana = await getVolunteer(ev4.id, by("Hana").id);
ok("one who needs a room is 'submitted': signed, but not final", r.status === 200 && r.review === true && !r.pdf && hana.status === "submitted" && hana.submission.accommodation === "yes", JSON.stringify(r));
ok("the receipt to them and the 'ready for review' notice to the board are both recorded", hana.delivery.received && hana.delivery.reviewNotice && !hana.delivery.filing);
ok("there is no final copy to download yet", (await call(volunteer, `/api/volunteer?t=${hana.token}&pdf=1`, "GET", null, {})).status === 404);
ok("reopening the link shows it as submitted, not final", (await call(volunteer, `/api/volunteer?t=${hana.token}`, "GET", null, {})).volunteer.status === "submitted");
ok("it cannot be signed twice", (await signAs(by("Hana"))).status === 409);
let L2 = await call(volunteers, `/api/volunteers?event=${ev4.id}`);
ok("the desk counts one to review, and still-to-sign excludes it", L2.counts.review === 1 && L2.counts.waiting === 2 && L2.counts.signed === 1, JSON.stringify(L2.counts));
let rm = await call(rooming, `/api/rooming?event=${ev4.id}`);
ok("until her nights are chosen she is on the 'may still need a room' list, not the rooms", rm.waiting.some((w) => /Hana Hotel/.test(w.name)) && !rm.rows.some((x) => /Hana/.test(x.name)), JSON.stringify(rm.waiting));
r = await call(volunteers, `/api/volunteers?event=${ev4.id}&action=invite`, "POST", {});
ok("'email everyone outstanding' leaves out the one who has signed", !JSON.stringify(r).includes("Hana"));
const plan4 = (await runReminders({ dry: true, origin: "http://x", onlyEvent: ev4.id })).results.filter((x) => x.kind === "volunteer");
ok("and so do the automatic reminders", !plan4.some((x) => /Hana/.test(x.name)));

const approveAs = (v, body) => call(volunteers, `/api/volunteers?event=${ev4.id}&id=${v.id}&action=approve`, "POST", body);
r = await approveAs(by("Hana"), { hotel: { need: "yes", from: "2026-11-08", to: "2026-11-12" } });
ok("it will not be approved without the board member's name", r.status === 400 && /name/.test(r.error));
r = await approveAs(by("Hana"), { approverName: "Raj Jaswal" });
ok("it will not be approved without an answer about the hotel", r.status === 400 && /hotel nights, or say that no room/.test(r.error));
r = await approveAs(by("Hana"), { approverName: "Raj Jaswal", hotel: { need: "maybe" } });
ok("'maybe' is not an answer", r.status === 400);
r = await approveAs(by("Hana"), { approverName: "Raj Jaswal", hotel: { need: "yes", from: "2026-11-08" } });
ok("nights need both dates", r.status === 400 && /both/.test(r.error));
r = await approveAs(by("Hana"), { approverName: "Raj Jaswal", hotel: { need: "yes", from: "2026-11-12", to: "2026-11-08" } });
ok("check-out must be after check-in", r.status === 400 && /after check-in/.test(r.error));
r = await approveAs(by("Hana"), { approverName: "Raj Jaswal", hotel: { need: "yes", from: "2026-10-01", to: "2026-10-03" } });
ok("nights must sit in the three-days-either-side window", r.status === 400 && /three days either side/.test(r.error), JSON.stringify(r));
ok("none of those refusals changed her", (await getVolunteer(ev4.id, by("Hana").id)).status === "submitted");
ok("an unsigned volunteer cannot be approved", (await approveAs(by("Zed"), { approverName: "Raj", hotel: { need: "no" } })).status === 409);

r = await approveAs(by("Hana"), { approverName: "Raj Jaswal", hotel: { need: "yes", from: "2026-11-08", to: "2026-11-13", pays: "ONGIA" } });
const hana2 = await getVolunteer(ev4.id, by("Hana").id);
ok("with a name and nights, she is final", r.ok && hana2.status === "signed" && hana2.review.hotel.nights === 5 && hana2.review.approver.name === "Raj Jaswal" && hana2.review.hotel.pays === "ONGIA", JSON.stringify(r));
ok("the final copy is delivered: filing, her email and the board notice are all recorded", hana2.delivery.filing && hana2.delivery.volunteerEmail && hana2.delivery.boardEmail);
ok("approving twice is refused", (await approveAs(by("Hana"), { approverName: "Raj", hotel: { need: "no" } })).status === 409);
const hpdf = await call(volunteer, `/api/volunteer?t=${hana.token}&pdf=1`, "GET", null, {});
writeFileSync(OUT + "hotel-agreement.pdf", Buffer.from(await hpdf.res.arrayBuffer()));
const ht = execFileSync("pdftotext", ["-layout", OUT + "hotel-agreement.pdf", "-"]).toString().replace(/\s+/g, " ");
ok("her PDF now has the hotel nights, who pays, and the board member's approval", hpdf.status === 200 && /Hotel accommodation requested: Yes/.test(ht) && /HOTEL ACCOMMODATION Check-in: Sun 8 Nov 2026 Check-out: Fri 13 Nov 2026 Nights: 5 Paid by: ONGIA/.test(ht) && /reviewed and approved by: Name: Raj Jaswal/.test(ht) && /FINAL COPY/.test(ht), ht.slice(ht.indexOf("HOTEL"), ht.indexOf("HOTEL") + 260));
rm = await call(rooming, `/api/rooming?event=${ev4.id}`);
const row = rm.rows.find((x) => /Hana/.test(x.name));
ok("her nights are on the hotel rooming list: a Volunteer, those dates, ONGIA billed, confirmed", row && row.type === "Volunteer" && row.who === "volunteer" && row.checkIn === "2026-11-08" && row.checkOut === "2026-11-13" && row.nights === 5 && row.billing === "ONGIA" && row.confirmed === true, JSON.stringify(row));
ok("and she is off the 'may still need a room' list", !rm.waiting.some((w) => /Hana/.test(w.name)));
const csv = await (await rooming(new Request(`http://localhost/api/rooming?event=${ev4.id}&csv=1`, { headers: H }))).text();
ok("the spreadsheet for the hotel includes her", /Hana Hotel,2026-11-08,2026-11-13,5/.test(csv), csv);
ok("Noah, who needs no room, is not on the list", !rm.rows.some((x) => /Noah/.test(x.name)));

await signAs(by("Gus"));
r = await approveAs(by("Gus"), { approverName: "Raj Jaswal", hotel: { need: "yes", from: "2026-11-09", to: "2026-11-11", pays: "Guest" } });
rm = await call(rooming, `/api/rooming?event=${ev4.id}`);
ok("a volunteer who pays their own way is billed to the guest on the list", r.ok && rm.rows.find((x) => /Gus/.test(x.name))?.billing === "Guest");
await signAs(by("Zed"));
r = await approveAs(by("Zed"), { approverName: "Raj Jaswal", hotel: { need: "no" } });
const zed = await getVolunteer(ev4.id, by("Zed").id);
rm = await call(rooming, `/api/rooming?event=${ev4.id}`);
ok("'No room needed' makes it final with no nights, and adds nothing to the list", r.ok && zed.status === "signed" && zed.review.hotel === null && !rm.rows.some((x) => /Zed/.test(x.name)) && !rm.waiting.some((w) => /Zed/.test(w.name)));
const zpdf = Buffer.from(await (await call(volunteer, `/api/volunteer?t=${zed.token}&pdf=1`, "GET", null, {})).res.arrayBuffer()); writeFileSync(OUT + "zed.pdf", zpdf);
const zt2 = execFileSync("pdftotext", ["-layout", OUT + "zed.pdf", "-"]).toString().replace(/\s+/g, " ");
ok("his PDF says a board member confirmed no room is needed", /Hotel accommodation requested: Yes/.test(zt2) && /confirmed that no hotel room is needed/.test(zt2) && /approved by: Name: Raj Jaswal/.test(zt2));
ok("the board can still change a rooming-list entry for presenters as before (no volunteer 'who' leaks into presenter edits)", rm.rows.every((x) => ["presenter", "guest", "volunteer"].includes(x.who)));

console.log("— the hotel emails");
const evh = describeEvent(await getEvent(ev4.id));
const recv = volunteerReceivedMail({ event: evh, volunteer: { ...hana, language: "en" } });
ok("the receipt says a board member confirms the hotel and the final copy follows", /board member needs to confirm your hotel nights/.test(recv.text) && /final signed copy will be emailed/.test(recv.text) && /VOL-/.test(recv.text), recv.text);
ok("and in French", /confirmer vos nuitées/.test(volunteerReceivedMail({ event: evh, volunteer: { ...hana, language: "fr" } }).text));
const rev = volunteerReviewNeededMail({ event: evh, volunteer: hana, adminUrl: "https://x/admin.html#event/y" });
ok("the board's notice says who, what to do, and has a button", /Ready for review: Hana Hotel \(volunteer\)/.test(rev.subject) && /choose their hotel nights/.test(rev.text) && rev.html.includes("https://x/admin.html#event/y"), rev.text);
const fin = volunteerSignedMail({ event: evh, volunteer: hana2 });
ok("the final copy email names the nights, and who pays", /Hotel confirmed: check-in.*November 8, 2026.*check-out.*November 13, 2026.*5 nights.*paid by ONGIA/.test(fin.text), fin.text);
ok("a volunteer who needed no room gets no hotel line", !/Hotel confirmed|hotel room is needed/.test(volunteerSignedMail({ event: evh, volunteer: await getVolunteer(ev4.id, by("Noah").id) }).text));
ok("the board's final notice carries the hotel line too", /Hotel confirmed/.test(volunteerNoticeMail({ event: evh, volunteer: hana2, filing: { folderUrl: "https://sp" } }).text));
const rm2 = await call(volunteers, `/api/volunteers?event=${ev4.id}&id=${by("Hana").id}&final=1`, "DELETE", { reason: "test" });
rm = await call(rooming, `/api/rooming?event=${ev4.id}`);
ok("removing a volunteer takes their nights off the hotel list", rm2.ok && !rm.rows.some((x) => /Hana/.test(x.name)));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
