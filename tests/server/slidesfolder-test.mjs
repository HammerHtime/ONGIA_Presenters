// A folder of its own for presenters' slides (Andrew 27 Oct 2026: "Where are the presentations saved that presenters
// are asked to upload? I would like to be able to create a different path to a different folder"). The upload link
// presenters get is made on that folder; left blank, slides go to the event folder as before. Agreements are not moved.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
process.env.MS_TENANT_ID = "t"; process.env.MS_CLIENT_ID = "c"; process.env.MS_CLIENT_SECRET = "s"; process.env.MS_DRIVE_ID = "drive1";
delete process.env.RESEND_API_KEY; delete process.env.MS_MAIL_FROM;
// A stand-in for Microsoft: every folder exists; a Request-files link names the folder it was made on.
const links = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const ok = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
  if (u.startsWith("https://login.microsoftonline.com/")) return ok({ access_token: "tok" });
  const path = decodeURIComponent(u.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, ""));
  const created = path.match(/^\/drives\/drive1\/root:\/(.+):\/createLink$/);
  if (created) { links.push(created[1]); return ok({ id: `p${links.length}`, link: { type: "createOnly", webUrl: `https://ongia.sharepoint.com/:f:/s/x/link-${links.length}` } }); }
  if (/^\/shares\//.test(path)) return ok({ id: "p", link: { type: "createOnly" } });
  const item = path.match(/^\/drives\/drive1\/root:\/([^?]+)\?/);
  if (item) return ok({ id: "i", name: item[1].split("/").pop(), webUrl: `https://ongia.sharepoint.com/sites/x/Shared Documents/${item[1]}` });
  throw new Error("unexpected fetch " + u);
};
const F = REPO + "netlify/functions/";
const { getEvent } = await import(F + "lib/store.mjs");
const events = (await import(F + "events.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (qs, method, body) => { const r = await events(new Request(`http://x/api/events${qs}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, body: await r.json() }; };

const details = { title: "Toronto Training", city: "Toronto", venue: "Hall", dayOne: "2026-12-01", lastDay: "2026-12-01", invite: false,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], sharePointFolder: "2026/Toronto 2026" };
const made = await call("", "POST", details);
const id = made.body.event?.id;
let e = await getEvent(id);
ok("a new event: the upload link is made on the event folder, as before", made.status < 300 && links.at(-1) === "2026/Toronto 2026" && !!e.materialsUploadUrl, JSON.stringify(links));
const first = e.materialsUploadUrl;

let r = await call(`?id=${id}`, "PUT", { ...details, materialsUploadUrl: first, materialsFolder: "2026/Toronto 2026/Presentations" });
e = await getEvent(id);
ok("a slides folder set: a fresh upload link is made on it", r.status === 200 && links.at(-1) === "2026/Toronto 2026/Presentations" && e.materialsUploadUrl && e.materialsUploadUrl !== first, JSON.stringify({ links, url: e.materialsUploadUrl }));
ok("the event remembers the folder, and where it is in SharePoint", e.materialsFolderPath === "2026/Toronto 2026/Presentations" && /Presentations$/.test(e.materialsFolderUrl));
ok("agreements still go to the event folder", e.sharePointFolder === "2026/Toronto 2026");

const n = links.length, second = e.materialsUploadUrl;
await call(`?id=${id}`, "PUT", { ...details, title: "Toronto Training Day", materialsUploadUrl: second });
e = await getEvent(id);
ok("a save that leaves the slides folder out keeps it, and the link", e.materialsFolderPath === "2026/Toronto 2026/Presentations" && e.materialsUploadUrl === second && links.length === n);

await call(`?id=${id}`, "PUT", { ...details, materialsUploadUrl: second, materialsFolder: "https://ongia.sharepoint.com/sites/x/Shared Documents/Presenter Slides/Toronto 2026" });
e = await getEvent(id);
ok("a pasted SharePoint folder link works too", e.materialsFolderPath === "Presenter Slides/Toronto 2026" && links.at(-1) === "Presenter Slides/Toronto 2026", JSON.stringify({ p: e.materialsFolderPath, links }));

await call(`?id=${id}`, "PUT", { ...details, materialsUploadUrl: e.materialsUploadUrl, materialsFolder: "" });
e = await getEvent(id);
ok("cleared, slides go back to the event folder with a link made there", !e.materialsFolderPath && links.at(-1) === "2026/Toronto 2026");

// A link Andrew pasted himself is his: the desk does not replace it when the folder changes.
await call(`?id=${id}`, "PUT", { ...details, materialsUploadUrl: "https://ongia.sharepoint.com/:f:/s/x/his-own", materialsFolder: "" });
const before = links.length;
await call(`?id=${id}`, "PUT", { ...details, materialsUploadUrl: "https://ongia.sharepoint.com/:f:/s/x/his-own", materialsFolder: "2026/Toronto 2026/Slides" });
e = await getEvent(id);
ok("a link he pasted himself is left alone", e.materialsUploadUrl === "https://ongia.sharepoint.com/:f:/s/x/his-own" && links.length === before);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
