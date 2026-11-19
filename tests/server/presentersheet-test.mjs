// The presenters as an Excel sheet (Andrew 19 Nov 2026: "download all the presenters into an Excel sheet. One column is
// first name and last name in the same column. And the next column would have their agency").
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const F = REPO + "netlify/functions/";
const events = (await import(F + "events.mjs")).default;
const S = await import(F + "lib/store.mjs");
const { readXlsx } = await import(F + "lib/xlsx.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await S.putEvent({ id: "ps-ev", title: "National Gang Summit", city: "Toronto, ON", dayOne: "2026-11-09", lastDay: "2026-11-12", board: [] });
await S.putPresenter({ id: "a", eventId: "ps-ev", first: "Dana", last: "Sample", organization: "Windsor Police Service", status: "signed" });
await S.putPresenter({ id: "b", eventId: "ps-ev", first: " Marc ", last: "Exemple", organization: "Service de police de la Ville de Montréal", status: "invited" });
await S.putPresenter({ id: "c", eventId: "ps-ev", first: "Lee", last: "Adams", organization: "", status: "approved" });
await S.putPresenter({ id: "d", eventId: "ps-ev", first: "Gone", last: "Away", organization: "OPP", status: "withdrawn" });
let r = await events(new Request("http://localhost/api/events?id=ps-ev&presentersheet=1"));
ok("only the desk can download it", r.status === 401);
r = await events(new Request("http://localhost/api/events?id=ps-ev&presentersheet=1", { headers: { "x-admin-key": "testkey" } }));
const bytes = Buffer.from(await r.arrayBuffer());
ok("it comes back as an Excel file named for the event", r.status === 200 && /spreadsheetml/.test(r.headers.get("content-type")) && /Presenters - \d{4}-\d{2}-\d{2}\.xlsx/.test(decodeURIComponent(r.headers.get("content-disposition"))) && bytes.subarray(0, 2).toString() === "PK", r.headers.get("content-disposition"));
const rows = readXlsx(bytes).map((x) => x.map((c) => String(c ?? "")));
const at = rows.findIndex((x) => x[0] === "Name" && x[1] === "Agency");
ok("two columns: Name and Agency", at >= 0, JSON.stringify(rows.slice(0, 5)));
const body = rows.slice(at + 1).filter((x) => x[0]);
ok("first and last name together in one column, the agency in the next, by last name; a blank agency stays blank", JSON.stringify(body) === JSON.stringify([["Lee Adams", ""], ["Marc Exemple", "Service de police de la Ville de Montréal"], ["Dana Sample", "Windsor Police Service"]]), JSON.stringify(body));
ok("someone who withdrew is left off", !body.some((x) => /Gone/.test(x[0])));
ok("an event that isn't there says so", (await events(new Request("http://localhost/api/events?id=nope&presentersheet=1", { headers: { "x-admin-key": "testkey" } }))).status === 404);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
