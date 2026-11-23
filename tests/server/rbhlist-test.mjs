// The names and agencies list for RBH (Andrew 23 Nov 2026: "Danny is going to need a list of names and agencies for his
// government control back-end paperwork … one of those standing things that we need to deliver to Danny prior to the
// event starting"). Due two days before; goes only on Send, with the Excel file, to whoever is set for every RBH event.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.RESEND_API_KEY = "test-key";
process.env.APP_URL = "https://events.example.org";
process.env.ADMIN_KEY = "testkey";
delete process.env.MS_MAIL_FROM;
const sent = [];
let failNext = false;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.resend.com/")) {
    if (failNext) { failNext = false; return new Response(JSON.stringify({ message: "Mailbox unavailable" }), { status: 422, headers: { "content-type": "application/json" } }); }
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "m" + sent.length }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error("unexpected fetch " + url);
};
const F = REPO + "netlify/functions/";
const S = await import(F + "lib/store.mjs");
const fn = (await import(F + "rbhlist.mjs")).default;
const { readZip } = await import(F + "lib/zip.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (q, method = "GET", body) => { const r = await fn(new Request(`http://x/api/rbhlist${q}`, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) })); return { status: r.status, r, body: r.headers.get("content-type")?.includes("json") ? await r.json() : null }; };

await S.putEvent({ id: "rl-rbh", title: "Western Symposium", kind: "rbh", dayOne: "2027-03-10", board: [] });
await S.putEvent({ id: "rl-own", title: "Own training", kind: "", dayOne: "2027-03-10", board: [] });
const P = (first, last, organization, order, status = "ATTENDING") => ({ key: `wix:${first}${last}${Math.random()}`, first, last, email: `${first}@x.ca`, organization, orderNumber: order, status });
await S.putAttendees("rl-rbh", { syncedAt: "2027-03-01T12:00:00Z", people: [
  P("RYAN", "ANDERSON", "VicPD", "o1"), P("Ryan", "Anderson", "VicPD", "o1"), P("Ryan", "Anderson", "VicPD", "o1"),
  P("Kamren", "Gill", "RCMP", "o2"), P("Kamren", "Gill", "RCMP", "o3"),
  P("Sarah", "McKinnon", "VicPD", "o4"), P("Gone", "Person", "Ministry of Finance", "o5", "WITHDRAWN"),
] });

let r = await call("?event=rl-own");
ok("only for RBH events", r.status === 409);
r = await call("?event=rl-rbh");
ok("due two days before the first day", r.body.due === "2027-03-08", r.body.due);
ok("nobody to send to yet", r.body.to === null);
ok("counts: the withdrawn left out, a double sign-up once, team tickets counted", r.body.counts.people === 5 && r.body.counts.named === 3 && r.body.counts.team === 2, JSON.stringify(r.body.counts));
ok("a name in capitals put right; one with care kept", r.body.rows.some((x) => x.name === "Ryan Anderson" && x.team === 2) && r.body.rows.some((x) => x.name === "Sarah McKinnon"));
r = await call("?event=rl-rbh&send=1", "POST", {});
ok("Send refused until someone is set", r.status === 400 && /who at RBH/.test(r.body.error) && !sent.length);
r = await call("?to=1", "PUT", { name: "Danny Fournier", email: "not-an-email" });
ok("a bad address is refused", r.status === 400);
r = await call("?to=1", "PUT", { name: "Danny Fournier", email: "Danny.Fournier@rbh.example" });
ok("who gets it is kept, for every RBH event", r.status === 200 && r.body.to.email === "danny.fournier@rbh.example");

const pv = await call("?event=rl-rbh&preview=1", "POST", {});
ok("the email: Andrew's words, short, the list attached not typed out, the team note", /Hi Danny,/.test(pv.body.html) && /As per your request, attached is a list of the names and agencies that will be in attendance for the Western Symposium\./.test(pv.body.html)
  && !/Ryan Anderson|McKinnon|<table[^>]*>\s*<tr><th/.test(pv.body.html) && /bought multiple tickets for their team/.test(pv.body.html) && /If you have any questions, please let me know\./.test(pv.body.html));
ok("nothing is sent by preview", !sent.length);

const x = await call("?event=rl-rbh&xlsx=1");
const files = readZip(Buffer.from(await x.r.arrayBuffer()));
const sheet = files.find((f) => f.name === "xl/worksheets/sheet1.xml")?.data.toString() ?? "";
ok("the Excel file: Name and Agency on row 1, one row per ticket", /<c r="A1"[^>]*><is><t[^>]*>Name<\/t>/.test(sheet) && /<c r="B1"[^>]*><is><t[^>]*>Agency<\/t>/.test(sheet) && (sheet.match(/<row /g) ?? []).length === 6 && /Name to come \(Ryan Anderson&apos;s team\)|Name to come \(Ryan Anderson's team\)/.test(sheet));

r = await call("?event=rl-rbh&send=1", "POST", {});
const m = sent[0];
ok("sent: to Danny, a copy to the President, replies to the President", r.status === 200 && m && String(m.to) === "danny.fournier@rbh.example" && String(m.cc).includes("president@ongia.ca") && String(m.reply_to ?? m.replyTo).includes("president@ongia.ca"), JSON.stringify({ to: m?.to, cc: m?.cc, rt: m?.reply_to }));
ok("with the Excel file attached", m?.attachments?.length === 1 && /Western Symposium - Attendees and Agencies\.xlsx/.test(m.attachments[0].filename));
r = await call("?event=rl-rbh");
ok("the send is on the event: when, how many, to whom", r.body.sent.length === 1 && r.body.sent[0].people === 5 && r.body.sent[0].to === "danny.fournier@rbh.example");

failNext = true;
r = await call("?event=rl-rbh&send=1", "POST", {});
ok("a failed send says so", r.status === 502 && /didn't go/i.test(r.body.error));
r = await call("?event=rl-rbh");
ok("and stays on the event, the earlier send kept", !!r.body.failed && r.body.sent.length === 1);
r = await call("?event=rl-rbh&send=1", "POST", {});
r = await call("?event=rl-rbh");
ok("Resend goes and clears it", r.body.sent.length === 2 && !r.body.failed);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
