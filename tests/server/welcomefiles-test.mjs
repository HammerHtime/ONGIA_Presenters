// PDFs attached to the welcome letter (Andrew 27 Oct 2026: "upload attachments to the welcome email … check boxes.
// Attached to community partner and attached to justice partners … allow for multiple attachments"). Each person gets
// the files ticked for their version, after its agenda; an email never carries more than 3 MB.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.RESEND_API_KEY = "test-key";
process.env.APP_URL = "https://events.example.org";
process.env.ADMIN_KEY = "testkey";
delete process.env.MS_MAIL_FROM;
const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.resend.com/")) {
    const p = JSON.parse(init.body);
    sent.push({ to: String(p.to), subject: p.subject, files: (p.attachments ?? []).map((a) => a.filename) });
    return new Response(JSON.stringify({ id: "m" + sent.length }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error("unexpected fetch " + url);
};
const F = REPO + "netlify/functions/";
const store = await import(F + "lib/store.mjs");
const { putEvent, getEvent, putAttendees } = store;
const { runLetterRounds } = await import(F + "lib/sendletters.mjs");
const welcome = (await import(F + "welcome.mjs")).default;
const agenda = (await import(F + "agenda.mjs")).default;
const events = (await import(F + "events.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (qs, init = {}) => { const r = await welcome(new Request(`http://x/api/welcome?event=ngs${qs}`, { ...init, headers: { ...H, ...(init.headers ?? {}) }, body: init.raw ?? (init.body ? JSON.stringify(init.body) : undefined) })); const t = r.headers.get("content-type") ?? ""; return { status: r.status, body: t.includes("json") ? await r.json() : new Uint8Array(await r.arrayBuffer()) }; };
const pdf = (s, pad = 0) => new Uint8Array([...new TextEncoder().encode(`%PDF-1.4\n${s}\n`), ...new Uint8Array(pad), ...new TextEncoder().encode("%%EOF")]);
const upload = (name, bytes) => call("&file=new", { method: "POST", headers: { "content-type": "application/pdf", "x-file-name": encodeURIComponent(name) }, raw: bytes });

await putEvent({ id: "ngs", title: "National Gang Summit: Organized Crime, Gangs & Youth", city: "Toronto, ON", venue: "the Sheraton Centre", dayOne: "2026-11-09", lastDay: "2026-11-12", board: [],
  wixMore: [{ eventId: "w2", title: "NGS Community Partners", group: "Community partners" }],
  schedule: ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"].map((date) => ({ date, start: "08:30", end: "16:00" })),
  tasks: [{ id: "t1", what: "Welcome letter sent to attendees", daysBefore: 7, auto: "welcome" }] });
await putAttendees("ngs", { people: [
  { key: "j1", first: "Jay", last: "Justice", email: "jay@example.ca", status: "ATTENDING" },
  { key: "c1", first: "Cam", last: "Community", email: "cam@example.ca", status: "ATTENDING", group: "Community partners" }] });
await call("", { method: "PUT", body: { main: { subject: "Welcome, justice partners", body: "Hello {first}," }, group: { subject: "Welcome, community partners", body: "Hello {first}," } } });
await agenda(new Request("http://x/api/agenda?event=ngs", { method: "POST", headers: { "x-admin-key": "testkey", "content-type": "application/pdf", "x-file-name": "justice-agenda.pdf" }, body: pdf("j") }));
await agenda(new Request("http://x/api/agenda?event=ngs&group=1", { method: "POST", headers: { "x-admin-key": "testkey", "content-type": "application/pdf", "x-file-name": "community-agenda.pdf" }, body: pdf("c") }));

// Upload: several PDFs; with two groups each starts unticked, so Andrew chooses.
let r = await upload("Parking map.pdf", pdf("parking"));
const parking = r.body.files?.[0];
ok("a PDF is added, by its own name, attached to neither letter until ticked", r.status === 200 && parking?.name === "Parking map.pdf" && !parking.main && !parking.group, JSON.stringify(r.body).slice(0, 200));
r = await upload("Hotel and venue.pdf", pdf("hotel"));
const hotel = r.body.files?.[1];
ok("and another: several can be attached", r.body.files.length === 2);
ok("something that is not a PDF is refused, with why", (await upload("notes.docx", new TextEncoder().encode("PK\u0003\u0004 word"))).status === 415);
ok("an empty file is refused", (await upload("empty.pdf", new Uint8Array())).status === 400);

// The ticks.
r = await call(`&file=${parking.id}`, { method: "PUT", body: { main: true, group: true } });
ok("the parking map ticked for both", r.body.files.find((f) => f.id === parking.id).main && r.body.files.find((f) => f.id === parking.id).group);
r = await call(`&file=${hotel.id}`, { method: "PUT", body: { main: true } });
ok("the hotel sheet for the justice partners only", r.body.files.find((f) => f.id === hotel.id).main && !r.body.files.find((f) => f.id === hotel.id).group);
ok("each version says how much it carries", r.body.versions[0].attachedBytes > r.body.versions[1].attachedBytes && r.body.attachLimit === 3 * 1024 * 1024);

// The preview names what goes with each.
const see = async (which) => (await call(`&preview=${which}`, { method: "POST", body: {} })).body.attached;
ok("the justice partners' email: their agenda, the parking map, the hotel sheet", JSON.stringify(await see("main")) === JSON.stringify(["justice-agenda.pdf", "Parking map.pdf", "Hotel and venue.pdf"]), JSON.stringify(await see("main")));
ok("the community partners': their agenda and the parking map", JSON.stringify(await see("group")) === JSON.stringify(["community-agenda.pdf", "Parking map.pdf"]), JSON.stringify(await see("group")));

// Opening one.
const opened = await call(`&file=${parking.id}`);
ok("Open gives the PDF back", opened.status === 200 && new TextDecoder().decode(opened.body.slice(0, 5)) === "%PDF-");

// 3 MB in all per email.
const big = await upload("Brochure.pdf", pdf("big", 1.6 * 1024 * 1024));
const brochure = big.body.files?.find((f) => f.name === "Brochure.pdf");
const big2 = await upload("Sponsor book.pdf", pdf("big2", 1.6 * 1024 * 1024));
const book = big2.body.files?.find((f) => f.name === "Sponsor book.pdf");
ok("two 1.6 MB PDFs can be added", big.status === 200 && big2.status === 200 && !!brochure && !!book);
ok("one can be ticked", (await call(`&file=${brochure.id}`, { method: "PUT", body: { main: true } })).status === 200);
const over = await call(`&file=${book.id}`, { method: "PUT", body: { main: true } });
ok("…but ticking the second, past 3 MB in one email, is refused, saying why", over.status === 413 && /3 MB/.test(over.body.error) && /Justice partners/.test(over.body.error), JSON.stringify(over.body).slice(0, 300));
ok("and it stays unticked", !(await getEvent("ngs")).welcomeFiles.find((f) => f.id === book.id).main);
ok("it can still go with the other letter, which has room", (await call(`&file=${book.id}`, { method: "PUT", body: { group: true } })).status === 200);
ok("a file over 3 MB on its own is refused at upload", (await upload("Huge.pdf", pdf("huge", 3.2 * 1024 * 1024))).status === 413);
for (const f of [brochure, book]) await call(`&file=${f.id}`, { method: "DELETE" });
ok("Remove takes them off, and their files go", !(await getEvent("ngs")).welcomeFiles.some((f) => [brochure.id, book.id].includes(f.id)) && !(await store.getWelcomeFile("ngs", brochure.id)));

// A test email carries them.
sent.length = 0;
await call("&test=group", { method: "POST", body: { to: "president@ongia.ca" } });
ok("a test of the community partners' letter carries their files", JSON.stringify(sent[0]?.files) === JSON.stringify(["community-agenda.pdf", "Parking map.pdf"]), JSON.stringify(sent[0]));

// The real round: each person gets their own version's files.
sent.length = 0;
const e = await getEvent("ngs"); e.attendeeMail = true; await putEvent(e);
await runLetterRounds([await getEvent("ngs")], { today: "2026-11-02", pace: async () => {} });
const jay = sent.find((m) => m.to === "jay@example.ca"), cam = sent.find((m) => m.to === "cam@example.ca");
ok("the justice partner gets the agenda, the parking map and the hotel sheet", JSON.stringify(jay?.files) === JSON.stringify(["justice-agenda.pdf", "Parking map.pdf", "Hotel and venue.pdf"]), JSON.stringify(sent));
ok("the community partner gets theirs, without the hotel sheet", JSON.stringify(cam?.files) === JSON.stringify(["community-agenda.pdf", "Parking map.pdf"]), JSON.stringify(sent));

// An event with one group: nothing to choose, so a new PDF goes with the letter.
await putEvent({ id: "one", title: "Calgary Training Day", city: "Calgary, AB", dayOne: "2026-11-20", lastDay: "2026-11-20", board: [] });
const one = await welcome(new Request("http://x/api/welcome?event=one&file=new", { method: "POST", headers: { "x-admin-key": "testkey", "content-type": "application/pdf", "x-file-name": "Map.pdf" }, body: pdf("map") }));
const oneBody = await one.json();
ok("with one group a new PDF goes with the letter straight away", one.status === 200 && oneBody.files[0].main === true && oneBody.files[0].group === false);

// A missing file holds the round back rather than sending without it.
const gone = await getEvent("one"); await store.deleteWelcomeFile("one", gone.welcomeFiles[0].id);
gone.welcome = { main: { subject: "Welcome", body: "Hello {first}," } }; gone.attendeeMail = true; gone.tasks = [{ id: "t1", what: "Welcome letter sent to attendees", daysBefore: 7, auto: "welcome" }]; await putEvent(gone);
await putAttendees("one", { people: [{ key: "a", first: "Ari", email: "ari@example.ca", status: "ATTENDING" }] });
sent.length = 0;
const [held] = await runLetterRounds([await getEvent("one")], { today: "2026-11-13", pace: async () => {} });
ok("a file gone missing holds the letter back with a reason, and nothing is sent", sent.length === 0 && /Map\.pdf could not be found/.test(JSON.stringify(held)), JSON.stringify(held));

// Deleting the event deletes its attachments.
const keep = (await getEvent("ngs")).welcomeFiles.map((f) => f.id);
await events(new Request("http://x/api/events?id=ngs", { method: "DELETE", headers: H }));
ok("deleting the event deletes its attached PDFs", (await Promise.all(keep.map((id) => store.getWelcomeFile("ngs", id)))).every((x) => !x));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
