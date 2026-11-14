// File names (Andrew 14 Nov 2026): "last name space first name. And date … for all downloads, including certificates".
const REPO = new URL("../../", import.meta.url).pathname;
const N = await import(REPO + "netlify/functions/lib/filenames.mjs");
const { certFileName } = await import(REPO + "netlify/functions/lib/certs.mjs");
const { letterFileName } = await import(REPO + "netlify/functions/lib/appreciation.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const vic = { title: "Canadian Forum Against Organized Crime - Western Symposium" }, ngs = { title: "National Gang Summit: Organized Crime, Gangs & Youth" };

ok("a presenter's letter: last first, what, the date", letterFileName({ first: "Melissa", last: "Tarsitano" }, "2026-11-25") === "Tarsitano Melissa - Letter of appreciation - 2026-11-25.pdf", letterFileName({ first: "Melissa", last: "Tarsitano" }, "2026-11-25"));
ok("a certificate, from the whole name and the date on it", certFileName({ name: "Jordan Tremblay", date: "2026-11-12" }) === "Tremblay Jordan - Certificate - 2026-11-12.pdf", certFileName({ name: "Jordan Tremblay", date: "2026-11-12" }));
ok("in French", certFileName({ name: "Luc Séguin", date: "2026-11-12" }, "fr") === "Séguin Luc - Certificat - 2026-11-12.pdf");
ok("a two-word first name stays together", N.lastFirst({ name: "Mary Anne Smith" }) === "Smith Mary Anne");
ok("an approval time is the day it was in Toronto (11:30 pm Eastern is still the 24th)", N.isoDay("2026-11-25T04:30:00Z") === "2026-11-24");
ok("a date written out is read: November 12, 2026", N.isoDay("November 12, 2026") === "2026-11-12" && N.isoDay("12 novembre 2026") === "2026-11-12");
ok("an event's file: its short name", N.eventFile(vic, "Registration list", "2026-11-14", "xlsx") === "Western Symposium - Registration list - 2026-11-14.xlsx" && N.eventFile(ngs, "MC script", "2026-11-14") === "National Gang Summit - MC script - 2026-11-14.pdf");
ok("no date given: today's", /^Tarsitano Melissa - Feedback - \d{4}-\d{2}-\d{2}\.pdf$/.test(N.personFile({ name: "Melissa Tarsitano" }, "Feedback")));
ok("characters a file name can't hold are dropped", N.personFile({ first: 'Jo"', last: "O'Neil/Ray" }, "Presenter agreement", "2026-11-01") === "O'Neil Ray Jo - Presenter agreement - 2026-11-01.pdf", N.personFile({ first: 'Jo"', last: "O'Neil/Ray" }, "Presenter agreement", "2026-11-01"));
const d = N.disposition("Séguin Luc - Certificat - 2026-11-12.pdf");
ok("the header carries the real name, with a plain one for old mail apps", d === `attachment; filename="Seguin Luc - Certificat - 2026-11-12.pdf"; filename*=UTF-8''${encodeURIComponent("Séguin Luc - Certificat - 2026-11-12.pdf")}`, d);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
