// Finalized without an agreement (Andrew 3 Nov 2026): "There will be some presenters who we will talk to verbally, like
// Ryan Dunlap … other people that we just speak to … like the Joy Smith Foundation … have the ability for me just to
// finalize it without any of the emails sent … I would still want a way to track the hotels, the hotel room nights, if
// we're booking them, if we're paying for them." A note says how it was arranged; the room and costs feed the rooming
// list; nothing is emailed, chased or counted as outstanding. Undo puts them back. Anyone signed here is never touched.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
process.env.APP_URL = "https://events.example.org";
process.env.RESEND_API_KEY = "test-key";
delete process.env.MS_MAIL_FROM;
const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.resend.com/")) { sent.push(String(JSON.parse(init.body).to)); return new Response(JSON.stringify({ id: "m" }), { status: 200 }); }
  throw new Error("unexpected fetch " + url);
};
const F = REPO + "netlify/functions/";
const { putEvent, getEvent, putPresenter, getPresenter, listPresenters } = await import(F + "lib/store.mjs");
const events = (await import(F + "events.mjs")).default;
const { attentionOf, countStatuses } = await import(F + "events.mjs");
const { roomingRows } = await import(F + "lib/rooming.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const put = async (pid, body) => { const r = await events(new Request(`http://x/api/events?id=ngs&presenter=${pid}&arranged=1`, { method: "PUT", headers: H, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };

await putEvent({ id: "ngs", title: "National Gang Summit", city: "Toronto", dayOne: "2026-11-09", lastDay: "2026-11-12", noDeadlines: true,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], deadlines: { agreement: "2026-08-11", draft: "2026-09-20", final: "2026-10-10" } });
const base = { eventId: "ngs", token: "t", createdAt: "2026-10-01T00:00:00Z" };
await putPresenter({ ...base, id: "jc", first: "Janet", last: "Campbell", email: "jc@example.ca", status: "invited" });                       // never sent
await putPresenter({ ...base, id: "rd", first: "Ryan", last: "Dunlap", email: "rd@example.ca", status: "invited", mail: [{ at: "2026-10-02T00:00:00Z", ok: true }] });
await putPresenter({ ...base, id: "da", first: "Devon", last: "Archer", email: "da@example.ca", status: "approved", approvedAt: "2026-10-20T00:00:00Z", review: { hotel: { from: "2026-11-08", to: "2026-11-10" }, ongiaCovers: { hotel: true } } });

let people = await listPresenters("ngs");
ok("before: Campbell is never sent, two are outstanding", attentionOf(people).uninvited.some((p) => p.id === "jc") && attentionOf(people).outstanding.length === 2);

ok("finalizing needs a note on how it was arranged", (await put("jc", { on: true, note: "" })).status === 400);
ok("a room needs who pays", (await put("jc", { on: true, note: "Spoke to them", hotel: { from: "2026-11-10", to: "2026-11-12" } })).status === 400);
ok("a room outside the training dates plus a day is refused", (await put("jc", { on: true, note: "Spoke to them", hotel: { block: "master", from: "2026-11-01", to: "2026-11-12" } })).status === 400);

// Joy Smith Foundation: spoken to, they make their own arrangements, ONGIA covers nothing.
const jc = await put("jc", { on: true, note: "Spoke to them on the phone. They are making their own arrangements.", hotel: null, covers: {} });
ok("Campbell is finalized with the note, no room, nothing covered", jc.status === 200 && jc.body.presenter.status === "arranged" && /phone/.test(jc.body.presenter.arranged.note)
  && jc.body.presenter.review.hotel === null && Object.values(jc.body.presenter.review.ongiaCovers).every((v) => v === false), JSON.stringify(jc.body));
// Ryan Dunlap: contract through his office; ONGIA books and pays his room and his travel.
const rd = await put("rd", { on: true, note: "Contract signed through his office.", hotel: { block: "master", from: "2026-11-09", to: "2026-11-11" }, covers: { transport: true } });
ok("Dunlap is finalized with ONGIA's room and travel", rd.status === 200 && rd.body.presenter.review.hotel.from === "2026-11-09" && rd.body.presenter.review.ongiaCovers.hotel === true && rd.body.presenter.review.ongiaCovers.transport === true && rd.body.presenter.review.ongiaCovers.meals === false);

people = await listPresenters("ngs");
const att = attentionOf(people), c = countStatuses(people);
ok("after: nobody never sent, nobody outstanding", att.uninvited.length === 0 && att.outstanding.length === 0, JSON.stringify(att));
ok("the counts carry them as arranged", c.arranged === 2 && c.approved === 1 && c.uninvited === 0, JSON.stringify(c));

const { rows } = roomingRows(await getEvent("ngs"), people);
const dun = rows.find((r) => r.key === "rd");
ok("the rooming list has Dunlap's two nights on ONGIA, and no room for Campbell", dun && dun.nights === 2 && dun.billing === "ONGIA" && dun.confirmed && !rows.some((r) => r.key === "jc"), JSON.stringify(rows));

// Changing it: they pay their own room after all.
const changed = await put("rd", { on: true, note: "Contract signed through his office. He pays his own room.", hotel: { block: "own", from: "2026-11-09", to: "2026-11-11" }, covers: { transport: true } });
ok("saving again changes it, keeping when it was first finalized and what it was before", changed.status === 200 && changed.body.presenter.review.ongiaCovers.hotel === false
  && changed.body.presenter.arranged.at === rd.body.presenter.arranged.at && changed.body.presenter.arranged.was === "invited");
ok("and the rooming list follows: their room, their bill", roomingRows(await getEvent("ngs"), await listPresenters("ngs")).rows.find((r) => r.key === "rd")?.billing === "Guest");

ok("an agreement signed here can't be finalized this way", (await put("da", { on: true, note: "x y z" })).status === 409 && (await getPresenter("ngs", "da")).status === "approved");

// Email everyone leaves them out.
const invite = (await import(F + "invite.mjs")).default;
await invite(new Request("http://x/api/invite?id=ngs", { method: "POST", headers: H, body: JSON.stringify({}) }));
ok("'email everyone' sends nothing to those finalized (nobody else is left to send to)", sent.length === 0, JSON.stringify(sent));

const undone = await put("rd", { on: false });
ok("undo puts Dunlap back as he was: his emails kept, note and room gone", undone.status === 200 && undone.body.presenter.status === "invited" && !undone.body.presenter.arranged && !undone.body.presenter.review && undone.body.presenter.mail.length === 1);
ok("undo on someone not finalized is refused", (await put("rd", { on: false })).status === 409);
ok("a body without on is refused", (await put("jc", {})).status === 400);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
