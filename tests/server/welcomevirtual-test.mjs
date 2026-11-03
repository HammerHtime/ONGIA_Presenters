// The Summit's virtual attendees (Andrew 3 Nov 2026: "I also need a section or the ability to send a welcome letter for
// virtual attendees … I upload an attachment or a PDF, and then I check a box"). They register on a third Wix event,
// linked as joining online: a third version of the welcome letter beside the justice and community partners', with its
// own ticked PDFs. Until it is written they are sent nothing, and they are never sent the in-room questions.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.RESEND_API_KEY = "test-key";
process.env.APP_URL = "https://events.example.org";
process.env.ADMIN_KEY = "testkey";
delete process.env.MS_MAIL_FROM;
const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.resend.com/")) {
    const p = JSON.parse(init.body);
    sent.push({ to: String(p.to), subject: p.subject, text: p.text, files: (p.attachments ?? []).map((a) => a.filename) });
    return new Response(JSON.stringify({ id: "m" + sent.length }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error("unexpected fetch " + url);
};
const F = REPO + "netlify/functions/";
const { putEvent, getEvent, putAttendees, getAttendees } = await import(F + "lib/store.mjs");
const { runLetterRounds } = await import(F + "lib/sendletters.mjs");
const { sendReplyRound } = await import(F + "lib/reply.mjs");
const welcome = (await import(F + "welcome.mjs")).default;
const agenda = (await import(F + "agenda.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (qs, init = {}) => { const r = await welcome(new Request(`http://x/api/welcome?event=ngs${qs}`, { ...init, headers: { ...H, ...(init.headers ?? {}) }, body: init.raw ?? (init.body ? JSON.stringify(init.body) : undefined) })); return { status: r.status, body: await r.json() }; };
const pdf = (s) => new TextEncoder().encode(`%PDF-1.4\n${s}\n%%EOF`);
const upload = (name) => call("&file=new", { method: "POST", headers: { "content-type": "application/pdf", "x-file-name": name }, raw: pdf(name) });
const run = (today) => runLetterRounds([], {}).then(async () => runLetterRounds([await getEvent("ngs")], { today, pace: async () => {} }));

const VIRTUAL = "1ca6fcaf-c752-4de9-bc39-cdb494ff438f";
await putEvent({ id: "ngs", title: "National Gang Summit: Organized Crime, Gangs & Youth", city: "Toronto, ON", venue: "the Delta", dayOne: "2026-11-09", lastDay: "2026-11-12",
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], attendeeMail: true,
  wix: { eventId: "w1", title: "NGS" },
  wixMore: [{ eventId: "w2", title: "NGS Community", group: "Community partners" },
    { eventId: VIRTUAL, title: "National Gang Summit: VIRTUAL", group: "Virtual", online: true, dayOne: "2026-11-09", lastDay: "2026-11-12" }],
  schedule: ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"].map((date) => ({ date, start: "09:00", end: "16:00" })),
  tasks: [{ id: "t1", what: "Welcome letter sent to attendees", daysBefore: 7, auto: "welcome" }] });
await putAttendees("ngs", { people: [
  { key: "j1", first: "Jay", email: "jay@example.ca", status: "ATTENDING", wixEventId: "w1", group: "" },
  { key: "c1", first: "Cam", email: "cam@example.ca", status: "ATTENDING", wixEventId: "w2", group: "Community partners" },
  { key: "v1", first: "Val", email: "val@example.ca", status: "ATTENDING", wixEventId: VIRTUAL, group: "Virtual" },
  { key: "v2", first: "Vic", email: "vic@example.ca", status: "ATTENDING", wixEventId: VIRTUAL, group: "Virtual" },
  // Registered in person and online: the justice partners' letter, and the questions, as before.
  { key: "b1", first: "Bo", email: "bo@example.ca", status: "ATTENDING", wixEventId: "w1", group: "" },
  { key: "b2", first: "Bo", email: "bo@example.ca", status: "ATTENDING", wixEventId: VIRTUAL, group: "Virtual" },
] });

const first = (await call("")).body;
const v = first.versions.find((x) => x.label === "Virtual");
ok("the card shows three versions: justice, community, virtual", first.versions.map((x) => x.label).join() === "Justice partners,Community partners,Virtual", JSON.stringify(first.versions.map((x) => x.label)));
ok("the virtual version reaches the two online-only people, and starts empty, said plainly", v && v.reaches === 2 && v.body === "" && /Not written yet/.test(v.problems[0]) && v.noAgendaSlot, JSON.stringify(v));
ok("someone also registered in person stays with the justice partners", first.versions[0].reaches === 2);

// Save the justice and community words as they start; leave virtual unwritten.
await call("", { method: "PUT", body: { main: first.versions[0], group: first.versions[1] } });
await agenda(new Request("http://x/api/agenda?event=ngs", { method: "POST", headers: { "x-admin-key": "testkey", "x-file-name": "justice.pdf" }, body: pdf("j") }));
await agenda(new Request("http://x/api/agenda?event=ngs&group=1", { method: "POST", headers: { "x-admin-key": "testkey", "x-file-name": "community.pdf" }, body: pdf("c") }));
const r1 = (await run("2026-11-03")).find((r) => r.kind === "welcome");
ok("with the virtual letter unwritten, the others still go and the virtual people get nothing", sent.length === 3 && !sent.some((m) => /val@|vic@/.test(m.to)), JSON.stringify(sent.map((m) => m.to)));
ok("the round says who is waiting and why, and the checklist job stays open", r1.left === 2 && /Virtual: 2 waiting/.test((r1.held ?? []).join()) && !(await getEvent("ngs")).tasks[0].done, JSON.stringify(r1));

// A PDF ticked for virtual only.
const zoom = (await upload("virtual-agenda.pdf")).body.files.at(-1);
ok("a new PDF is ticked for nobody while there are several versions", !zoom.main && !zoom.group && !zoom[v.key]);
const ticked = (await call(`&file=${zoom.id}`, { method: "PUT", body: { [v.key]: true } })).body;
ok("it can be ticked for Virtual alone", ticked.files.find((f) => f.id === zoom.id)[v.key] === true && !ticked.files.find((f) => f.id === zoom.id).main);

// A leftover placeholder holds the virtual letter back, and only it.
const words = { subject: "Welcome to the National Gang Summit: how to join online", body: "Hello {first},\n\nThe Summit will stream on Zoom.\n\nInterpretation is through Wordly. [WORDLY ACCESS DETAILS]" };
const withNote = (await call("", { method: "PUT", body: { [v.key]: words } })).body.versions.find((x) => x.key === v.key);
ok("a placeholder in capitals is caught before anything goes", /Still has a note to fill in: \[WORDLY ACCESS DETAILS\]/.test(withNote.problems[0]), JSON.stringify(withNote.problems));
const r2 = (await run("2026-11-04")).find((r) => r.kind === "welcome");
ok("so the next morning the virtual people still get nothing", sent.length === 3 && /WORDLY/.test((r2.held ?? []).join()), JSON.stringify(r2));

// The preview and test of the virtual version: made out to one of them, with only its PDF.
const pv = (await call(`&preview=${v.key}`, { method: "POST", body: {} })).body;
ok("the preview is made out to a virtual attendee, with the virtual PDF", /Hello Val/.test(pv.text) && pv.attached.join() === "virtual-agenda.pdf", JSON.stringify(pv).slice(0, 300));

// Written properly: the next morning it goes, once, with its PDF and nothing of the others'.
words.body = words.body.replace(" [WORDLY ACCESS DETAILS]", "");
await call("", { method: "PUT", body: { [v.key]: words } });
await run("2026-11-05");
const virt = sent.filter((m) => /val@|vic@/.test(m.to));
ok("the virtual people get their own letter, with only the virtual PDF", virt.length === 2 && virt.every((m) => /how to join online/.test(m.subject) && m.files.join() === "virtual-agenda.pdf"), JSON.stringify(virt));
ok("nobody else is written to again, and Bo never gets the virtual letter", sent.length === 5 && !sent.some((m) => m.to.includes("bo@") && /online/.test(m.subject)));
ok("the job ticks itself done once everyone has had theirs", (await getEvent("ngs")).tasks[0].done === true);
await run("2026-11-06");
ok("nobody gets it twice", sent.length === 5);

// The in-room questions (meals, receptions) never go to someone joining online.
sent.length = 0;
const e = await getEvent("ngs");
e.reply = { token: "t", open: true, replyBy: "2026-11-07", sentAt: new Date().toISOString(), subject: "A few questions", body: "Hello {first},\n\nA few questions about meals." };
await putEvent(e);
await sendReplyRound(await getEvent("ngs"), { today: "2026-11-05", pace: async () => {} });
ok("the questions go to the people in the room only: Bo (also in the room) yes, Val and Vic no", !sent.some((m) => /val@|vic@/.test(m.to)) && sent.some((m) => m.to.includes("bo@")) && sent.some((m) => m.to.includes("jay@")), JSON.stringify(sent.map((m) => m.to)));
ok("the virtual people are still on the attendee list", ((await getAttendees("ngs")).people ?? []).filter((p) => p.group === "Virtual").length === 3);

// The daily survey asks a virtual attendee about all four days, a community partner about their two.
const { daysFor } = await import(F + "lib/survey.mjs");
const ev = await getEvent("ngs");
ok("the survey asks the virtual attendees about every day", daysFor(ev, { group: "Virtual", wixEventId: VIRTUAL }).length === 4, JSON.stringify(daysFor(ev, { group: "Virtual", wixEventId: VIRTUAL })));
ev.wixMore[0].dayOne = "2026-11-10"; ev.wixMore[0].lastDay = "2026-11-11";
ok("and a community partner about their two, as before", daysFor(ev, { group: "Community partners", wixEventId: "w2" }).join() === "2026-11-10,2026-11-11");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
