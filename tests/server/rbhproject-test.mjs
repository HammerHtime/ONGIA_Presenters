// An RBH project that isn't an event (Andrew 6 Nov 2026: "an SOW for RBH not for an event but for website development …
// everything stays the same with RBH events like draft, approved etc."). The same record and statement of work, with
// none of a training's parts.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
delete process.env.MS_TENANT_ID; delete process.env.MS_CLIENT_ID; delete process.env.MS_CLIENT_SECRET;
const F = REPO + "netlify/functions/";
const events = (await import(F + "events.mjs")).default;
const sow = (await import(F + "sow.mjs")).default;
const { getEvent } = await import(F + "lib/store.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const board = [{ name: "Andrew Hammond", email: "president@ongia.ca", lead: true }];
const make = async (body) => { const r = await events(new Request("http://x/api/events", { method: "POST", headers: H, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };

const noCity = await make({ title: "Workshop", dayOne: "2026-12-01", board });
ok("an ordinary event still needs a city", noCity.status === 400 && /city/.test(noCity.body.error), JSON.stringify(noCity.body));
const out = await make({ title: "Website development", dayOne: "2026-11-15", lastDay: "2027-02-28", kind: "rbh", project: true, province: "ON", board });
ok("a project is made without a city", out.status === 201, JSON.stringify(out.body).slice(0, 200));
const ev = await getEvent(out.body.event.id);
ok("it's an RBH event marked as a project, emailing nobody, with no training checklist", ev.kind === "rbh" && ev.project === true && ev.attendeeMail === false && ev.noDeadlines === true && ev.tasks.length === 0, JSON.stringify({ kind: ev.kind, project: ev.project, tasks: ev.tasks?.length }));
ok("its papers go under RBH Projects by year and title", ev.sharePointFolder === "ONGIA Board/RBH Projects/2026/Website development", ev.sharePointFolder);
ok("its id comes from the title", /^2026-website-development-/.test(ev.id), ev.id);
const notRbh = await make({ title: "Something", dayOne: "2026-11-15", project: true, board });
ok("a project has to be an RBH one: otherwise it's an ordinary event and needs a city", notRbh.status === 400);
const s = await sow(new Request(`http://x/api/sow?event=${ev.id}`, { headers: H }));
const sj = await s.json();
ok("its statement of work opens like any RBH event's", s.status === 200 && (sj.sow === null || sj.sow?.status === "draft" || Array.isArray(sj.sow?.lines) || sj.status !== undefined), JSON.stringify(sj).slice(0, 200));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
