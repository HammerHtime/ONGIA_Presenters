// ONGIA's trainings for a year, from every Wix site and the desk, by Andrew's counting rules (Andrew 1 Nov 2026: the
// 2026 Reach and Network Report said 95 people at four events because the year reports counted the desk's events only).
const REPO = new URL("../../", import.meta.url).pathname;
const { readYearTrainings, groupTrainings, countPeople } = await import(REPO + "netlify/functions/lib/history.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };

const ev = (site, id, title, dayOne, city = "", lastDay = dayOne) => ({ site, id, title, dayOne, lastDay, city, status: "ENDED" });
const WIX = {
  2025: [
    ev("3", "a-cal", "Gang & Organized Crime Training Symposium - Calgary", "2025-07-15", "Calgary"),
    ev("1", "c-cal", "Gang & Organized Crime Training Symposium - Calgary", "2025-07-15", "Calgary"),
    ev("1", "ew", "Expert Witness Workshop ", "2025-10-06", "Kingston"),
    ev("1", "cc", "Criminal Convergence ", "2025-10-07", "Kingston"),
    ev("1", "kin", "Chain Reaction: Crime, Money & Power ", "2025-11-17", "Kingston"),
    ev("1", "kin-o", "OVERFLOW - Chain Reaction: Crime, Money & Power  ", "2025-11-17", "Kingston"),
    ev("1", "kin-v", "VIRTUAL - Chain Reaction: Crime, Money & Power", "2025-11-17", ""),
    ev("1", "com", "Community Event - Beneath the Surface", "2025-11-18", "Kingston"),
    ev("1", "buf", "2025 Conference - Four Points Lunch Buffet", "2025-11-18", "Kingston"),
    ev("1", "web", "Webinar - Hidden in Plain Sight ", "2025-12-11", ""),
  ],
  2026: [
    ev("1", "wpg", "Crime at the Crossroads (Winnipeg)", "2026-03-10", "Kingston"),
    ev("1", "edm1", "At The Crossroads of Organized Crime: Law Enforcement Challenges", "2026-10-13", "Edmundston"),
    ev("1", "edm2", "Introduction aux gangs et trafic humain : signes et prévention", "2026-10-15", "Edmundston"),
    ev("1", "ngs", "National Gang Summit:  Organized Crime, Gangs & Youth", "2026-11-09", "Toronto", "2026-11-12"),
    ev("1", "ngs-v", "National Gang Summit:  VIRTUAL", "2026-11-09", ""),
    ev("2", "ngs-p", "National Gang Summit", "2026-11-10", "Los Angeles"),
  ],
  2027: [ev("1", "cal27", "Calgary Gang & Organized Crime Symposium", "2027-04-06", "Calgary")],
};
const person = (email, org = "", status = "ATTENDING") => ({ id: Math.random().toString(36).slice(2), guestType: "RSVP", status, email, organization: org, first: "Pat", last: "Test" });
const GUESTS = {
  "3:a-cal": [person("a@cps.ca", "Calgary Police Service"), person("b@cps.ca", "Calgary Police Service")],
  "1:c-cal": [person("a@cps.ca", "Calgary Police Service"), person("c@rcmp.ca", "RCMP")],
  "1:ew": [person("r1@regina.ca"), person("r2@regina.ca"), person("shared@x.ca"), person("shared@x.ca")],
  "1:cc": [person("r1@regina.ca"), person("r3@regina.ca"), person("shared@x.ca"), person("", "")],
  "1:kin": [person("k1@tps.ca"), person("k2@tps.ca")], "1:kin-o": [person("k3@tps.ca")], "1:kin-v": [person("v1@opp.ca"), person("k1@tps.ca")],
  "1:com": [person("p1@gmail.com")], "1:buf": [person("lunch@x.ca")], "1:web": [person("w1@x.ca"), person("w2@x.ca", "", "NOT_ATTENDING")],
  "1:wpg": [person("w@wps.ca"), person("w2@wps.ca"), person("w3@wps.ca")],
  "1:edm1": [person("e1@x.ca"), person("e2@x.ca"), person("e3@x.ca")], "1:edm2": [person("e3@x.ca"), person("f1@x.ca")],
  "1:ngs": [person("n1@x.ca"), person("n2@x.ca")], "1:ngs-v": [person("nv@x.ca")], "2:ngs-p": [person("cp1@x.org"), person("cp2@x.org")],
};
const wix = { events: async (y) => WIX[y] ?? [], guests: async (p) => GUESTS[`${p.site}:${p.id}`] ?? [] };
const list = [{ name: "Calgary Police Service", province: "AB", sector: "police", domains: ["cps.ca"] }, { name: "Royal Canadian Mounted Police", province: "", sector: "federal", domains: ["rcmp.ca"] }];
const desk = [
  { id: "d-edm", title: "At The Crossroads of Organized Crime", dayOne: "2026-10-13", lastDay: "2026-10-13", city: "Edmundston", wix: { eventId: "edm1", site: "1" } },
  { id: "d-ngs", title: "National Gang Summit", dayOne: "2026-11-09", lastDay: "2026-11-12", city: "Toronto", wix: { eventId: "ngs", site: "1" }, wixMore: [{ eventId: "ngs-p", site: "2", group: "Community partners" }] },
  { id: "d-vip", title: "RBH VIP Event", dayOne: "2026-11-15", city: "Montreal, QC", kind: "rbh" },
  { id: "d-prac", title: "Practice · Ontario Symposium", dayOne: "2026-10-20", city: "Toronto", practice: true },
];

const y25 = await readYearTrainings(2025, { wix, list, events: [], now: "2026-11-01" });
const t = (rows, re) => rows.find((r) => re.test(r.title));
ok("2025: five trainings (Calgary once across two sites, Regina's two days once, Kingston's three parts once, community event, webinar), buffet left out",
  y25.length === 5 && !y25.some((r) => /buffet/i.test(r.title)), JSON.stringify(y25.map((r) => [r.title, r.people])));
ok("Calgary 2025, on the Archive and the current site: the same address counts once (2 + 2 registrations, 3 people)", t(y25, /Calgary/).people === 3, JSON.stringify(t(y25, /Calgary/)));
ok("Calgary's agencies: two Calgary police, one RCMP", t(y25, /Calgary/).agencies.find((a) => a.agency === "Calgary Police Service")?.count === 2 && t(y25, /Calgary/).agencies.find((a) => /Mounted/.test(a.agency))?.count === 1);
const reg = t(y25, /Regina/);
ok("Regina 2025 is one training, in Regina (Wix says Kingston)", reg && reg.city === "Regina, SK" && reg.parts.length === 2, JSON.stringify(reg));
ok("Regina: an address on both days counts once; a shared address used by two people in one day stays two; no address can't be matched (2+1 regina, 2 shared, 1 blank = 6)", reg.people === 6, String(reg.people));
ok("Regina's training days are Monday and Tuesday: 2", reg.days === 2);
const kin = t(y25, /Chain Reaction/);
ok("Kingston conference: in person, overflow and virtual are one event; the person on both in-person and virtual lists counts once, as in person", kin.people === 4 && kin.inPerson === 3 && kin.virtual === 1, JSON.stringify(kin));
ok("the community event the next day is its own training", t(y25, /Community/).people === 1);
ok("a webinar is virtual, and someone who withdrew isn't counted", t(y25, /Hidden/).format === "virtual" && t(y25, /Hidden/).people === 1);

const y26 = await readYearTrainings(2026, { wix, list, events: desk, now: "2026-11-01" });
ok("2026: Winnipeg, Edmundston, the Summit; the VIP reception and the practice event are not trainings", y26.length === 3 && !y26.some((r) => /VIP|Practice/.test(r.title)), JSON.stringify(y26.map((r) => r.title)));
ok("Winnipeg's training is in Winnipeg (Wix says Kingston)", t(y26, /Crossroads \(Winnipeg\)/).city === "Winnipeg, MB");
const edm = y26.find((r) => r.deskId === "d-edm");
ok("Edmundston: the desk event and its French day are one training, 4 people (one came both days)", edm.people === 4 && edm.parts.length === 2, JSON.stringify(edm));
ok("Edmundston's days are 13 and 15 October: 2 training days, not 3", edm.days === 2, String(edm.days));
const ngs = y26.find((r) => r.deskId === "d-ngs");
ok("the Summit: in person, its community partners on the second site, and its virtual registrations are one event (2 + 2 + 1)", ngs.people === 5 && ngs.virtual === 1 && ngs.parts.length === 3, JSON.stringify(ngs));
ok("the Summit is still to come", ngs.held === false);
ok("nothing personal is kept: no address in the rows", !/@/.test(JSON.stringify(y26)));

const groups = groupTrainings(2026, WIX[2026], desk);
ok("grouping keeps the desk's title and link", groups.some((g) => g.desk?.id === "d-ngs" && g.parts.length === 3));
const cp = countPeople([{ title: "x", city: "Toronto", dayOne: "2026-01-01" }], () => [person("a@x.ca"), person("a@x.ca"), person("")]);
ok("one part: everyone listed counts, a group under one address included", cp.people === 3 && cp.inPerson === 3);

// End to end: refresh the reading, then the year reports' figures come from it.
const { refreshYear } = await import(REPO + "netlify/functions/lib/history.mjs");
const { ongiaYearFacts } = await import(REPO + "netlify/functions/lib/ongiayear.mjs");
const before = await ongiaYearFacts(2026, { events: desk, now: "2026-11-01" });
ok("before a reading, the figures say they come from the desk alone", before.source === "desk");
await refreshYear(2026, { wix, list, events: desk, now: "2026-11-01", earlier: false });
const f = await ongiaYearFacts(2026, { events: desk, now: "2026-11-01" });
ok("after it, they come from Wix: 3 trainings, 2 held, 7 people trained (Winnipeg 3, Edmundston 4; the Summit is still to come)",
  f.source === "wix" && f.events === 3 && f.held === 2 && f.attendees === 7, JSON.stringify({ src: f.source, events: f.events, held: f.held, people: f.attendees }));
ok("in person and virtual are totalled", f.inPerson === 7 && f.virtual === 0);
ok("the people registered for trainings still to come are counted apart (the Summit's 5)", f.registeredToCome === 5, String(f.registeredToCome));
ok("next year's trainings come from Wix too", f.nextYear.count === 1 && f.nextYear.provinces === 1, JSON.stringify(f.nextYear));
ok("the reading's time is given", typeof f.readAt === "string" && f.readAt.length > 10);

// Wix's times are UTC: an evening event in Kingston ended "the next day", and Regina's two days read as three.
const { tidyEvent } = await import(REPO + "netlify/functions/lib/wix.mjs");
const evening = tidyEvent({ id: "x", dateAndTimeSettings: { startDate: "2025-11-18T23:00:00Z", endDate: "2025-11-19T02:00:00Z", timeZoneId: "America/Toronto" } });
ok("an evening event is one day in its own time zone", evening.dayOne === "2025-11-18" && evening.lastDay === "2025-11-18", JSON.stringify(evening));
const sask = tidyEvent({ id: "y", dateAndTimeSettings: { startDate: "2025-10-07T15:00:00Z", endDate: "2025-10-08T00:30:00Z", timeZoneId: "America/Regina" } });
ok("a Regina day ending after 6 pm is still that day", sask.lastDay === "2025-10-07");
const caseOnly = countPeople([{ title: "a", city: "Calgary", dayOne: "2025-07-15" }, { title: "b", city: "Calgary", dayOne: "2025-07-15" }], (p) => [person(p.title === "a" ? "Pat@CPS.ca" : "pat@cps.ca ")]);
ok("the same address typed in another case counts once", caseOnly.people === 1, String(caseOnly.people));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
