// Conferences ONGIA's board goes to (Andrew 30 Oct 2026): calendar placeholders, kept apart from the events, so nothing that
// runs an event (presenters, letters, reminders, the action queue) ever sees them.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
const F = REPO + "netlify/functions/";
const conferences = (await import(F + "conferences.mjs")).default;
const { listEvents } = await import(F + "lib/store.mjs");
const { issueSession } = await import(F + "lib/auth.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const call = async (method, qs = "", body, who = issueSession({ email: "member@ongia.ca", name: "Board Member" })) => {
  const r = await conferences(new Request(`http://x/api/conferences${qs}`, { method, headers: { "x-admin-key": who, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
  return { status: r.status, body: await r.json() };
};

ok("signed out, nothing", (await call("GET", "", undefined, "")).status === 401);
ok("none to start", (await call("GET")).body.conferences.length === 0);
let r = await call("POST", "", { title: "Arizona Gang Conference", from: "2027-06-22", to: "2027-06-25", place: "Phoenix, AZ", role: "attending", who: ["President@ongia.ca", "jacqueline@ongia.ca", "president@ongia.ca"] });
ok("any board member can add one: name, dates, place, attending, who (each once)", r.status === 200 && r.body.conferences[0].title === "Arizona Gang Conference" && r.body.conferences[0].who.join() === "president@ongia.ca,jacqueline@ongia.ca" && r.body.conferences[0].role === "attending", JSON.stringify(r.body));
await call("POST", "", { title: "Alberta Association of Chiefs of Police", from: "2027-04-14", to: "2027-04-16", place: "Calgary, AB", role: "presenting", who: ["president@ongia.ca"] });
r = await call("GET");
ok("kept in date order, earliest first", r.body.conferences.map((c) => c.title).join("|") === "Alberta Association of Chiefs of Police|Arizona Gang Conference");
ok("they are not events: no event list has them", !(await listEvents()).some((e) => /Arizona|Alberta/.test(e.title)));
ok("a one-day one needs no last day", (await call("POST", "", { title: "Halifax Symposium", from: "2027-04-22" })).body.conferences.find((c) => c.title === "Halifax Symposium")?.to === "2027-04-22");
ok("nonsense is refused: no name, no start, ends before it starts", (await call("POST", "", { from: "2027-01-01" })).status === 400 && (await call("POST", "", { title: "X" })).status === 400 && (await call("POST", "", { title: "X", from: "2027-05-02", to: "2027-05-01" })).status === 400);
const az = r.body.conferences.find((c) => c.title === "Arizona Gang Conference");
r = await call("PUT", `?id=${az.id}`, { ...az, role: "presenting", who: ["president@ongia.ca"] });
ok("changed: now presenting, just Andrew", r.body.conferences.find((c) => c.id === az.id).role === "presenting" && r.body.conferences.find((c) => c.id === az.id).who.length === 1);
r = await call("DELETE", `?id=${az.id}`);
ok("taken off", !r.body.conferences.some((c) => c.id === az.id) && r.body.conferences.length === 2);
ok("an unknown one is not found", (await call("DELETE", "?id=nope")).status === 404);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
