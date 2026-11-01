// The old website (Andrew 1 Nov 2026: "our older site called Archive"): read for history only. Its past events and how many
// registered, in counts; never offered for linking alongside the live sites.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey"; process.env.WIX_API_KEY = "k";
process.env.WIX_SITE_ID = "11111111-1111-4111-8111-111111111111"; process.env.WIX_SITE_ID_3 = "33333333-3333-4333-8333-333333333333";
const ARCH = "33333333-3333-4333-8333-333333333333";
const archEvents = Array.from({ length: 130 }, (_, i) => ({ id: "a" + i, title: `Old training ${i}`, status: "ENDED", dateAndTimeSettings: { startDate: `${2022 + (i % 3)}-0${1 + (i % 9)}-10T13:00:00Z` }, location: { address: { city: ["Regina", "Thunder Bay", "Halifax"][i % 3] } } }));
const liveEvents = [{ id: "n1", title: "New training", status: "UPCOMING", dateAndTimeSettings: { startDate: "2027-01-10T13:00:00Z" } }];
const guest = (ev, i) => ({ id: ev + "-g" + i, eventId: ev, guestType: "RSVP", attendanceStatus: "ATTENDING", totalGuests: 1, guestDetails: { firstName: "Sam" + i, lastName: "Old", email: `sam${i}@rps.ca` } });
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body ?? "{}"), site = init.headers["wix-site-id"];
  if (String(url).endsWith("/events/v3/events/query")) {
    const all = site === ARCH ? archEvents : liveEvents, { offset = 0, limit = 100 } = body.query?.paging ?? {};
    return Response.json({ events: all.slice(offset, offset + limit) });
  }
  if (String(url).endsWith("/events/v2/guests/query")) {
    // Like Wix, a query with no event named stops short; asked one event at a time, every guest comes back.
    const ev = body.query?.filter?.eventId;
    if (!ev) return Response.json({ guests: [], pagingMetadata: {} });
    const all = site === ARCH ? [guest("a0", 1), guest("a0", 2), guest("a1", 3)] : [];
    return Response.json({ guests: all.filter((g) => g.eventId === ev), pagingMetadata: {} });
  }
  throw new Error("unexpected fetch " + url);
};
const wix = (await import(REPO + "netlify/functions/wix.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const get = async (qs) => (await wix(new Request(`http://x/api/wix?${qs}`, { headers: { "x-admin-key": "testkey" } }))).json();
const a = await get("archive=1");
ok("reads every Archive event across pages (130)", a.events === 130, JSON.stringify({ events: a.events }));
ok("counts who registered for each event", a.rows.find((r) => r.title === "Old training 0")?.registered === 2 && a.rows.find((r) => r.title === "Old training 1")?.registered === 1);
ok("totals by year, with the cities", Object.keys(a.years).join() === "2022,2023,2024" && a.years["2022"].cities.includes("Regina"), JSON.stringify(a.years));
ok("no names or email addresses in the answer", !/Sam\d|@rps\.ca/.test(JSON.stringify(a)));
const ev = await get("events=1");
ok("the Archive's events are never offered for linking", ev.events.length === 1 && ev.events[0].title === "New training", JSON.stringify(ev.events.map((e) => e.title)));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
