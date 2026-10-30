// Several checklist jobs at once (Andrew 30 Oct 2026: "Some events dont need the standard to do's and I would either just
// check them off or click N/A"): one write ticks or rules out every job picked, and Undo puts them back as they were.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
const F = REPO + "netlify/functions/";
const events = (await import(F + "events.mjs")).default;
const tasks = (await import(F + "tasks.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (h, url, method = "GET", body) => { const r = await h(new Request("http://localhost" + url, { method, headers: H, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, ...(await r.json()) }; };
process.env.ADMIN_KEY = "testkey";

const ev = (await call(events, "/api/events", "POST", { title: `Bulk Jobs ${Date.now().toString(36)}`, city: "Toronto", dayOne: "2031-04-07", lastDay: "2031-04-08", invite: false,
  board: [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }] })).event;
let r = await call(tasks, `/api/tasks?event=${ev.id}&seed=1`, "POST", {});
const [a, b, c, d] = r.tasks;
// One already done earlier, so Undo has an old date to keep.
r = await call(tasks, `/api/tasks?event=${ev.id}&id=${d.id}`, "PUT", { done: true });
const dWas = r.tasks.find((t) => t.id === d.id);
const q = `/api/tasks?event=${ev.id}&bulk=1`;

r = await call(tasks, q, "PUT", { jobs: [a, b, c].map((t) => ({ id: t.id, na: false, done: true })) });
const by = (id) => r.tasks.find((t) => t.id === id);
ok("three picked jobs are marked done in one write", r.status === 200 && r.changed === 3 && [a, b, c].every((t) => by(t.id).done && by(t.id).doneAt), JSON.stringify(r).slice(0, 200));
ok("the count goes up by three", r.counts.done === 4, JSON.stringify(r.counts));

const before = [a, b, d].map((t) => ({ id: t.id, done: by(t.id).done, na: by(t.id).na, doneAt: by(t.id).doneAt }));
r = await call(tasks, q, "PUT", { jobs: [a, b, d].map((t) => ({ id: t.id, na: true })) });
ok("Not needed rules them out and takes the tick off, as one at a time does", [a, b, d].every((t) => by(t.id).na && !by(t.id).done && !by(t.id).doneAt) && r.counts.na === 3);
r = await call(tasks, q, "PUT", { jobs: before });
ok("Undo puts every one back as it was, the old done date included", before.every((x) => by(x.id).done === x.done && !by(x.id).na && by(x.id).doneAt === x.doneAt) && by(d.id).doneAt === dWas.doneAt, JSON.stringify(r.tasks.slice(0, 4)));

r = await call(tasks, q, "PUT", { jobs: [{ id: a.id, done: false }, { id: "nope", done: true }] });
ok("a job that isn't on the list stops the whole write, nothing half-done", r.status === 404 && (await call(tasks, `/api/tasks?event=${ev.id}`)).tasks.find((t) => t.id === a.id).done === true);
ok("an empty pick is refused", (await call(tasks, q, "PUT", { jobs: [] })).status === 400);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
