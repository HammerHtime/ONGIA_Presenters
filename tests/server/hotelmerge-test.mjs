// Two board members change different hotel details at the same time (audit, 21 Nov 2026): both changes are kept, the
// way two different fields of the event already were. A detail both changed goes to the one saved last.
const REPO = new URL("../../", import.meta.url).pathname;
const S = await import(REPO + "netlify/functions/lib/store.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await S.putEvent({ id: "hm", title: "Summit", hotel: { name: "Delta", rate: 189, cutoff: "2026-10-01" } });
const a = await S.getEvent("hm"), b = await S.getEvent("hm");
a.hotel = { ...a.hotel, rate: 199 };                 // one changes the rate
b.hotel = { ...b.hotel, cutoff: "2026-10-15" };      // the other the cut-off, from the same starting point
await S.putEvent(a); await S.putEvent(b);
let now = await S.getEvent("hm");
ok("both hotel changes are kept", now.hotel.rate === 199 && now.hotel.cutoff === "2026-10-15" && now.hotel.name === "Delta", JSON.stringify(now.hotel));
const c = await S.getEvent("hm"), d = await S.getEvent("hm");
c.hotel = { ...c.hotel, rate: 205 }; d.hotel = { ...d.hotel, rate: 210 };
await S.putEvent(c); await S.putEvent(d);
ok("the same detail changed by both: the last one saved", (await S.getEvent("hm")).hotel.rate === 210);
const e = await S.getEvent("hm"), f = await S.getEvent("hm");
e.title = "Summit 2026"; f.hotel = { ...f.hotel, name: "Delta Airport" };
await S.putEvent(e); await S.putEvent(f);
now = await S.getEvent("hm");
ok("a title change and a hotel change at once: both kept, as before", now.title === "Summit 2026" && now.hotel.name === "Delta Airport");
const g = await S.getEvent("hm"), h = await S.getEvent("hm");
delete g.hotel.cutoff; h.hotel = { ...h.hotel, rate: 220 };
await S.putEvent(g); await S.putEvent(h);
now = await S.getEvent("hm");
ok("a detail cleared by one and another changed by the other: both", now.hotel.cutoff === undefined && now.hotel.rate === 220, JSON.stringify(now.hotel));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
