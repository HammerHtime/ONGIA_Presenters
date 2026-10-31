// Each person's certificate by email (Andrew 31 Oct 2026, from the mock-up he approved): through Resend from
// certificates@send.ongia.ca, replies to the shared ONGIA Events mailbox, English then French, the PDF attached and a
// personal download link that notes who fetched theirs; bounces come back from Resend's signed webhook. Made-up people.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
process.env.APP_URL = "https://events.ongia.org";
process.env.RESEND_API_KEY = "re_test";
process.env.RESEND_WEBHOOK_SECRET = "whsec_" + Buffer.from("a-test-signing-secret-32-bytes!!").toString("base64");
process.env.COSTING_USERS = "president@ongia.ca,vp_operations@ongia.ca";
delete process.env.MS_MAIL_FROM;
const F = REPO + "netlify/functions/";
const sent = [];
let failNext = false;
globalThis.fetch = async (url, init) => {
  if (String(url).includes("api.resend.com")) {
    if (failNext) { failNext = false; return new Response(JSON.stringify({ message: "The to address is invalid" }), { status: 422 }); }
    sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: `re_${sent.length}` }), { status: 200 });
  }
  throw new Error("unexpected fetch " + url);
};
const { putEvent, putAttendees, getMeta } = await import(F + "lib/store.mjs");
const { issueSession } = await import(F + "lib/auth.mjs");
const certificates = (await import(F + "certificates.mjs")).default;
const certfile = (await import(F + "certfile.mjs")).default;
const webhook = (await import(F + "resend-webhook.mjs")).default;
const { verifySvix } = await import(F + "resend-webhook.mjs");
const { dateRange } = await import(F + "lib/certmail.mjs");
const { createHmac } = await import("node:crypto");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const call = async (qs, { method = "GET", body, who = "testkey" } = {}) => {
  const r = await certificates(new Request(`http://x/api/certificates?${qs}`, { method, headers: { "x-admin-key": who, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
await putEvent({ id: "ngs31", title: "National Gang Summit 2031", city: "Toronto, ON", dayOne: "2031-11-10", lastDay: "2031-11-13",
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], reviewer: { name: "Raj Jaswal", email: "treasurer@ongia.ca" } });
const p = (key, first, last, org, email, extra = {}) => ({ key, first, last, organization: org, email, status: "ATTENDING", source: "wix", checkedIn: true, ...extra });
await putAttendees("ngs31", { people: [p("k1", "Jordan", "Tremblay", "TPS", "jt@example.ca"), p("k2", "Sam", "Okafor", "OPP", "so@example.ca"), p("k3", "Casey", "Lee", "RCMP", ""),
  p("k4", "Riley", "Gagnon", "SQ", "rg@practice.invalid")] });
await call("event=ngs31&issueAll=1", { method: "POST", body: {} });

ok("dates read naturally in both languages", dateRange("2031-11-10", "2031-11-13", "en") === "November 10 to 13, 2031" && dateRange("2031-11-10", "2031-11-13", "fr") === "du 10 au 13 novembre 2031", dateRange("2031-11-10", "2031-11-13", "en") + " / " + dateRange("2031-11-10", "2031-11-13", "fr"));

// Send two.
let r = await call("event=ngs31&mail=1", { method: "POST", body: { keys: ["k1", "k2"] } });
const m = sent[0];
ok("both went, one Resend message each", r.status === 200 && sent.length === 2 && r.body.results.every((x) => x.mail?.sentAt), JSON.stringify(r.body));
ok("from ONGIA Certificates <certificates@send.ongia.ca>, replies to ongiaevents@ongia.ca, to the attendee", m.from === "ONGIA Certificates <certificates@send.ongia.ca>" && m.reply_to === "ongiaevents@ongia.ca" && JSON.stringify(m.to) === '["jt@example.ca"]', JSON.stringify({ from: m.from, reply: m.reply_to, to: m.to }));
ok("subject in both languages", m.subject === "Your certificate: National Gang Summit 2031 / Votre certificat", m.subject);
ok("the PDF is attached, named for the person", m.attachments?.length === 1 && m.attachments[0].filename === "Jordan Tremblay - certificate.pdf" && Buffer.from(m.attachments[0].content, "base64").subarray(0, 5).toString() === "%PDF-");
const link = /href="(https:\/\/events\.ongia\.org\/api\/certfile\?c=[A-Z0-9-]+&amp;d=[A-Za-z0-9_-]+)"/.exec(m.html)?.[1]?.replace(/&amp;/g, "&");
ok("English then French, greeting by first name, the dates, a download button in each language, the verify link", /Hello Jordan,/.test(m.html) && m.html.indexOf("Hello Jordan") < m.html.indexOf("Bonjour Jordan") && /November 10 to 13, 20&zwnj;31/.test(m.html) && /du 10 au 13 novembre 20&zwnj;31/.test(m.html) && /November 10 to 13, 2031/.test(m.text)
  && /Download your certificate/.test(m.html) && /Télécharger votre certificat/.test(m.html) && /verify\.html\?c=/.test(m.html) && !!link, m.html.slice(0, 300));
ok("signed by the lead, and says replies go to the ONGIA events team", /Raj Jaswal/.test(m.html) && /Replies go to the ONGIA events team at/.test(m.html) && !/Replies to this email go straight to/.test(m.html));
ok("a plain-text copy with the link", /Download your certificate: https:\/\/events\.ongia\.org\/api\/certfile/.test(m.text));

// The download link.
const fileReq = (u) => certfile(new Request(u));
let f = await fileReq(link);
ok("the link hands over the PDF", f.status === 200 && (f.headers.get("content-type") ?? "").includes("pdf") && /Jordan%20Tremblay/.test(f.headers.get("content-disposition") ?? ""));
let C = (await call("event=ngs31")).body;
const row = (k) => C.people.find((x) => x.key === k).cert.mail;
ok("and the list now shows Jordan downloaded it; Sam emailed, not downloaded", !!row("k1").downloadedAt && !!row("k1").sentAt && !!row("k2").sentAt && !row("k2").downloadedAt, JSON.stringify([row("k1"), row("k2")]));
f = await fileReq(link.replace(/d=[^&]+/, "d=wrong"));
ok("a wrong token gets a polite 'not valid' page, no PDF", f.status === 404 && /isn't valid/.test(await f.text()));

// Sending again is deliberate.
const before = sent.length;
r = await call("event=ngs31&mail=1", { method: "POST", body: { keys: ["k1"] } });
ok("pressing send again doesn't email someone twice", sent.length === before && r.body.results[0].skipped === "already emailed");
r = await call("event=ngs31&mail=1", { method: "POST", body: { keys: ["k1"], again: true } });
ok("…unless it's Email it again", sent.length === before + 1 && r.body.results[0].mail.sends === 2);

// No address, a practice address, a refusal from Resend: each is said, none is thrown away.
r = await call("event=ngs31&mail=1", { method: "POST", body: { keys: ["k3", "k4"] } });
ok("no email address on the list: says so", r.body.results[0].error === "No email address on the list for this person.", JSON.stringify(r.body.results[0]));
ok("a practice event's made-up address: not sent, and the row says why", /practice/.test(r.body.results[1].mail?.failed ?? ""), JSON.stringify(r.body.results[1]));
failNext = true;
r = await call("event=ngs31&mail=1", { method: "POST", body: { keys: ["k2"], again: true } });
ok("Resend refusing it: the row says couldn't send, with the reason", /The to address is invalid/.test(r.body.results[0].mail?.failed ?? ""), JSON.stringify(r.body.results[0]));
r = await call("event=ngs31&mail=1", { method: "POST", body: { keys: ["k2"] } });
ok("and a failed one can be sent again without the again flag", !!r.body.results[0].mail?.sentAt && !r.body.results[0].mail?.failed, JSON.stringify(r.body.results[0]));

// Resend's webhook: signed, then bounced.
const sign = (body, ts = Math.floor(Date.now() / 1000), id = "msg_1") => {
  const key = Buffer.from(process.env.RESEND_WEBHOOK_SECRET.replace(/^whsec_/, ""), "base64");
  return { "svix-id": id, "svix-timestamp": String(ts), "svix-signature": "v1," + createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64") };
};
const k2id = (await getMeta(`certs:code:${C.people.find((x) => x.key === "k2").cert.code}`)).mail.id;
const bounce = JSON.stringify({ type: "email.bounced", data: { email_id: k2id, bounce: { message: "Mailbox does not exist" } } });
let w = await webhook(new Request("http://x/api/resend-webhook", { method: "POST", body: bounce, headers: { ...sign(bounce), "content-type": "application/json" } }));
C = (await call("event=ngs31")).body;
ok("a signed bounce from Resend marks Sam's row Bounced, with the reason", w.status === 200 && row("k2").bounced === "Mailbox does not exist", JSON.stringify(row("k2")));
w = await webhook(new Request("http://x/api/resend-webhook", { method: "POST", body: bounce, headers: { ...sign(bounce), "svix-signature": "v1,AAAA", "content-type": "application/json" } }));
ok("a bad signature is refused and changes nothing", w.status === 401);
ok("an old timestamp is refused (no replays)", !verifySvix(process.env.RESEND_WEBHOOK_SECRET, "msg_1", String(Math.floor(Date.now() / 1000) - 600), bounce, sign(bounce, Math.floor(Date.now() / 1000) - 600)["svix-signature"]));
const delivered = JSON.stringify({ type: "email.delivered", data: { email_id: "re_unknown" } });
w = await webhook(new Request("http://x/api/resend-webhook", { method: "POST", body: delivered, headers: { ...sign(delivered), "content-type": "application/json" } }));
ok("an event for an email we don't know is accepted and ignored", w.status === 200 && (await w.json()).noted === false);

// A sample to the board member asking.
const n = sent.length;
r = await call("event=ngs31&sample=1", { method: "POST", body: {}, who: issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" }) });
const s = sent[n];
ok("Email me a sample: to the signed-in board member, marked [Sample], a sample certificate in their name", r.status === 200 && JSON.stringify(s?.to) === '["president@ongia.ca"]' && /^\[Sample\] Your certificate/.test(s.subject) && /SAMP-LE00/.test(s.html) && s.attachments[0].filename === "Andrew Hammond - certificate.pdf", JSON.stringify(r.body));
const slink = /href="(https:\/\/events\.ongia\.org\/api\/certfile\?c=SAMP-LE00&amp;d=[A-Za-z0-9_-]+)"/.exec(s.html)?.[1]?.replace(/&amp;/g, "&");
f = await fileReq(slink);
ok("and its download link works", f.status === 200 && (f.headers.get("content-type") ?? "").includes("pdf"));

// Resend refusing the sample (as it did on 31 Oct 2026: "The send.ongia.ca domain is not verified") is said plainly, not a crash.
failNext = true;
r = await call("event=ngs31&sample=1", { method: "POST", body: {}, who: issueSession({ email: "president@ongia.ca", name: "Andrew Hammond" }) });
ok("a refused sample comes back as a plain message, not a crash", r.status === 503 && /The sample wasn't sent: Email failed \(422\): The to address is invalid/.test(r.body.error ?? ""), JSON.stringify(r));

// Who may: not another board member.
r = await call("event=ngs31&mail=1", { method: "POST", body: { keys: ["k1"] }, who: issueSession({ email: "member@ongia.ca", name: "Member" }) });
ok("a board member who isn't the lead, president or VP can't send", r.status === 403);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
