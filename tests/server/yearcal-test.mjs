// The year as a wall calendar PDF with my own schedule on each day (Andrew 27–28 Nov 2026: "a full 12 month calendar each
// page is a month showing all the events … include my schedule in the top right corner of each day? N for nights, D for
// days, O for off … I work a 7 on, 7 off schedule … today is my second shift of nights").
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const F = REPO + "netlify/functions/";
const cal = (await import(F + "calendar.mjs")).default;
const { putEvent, putMeta } = await import(F + "lib/store.mjs");
const { issueSession } = await import(F + "lib/auth.mjs");
const { cleanSchedule, shiftOn, describe } = await import(F + "lib/myschedule.mjs");
const { calendarItems, monthWeeks, clashes } = await import(F + "lib/yearpdf.mjs");
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };

// 7 days, 7 off, 7 nights, 7 off; nights began 27 Nov 2026, so the days before them began 13 Nov.
const s = cleanSchedule({ pattern: "ddddddd ooooooo nnnnnnn ooooooo", start: "2026-11-13" });
ok("the rotation is kept as letters", s.pattern === "DDDDDDDOOOOOOONNNNNNNOOOOOOO" && describe(s) === "7 days, 7 off, 7 nights, 7 off");
ok("28 Nov 2026 is his second night", shiftOn(s, "2026-11-27") === "N" && shiftOn(s, "2026-11-28") === "N" && shiftOn(s, "2026-11-26") === "O");
ok("it runs on: 3 Dec last night, then 7 off, days again from 11 Dec", shiftOn(s, "2026-12-03") === "N" && shiftOn(s, "2026-12-04") === "O" && shiftOn(s, "2026-12-10") === "O" && shiftOn(s, "2026-12-11") === "D");
ok("and backwards, before its start", shiftOn(s, "2026-11-12") === "O" && shiftOn(s, "2026-10-30") === "N");
ok("a year on, nights again 16–22 Apr 2027", ["16", "22"].every((d) => shiftOn(s, `2027-04-${d}`) === "N") && shiftOn(s, "2027-04-23") === "O");
ok("nothing typed, no schedule", cleanSchedule({ pattern: "xyz", start: "2026-11-13" }) === null && cleanSchedule({ pattern: "DN", start: "soon" }) === null && shiftOn(null, "2026-11-28") === "");

ok("a month's page shows its weeks, Sunday first", monthWeeks(2027, 1)[0][0] === "2027-01-31" && monthWeeks(2027, 1).length === 5 && monthWeeks(2027, 4).length === 6);
const items = calendarItems([
  { id: "a", kind: "rbh", title: "RBH ITP", city: "Montreal, QC", dayOne: "2027-06-14", lastDay: "2027-06-18", board: [{ name: "Jacqulyn Taylor" }, { name: "Andrew Hammond", lead: true }] },
  { id: "b", kind: "ongia", title: "Calgary Symposium", city: "Calgary", dayOne: "2027-04-06", lastDay: "2027-04-07" },
  { id: "c", kind: "ongia", title: "Practice", dayOne: "2027-04-06", practice: true },
  { id: "d", kind: "rbh", title: "Website", dayOne: "2027-01-01", project: true },
], [{ id: "x", title: "IAGI", place: "Orlando", from: "2027-08-01", to: "2027-08-04" }]);
ok("every RBH and ONGIA event and the conferences, not practice events or projects", items.map((i) => `${i.kind}:${i.title}`).join("|") === "ongia:Calgary Symposium|rbh:RBH ITP|ext:IAGI");
ok("who's going, the lead first, first names", items[1].who.join(",") === "Andrew,Jacqulyn" && items[1].place === "Montreal");

ok("a clash: an event on a day or night I work", clashes({ from: "2027-04-06", to: "2027-04-07" }, s) && clashes({ from: "2027-04-16", to: "2027-04-16" }, s));
ok("not one on days off, even across a week", !clashes({ from: "2027-04-09", to: "2027-04-15" }, s) && !clashes({ from: "2027-04-06", to: "2027-04-07" }, null));
ok("one that only starts on an off day and runs into work is still a clash", clashes({ from: "2027-04-14", to: "2027-04-17" }, s));

// The route.
await putEvent({ id: "cal-1", kind: "rbh", title: "RBH ITP Training - June 2027", city: "Montreal, QC", dayOne: "2027-06-14", lastDay: "2027-06-18", board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }] });
const me = { "x-admin-key": issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" }), "content-type": "application/json" };
const other = { "x-admin-key": issueSession({ email: "vp_operations@ongia.ca", name: "Jacqulyn Taylor" }), "content-type": "application/json" };
const call = async (url, method = "GET", body, headers = me) => cal(new Request("http://localhost/api/calendar" + url, { method, headers, body: body ? JSON.stringify(body) : undefined }));
ok("no schedule to start", (await (await call("?schedule=1")).json()).schedule === null);
const put = await (await call("?schedule=1", "PUT", { pattern: "DDDDDDDOOOOOOONNNNNNNOOOOOOO", start: "2026-11-13" })).json();
ok("set: it says what it is", put.says === "7 days, 7 off, 7 nights, 7 off");
ok("it's his own: another person has none", (await (await call("?schedule=1", "GET", null, other)).json()).schedule === null);
ok("a bad rotation is refused, in words", (await call("?schedule=1", "PUT", { pattern: "", start: "2026-11-13" })).status === 400);
const res = await call("?year=2027");
const pdf = Buffer.from(await res.arrayBuffer());
ok("the year comes as a PDF to save", res.status === 200 && res.headers.get("content-type") === "application/pdf" && /ONGIA calendar 2027\.pdf/.test(res.headers.get("content-disposition")) && pdf.slice(0, 5).toString() === "%PDF-");
const dir = mkdtempSync("/tmp/yearcal-"); writeFileSync(`${dir}/y.pdf`, pdf);
const info = execFileSync("pdfinfo", [`${dir}/y.pdf`]).toString();
ok("12 pages, landscape letter", /Pages:\s+12/.test(info) && /792 x 612/.test(info), info);
const june = execFileSync("pdftotext", ["-f", "6", "-l", "6", "-layout", `${dir}/y.pdf`, "-"]).toString();
ok("June's page has the month, the event, the city, who's going and the schedule letters", /June/.test(june) && /RBH ITP Training/.test(june) && /Montreal/.test(june) && /Andrew/.test(june) && /\bN\b/.test(june) && /\bD\b/.test(june) && /\bO\b/.test(june), june.slice(0, 600));
ok("a year that isn't one is refused", (await call("?year=abc")).status === 400);
ok("signed out: refused", (await call("?year=2027", "GET", null, {})).status === 401);
await call("?schedule=1", "PUT", { off: true });
ok("taken off", (await (await call("?schedule=1")).json()).schedule === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
