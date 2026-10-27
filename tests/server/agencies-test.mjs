// One name for each agency (Andrew 27 Oct 2026: "TPS, Toronto Police, Toronto Police Service … OPP, Ontario
// Provincial Police, OPP - Gang Unit"), from an event's registrations or every registration on Wix.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
process.env.WIX_API_KEY = "k"; process.env.WIX_SITE_ID = "11111111-1111-4111-8111-111111111111";
delete process.env.WIX_SITE_ID_2;
const wixGuests = [["TPS"], ["Toronto Police Service - Gang Task Force"], ["OPP"], ["Kawartha Lakes PS"], ["Kawartha Lakes Police Service"], ["Kawartha Lakes PS"]];
globalThis.fetch = async (url) => {
  if (String(url).endsWith("/events/v3/events/query")) return Response.json({ events: [{ id: "old", title: "Kingston 2025", status: "ENDED", dateAndTimeSettings: { startDate: new Date(Date.now() - 300 * 86400000).toISOString() } },
    { id: "ancient", title: "Old 2021", status: "ENDED", dateAndTimeSettings: { startDate: "2021-05-01T13:00:00Z" } }] });
  if (String(url).endsWith("/events/v2/guests/query")) return Response.json({ guests: wixGuests.map(([org], i) => ({ id: `g${i}`, eventId: "old", guestType: "RSVP", attendanceStatus: "ATTENDING",
    guestDetails: { firstName: "A", lastName: "B", email: `p${i}@example.ca`, formResponse: { inputValues: [{ inputName: "agency_name", value: org }] } } })).concat([{ id: "z", eventId: "ancient", guestType: "RSVP", attendanceStatus: "ATTENDING", guestDetails: { email: "z@example.ca", formResponse: { inputValues: [{ inputName: "agency_name", value: "From 2021 Agency" }] } } }]).map((g) => ({ eventId: "old", ...g })), pagingMetadata: {} });
  throw new Error("unexpected fetch " + url);
};
const F = REPO + "netlify/functions/";
const { putEvent, putAttendees } = await import(F + "lib/store.mjs");
const { suggest, directory, standardOf } = await import(F + "lib/agencies.mjs");
const agencies = (await import(F + "agencies.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (qs, init = {}) => { const r = await agencies(new Request(`http://x/api/agencies?${qs}`, { ...init, headers: H, body: init.body ? JSON.stringify(init.body) : undefined })); return { status: r.status, body: await r.json() }; };

await putEvent({ id: "ngs", title: "National Gang Summit", city: "Toronto", dayOne: "2026-11-09", board: [] });
const typed = ["TPS", "Toronto Police", "Toronto Police Service", "OPP", "OPP - Gang Unit", "Ontario Provincial Police", "RCMP E Division", "Correctional Service of Canada", "Bluewater Youth Services", "Bluewater Youth Services"];
await putAttendees("ngs", { people: [...typed.map((organization, i) => ({ key: `k${i}`, first: "X", email: `x${i}@example.ca`, status: "ATTENDING", organization })),
  { key: "w", first: "W", email: "w@example.ca", status: "WITHDRAWN", organization: "Withdrawn Agency" }] });

const a = (await call("event=ngs")).body;
const by = (name) => a.agencies.find((g) => g.agency === name);
ok("the three Toronto spellings are one agency, counted three times", by("Toronto Police Service")?.count === 3 && by("Toronto Police Service").spellings.length === 3, JSON.stringify(a.agencies));
ok("OPP, OPP - Gang Unit and Ontario Provincial Police are one", by("Ontario Provincial Police")?.count === 3);
ok("the RCMP and CSC are placed too, with no province for a federal agency", by("Royal Canadian Mounted Police")?.count === 1 && by("Correctional Service Canada")?.province === "");
ok("what it cannot place is listed once with its count; someone withdrawn is not", a.unplaced.length === 1 && a.unplaced[0].raw === "Bluewater Youth Services" && a.unplaced[0].count === 2, JSON.stringify(a.unplaced));

// Andrew confirms it as a new agency; from then on it is known.
const after = (await call("event=ngs", { method: "PUT", body: { raw: "Bluewater Youth Services", agency: "Bluewater Youth Services", province: "ON" } })).body;
ok("confirmed, it joins the list as an agency with its province", after.unplaced.length === 0 && after.agencies.find((g) => g.agency === "Bluewater Youth Services")?.province === "ON");
await call("event=ngs", { method: "PUT", body: { raw: "Bluewater YS", agency: "Bluewater Youth Services" } });
ok("a new spelling taught for it is known next time", standardOf("Bluewater YS", await directory())?.name === "Bluewater Youth Services");

// Claude's suggestions: only names on the list, or a new agency marked as new.
const fake = { messages: { create: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ matches: [
  { raw: "Kawartha Lakes PS", agency: "Kawartha Lakes Police Service", isNew: true, province: "ON" },
  { raw: "T.P.S. Intel", agency: "Toronto Police Service", isNew: false, province: "ON" },
  { raw: "my house", agency: "", isNew: false, province: "" }] }) }] }) } };
const s = await suggest(["Kawartha Lakes PS", "T.P.S. Intel", "my house"], await directory(), { client: fake });
ok("Claude's suggestions come back per spelling, new ones marked new, nonsense left empty", s[0].isNew && s[0].province === "ON" && s[1].agency === "Toronto Police Service" && !s[1].isNew && s[2].agency === "", JSON.stringify(s));

// Every Wix registration, past events included.
const all = (await call("all=1")).body;
ok("across every Wix registration, the known agencies are grouped and the rest listed to place", all.agencies.find((g) => g.agency === "Toronto Police Service")?.count === 2 && all.unplaced.some((u) => /Kawartha/.test(u.raw)), JSON.stringify(all).slice(0, 400));
const taught = (await call("all=1", { method: "PUT", body: { raw: "Kawartha Lakes PS", agency: "Kawartha Lakes Police Service", province: "ON" } })).body;
ok("confirming one there answers at once, without reading Wix again", taught.ok && taught.agency === "Kawartha Lakes Police Service");
ok("and both Kawartha spellings are then one agency", (await call("all=1")).body.agencies.find((g) => g.agency === "Kawartha Lakes Police Service")?.count === 3);

const csv = await (await agencies(new Request("http://x/api/agencies?all=1&download=1", { headers: H }))).text();
ok("the download lists each spelling of the last two years once with its count, and no names or emails", /"Kawartha Lakes PS",2/.test(csv) && /"TPS",1/.test(csv) && !/@|From 2021/.test(csv), csv);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
