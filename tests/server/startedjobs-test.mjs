// Once an event has started, its jobs from before it have passed rather than gone late (Andrew 26 Nov 2026: "If there
// are open tasks outstanding like presenter material or send food or hotel rooms to hotel, clearly they do not still
// need to be on my dashboard"). Jobs during or after the event still count. Made-up event and jobs.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const { checklistOf, tickCertsJob } = await import(REPO + "netlify/functions/lib/checklist.mjs");
const S = await import(REPO + "netlify/functions/lib/store.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };

const event = { dayOne: "2026-11-24", lastDay: "2026-11-24", hotel: { cutoff: "2026-10-23" }, tasks: [
  { id: "mat", what: "Final presenter materials in", daysBefore: 14 },
  { id: "food", what: "Food and beverage numbers to the hotel", daysBefore: 7 },
  { id: "rooms", what: "Rooming list to the hotel", daysBefore: 3, from: "cutoff" },
  { id: "survey", what: "Survey link sent to attendees", daysBefore: -1, auto: "survey" },
  { id: "certs", what: "Event certificate sent out (after the event)", daysBefore: null },
  { id: "av", what: "AV returned", daysBefore: -1 },
  { id: "done", what: "Agenda printed", daysBefore: 2, done: true },
] };
const before = checklistOf(event, "2026-11-20");
ok("before the event, a job past its date is late", before.tasks.find((t) => t.id === "mat").late && before.counts.late === 3, JSON.stringify(before.counts));
const after = checklistOf(event, "2026-11-26");
const t = (id) => after.tasks.find((x) => x.id === id);
ok("once it has started, the materials, food and rooming jobs have passed, not late", ["mat", "food", "rooms"].every((id) => t(id).lapsed && !t(id).late && !t(id).soon));
ok("…so only the survey and the certificates are overdue", after.counts.late === 2 && t("survey").late && t("certs").late, JSON.stringify(after.counts));
ok("any other job after the event doesn't alert either (only the survey and certificates do)", t("av").lapsed && !t("av").late);
ok("the certificates job with no date of its own is due the day after the event", t("certs").due === "2026-11-25");
ok("they stay on the list, unticked, counted in the total", after.counts.total === 7 && after.counts.done === 1);
ok("months later, the survey and certificates still alert until they're done", checklistOf(event, "2027-03-01").counts.late === 2);
ok("on day one itself, they have passed", checklistOf(event, "2026-11-24").tasks.find((x) => x.id === "food").lapsed);

// Certificates emailed: the job ticks itself.
await S.putEvent({ id: "tk1", title: "Sample", ...event });
ok("emailing certificates ticks the certificates job", (await tickCertsJob("tk1")) && (await S.getEvent("tk1")).tasks.find((x) => x.id === "certs").done === true);
ok("…once", (await tickCertsJob("tk1")) === false);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
