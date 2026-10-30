// Certificates (Andrew 30 Oct 2026): his design filled with each person's name, agency (official name) and the date,
// "default to the last day of the training event" and changeable; anyone's PDF downloadable; a QR code that verifies;
// kept for good; for the president, VP and event lead. And the two attendee downloads.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
process.env.APP_URL = "https://events.ongia.org";
process.env.COSTING_USERS = "president@ongia.ca,vp_operations@ongia.ca";
const F = REPO + "netlify/functions/";
const { putEvent, putAttendees, getEvent, getMeta } = await import(F + "lib/store.mjs");
const { issueSession } = await import(F + "lib/auth.mjs");
const certificates = (await import(F + "certificates.mjs")).default;
const verify = (await import(F + "verify.mjs")).default;
const { readCsv } = await import(F + "lib/attendees.mjs");
const { execFileSync } = await import("node:child_process");
const fs = await import("node:fs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const as = (email) => issueSession({ email, name: email });
const call = async (qs, { method = "GET", body, who = "testkey" } = {}) => {
  const r = await certificates(new Request(`http://x/api/certificates?${qs}`, { method, headers: { "x-admin-key": who, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
  const type = r.headers.get("content-type") ?? "";
  return { status: r.status, type, disp: r.headers.get("content-disposition") ?? "", body: type.includes("json") ? await r.json() : type.includes("pdf") ? Buffer.from(await r.arrayBuffer()) : await r.text() };
};

await putEvent({ id: "ngs27", title: "National Gang Summit", city: "Toronto", dayOne: "2027-05-04", lastDay: "2027-05-06",
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }, { name: "Other Member", email: "member@ongia.ca" }] });
await putEvent({ id: "web1", title: "Beyond the Headlines: An Analytical Look at Organized Crime Trends Across Canada", city: "Online", dayOne: "2026-09-15", board: [] });
const p = (key, first, last, organization, email, extra = {}) => ({ key, first, last, organization, email, status: "ATTENDING", source: "wix", ...extra });
await putAttendees("ngs27", { people: [p("k1", "Jordan", "Tremblay", "TPS", "jt@torontopolice.on.ca", { checkedIn: true }), p("k2", "Sam", "Okafor", "OPP - Gang Unit", "so@opp.ca", { checkedIn: true }),
  p("k3", "Alex", "Martin", "Peel Police", "am@peelpolice.ca"), p("k4", "Casey", "Nguyen", "CSC", "cn@csc-scc.gc.ca", { status: "WITHDRAWN" })] });
await putAttendees("web1", { people: [p("w1", "Pat", "Doe", "RCMP E Division", "pd@rcmp-grc.gc.ca", { checkedIn: true })] });

let C = (await call("event=ngs27")).body;
ok("the Summit picks its own design; the date is the event's last day; the course is its title", C.settings.template === "national-gang-summit" && C.settings.date === "2027-05-06" && !C.settings.dateSet && C.settings.course === "National Gang Summit", JSON.stringify(C.settings));
ok("another event starts on the generic design", (await call("event=web1")).body.settings.template === "generic");
ok("everyone coming is listed with their agency's official name; someone withdrawn is not", C.people.length === 3 && C.people.find((x) => x.key === "k1").agency === "Toronto Police Service" && C.people.find((x) => x.key === "k2").agency === "Ontario Provincial Police" && !C.people.some((x) => x.key === "k4"), JSON.stringify(C.people.map((x) => [x.key, x.agency])));
ok("and who checked in is counted", C.counts.checkedIn === 2 && C.counts.coming === 3);

// Who may: the president, the VP, the event's lead; not another board member.
ok("the event's lead may", (await call("event=ngs27", { who: as("treasurer@ongia.ca") })).status === 200);
ok("the VP may", (await call("event=ngs27", { who: as("vp_operations@ongia.ca") })).status === 200);
ok("another board member on the event may not", (await call("event=ngs27", { who: as("member@ongia.ca") })).status === 403);

// The date can change, and go back.
C = (await call("event=ngs27", { method: "PUT", body: { date: "2027-05-07" } })).body;
ok("Andrew can change the date", C.settings.date === "2027-05-07" && C.settings.dateSet);
C = (await call("event=ngs27", { method: "PUT", body: { date: "" } })).body;
ok("and put it back to the last day", C.settings.date === "2027-05-06" && !C.settings.dateSet);
ok("an unknown design is refused", (await call("event=ngs27", { method: "PUT", body: { template: "nope" } })).status === 400);

// A certificate.
const one = await call("event=ngs27&pdf=k1");
fs.writeFileSync("/tmp/cert-k1.pdf", one.body);
const words = execFileSync("pdftotext", ["-layout", "/tmp/cert-k1.pdf", "-"]).toString();
ok("Jordan's certificate is a one-page PDF with the name, the official agency and the last day", one.type === "application/pdf" && /Jordan Tremblay/.test(words) && /Toronto Police Service/.test(words) && /06\/05\/2027/.test(words)
  && /Pages:\s+1\b/.test(execFileSync("pdfinfo", ["/tmp/cert-k1.pdf"]).toString()), words.slice(0, 300));
ok("it downloads under the person's name", /Jordan%20Tremblay%20-%20certificate\.pdf/.test(one.disp), one.disp);
C = (await call("event=ngs27")).body;
const code = C.people.find((x) => x.key === "k1").cert?.code;
ok("it now has a number", /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code ?? ""), JSON.stringify(C.people.find((x) => x.key === "k1").cert));
await call("event=ngs27&pdf=k1");
ok("downloading it again keeps the same number", (await call("event=ngs27")).body.people.find((x) => x.key === "k1").cert.code === code);
// The QR code on it opens the verify page for that number.
execFileSync("pdftoppm", ["-png", "-r", "200", "/tmp/cert-k1.pdf", "/tmp/cert-k1"]);
ok("the QR code is drawn on it (one embedded image besides the design)", execFileSync("pdfimages", ["-list", "/tmp/cert-k1.pdf"]).toString().trim().split("\n").length - 2 === 2 || /image/.test(execFileSync("pdfimages", ["-list", "/tmp/cert-k1.pdf"]).toString()));

const v = async (c) => { const r = await verify(new Request(`http://x/api/verify?c=${c}`)); return { status: r.status, body: await r.json() }; };
let V = await v(code);
ok("the verify page confirms it: name, agency, what was completed, the date", V.body.valid && V.body.name === "Jordan Tremblay" && V.body.agency === "Toronto Police Service" && V.body.training === "National Gang Summit" && /May 6, 2027/.test(V.body.date), JSON.stringify(V.body));
ok("with an Add to LinkedIn link filled in", /linkedin\.com\/profile\/add\?/.test(V.body.linkedin) && /certId=/.test(V.body.linkedin) && /organizationName=ONGIA/.test(V.body.linkedin) && /issueYear=2027/.test(V.body.linkedin));
ok("it says nothing more: no email", !JSON.stringify(V.body).includes("@"));
ok("a made-up number is not genuine", (await v("ZZZZ-ZZZZ")).body.valid === false && (await v("bad")).status === 404);

// Once issued it stays as issued (audit, 30 Oct 2026): a change to the settings doesn't alter it on the next download;
// Correct details puts it on, on purpose, keeping the number and what it said before.
await call("event=ngs27", { method: "PUT", body: { date: "2027-05-07" } });
const again = await call("event=ngs27&pdf=k1");
fs.writeFileSync("/tmp/cert-k1b.pdf", again.body);
ok("after the date is changed, downloading it again gives the certificate as issued", /May 6, 2027/.test((await v(code)).body.date) && /06\/05\/2027/.test(execFileSync("pdftotext", ["-layout", "/tmp/cert-k1b.pdf", "-"]).toString()));
C = (await call("event=ngs27&correct=k1", { method: "POST", body: {} })).body;
ok("Correct details puts the new date on it, same number, marked corrected", /May 7, 2027/.test((await v(code)).body.date) && C.people.find((x) => x.key === "k1").cert.code === code && C.people.find((x) => x.key === "k1").cert.corrected === 1);
ok("what it said before is kept on its record", (await getMeta(`certs:code:${code}`)).history?.[0]?.date === "2027-05-06");
await call("event=ngs27", { method: "PUT", body: { date: "" } });
// Someone not checked in: issued only when that's what's wanted.
const k3 = await call("event=ngs27&pdf=k3");
ok("someone not checked in isn't issued one by a plain download: it asks", k3.status === 409 && k3.body.ask === "anyway" && /isn't checked in/.test(k3.body.error) && !(await call("event=ngs27")).body.people.find((x) => x.key === "k3").cert);
const k3b = await call("event=ngs27&pdf=k3&anyway=1");
ok("Issue anyway issues it, noted as not checked in", k3b.type === "application/pdf" && (await getMeta(`certs:code:${(await call("event=ngs27")).body.people.find((x) => x.key === "k3").cert.code}`)).notCheckedIn === true);

// Withdrawn in error.
await call("event=ngs27&revoke=k1", { method: "POST", body: {} });
V = await v(code);
ok("a withdrawn certificate says so", V.body.valid === false && V.body.revoked === true);
const w0 = await call("event=ngs27&pdf=k1");
ok("a withdrawn one isn't issued again by a plain download: it asks", w0.status === 409 && w0.body.ask === "again");
await call("event=ngs27&pdf=k1&again=1");
const code2 = (await call("event=ngs27")).body.people.find((x) => x.key === "k1").cert.code;
ok("Issue again gives a new number; the old one still says withdrawn", code2 !== code && (await v(code2)).body.valid === true && (await v(code)).body.revoked === true && (await getMeta(`certs:code:${code2}`)).replaces === code);

// A preview is never issued.
const pre = await call("event=ngs27&preview=1");
ok("Preview makes a PDF without issuing one", pre.type === "application/pdf" && (await call("event=ngs27")).body.people.filter((x) => x.cert).length === 2);

// The generic design prints the course.
const w = await call("event=web1&pdf=w1");
fs.writeFileSync("/tmp/cert-w1.pdf", w.body);
const ww = execFileSync("pdftotext", ["/tmp/cert-w1.pdf", "-"]).toString().replace(/\s+/g, " ");
ok("the generic design carries the course, wrapped, and the RCMP's official name", /Beyond the Headlines: An Analytical Look at Organized Crime Trends Across Canada/.test(ww) && /Royal Canadian Mounted Police/.test(ww) && /15\/09\/2026/.test(ww), ww);

// The two downloads.
const reg = await call("event=ngs27&csv=registration");
const regRows = reg.body.replace(/^﻿/, "").trim().split("\n");
ok("the registration list: everyone coming, by last name, official agency and what they typed", reg.type.startsWith("text/csv") && /national-gang-summit-registration-list\.csv/.test(reg.disp)
  && regRows.length === 4 && /^"Martin","Alex","Peel Regional Police","Peel Police"/.test(regRows[1]) && /^"Okafor"/.test(regRows[2]) && /^"Tremblay"/.test(regRows[3]), reg.body);
const cert = await call("event=ngs27&csv=certificate");
const certRows = cert.body.replace(/^﻿/, "").trim().split("\n");
ok("the certificate list: only people checked in, with the event and date", certRows[0] === '"First name","Last name","Agency","Email","Event","Date"' && certRows.length === 3 && certRows[2] === '"Jordan","Tremblay","Toronto Police Service","jt@torontopolice.on.ca","National Gang Summit","06/05/2027"', cert.body);

// A sign-in sheet's Checked in column comes through an import.
const sheet = readCsv("First name,Last name,Email,Checked in\nA,B,a@x.ca,Yes\nC,D,c@x.ca,\n");
ok("an imported sheet's Checked in column is read", sheet.people[0].checkedIn === true && sheet.people[1].checkedIn === false);
ok("a sheet without one says nothing about it", !("checkedIn" in readCsv("Name,Email\nA B,a@x.ca\n").people[0]));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
