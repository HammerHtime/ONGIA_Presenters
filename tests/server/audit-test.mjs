// Audit fixes, server side: who may change an event (its board, the president, the VP), who signs (the signed-in person),
// who may delete, and saves that no longer undo each other.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
delete process.env.RESEND_API_KEY; delete process.env.MS_MAIL_FROM;
const F = REPO + "netlify/functions/";
const imp = async (n) => (await import(F + n)).default;
const events = await imp("events.mjs"), agreement = await imp("agreement.mjs"), review = await imp("review.mjs"), roster = await imp("roster.mjs");
const invite = await imp("invite.mjs"), rooming = await imp("rooming.mjs"), tasks = await imp("tasks.mjs"), attendees = await imp("attendees.mjs");
const agenda = await imp("agenda.mjs"), volunteers = await imp("volunteers.mjs"), volunteer = await imp("volunteer.mjs"), inbox = await imp("inbox.mjs"), contract = await imp("contract.mjs"), materials = await imp("materials.mjs");
const store = await import(F + "lib/store.mjs");
const { issueSession, mayEditEvent } = await import(F + "lib/auth.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const as = (email, name = email) => ({ "x-admin-key": issueSession({ email, name }), "content-type": "application/json" });
const KEY = { "x-admin-key": "testkey", "content-type": "application/json" };
const PRES = as("president@ongia.ca", "Andrew Hammond"), VP = as("vp_operations@ongia.ca", "Jacqulyn Taylor"), LEAD = as("treasurer@ongia.ca", "Raj Jaswal"), MEMBER = as("j.healy@ongia.ca", "John Healy"), OTHER = as("b.konkle@ongia.ca", "Barb Konkle");
const call = async (h, url, method = "GET", body, headers = KEY) => { const r = await h(new Request("http://localhost" + url, { method, headers, body: body ? JSON.stringify(body) : undefined })); return { http: r.status, ...(await r.json().catch(() => ({}))) }; };
await call(roster, "/api/roster");
const mk = async (title, who = KEY) => (await call(events, "/api/events", "POST", { title, city: "Toronto", dayOne: "2027-03-09", lastDay: "2027-03-11", invite: false,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }, { name: "John Healy", email: "j.healy@ongia.ca" }],
  presenters: [{ first: "Ann", last: "One", email: "ann@example.ca", organization: "Org" }, { first: "Bob", last: "Two", email: "bob@example.ca", organization: "Org" }] }, who)).event;
const ev = await mk("Audit Event");
const answers = (p) => ({ first: p.first, last: p.last, email: p.email, phone: "4165550100", organization: "Org", talk: "T", bio: "word ".repeat(40), outline: "O", travel: "no", hotel: "no",
  expenses: { transport: "no", meals: "no", other: "no", otherText: "" }, copyright: true, noInvestigation: true, termsAccepted: true,
  media: { photo: { internal: "yes", public: "yes" }, materials: { internal: "yes", public: "no" }, summary: { internal: "yes", public: "yes" }, bio: { internal: "yes", public: "yes" } }, sensitive: "no", signature: `${p.first} ${p.last}`, agreed: true, language: "en" });
const people = async (e) => store.listPresenters(e.id);
for (const p of await people(ev)) await call(agreement, `/api/agreement?t=${p.token}`, "POST", answers(p), { "content-type": "application/json" });

console.log("— the rule");
const e0 = await store.getEvent(ev.id);
ok("the lead, another board member on the event, the president and the VP may change it; another board member may not", mayEditEvent({ email: "treasurer@ongia.ca" }, e0) && mayEditEvent({ email: "J.Healy@ongia.ca" }, e0) && mayEditEvent({ email: "president@ongia.ca" }, e0) && mayEditEvent({ email: "vp_operations@ongia.ca" }, e0) && !mayEditEvent({ email: "b.konkle@ongia.ca" }, e0));

console.log("— looking is open to every board member who can sign in; changing is not");
let r = await call(events, `/api/events?id=${ev.id}`, "GET", undefined, OTHER);
ok("another board member can open the event, and is told it is view only", r.http === 200 && r.canEdit === false);
ok("the lead is told they can change it", (await call(events, `/api/events?id=${ev.id}`, "GET", undefined, LEAD)).canEdit === true);
const list = await call(events, "/api/events", "GET", undefined, OTHER);
ok("the events list says, per event, which the viewer can change", list.events.find((e) => e.id === ev.id).canEdit === false);
ok("…and that the event's own board member and the president can change it", (await call(events, "/api/events", "GET", undefined, MEMBER)).events.find((e) => e.id === ev.id).canEdit === true && (await call(events, "/api/events", "GET", undefined, PRES)).events.find((e) => e.id === ev.id).canEdit === true);
const tries = [
  ["edit the event", events, `/api/events?id=${ev.id}`, "PUT", { title: "Hijacked" }],
  ["add presenters", events, `/api/events?id=${ev.id}&add=1`, "POST", { presenters: [{ first: "X", last: "Y", email: "x@y.ca" }] }],
  ["switch attendee email", events, `/api/events?id=${ev.id}&attendeeMail=1`, "PUT", { on: true }],
  ["send invitations", invite, `/api/invite?id=${ev.id}`, "POST", {}],
  ["change the hotel list", rooming, `/api/rooming?event=${ev.id}`, "PUT", {}],
  ["add a checklist job", tasks, `/api/tasks?event=${ev.id}`, "POST", { title: "x" }],
  ["add attendees", attendees, `/api/attendees?event=${ev.id}`, "POST", { people: [] }],
  ["change the agenda", agenda, `/api/agenda?event=${ev.id}`, "PUT", { schedule: [] }],
  ["add a volunteer", volunteers, `/api/volunteers?event=${ev.id}`, "POST", { volunteers: [] }],
  ["add an email to-do", inbox, `/api/inbox?event=${ev.id}`, "POST", { note: "x" }],
  ["mark materials", materials, `/api/materials?event=${ev.id}&presenter=x`, "POST", {}],
];
for (const [what, h, url, method, body] of tries) {
  const x = await call(h, url, method, body, OTHER);
  ok(`another board member cannot ${what} (refused with the reason)`, x.http === 403 && /only its own board members/.test(x.error ?? ""), JSON.stringify(x).slice(0, 160));
}
ok("…nor delete it", (await call(events, `/api/events?id=${ev.id}`, "DELETE", undefined, OTHER)).http === 403);
ok("the event was not changed by any of that", (await store.getEvent(ev.id)).title === "Audit Event");
r = await call(events, `/api/events?id=${ev.id}`, "PUT", { ...await store.getEvent(ev.id), title: "Audit Event", venue: "Changed by Healy" }, MEMBER);
ok("a board member who is on the event can change it", r.http === 200 && (await store.getEvent(ev.id)).venue === "Changed by Healy", JSON.stringify(r).slice(0, 200));

console.log("— deleting an event");
const del = await mk("To Delete");
ok("the event's own lead cannot delete it", (await call(events, `/api/events?id=${del.id}`, "DELETE", undefined, LEAD)).http === 403 && !!(await store.getEvent(del.id)));
ok("the VP can", (await call(events, `/api/events?id=${del.id}`, "DELETE", undefined, VP)).http === 200 && !(await store.getEvent(del.id)));

console.log("— who signs an approval");
const [ann, bob] = await people(ev);
r = await call(review, `/api/review?event=${ev.id}&presenter=${ann.id}`, "GET", undefined, OTHER);
ok("another board member can read the agreement, is told it is view only, and has no signer", r.http === 200 && r.canEdit === false);
r = await call(review, `/api/review?event=${ev.id}&presenter=${ann.id}&action=approve`, "POST", { approverName: "Raj Jaswal", attest: true, covers: {} }, OTHER);
ok("another board member cannot approve it, even typing the lead's name", r.http === 403 && (await store.getPresenter(ev.id, ann.id)).status === "submitted");
ok("…nor send it back", (await call(review, `/api/review?event=${ev.id}&presenter=${ann.id}&action=return`, "POST", { note: "x" }, OTHER)).http === 403);
r = await call(review, `/api/review?event=${ev.id}&presenter=${ann.id}`, "GET", undefined, MEMBER);
ok("the review page names the signed-in person as the signer", r.canEdit === true && r.signer?.name === "John Healy" && r.signer?.email === "j.healy@ongia.ca");
r = await call(review, `/api/review?event=${ev.id}&presenter=${ann.id}&action=approve`, "POST", { approverName: "Raj Jaswal", approverRole: "Director", attest: true, covers: {} }, MEMBER);
const a1 = (await store.getPresenter(ev.id, ann.id)).review.approver;
ok("a board member on the event (not the lead) can approve, and the signature is theirs, not the name typed", r.http === 200 && a1.name === "John Healy" && a1.email === "j.healy@ongia.ca" && a1.via === "Microsoft sign-in" && a1.role === "Director", JSON.stringify(a1));
r = await call(review, `/api/review?event=${ev.id}&presenter=${bob.id}&action=return`, "POST", { note: "Please fix the outline", approverName: "Someone Else" }, VP);
ok("the VP, not on the event, can send one back; it records the VP as the one who did", r.http === 200 && (await store.getPresenter(ev.id, bob.id)).review.returnedBy === "Jacqulyn Taylor");
const ev2 = await mk("President Signs");
for (const p of await people(ev2)) await call(agreement, `/api/agreement?t=${p.token}`, "POST", answers(p), { "content-type": "application/json" });
const [c1] = await people(ev2);
r = await call(review, `/api/review?event=${ev2.id}&presenter=${c1.id}&action=approve`, "POST", { attest: true, covers: {} }, PRES);
ok("the president, not on the event, can approve, as himself", r.http === 200 && (await store.getPresenter(ev2.id, c1.id)).review.approver.name === "Andrew Hammond");

console.log("— volunteers are signed the same way");
await call(volunteers, `/api/volunteers?event=${ev.id}`, "POST", { invite: false, volunteers: [{ first: "Vera", last: "Vol", email: "vera@example.ca", organization: "Org" }] }, LEAD);
const [vol] = await store.listVolunteers(ev.id);
await call(volunteer, `/api/volunteer?t=${vol.token}`, "POST", { first: "Vera", last: "Vol", email: "vera@example.ca", phone: "4165550100", organization: "Org", accommodation: "yes", termsAccepted: true, standing: true, signature: "Vera Vol", agreed: true, language: "en" }, { "content-type": "application/json" });
const v1 = await store.getVolunteer(ev.id, vol.id);
if (v1.status === "submitted") {
  ok("another board member cannot approve a volunteer", (await call(volunteers, `/api/volunteers?event=${ev.id}&id=${vol.id}&action=approve`, "POST", { approverName: "X", hotel: { need: "no" } }, OTHER)).http === 403);
  r = await call(volunteers, `/api/volunteers?event=${ev.id}&id=${vol.id}&action=approve`, "POST", { approverName: "Typed Name", hotel: { need: "no" } }, LEAD);
  const va = (await store.getVolunteer(ev.id, vol.id)).review?.approver;
  ok("the lead approves a volunteer and the signature is the lead's own", r.http === 200 && va?.name === "Raj Jaswal" && va?.email === "treasurer@ongia.ca", JSON.stringify([r.http, r.error, va]));
} else ok("(volunteer sign-up for the test)", false, JSON.stringify(v1.status));

console.log("— two saves no longer undo each other");
const ev3 = await mk("Concurrency");
const [p3] = await people(ev3);
const morning = await store.getPresenter(ev3.id, p3.id);       // the morning run reads her…
const person = await store.getPresenter(ev3.id, p3.id);        // …and so does someone at the desk
person.status = "approved"; person.review = { approver: { name: "Raj Jaswal" } };
await store.putPresenter(person);                              // the desk saves first
morning.mail = [...(morning.mail ?? []), { at: "2027-01-01", kind: "remind" }];
await store.putPresenter(morning);                             // then the morning run saves its stale copy
const p3now = await store.getPresenter(ev3.id, p3.id);
ok("the approval made at the desk survives the morning run's later save", p3now.status === "approved" && p3now.review?.approver?.name === "Raj Jaswal", JSON.stringify([p3now.status, p3now.review]));
ok("and the morning run's note of its email is kept too", (p3now.mail ?? []).some((m) => m.kind === "remind"));
ok("the morning run's copy now carries the merged record", morning.status === "approved");
const s1 = await store.getEvent(ev3.id), s2 = await store.getEvent(ev3.id);
s1.venue = "Hall A"; await store.putEvent(s1);
s2.sessionMinutes = 45; await store.putEvent(s2);
const e3 = await store.getEvent(ev3.id);
ok("two people editing different parts of an event both keep their change", e3.venue === "Hall A" && e3.sessionMinutes === 45, JSON.stringify([e3.venue, e3.sessionMinutes]));
const t1 = await store.getEvent(ev3.id), t2 = await store.getEvent(ev3.id);
t1.venue = "Hall B"; await store.putEvent(t1);
t2.venue = "Hall C"; await store.putEvent(t2);
ok("on the very same field, the later save wins (as before)", (await store.getEvent(ev3.id)).venue === "Hall C");
const u = await store.getEvent(ev3.id); delete u.venue; await store.putEvent(u);
ok("a field removed by a save stays removed", (await store.getEvent(ev3.id)).venue === undefined);
const copy = { ...(await store.getEvent(ev3.id)), venue: "From a copy" }; await store.putEvent(copy);
ok("a copy made with a spread is saved as it is (the old behaviour)", (await store.getEvent(ev3.id)).venue === "From a copy");
ok("nothing extra is saved with the record", !Object.keys(await store.getEvent(ev3.id)).some((k) => k.startsWith("__")) && !JSON.stringify(await store.getPresenter(ev3.id, p3.id)).includes("__asRead"));

// Audit F05 (28 Oct 2026): where the desk key can't sign in (DESK_KEY_LOGIN=off, as live), it can't sign an approval either.
console.log("— the desk key can't sign where key sign-in is off");
const ev4 = await mk("Key Signing Event");
const [k1] = await people(ev4);
await call(agreement, `/api/agreement?t=${k1.token}`, "POST", answers(k1), { "content-type": "application/json" });
process.env.DESK_KEY_LOGIN = "off";
r = await call(review, `/api/review?event=${ev4.id}&presenter=${k1.id}&action=approve`, "POST", { approverName: "Typed Name", attest: true, covers: {} }, KEY);
ok("the key is refused, and told to sign in", r.http === 403 && /Sign in with your Microsoft account/.test(r.error) && (await store.getPresenter(ev4.id, k1.id)).status === "submitted", JSON.stringify(r));
await call(volunteers, `/api/volunteers?event=${ev4.id}`, "POST", { invite: false, volunteers: [{ first: "Kim", last: "Key", email: "kim@example.ca", organization: "Org" }] });
const [kv] = await store.listVolunteers(ev4.id);
await call(volunteer, `/api/volunteer?t=${kv.token}`, "POST", { first: "Kim", last: "Key", email: "kim@example.ca", phone: "4165550100", organization: "Org", accommodation: "yes", termsAccepted: true, standing: true, signature: "Kim Key", agreed: true, language: "en" }, { "content-type": "application/json" });
ok("and for a volunteer too", (await store.getVolunteer(ev4.id, kv.id)).status === "submitted" && (await call(volunteers, `/api/volunteers?event=${ev4.id}&id=${kv.id}&action=approve`, "POST", { approverName: "Typed", hotel: { need: "no" } }, KEY)).http === 403);
r = await call(review, `/api/review?event=${ev4.id}&presenter=${k1.id}&action=approve`, "POST", { attest: true, covers: {} }, LEAD);
ok("the signed-in lead still approves, as themselves", r.http === 200 && (await store.getPresenter(ev4.id, k1.id)).review.approver.name === "Raj Jaswal", JSON.stringify(r).slice(0, 200));
delete process.env.DESK_KEY_LOGIN;
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
