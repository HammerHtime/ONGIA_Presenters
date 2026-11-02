// Names and agencies that stay right (Andrew 3 Nov 2026: "I need you to fix whatever the error was in the code ... so when
// I pull this list three more times, it's going to come with the right names"). Fake people and addresses throughout.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
delete process.env.ANTHROPIC_API_KEY;
const F = REPO + "netlify/functions/";
const { putEvent, getAttendees, putAttendees, putAgencyList, putMeta } = await import(F + "lib/store.mjs");
const { readCsv, merge, correct } = await import(F + "lib/attendees.mjs");
const A = await import(F + "lib/agencies.mjs");
const attendees = (await import(F + "attendees.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };

// The partners' form: a Microsoft Form export, "Email" says anonymous, the address is under "Work Email Address (…)".
const form = [
  ["Start time", "Email", "Full Name", "Work Email Address (Personal email addresses may delay or impact approval)", "Organization or Agency", "Supervisor Email (may be contacted)", "Approved/Declined"],
  ["2026-06-03", "anonymous", "Avery Stone", "avery.stone@helpers.example.org", "Helpers Youth Services ", "boss@helpers.example.org", "Approved"],
  ["2026-06-03", "anonymous", "Rowan Field", "rfield@schools.example.ca", "Example DSB", "boss@schools.example.ca", "Approved"],
  ["2026-06-03", "anonymous", "Jordan Vale", "jvale@void.example.org", "Not Coming Org", "", "void"],
  ["2026-06-03", "anonymous", "Sam Pike", "tickets@group.example.org", "Group Services", "", "Approved"],
].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
const read = readCsv(form);
ok("a form's work email column is used, not its 'Email' column that reads anonymous or the supervisor's", read.people.length === 4 && read.people[0].email === "avery.stone@helpers.example.org", JSON.stringify(read.people[0]));
ok("'Organization or Agency' and 'Full Name' are read", read.people[0].organization === "Helpers Youth Services" && read.people[0].first === "Avery" && read.people[0].last === "Stone");

// The list as Wix gives it: partners with no organization; one with no name; a group of tickets under one address.
const wix = [
  { key: "w1", email: "avery.stone@helpers.example.org", first: "Avery", last: "Stone", organization: "", status: "ATTENDING", source: "wix", group: "Community partners" },
  { key: "w2", email: "rfield@schools.example.ca", first: "", last: "", organization: "", status: "ATTENDING", source: "wix", group: "Community partners" },
  { key: "w3", email: "tickets@group.example.org", first: "Sam", last: "Pike", organization: "", status: "ATTENDING", source: "wix" },
  { key: "w4", email: "tickets@group.example.org", first: "", last: "", organization: "", status: "ATTENDING", source: "wix" },
  { key: "w5", email: "tickets@group.example.org", first: "", last: "", organization: "", status: "ATTENDING", source: "wix" },
];
const c = correct(wix, read.people);
const by = (k) => c.people.find((p) => p.key === k);
ok("an organization from the form replaces the blank Wix had", by("w1").organization === "Helpers Youth Services" && by("w1").fixed.organization === "Helpers Youth Services");
ok("a row Wix left without a name gets the name from the form", by("w2").first === "Rowan" && by("w2").last === "Field" && by("w2").organization === "Example DSB");
ok("someone in the form but not on the list (a void row) is reported, never added", c.people.length === 5 && c.notFound.some((x) => x.name === "Jordan Vale"));
ok("with several tickets under one address, the row with that name is the one corrected", by("w3").organization === "Group Services" && !by("w4").organization && !by("w5").organization);
ok("what Wix had is kept beside the correction", by("w2").asWix.first === "" && by("w2").asWix.organization === "");

// The next pull from Wix says the same as before: the corrections stay.
const pulled = merge(c.people, wix.map((p) => ({ ...p })), { source: "wix", authoritative: true });
const after = (k) => pulled.people.find((p) => p.key === k);
ok("a pull from Wix keeps the corrected organization", after("w1").organization === "Helpers Youth Services", JSON.stringify(after("w1")));
ok("a pull from Wix keeps a corrected name", after("w2").first === "Rowan" && after("w2").last === "Field");
const cancelled = merge(c.people, wix.map((p) => (p.key === "w2" ? { ...p, status: "NOT_ATTENDING" } : { ...p })), { source: "wix" });
ok("but Wix still says who is coming: a cancellation goes through", cancelled.people.find((p) => p.key === "w2").status === "NOT_ATTENDING" && cancelled.people.find((p) => p.key === "w2").first === "Rowan");
const renamed = merge(c.people, wix.map((p) => (p.key === "w1" ? { ...p, organization: "Typed later" } : { ...p })), { source: "wix" });
ok("what Wix says later is kept beside it, the correction still shown", renamed.people.find((p) => p.key === "w1").organization === "Helpers Youth Services" && renamed.people.find((p) => p.key === "w1").asWix.organization === "Typed later");

// Through the desk: POST ?correct=1 with the sheet, then the stored list.
await putEvent({ id: "ev-fix", title: "Summit test", dayOne: "2026-11-09", lastDay: "2026-11-12", lead: "" });
await putAttendees("ev-fix", { people: wix });
const r = await attendees(new Request("http://x/api/attendees?event=ev-fix&correct=1", { method: "POST", headers: { "x-admin-key": "testkey", "content-type": "text/csv" }, body: form }));
const j = await r.json();
ok("the desk takes a corrections sheet and says what it did", r.status === 200 && j.organizations === 3 && j.named === 1 && j.notFound.length === 1, JSON.stringify(j));
ok("and stores it", ((await getAttendees("ev-fix")).people.find((p) => p.key === "w2")).fixed?.last === "Field");

// Agencies: a spelling two agencies share is settled by the person's email; a domain is learned when nothing was typed.
await putAgencyList([
  { name: "Correctional Service Canada", province: "", aliases: ["Corrections", "Ministry of Community Safety and Correctional Services"], domains: ["csc-scc.gc.ca"] },
  { name: "Ministry of the Solicitor General", province: "ON", aliases: ["Ontario Corrections", "Corrections"], domains: [] },
]);
for (const k of ["agencies:log", "agencies:waiting", "agencies:blank"]) await putMeta(k, []);
const list = await A.directory();
const of = (organization, email) => A.agencyOf({ organization, email }, list)?.name ?? "";
ok("'Ministry of Community Safety and Correctional Services' from an Ontario address is the Solicitor General, not CSC", of("Ministry of Community Safety and Correctional Services", "pat@ontario.ca") === "Ministry of the Solicitor General (Ontario)", of("Ministry of Community Safety and Correctional Services", "pat@ontario.ca"));
ok("'Corrections' from a federal address is Correctional Service Canada", of("Corrections", "pat@csc-scc.gc.ca") === "Correctional Service Canada");
ok("'Corrections' from an Ontario address is Ontario's", of("Corrections", "pat@ontario.ca").startsWith("Ministry of the Solicitor General"));
ok("a shared spelling with nothing to settle it is not guessed", of("Corrections", "pat@gmail.com") === "");
ok("the same ministry listed twice still reads as the ministry", of("Ministry of the Solicitor General", "pat@ontario.ca").startsWith("Ministry of the Solicitor General"));
ok("a spelling only one agency has is unchanged", of("CSC", "pat@csc-scc.gc.ca") === "Correctional Service Canada" && of("Toronto Police Service", "x@tps.ca") === "Toronto Police Service");
ok("a federal agency typed by someone at a provincial government address isn't taken on trust", of("Correctional Service Canada", "pat@ontario.ca") === "");

const people = [{ email: "a@helpers.example.org", organization: "", status: "ATTENDING" }, { email: "b@helpers.example.org", organization: "", status: "ATTENDING" }, { email: "c@gmail.com", organization: "" }, { email: "d@csc-scc.gc.ca", organization: "" }];
const doms = A.unknownDomainsOf(people, list);
ok("people who typed nothing are asked about by work domain, once per domain; personal and known domains aren't", doms.length === 1 && doms[0].raw === "@helpers.example.org" && doms[0].count === 2, JSON.stringify(doms));
const sent = [];
const client = { messages: { create: async (req) => { sent.push(JSON.stringify(req)); return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ answers: [{ raw: "@helpers.example.org", agency: "Helpers Youth Services", isNew: true, province: "ON", fr: "", reason: "The domain is Helpers Youth Services'.", lookUp: false }] }) }] }; } } };
await A.settle(people, { client });
ok("Claude is asked whose the domain is, and told nothing was typed", sent.some((s) => s.includes("@helpers.example.org") && s.includes("nothing typed")));
const learned = await A.directory();
ok("the domain is learned with the organization, not as a spelling", (learned.find((a) => a.name === "Helpers Youth Services")?.domains ?? []).includes("helpers.example.org") && !(learned.find((a) => a.name === "Helpers Youth Services")?.aliases ?? []).some((s) => s.startsWith("@")));
ok("so the next person from there needs nothing typed", A.agencyOf({ organization: "", email: "new@helpers.example.org" }, learned)?.name === "Helpers Youth Services");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
