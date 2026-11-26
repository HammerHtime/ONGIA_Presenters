// Once an event has started, its jobs from before it have passed rather than gone late (Andrew 26 Nov 2026: "If there
// are open tasks outstanding like presenter material or send food or hotel rooms to hotel, clearly they do not still
// need to be on my dashboard"). Jobs during or after the event still count. Made-up event and jobs.
const REPO = new URL("../../", import.meta.url).pathname;
const { checklistOf } = await import(REPO + "netlify/functions/lib/checklist.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };

const event = { dayOne: "2026-11-24", lastDay: "2026-11-24", hotel: { cutoff: "2026-10-23" }, tasks: [
  { id: "mat", what: "Final presenter materials in", daysBefore: 14 },
  { id: "food", what: "Food and beverage numbers to the hotel", daysBefore: 7 },
  { id: "rooms", what: "Rooming list to the hotel", daysBefore: 3, from: "cutoff" },
  { id: "survey", what: "Survey sent", daysBefore: -1 },
  { id: "done", what: "Agenda printed", daysBefore: 2, done: true },
] };
const before = checklistOf(event, "2026-11-20");
ok("before the event, a job past its date is late", before.tasks.find((t) => t.id === "mat").late && before.counts.late === 3, JSON.stringify(before.counts));
const after = checklistOf(event, "2026-11-26");
const t = (id) => after.tasks.find((x) => x.id === id);
ok("once it has started, the materials, food and rooming jobs have passed, not late", ["mat", "food", "rooms"].every((id) => t(id).lapsed && !t(id).late && !t(id).soon));
ok("…so the event shows no overdue jobs for them", after.counts.late === 1, JSON.stringify(after.counts));
ok("a job after the event (the survey) still goes late", t("survey").late && !t("survey").lapsed);
ok("they stay on the list, unticked, counted in the total", after.counts.total === 5 && after.counts.done === 1);
ok("three weeks after the event ends, the survey left undone has passed too", checklistOf(event, "2026-12-16").tasks.find((x) => x.id === "survey").lapsed && checklistOf(event, "2026-12-16").counts.late === 0);
ok("…but not before then", checklistOf(event, "2026-12-14").tasks.find((x) => x.id === "survey").late);
ok("on day one itself, they have passed", checklistOf(event, "2026-11-24").tasks.find((x) => x.id === "food").lapsed);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
