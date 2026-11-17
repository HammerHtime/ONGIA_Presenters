// A certificate follows a correction on the People tab (Andrew 17 Nov 2026, Parm Dhesi: his agency fixed from Victoria
// to Vancouver Police after his certificate went out). Same number, the old wording kept in its history, nothing emailed
// on its own; the desk is told so it can offer to email it again.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const F = REPO + "netlify/functions/";
const { putEvent, putAttendees } = await import(F + "lib/store.mjs");
const C = await import(F + "lib/certs.mjs");
const attendees = (await import(F + "attendees.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const put = async (qs, body) => { const r = await attendees(new Request(`http://localhost/api/attendees?${qs}`, { method: "PUT", headers: H, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };

const ev = { id: "cf-ev", title: "National Gang Summit", city: "Toronto, ON", dayOne: "2026-11-09", lastDay: "2026-11-12", board: [] };
await putEvent(ev);
await putAttendees("cf-ev", { people: [
  { key: "t1", first: "Parm", last: "Dhesi", email: "parm@example.ca", organization: "Victoria Police Department", status: "ATTENDING", checkedIn: true },
  { key: "t2", first: "Lee", last: "Wong", email: "lee@example.ca", organization: "Toronto Police Service", status: "ATTENDING", checkedIn: true },
] });
const settings = C.certSettings(ev, await C.templatesFor(ev));
const first = await C.issue(ev, { key: "t1", email: "parm@example.ca" }, { name: "Parm Dhesi", agency: "Victoria Police Department", settings });

let r = await put("event=cf-ev&key=t1", { first: "Parm", last: "Dhesi", organization: "Vancouver Police Department", email: "parm@example.ca" });
const after = await C.certRecord(first.code);
ok("correcting the agency on the People tab updates the certificate already issued", r.status === 200 && after.agency === "Vancouver Police Department" && after.name === "Parm Dhesi", JSON.stringify(after));
ok("…keeping its number, with what it said before in its history", after.code === first.code && after.history?.length === 1 && after.history[0].agency === "Victoria Police Department");
ok("the desk is told, so it can offer to email it again (nothing is sent on its own)", r.body.certificate?.key === "t1" && r.body.certificate.agency === "Vancouver Police Department" && r.body.certificate.email === "parm@example.ca" && !after.mail);

r = await put("event=cf-ev&key=t1", { first: "Parm", last: "Dhesi", organization: "Vancouver Police Department", email: "parm@example.ca" });
ok("saving the same details again changes nothing and offers nothing", r.body.certificate === null && (await C.certRecord(first.code)).history.length === 1);

r = await put("event=cf-ev&key=t2", { first: "Lee", last: "Wong", organization: "Ontario Provincial Police", email: "lee@example.ca" });
ok("someone with no certificate: just the correction", r.status === 200 && r.body.certificate === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
