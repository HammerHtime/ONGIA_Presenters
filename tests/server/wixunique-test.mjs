// One training that Wix holds as several events (Andrew 1 Nov 2026: "Regina on 2 days ... that's the same training event"):
// count the different people, matched by email, across days and across sites. Counts only.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey"; process.env.WIX_API_KEY = "k";
process.env.WIX_SITE_ID = "11111111-1111-4111-8111-111111111111"; process.env.WIX_SITE_ID_2 = "22222222-2222-4222-8222-222222222222";
process.env.WIX_SITE_ID_3 = "33333333-3333-4333-8333-333333333333";
const SITE = { "11111111-1111-4111-8111-111111111111": "1", "22222222-2222-4222-8222-222222222222": "2", "33333333-3333-4333-8333-333333333333": "3" };
const g = (ev, email, extra = {}) => ({ id: ev + email, eventId: ev, guestType: "RSVP", attendanceStatus: "ATTENDING", totalGuests: 1, guestDetails: { firstName: "Pat", lastName: "Test", email }, ...extra });
const guests = {
  "1:day1": [g("day1", "a@x.ca"), g("day1", "b@x.ca"), g("day1", "c@x.ca"), g("day1", "", {})],
  "1:day2": [g("day2", "A@X.CA"), g("day2", "b@x.ca"), g("day2", "d@x.ca"), g("day2", "gone@x.ca", { attendanceStatus: "NOT_ATTENDING" })],
  "3:old": [g("old", "a@x.ca"), g("old", "e@x.ca")],
  "2:partners": [g("partners", "p1@x.ca"), g("partners", "p2@x.ca")],
};
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body ?? "{}"), site = SITE[init.headers["wix-site-id"]];
  if (String(url).endsWith("/events/v2/guests/query")) {
    const ev = body.query?.filter?.eventId;
    return Response.json({ guests: guests[`${site}:${ev}`] ?? [], pagingMetadata: {} });
  }
  throw new Error("unexpected fetch " + url);
};
const wix = (await import(REPO + "netlify/functions/wix.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const get = async (qs) => { const r = await wix(new Request(`http://x/api/wix?${qs}`, { headers: { "x-admin-key": "testkey" } })); return { status: r.status, j: await r.json() }; };

let { j } = await get("unique=1:day1,1:day2");
ok("two days of one training: 7 registrations, 5 different people (same address in any case is one person; the one with no address counts once)",
  j.added === 7 && j.unique === 5 && j.inMoreThanOne === 2 && j.withoutEmail === 1, JSON.stringify(j));
ok("someone who withdrew is not counted", j.events[1].people === 3, JSON.stringify(j.events));
({ j } = await get("unique=3:old,1:day1"));
ok("one event registered on two sites (Archive and current): matched across sites", j.added === 6 && j.unique === 5, JSON.stringify(j));
ok("no names or email addresses in the answer", !/@x\.ca|Pat/.test(JSON.stringify(j)));
({ j } = await get("count=partners&site=2"));
ok("the guest count reads the site it is told to (community partners on the second site were counted as 0)", j.total === 2 && j.site === "2", JSON.stringify(j));
({ j } = await get("count=partners"));
ok("and still defaults to the main site", j.total === 0 && j.site === "1");
const bad = await get("unique=" + Array.from({ length: 11 }, (_, i) => "1:e" + i).join(","));
ok("more than ten events is refused", bad.status === 400);
const noKey = await wix(new Request("http://x/api/wix?unique=1:day1"));
ok("needs the admin key", noKey.status === 401);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
