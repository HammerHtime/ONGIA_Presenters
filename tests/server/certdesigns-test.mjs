// Certificate designs uploaded in the app (Andrew 30 Oct 2026): Claude places the words; each design is for one event or
// a template for any ("That way it doesn't get added to the template list if only for specific event"); a template is
// the president's and the VP's to add, a design for one event also its lead's.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
process.env.APP_URL = "https://events.ongia.org";
process.env.COSTING_USERS = "president@ongia.ca,vp_operations@ongia.ca";
const F = REPO + "netlify/functions/";
const fs = await import("node:fs");
const { execFileSync } = await import("node:child_process");
const { putEvent, putAttendees } = await import(F + "lib/store.mjs");
const { issueSession } = await import(F + "lib/auth.mjs");
const { placeDesign, templatesFor, certSettings } = await import(F + "lib/certs.mjs");
const certificates = (await import(F + "certificates.mjs")).default;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const as = (email) => issueSession({ email, name: email });
const call = async (qs, { method = "GET", body, who = "testkey" } = {}) => {
  const r = await certificates(new Request(`http://x/api/certificates?${qs}`, { method, headers: { "x-admin-key": who, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
  const type = r.headers.get("content-type") ?? "";
  return { status: r.status, type, body: type.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) };
};
const JPEG = fs.readFileSync(REPO + "public/assets/certs/ongia-generic.jpg").toString("base64");

// Claude's placing, from fractions of the page to points, kept on the page.
const client = { messages: { create: async (req) => {
  ok("Claude is shown the design and told the page's size", req.messages[0].content[0].type === "image" && /612 points wide and 792 points tall/.test(req.system));
  return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({
    name: { present: true, box: { x: 0.065, y: 0.4, w: 0.55, h: 0.05 }, font: "bold", sizePt: 36, color: "black", align: "left" },
    agency: { present: true, box: { x: 0.065, y: 0.46, w: 0.6, h: 0.03 }, font: "regular", sizePt: 17, color: "black", align: "left" },
    course: { present: true, box: { x: 0.065, y: 0.6, w: 0.65, h: 0.07 }, font: "bold", sizePt: 20, color: "navy", align: "left" },
    date: { present: true, box: { x: 0.07, y: 0.77, w: 0.2, h: 0.025 }, font: "regular", sizePt: 13, color: "black", align: "left" },
    erase: [{ box: { x: 0.06, y: 0.4, w: 0.4, h: 0.05 }, text: "Your Recipient" }],
    qr: { box: { x: 0.88, y: 0.04, w: 0.06, h: 0.06 }, onDark: false }, notes: "" }) }] };
} } };
const placed = await placeDesign({ image: JPEG, w: 612, h: 792 }, { client });
ok("each box comes back in points: the name about 337 points wide, 317 down", Math.abs(placed.fields.name.w - 336.6) < 1 && Math.abs(placed.fields.name.y - 316.8) < 1 && placed.fields.name.font === "b" && placed.fields.name.size === 36, JSON.stringify(placed.fields.name));
ok("the course is two lines, in navy; sample words to lift off are listed", placed.fields.course.lines === 2 && placed.fields.course.color === "#1a2f5e" && placed.erase[0].text === "Your Recipient");
ok("the QR code sits in its quiet corner, on the page", placed.qr.x > 500 && placed.qr.x + placed.qr.size <= 612 && placed.qr.y < 60, JSON.stringify(placed.qr));

await putEvent({ id: "sym27", title: "Ontario Symposium 2027", city: "Toronto", dayOne: "2027-11-04", lastDay: "2027-11-06", board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }] });
await putEvent({ id: "cal27", title: "Calgary Training 2027", city: "Calgary", dayOne: "2027-04-05", lastDay: "2027-04-07", board: [] });
await putAttendees("sym27", { people: [{ key: "k1", first: "Jordan", last: "Tremblay", organization: "TPS", email: "jt@torontopolice.on.ca", status: "ATTENDING", checkedIn: true }] });
const design = (extra) => ({ name: "Ontario Symposium 2027", scope: "event", event: "sym27", w: 612, h: 792, image: JPEG, fields: placed.fields, qr: placed.qr, dateStyle: "long", ...extra });

ok("the event's lead may not add a template for every event", (await call("design=new", { method: "POST", body: design({ scope: "any" }), who: as("treasurer@ongia.ca") })).status === 403);
const mine = await call("design=new", { method: "POST", body: design(), who: as("treasurer@ongia.ca") });
ok("the lead may add a design for their own event", mine.status === 200 && mine.body.design.scope === "event" && mine.body.design.event === "sym27", JSON.stringify(mine.body).slice(0, 200));
ok("but not for an event they don't lead", (await call("design=new", { method: "POST", body: design({ event: "cal27" }), who: as("treasurer@ongia.ca") })).status === 403);
ok("a picture that isn't one is refused", (await call("design=new", { method: "POST", body: design({ image: "AAAA" }) })).status === 400);
const id = mine.body.design.id;

let C = (await call("event=sym27")).body;
ok("the Symposium now offers its own design, and uses it straight away", C.templates.some((t) => t.id === id && !t.builtIn && /This event's own/.test(t.note)) && C.settings.template === id, JSON.stringify(C.settings));
ok("Calgary doesn't see the Symposium's design", !(await call("event=cal27")).body.templates.some((t) => t.id === id));

const pdf = await call("event=sym27&pdf=k1");
fs.writeFileSync("/tmp/certdesign-k1.pdf", pdf.body);
const words = execFileSync("pdftotext", ["-layout", "/tmp/certdesign-k1.pdf", "-"]).toString();
ok("a certificate on the uploaded design: name, official agency, the course, the date written out", pdf.type === "application/pdf" && /Jordan Tremblay/.test(words) && /Toronto Police Service/.test(words) && /Ontario Symposium 2027/.test(words) && /November 6, 2027/.test(words), words.slice(0, 400));
ok("its image is the uploaded page", /jpeg|image/.test(execFileSync("pdfimages", ["-list", "/tmp/certdesign-k1.pdf"]).toString()));

// A landscape design prints on a landscape page.
const land = await call("design=new", { method: "POST", body: design({ name: "Wide one", w: 792, h: 612, scope: "any" }), who: as("vp_operations@ongia.ca") });
ok("the VP may add a template; Calgary sees it", land.status === 200 && (await call("event=cal27")).body.templates.some((t) => t.id === land.body.design.id && t.landscape));
await call("event=cal27", { method: "PUT", body: { template: land.body.design.id } });
await putAttendees("cal27", { people: [{ key: "c1", first: "Sam", last: "Okafor", organization: "OPP", email: "so@opp.ca", status: "ATTENDING", checkedIn: true }] });
fs.writeFileSync("/tmp/certdesign-c1.pdf", (await call("event=cal27&pdf=c1")).body);
ok("a landscape design makes a landscape certificate", /792 x 612/.test(execFileSync("pdfinfo", ["/tmp/certdesign-c1.pdf"]).toString()));

// Admin: the list, changing whether a design is a template, retiring.
let D = (await call("designs=1")).body;
ok("Admin lists every design, with the event each is for", D.designs.some((d) => d.id === id && d.eventTitle === "Ontario Symposium 2027") && D.designs.some((d) => d.scope === "any"));
ok("the lead can't turn their event's design into a template", (await call(`design=${id}`, { method: "PUT", body: { scope: "any" }, who: as("treasurer@ongia.ca") })).status === 403);
ok("the president can", (await call(`design=${id}`, { method: "PUT", body: { scope: "any" } })).body.design.scope === "any" && (await call("event=cal27")).body.templates.some((t) => t.id === id));
await call(`design=${id}`, { method: "PUT", body: { retired: true } });
ok("retired, no event offers it any more", !(await call("event=cal27")).body.templates.some((t) => t.id === id) && !(await call("event=sym27")).body.templates.some((t) => t.id === id));
ok("an edit to where the words go is kept", (await call(`design=${land.body.design.id}`, { method: "PUT", body: { fields: { ...placed.fields, name: { ...placed.fields.name, size: 40 } }, qr: null } })).body.design.fields.name.size === 40);
ok("and a design whose QR code is left off makes certificates without one", (await call(`design=${land.body.design.id}`)).body.design.qr === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
