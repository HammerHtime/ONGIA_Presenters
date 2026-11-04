// A presenter brought over from an earlier event (Andrew 4 Nov 2026: "some of the presenters will be the same at the other
// CFAOC events … select the presenter name and all the info (bio and presentation outline) will prefill and move over to
// the new event"). Picked from everyone who has signed before; their bio, talk, outline and phone wait in the new
// agreement for them to check; hotel, travel, consent and signature are the new event's own.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
process.env.APP_URL = "https://events.example.org";
delete process.env.RESEND_API_KEY; delete process.env.MS_MAIL_FROM;
const F = REPO + "netlify/functions/";
const { putEvent, putPresenter, listPresenters } = await import(F + "lib/store.mjs");
const events = (await import(F + "events.mjs")).default;
const agreement = (await import(F + "agreement.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const get = async (qs) => (await events(new Request(`http://x/api/events?${qs}`, { headers: H }))).json();
const add = async (id, body) => (await events(new Request(`http://x/api/events?id=${id}&add=1`, { method: "POST", headers: H, body: JSON.stringify(body) }))).json();

const ev = (id, title, dayOne) => ({ id, title, city: "Victoria", dayOne, lastDay: dayOne, board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], deadlines: { agreement: dayOne, draft: dayOne, final: dayOne }, nextSequence: 1 });
await putEvent(ev("west", "Canadian Forum Against Organized Crime - Western Symposium", "2026-11-24"));
await putEvent(ev("east", "Canadian Forum Against Organized Crime - Eastern Symposium", "2027-03-30"));
await putEvent(ev("old", "Regina Symposium", "2025-10-01"));
await putEvent({ ...ev("practice-x", "Practice · Symposium", "2026-10-20"), practice: true });
const sub = (talk) => ({ phone: "250-555-0100", talk, bio: "Twenty years in tobacco enforcement.", outline: "Trends, cases and what works.", hotel: "yes", hotelFrom: "2026-11-23", hotelTo: "2026-11-24", media: { summary: { public: "yes" } }, signature: "Lloyd Plomp" });
await putPresenter({ id: "lp", eventId: "west", token: "tok-lp", first: "Lloyd", last: "Plomp", email: "LP@example.ca", organization: "AGLC", status: "approved", submission: sub("Contraband nicotine"), web: { title: "Supervisor, Tobacco Enforcement Unit", bioFr: "Vingt ans…" } });
await putPresenter({ id: "lp-old", eventId: "old", token: "tok-lp-old", first: "Lloyd", last: "Plomp", email: "lp@example.ca", organization: "AGLC", status: "approved", submission: sub("An older talk") });
await putPresenter({ id: "nb", eventId: "west", token: "tok-nb", first: "Never", last: "Signed", email: "nb@example.ca", status: "invited", submission: null });
await putPresenter({ id: "pr", eventId: "practice-x", token: "tok-pr", first: "Practice", last: "Person", email: "pr@example.ca", status: "approved", submission: sub("Practice") });

const people = (await get("people=1&for=east")).people;
ok("everyone who has signed before is listed once, with their most recent event", people.length === 1 && people[0].event === "west" && people[0].talk === "Contraband nicotine", JSON.stringify(people));
ok("nobody who hasn't signed, and no practice events", !people.some((p) => /Never|Practice/.test(p.first)));

const out = await add("east", { invite: false, presenters: [{ first: "Lloyd", last: "Plomp", email: "lp@example.ca", organization: "Alberta Gaming, Liquor and Cannabis Commission", from: { event: people[0].event, presenter: people[0].presenter } }] });
const lp = (await listPresenters("east")).find((p) => p.last === "Plomp");
ok("added to the new event, waiting for their signature, nothing signed for them", out.added?.length === 1 && lp.status === "invited" && lp.submission === null);
ok("an organization with commas in it comes through whole", lp.organization === "Alberta Gaming, Liquor and Cannabis Commission");
ok("their bio, talk, outline and phone are carried", lp.prefill.bio === "Twenty years in tobacco enforcement." && lp.prefill.talk === "Contraband nicotine" && lp.prefill.outline && lp.prefill.phone);
ok("hotel, consent and signature are not", !("hotel" in lp.prefill) && !("media" in lp.prefill) && !("signature" in lp.prefill));
ok("the website's job title and French come too", lp.web?.title === "Supervisor, Tobacco Enforcement Unit" && lp.web?.bioFr === "Vingt ans…");

const form = await (await agreement(new Request(`http://x/api/agreement?t=${lp.token}`))).json();
ok("their new agreement opens with what they wrote before, to check", form.draft?.bio === "Twenty years in tobacco enforcement." && form.draft?.talk === "Contraband nicotine" && !form.draft?.signature && !form.draft?.hotel, JSON.stringify(form.draft));

ok("someone already on the event isn't offered again", (await get("people=1&for=east")).people.length === 0);
const plain = await add("east", { invite: false, presenters: [{ first: "New", last: "Face", email: "nf@example.ca", from: { event: "west", presenter: "nope" } }] });
ok("a source that can't be found just adds them plainly", plain.added?.length === 1 && !(await listPresenters("east")).find((p) => p.last === "Face").prefill);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
