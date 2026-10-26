// One desk event pulling from two Wix events (Andrew 26 Oct 2026): the National Gang Summit's justice partners register
// on one Wix event and its community partners on another. Both lists land on the one desk event, the second labelled
// "Community partners"; each pull only withdraws people from its own Wix event; letters still go once per address.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.WIX_API_KEY = "k"; process.env.WIX_SITE_ID = "s";
const guests = {
  justice: [["j1", "Jay", "Justice", "jay@example.ca"], ["j2", "Kim", "Court", "kim@example.ca"]],
  community: [["c1", "Cam", "Community", "cam@example.ca"], ["c2", "Dee", "Both", "kim@example.ca"]],   // shares an address with a justice partner
};
const wixGuest = (ev, [id, first, last, email]) => ({ id, eventId: ev, guestType: "RSVP", attendanceStatus: "ATTENDING", totalGuests: 1,
  guestDetails: { firstName: first, lastName: last, email, formResponse: { inputValues: [{ inputName: "email", value: email }, { inputName: ev === "justice" ? "agency_name" : "Organization", value: `${last} Agency` }] } } });
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body ?? "{}");
  if (String(url).endsWith("/events/v3/events/query")) return Response.json({ events: [
    { id: "justice", title: "National Gang Summit", status: "UPCOMING", dateAndTimeSettings: { startDate: "2026-11-09T13:00:00Z" }, eventPageUrl: { url: "https://www.ongia.org/event-details/ngs" } },
    { id: "community", title: "National Gang Summit — Community Partners", status: "UPCOMING", dateAndTimeSettings: { startDate: "2026-11-10T13:00:00Z" }, eventPageUrl: { url: "https://www.ongia.org/event-details/ngs-community" } }] });
  if (String(url).endsWith("/events/v2/guests/query")) {
    const ev = body.query?.filter?.eventId;
    const all = Object.entries(guests).flatMap(([e, list]) => (!ev || ev === e ? list.map((g) => wixGuest(e, g)) : []));
    return Response.json({ guests: all, pagingMetadata: {} });
  }
  throw new Error("unexpected fetch " + url);
};
const F = REPO + "netlify/functions/";
const wix = (await import(F + "wix.mjs")).default;
const { sweepWix } = await import(F + "wix.mjs");
const { putEvent, getEvent, getAttendees } = await import(F + "lib/store.mjs");
const { writeableTo } = await import(F + "lib/attendees.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey" };
const put = async (qs) => { const r = await wix(new Request(`http://localhost/api/wix?${qs}`, { method: "PUT", headers: H })); return { status: r.status, body: await r.json() }; };

await putEvent({ id: "ngs", title: "National Gang Summit", city: "Toronto, ON", dayOne: "2026-11-09", lastDay: "2026-11-12", board: [] });
ok("the second Wix event needs the first one linked", (await put("event=ngs&link=community&also=1")).status === 409);
await put("event=ngs&link=justice");
const both = await put("event=ngs&link=community&also=1&group=Community%20partners");
ok("linking the community partners' Wix event pulls them straight away", both.status === 200 && both.body.read === 4, JSON.stringify(both.body));
let people = (await getAttendees("ngs")).people;
ok("everyone from both Wix events is on the one list", people.filter((p) => p.status === "ATTENDING").length === 4);
ok("the community partners are labelled, the justice partners are not", people.filter((p) => p.group === "Community partners").map((p) => p.first).sort().join() === "Cam,Dee" && !people.find((p) => p.first === "Jay").group);
ok("two people at one address (one from each Wix event) get one letter", writeableTo(people).length === 3);
ok("the agency someone gave on the Wix form comes across, so the housekeeping form can fill it in", people.find((p) => p.first === "Jay").organization === "Justice Agency" && people.find((p) => p.first === "Cam").organization === "Community Agency");
ok("a Wix event linked here cannot be linked to another desk event", await (async () => { await putEvent({ id: "other", title: "Other", city: "X", dayOne: "2026-12-01", board: [] }); return (await put("event=other&link=community")).status === 409; })());

// Someone cancels on the community side only.
guests.community = guests.community.filter(([id]) => id !== "c1");
await sweepWix();
people = (await getAttendees("ngs")).people;
ok("a community partner who cancels shows as withdrawn", people.find((p) => p.first === "Cam").status === "WITHDRAWN");
ok("and nobody from the justice side is touched by the community pull", people.filter((p) => !p.group).every((p) => p.status === "ATTENDING"));
const again = await sweepWix();
ok("pulling again changes nothing", again.events.find((e) => e.event === "ngs").added === 0 && again.events.find((e) => e.event === "ngs").withdrawn === 0, JSON.stringify(again.events));

await put("event=ngs&unlinkAlso=community");
ok("the second Wix event can be unlinked, and the people already pulled are kept", !(await getEvent("ngs")).wixMore.length && (await getAttendees("ngs")).people.length === 4);
await sweepWix();
ok("and the next pull does not mark them as withdrawn", (await getAttendees("ngs")).people.find((p) => p.first === "Dee").status === "ATTENDING");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
