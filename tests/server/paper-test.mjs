// Signed on paper (Andrew 3 Nov 2026): the Summit's agreements gathered by email over the summer sit in the Training
// Director's folders, not the Briefing Room. Marking a presenter as signed on paper makes them done: not outstanding,
// not "never sent", not in "email everyone", not chased. Undo puts them back. An agreement signed here is never touched.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
process.env.APP_URL = "https://events.example.org";
delete process.env.RESEND_API_KEY; delete process.env.MS_MAIL_FROM;
const F = REPO + "netlify/functions/";
const { putEvent, putPresenter, getPresenter, listPresenters } = await import(F + "lib/store.mjs");
const events = (await import(F + "events.mjs")).default;
const { attentionOf, countStatuses } = await import(F + "events.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const put = async (pid, body) => { const r = await events(new Request(`http://x/api/events?id=ngs&presenter=${pid}&paper=1`, { method: "PUT", headers: H, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };

await putEvent({ id: "ngs", title: "National Gang Summit", city: "Toronto", dayOne: "2026-11-09", lastDay: "2026-11-12", noDeadlines: true,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], deadlines: { agreement: "2026-08-11", draft: "2026-09-20", final: "2026-10-10" } });
const base = { eventId: "ngs", token: "t", createdAt: "2026-10-01T00:00:00Z" };
await putPresenter({ ...base, id: "fr", first: "Francis", last: "Renaud", email: "fr@example.ca", status: "invited" });                          // never sent
await putPresenter({ ...base, id: "kg", first: "Kevin", last: "Graham", email: "kg@example.ca", status: "invited", mail: [{ at: "2026-10-02T00:00:00Z", ok: true }] });
await putPresenter({ ...base, id: "da", first: "Devon", last: "Archer", email: "da@example.ca", status: "approved", approvedAt: "2026-10-20T00:00:00Z" });

let people = await listPresenters("ngs");
ok("before: Renaud is never sent, both are outstanding", attentionOf(people).uninvited.some((p) => p.id === "fr") && attentionOf(people).outstanding.length === 2);

const marked = await put("fr", { on: true });
ok("marking Renaud as signed on paper works", marked.status === 200 && marked.body.presenter.status === "paper" && marked.body.presenter.paper.was === "invited", JSON.stringify(marked.body));
await put("kg", { on: true });
people = await listPresenters("ngs");
const att = attentionOf(people), c = countStatuses(people);
ok("after: nobody never sent, nobody outstanding", att.uninvited.length === 0 && att.outstanding.length === 0, JSON.stringify(att));
ok("the counts carry them as on paper", c.paper === 2 && c.approved === 1 && c.uninvited === 0 && c.invited === 0, JSON.stringify(c));

ok("an agreement signed here can't be marked", (await put("da", { on: true })).status === 409 && (await getPresenter("ngs", "da")).status === "approved");

const undone = await put("kg", { on: false });
ok("undo puts Graham back as he was, his emails kept", undone.status === 200 && undone.body.presenter.status === "invited" && !undone.body.presenter.paper && undone.body.presenter.mail.length === 1);
ok("undo on someone not on paper is refused", (await put("kg", { on: false })).status === 409);
ok("a body without on is refused", (await put("fr", {})).status === 400);

// Email everyone leaves them out.
const invite = (await import(F + "invite.mjs")).default;
const sent = await invite(new Request("http://x/api/invite?id=ngs", { method: "POST", headers: H, body: JSON.stringify({}) }));
const out = await sent.json();
ok("'email everyone' leaves out the one on paper", !JSON.stringify(out).includes("fr@example.ca") && (await getPresenter("ngs", "fr")).status === "paper", JSON.stringify(out).slice(0, 300));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
