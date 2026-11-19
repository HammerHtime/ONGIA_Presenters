// A presenter's own expense claim, by a link (Andrew 19 Nov 2026: "send out a link to presenters post-conference … they
// take a picture of their receipts … bypass [the Microsoft sign-in] and just submit"; "30 days is good"; "I would like a
// button to send"). The link is theirs alone; the claim is an ordinary one for them, approved by the President and the
// VP. Meals the event served have no per diem; mileage is $0.66 for everyone.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
delete process.env.ANTHROPIC_API_KEY;
const F = REPO + "netlify/functions/";
const px = (await import(F + "presenter-expenses.mjs")).default;
const exp = (await import(F + "expenses.mjs")).default;
const events = (await import(F + "events.mjs")).default;
const roster = (await import(F + "roster.mjs")).default;
const X = await import(F + "lib/expenses.mjs");
const P = await import(F + "lib/presenterexpense.mjs");
const M = await import(F + "lib/expensemail.mjs");
const S = await import(F + "lib/store.mjs");
const { todayIso } = await import(F + "lib/deadlines.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
await roster(new Request("http://localhost/api/roster", { headers: H }));
const day = (n) => todayIso(new Date(Date.now() + n * 86400e3));
const as = (email, name) => ({ "x-expense-key": X.issueExpenseSession({ email, name }), "content-type": "application/json" });
const PRES = as("president@ongia.ca", "Andrew Hammond"), VP = as("vp_operations@ongia.ca", "Jacqulyn Taylor");
const J = async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) });

ok("mileage is $0.66 a kilometre for everyone", X.mileageRate() === 0.66);

await S.putEvent({ id: "pl-ev", title: "National Gang Summit", city: "Toronto, ON", dayOne: day(-6), lastDay: day(-3), board: [], mealsProvided: { breakfast: true, lunch: true, dinner: false } });
await S.putEvent({ id: "pl-old", title: "Spring Symposium", city: "London, ON", dayOne: day(-50), lastDay: day(-49), board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }] });
await S.putPresenter({ id: "d1", eventId: "pl-ev", first: "Dana", last: "Sample", email: "Dana@Example.ca", organization: "Windsor Police Service", status: "signed", language: "en" });
await S.putPresenter({ id: "f1", eventId: "pl-ev", first: "Marc", last: "Exemple", email: "marc@example.ca", organization: "SPVM", status: "signed", language: "fr" });
await S.putPresenter({ id: "n1", eventId: "pl-ev", first: "No", last: "Email", email: "", organization: "Somewhere", status: "signed" });
await S.putPresenter({ id: "o1", eventId: "pl-old", first: "Old", last: "Timer", email: "old@example.ca", organization: "OPP", status: "signed" });

// The desk: each presenter's link.
let r = await J(await px(new Request("http://localhost/api/presenter-expenses?event=pl-ev&links=1")));
ok("the links are the desk's to see, not anyone's", r.status === 401);
r = await J(await px(new Request("http://localhost/api/presenter-expenses?event=pl-ev&links=1", { headers: H })));
const dana = r.presenters.find((p) => p.name === "Dana Sample");
ok("the desk sees each presenter's own link, the deadline 30 days after the event, and the meals it served", r.presenters.length === 3 && /\/x\/pl-ev\/d1\/[0-9a-f]{32}$/.test(dana.link) && r.deadline === day(27) && r.provided.join() === "breakfast,lunch" && dana.sentAt === null && dana.claim === null, JSON.stringify(r));
const key = dana.link.split("/").pop();
const mine = (extra = "") => `http://localhost/api/presenter-expenses?e=pl-ev&p=d1&k=${key}${extra}`;
const call = async (extra = "", init = {}) => J(await px(new Request(mine(extra), init)));

ok("a wrong or borrowed key opens nothing", (await J(await px(new Request(`http://localhost/api/presenter-expenses?e=pl-ev&p=f1&k=${key}`)))).status === 403 && (await J(await px(new Request("http://localhost/api/presenter-expenses?e=pl-ev&p=d1&k=nope")))).status === 403);
ok("a presenter with no email is told why they can't claim", (await J(await px(new Request(`http://localhost/api/presenter-expenses?e=pl-ev&p=n1&k=${r.presenters.find((p) => p.name === "No Email").link.split("/").pop()}`)))).status === 409);

// The presenter's page.
r = await call();
ok("the page: who they are, the event, the meal per diem, what was served, the mileage rate, and no claim yet", r.status === 200 && r.presenter.name === "Dana Sample" && r.presenter.email === "dana@example.ca" && r.event.title === "National Gang Summit" && r.perDiem.dinner === 62.7 && r.provided.join() === "breakfast,lunch" && r.rate === 0.66 && r.claim === null && r.open === true, JSON.stringify(r).slice(0, 400));
ok("the words they read: what ONGIA covers, that breakfast and lunch were provided so only dinner can be claimed, food only and no alcohol, mileage",
  /up to these amounts per meal: Breakfast \$29\.95 · Lunch \$30\.55 · Dinner \$62\.70\./.test(r.blurb.en[0]) && /At this event, breakfast and lunch were provided, so you can claim dinner only\./.test(r.blurb.en[1]) && /food only\. Alcohol is not reimbursed, so please keep it on a separate bill\. Anything above the per diem amount is your own cost\./.test(r.blurb.en[2]) && /mileage is paid at the federal government rate/.test(r.blurb.en[3]) && /le déjeuner et le dîner étaient fournis/.test(r.blurb.fr[1]), JSON.stringify(r.blurb));

// A receipt (a photo), kilometres, and a meal.
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 7)]);
r = await call("&add=receipt", { method: "POST", headers: { "content-type": "image/jpeg", "x-file-name": "dinner.jpg" }, body: jpg });
ok("a photo of a receipt starts their claim, made out to them, with no sign-in", [200, 202].includes(r.status) && r.claim?.lines.length === 1 && r.claim.status === "draft" && r.claim.canEdit === true, JSON.stringify(r).slice(0, 300));
const C = r.claim.id, L1 = r.claim.lines[0].id;
const stored = await S.getClaim(C);
ok("the claim is the presenter's own: paid to their email, marked with their link, owned by no board member", stored.payee.email === "dana@example.ca" && stored.payee.presenter === "d1" && stored.self.link === dana.link && P.isSelfOwner(stored.owner.email) && stored.owner.name === "Dana Sample", JSON.stringify({ o: stored.owner, s: stored.self }));
r = await call(`&line=${L1}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ paidTo: "The Keg", date: day(-4), amount: 80, meal: "dinner", eventId: "pl-old", sowLineId: "x", category: 2 }) });
const keg = r.claim.lines.find((l) => l.id === L1);
ok("what they typed is kept; an $80 dinner is marked $17.30 over the per diem; nothing else can be slipped in", keg.paidTo === "The Keg" && keg.amount === 80 && keg.overPerDiem?.over === 17.3 && !keg.eventId && keg.category === X.TRAVEL, JSON.stringify(keg).slice(0, 300));
r = await call("&add=mileage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: day(-6), km: 100, from: "Windsor", to: "Toronto" }) });
ok("kilometres at $0.66: 100 km is $66.00", r.claim.lines.find((l) => l.kind === "mileage")?.amount === 66, JSON.stringify(r.claim?.lines.map((l) => l.amount)));
r = await call("&add=receipt", { method: "POST", headers: { "content-type": "image/jpeg", "x-file-name": "lunch.jpg" }, body: Buffer.concat([jpg, Buffer.from([1])]) });
const L2 = r.claim.lines.find((l) => l.kind === "receipt" && l.id !== L1).id;
r = await call(`&line=${L2}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ paidTo: "Sub Shop", date: day(-4), amount: 14, meal: "lunch" }) });
ok("a lunch at an event that served lunch is marked as provided", r.claim.lines.find((l) => l.id === L2).mealProvided === true);
const file = await px(new Request(mine(`&file=${L1}`)));
ok("they can see their own receipt again", file.status === 200 && Buffer.from(await file.arrayBuffer()).equals(jpg));

// Nobody on the board has this claim in their app while it's being built.
r = await J(await exp(new Request("http://localhost/api/expenses", { headers: PRES })));
ok("it isn't in the President's own claims, and isn't waiting on him yet", r.current?.id !== C && !(r.others ?? []).some((o) => o.id === C) && !r.toApprove.some((c) => c.id === C));

// Sent: to the President and the VP, flagged, never refused.
r = await call("&submit=1", { method: "POST" });
ok("they send it: no category or purpose asked of them, and over the per diem doesn't stop it", r.status === 200 && r.claim.status === "submitted" && r.claim.canEdit === false, JSON.stringify(r).slice(0, 300));
r = await J(await exp(new Request(`http://localhost/api/expenses?claim=${C}`, { headers: PRES })));
const notes = (r.claim.checks?.notes ?? []).join(" | ");
ok("the President sees it to approve, with both flags: over the dinner per diem, and a lunch the event provided", r.claim.can.decide?.role === "president" && /\$17\.30 over the \$62\.70 per diem/.test(notes) && /\$14\.00 for lunch, but lunch was provided at the event, so there's no per diem for it/.test(notes) && /Lunch was provided at the event/.test(r.claim.checks.flags[L2] ?? ""), notes);
const sentClaim = await S.getClaim(C);
const am = M.needsApprovalMail({ claim: sentClaim, lines: [], checks: null });
ok("the approvers' email says it came by the presenter's own link", /Expense claim for Dana Sample \(presenter, sent by their own link\)/.test(am.subject), am.subject);
ok("a sent claim can't be added to", (await call("&add=mileage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: day(-6), km: 5, from: "a", to: "b" }) })).status === 409);

// Sent back: the presenter is told, with their link, and can fix it.
await exp(new Request(`http://localhost/api/expenses?decide=${C}`, { method: "POST", headers: PRES, body: JSON.stringify({ decision: "reject", comment: "Please remove the lunch." }) }));
let after = await S.getClaim(C);
const sb = M.sentBackMail({ claim: after, by: "Andrew Hammond (President)", comment: "Please remove the lunch." });
ok("sent back: the email goes to the presenter and opens their link, not the board's app", after.status === "rejected" && after.mail.some((m) => m.what === "sent back" && m.to === "dana@example.ca") && sb.text.includes(dana.link) && !sb.text.includes("/expenses#claim"), JSON.stringify(after.mail?.slice(-2)) + after.status);
r = await call(`&line=${L2}`, { method: "DELETE" });
ok("they take the lunch off and send it again", r.claim.lines.length === 2 && (await call("&submit=1", { method: "POST" })).claim?.status === "submitted");
await exp(new Request(`http://localhost/api/expenses?decide=${C}`, { method: "POST", headers: PRES, body: JSON.stringify({ decision: "approve" }) }));
await exp(new Request(`http://localhost/api/expenses?decide=${C}`, { method: "POST", headers: VP, body: JSON.stringify({ decision: "approve" }) }));
r = await J(await exp(new Request(`http://localhost/api/expenses?pay=${C}`, { method: "POST", headers: VP, body: JSON.stringify({ ref: "CA1PL2", date: day(0) }) })));
after = await S.getClaim(C);
const paidTo = after.mail.filter((m) => m.what === "paid").map((m) => m.to).join();
ok("approved and paid: the presenter is told, and no mail goes to a made-up owner address", after.status === "paid" && paidTo === "dana@example.ca" && !after.mail.some((m) => /ongia\.invalid/.test(m.to ?? "")), JSON.stringify(after.mail.map((m) => [m.what, m.to])));
const pm = M.presenterPaidMail({ claim: after, paid: after.paid });
ok("their paid email doesn't say a board member sent it for them", !/sent the claim for you/.test(pm.text) && /\$146\.00/.test(pm.text), pm.text);
r = await call();
ok("their page shows it paid, with the e-transfer number", r.claim.status === "paid" && r.claim.paid.ref === "CA1PL2");

// 30 days after the event the link stops taking claims.
const oldLink = P.selfLink("pl-old", "o1"), oldKey = oldLink.split("/").pop();
r = await J(await px(new Request(`http://localhost/api/presenter-expenses?e=pl-old&p=o1&k=${oldKey}`)));
ok("an event that ended 49 days ago: the page opens and says it's closed", r.status === 200 && r.open === false && r.deadline === day(-19));
r = await J(await px(new Request(`http://localhost/api/presenter-expenses?e=pl-old&p=o1&k=${oldKey}&add=mileage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: day(-49), km: 10, from: "a", to: "b" }) })));
ok("…and takes no claim", r.status === 410);

// The Send button: the link by email, to those with an address, once.
const mail = P.selfLinkMail({ presenter: { first: "Dana", language: "en" }, event: { title: "National Gang Summit", mealsProvided: { breakfast: true, lunch: true } }, link: dana.link, perDiem: X.PER_DIEM_DEFAULT, deadline: day(27) });
ok("the email: thanks, how it works, the per diem words, where the money goes, the deadline, and the link", /Your expenses: National Gang Summit/.test(mail.subject) && /Hello Dana,/.test(mail.text) && /take a photo of each receipt/.test(mail.text) && /you can claim dinner only/.test(mail.text) && /Alcohol is not reimbursed/.test(mail.text) && /paid by e-transfer to this email address/.test(mail.text) && /The link works until/.test(mail.text) && mail.text.includes(dana.link), mail.text);
const frMail = P.selfLinkMail({ presenter: { first: "Marc", language: "fr" }, event: { title: "Sommet", mealsProvided: {} }, link: "https://x/y", perDiem: X.PER_DIEM_DEFAULT, deadline: day(27) });
ok("in French for a presenter who filled their agreement in French", /Bonjour Marc,/.test(frMail.text) && /Déjeuner 29,95 \$ · Dîner 30,55 \$ · Souper 62,70 \$/.test(frMail.text) && /L'alcool n'est pas remboursé/.test(frMail.text));
r = await J(await px(new Request("http://localhost/api/presenter-expenses?event=pl-ev&send=1", { method: "POST", headers: H })));
ok("Send goes to the two with an email address, and each is marked", r.status === 200 && r.sent + r.failed.length === 2 && r.presenters.filter((p) => p.sentAt).length === 2 && r.presenters.find((p) => p.name === "No Email").sentAt === null, JSON.stringify({ sent: r.sent, failed: r.failed }));
ok("the desk's list shows Dana's claim as paid", /paid/i.test(r.presenters.find((p) => p.name === "Dana Sample").claim?.status ?? ""), JSON.stringify(r.presenters.find((p) => p.name === "Dana Sample")));

// The event's setting is saved from Edit event.
const ev0 = await S.getEvent("pl-old");
r = await J(await events(new Request("http://localhost/api/events?id=pl-old", { method: "PUT", headers: H, body: JSON.stringify({ ...ev0, mealsProvided: { breakfast: true, lunch: false, dinner: true } }) })));
ok("meals provided is a setting on the event", (await S.getEvent("pl-old")).mealsProvided?.breakfast === true && (await S.getEvent("pl-old")).mealsProvided?.lunch === false && (await S.getEvent("pl-old")).mealsProvided?.dinner === true, JSON.stringify(r).slice(0, 200));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
