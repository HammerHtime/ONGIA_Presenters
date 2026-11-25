// Settings on the event, never worked out from its name (Andrew 25 Nov 2026, "yes to all three"): what the main group
// is called, each further group's own days, the board inbox letters are signed with, and the kind of event (its
// invoice prefix) that picks a statement of work's lines, the CFAOC website and the certificate design. Made-up events.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const F = REPO + "netlify/functions/";
const { putEvent, getEvent } = await import(F + "lib/store.mjs");
const events = (await import(F + "events.mjs")).default;
const { groupsOf } = await import(F + "lib/welcome.mjs");
const { attendeeSignOf, groupDaysOf } = await import(F + "lib/letters.mjs");
const { sowFamily } = await import(F + "sow.mjs");
const { defaultTemplate, certSettings } = await import(F + "lib/certs.mjs");
const { isWebsiteEvent } = await import(F + "lib/website.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const req = async (q, body) => { const r = await events(new Request(`http://x/api/events?${q}`, { method: "PUT", headers: H, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };

const summit = { id: "sum", title: "National Gang Summit", city: "Toronto, ON", dayOne: "2030-11-09", lastDay: "2030-11-12", board: [],
  wix: { eventId: "w1" }, wixMore: [{ eventId: "w2", title: "Partners", group: "Community partners" }] };
await putEvent(summit);

// Nothing set: the name decides nothing.
ok("a Summit with nothing set calls its main group 'Everyone else'", groupsOf(await getEvent("sum")).main === "Everyone else");
ok("…is signed with info@ongia.ca", attendeeSignOf(await getEvent("sum")).email === "info@ongia.ca");
ok("…and its second group has no days of its own", groupDaysOf(await getEvent("sum")) === null);

// The group settings.
let r = await req("id=sum&groups=1", { mainGroup: "  Justice partners ", days: [{ eventId: "w2", dayOne: "2030-11-10", lastDay: "2030-11-11" }] });
ok("the main group's name and the group's days save", r.status === 200 && r.body.mainGroup === "Justice partners" && r.body.wixMore[0].dayOne === "2030-11-10", JSON.stringify(r.body));
ok("the letters then use them", groupsOf(await getEvent("sum")).main === "Justice partners" && groupDaysOf(await getEvent("sum"))?.lastDay === "2030-11-11");
r = await req("id=sum&groups=1", { days: [{ eventId: "w2", dayOne: "2030-11-11", lastDay: "2030-11-10" }] });
ok("a last day before the first is refused, saying whose", r.status === 400 && /Community partners/.test(r.body.error), JSON.stringify(r.body));
r = await req("id=sum&groups=1", { days: [{ eventId: "nope", dayOne: "2030-11-10" }] });
ok("a group that isn't linked is refused", r.status === 404);
r = await req("id=sum&groups=1", { days: [{ eventId: "w2", dayOne: "10/11/2030" }] });
ok("a day that isn't from the calendar is refused", r.status === 400);
r = await req("id=sum&groups=1", { days: [{ eventId: "w2", dayOne: "2030-11-10", lastDay: "" }] });
ok("one day alone is a one-day group", r.status === 200 && r.body.wixMore[0].lastDay === "2030-11-10");
r = await req("id=sum&groups=1", { mainGroup: "", days: [{ eventId: "w2", dayOne: "", lastDay: "" }] });
ok("emptied, it's 'Everyone else' and no days again", r.status === 200 && groupsOf(await getEvent("sum")).main === "Everyone else" && groupDaysOf(await getEvent("sum")) === null);

// The board inbox, on Edit event.
const edit = (extra) => req("id=sum", { title: summit.title, city: summit.city, dayOne: summit.dayOne, lastDay: summit.lastDay, board: [{ name: "Pat Lead", email: "pat@example.ca", lead: true }], ...extra });
r = await edit({ boardInbox: "NGS@ongia.ca" });
ok("the board inbox saves from Edit event", r.status === 200 && (await getEvent("sum")).boardInbox === "ngs@ongia.ca", JSON.stringify(r.body).slice(0, 200));
ok("letters signed ONGIA Board then use it", attendeeSignOf(await getEvent("sum")).email === "ngs@ongia.ca");
r = await edit({ boardInbox: "not an address" });
ok("an inbox that isn't an email address is refused, and the old one kept", r.status === 400 && (await getEvent("sum")).boardInbox === "ngs@ongia.ca");
r = await edit({});
ok("a save that doesn't mention it keeps it", r.status === 200 && (await getEvent("sum")).boardInbox === "ngs@ongia.ca");
r = await edit({ boardInbox: "" });
ok("emptied, it's info@ongia.ca again", r.status === 200 && attendeeSignOf(await getEvent("sum")).email === "info@ongia.ca");

// The kind of event comes from its invoice prefix.
ok("an ITP by its prefix, whatever its name", sowFamily({ title: "February training", invoicePrefix: "ITP" }) === "itp");
ok("a name with ITP in it but an RBH prefix is not an ITP", sowFamily({ title: "RBH ITP Training", invoicePrefix: "RBH" }) === "other");
ok("a CFAOC by its prefix", sowFamily({ title: "Western Symposium", invoicePrefix: "cfaoc" }) === "cfaoc");
ok("the CFAOC website goes by the prefix, not the name", isWebsiteEvent({ title: "Some Symposium", invoicePrefix: "CFAOC" }) && !isWebsiteEvent({ title: "Canadian Forum Against Organized Crime", invoicePrefix: "RBH" }));
ok("a CFAOC event's certificate starts as the CFAOC design", defaultTemplate({ id: "w", title: "Western Symposium", invoicePrefix: "CFAOC" }) === "cfaoc");
ok("a Summit's name alone doesn't pick the Summit design", defaultTemplate({ id: "n", title: "National Gang Summit", invoicePrefix: "RBH" }) === "generic");
ok("…its own pick on the Certificates tab does", certSettings({ id: "n", title: "National Gang Summit", certs: { template: "national-gang-summit" } }).template === "national-gang-summit");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
