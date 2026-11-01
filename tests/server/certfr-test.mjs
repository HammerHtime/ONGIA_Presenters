// French certificates (Andrew 31 Oct 2026): the two built-in designs in French, the agency under its French name,
// given by the French button in the certificate email and by "Download in French" on the desk. A design with no
// French version stays English, and is named so.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY = "testkey";
process.env.APP_URL = "https://events.ongia.org";
const F = REPO + "netlify/functions/";
const { putEvent, putAttendees, putMeta } = await import(F + "lib/store.mjs");
const certificates = (await import(F + "certificates.mjs")).default;
const certfile = (await import(F + "certfile.mjs")).default;
const { certificatePdf, certIndex, certRecord } = await import(F + "lib/certs.mjs");
const { execFileSync } = await import("node:child_process");
const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const call = async (qs) => {
  const r = await certificates(new Request(`http://x/api/certificates?${qs}`, { headers: { "x-admin-key": "testkey" } }));
  const type = r.headers.get("content-type") ?? "";
  return { status: r.status, disp: r.headers.get("content-disposition") ?? "", body: type.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) };
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "certfr-"));
const read = (bytes) => { const f = path.join(dir, `c${Math.random().toString(36).slice(2)}.pdf`); fs.writeFileSync(f, bytes);
  return { text: execFileSync("pdftotext", [f, "-"]).toString(), info: execFileSync("pdfinfo", [f]).toString() }; };

await putEvent({ id: "ngsfr", title: "National Gang Summit", city: "Toronto", dayOne: "2027-05-04", lastDay: "2027-05-06", board: [] });
await putEvent({ id: "webfr", title: "Organized Crime Trends", city: "Online", dayOne: "2026-09-15", board: [] });
const p = (key, first, last, organization, email) => ({ key, first, last, organization, email, status: "ATTENDING", source: "wix", checkedIn: true });
await putAttendees("ngsfr", { people: [p("f1", "Camille", "Gagnon", "RCMP E Division", "cg@rcmp-grc.gc.ca")] });
await putAttendees("webfr", { people: [p("g1", "Jordan", "Roy", "CBSA", "jr@cbsa-asfc.gc.ca")] });

// The desk download, English then French.
const en = await call("event=ngsfr&pdf=f1");
const fr = await call("event=ngsfr&pdf=f1&lang=fr");
const E = read(en.body), R = read(fr.body);
ok("English by default: the English title and file name", /Certificate of Completion: Camille Gagnon/.test(E.info) && /certificate\.pdf/.test(en.disp), en.disp);
ok("French: the French title and file name", /Certificat de r.ussite : Camille Gagnon/.test(R.info) && /certificat\.pdf/.test(fr.disp), fr.disp);
ok("the agency under its French name in French, its English name in English", /Gendarmerie royale du Canada/.test(R.text) && /Royal Canadian Mounted Police/.test(E.text) && !/Royal Canadian Mounted Police/.test(R.text), R.text);
ok("the QR code's label is in French", /Balayer pour v.rifier/.test(R.text) && /Scan to verify/.test(E.text));
ok("it is the same person on both", /Camille Gagnon/.test(R.text) && /Camille Gagnon/.test(E.text));

// The list tells the desk a French version exists (the "Download in French" item).
const C = (await call("event=ngsfr")).body;
ok("the person's certificate says it comes in French", C.people.find((x) => x.key === "f1")?.cert?.french === true, JSON.stringify(C.people[0]?.cert));

// The generic design in French too.
const g = read((await call("event=webfr&pdf=g1&lang=fr")).body);
ok("the generic design in French, agency in French", /Certificat de r.ussite/.test(g.info) && /Agence des services frontaliers du Canada/.test(g.text), g.text);

// An uploaded design has no French version: it stays English and is named in English.
await putMeta("certs:designs", [{ id: "up1", name: "Designer's own", scope: "any", w: 612, h: 792, fields: { name: { x: 40, y: 300, w: 400, h: 40, size: 24, font: "b" } } }]);
const rec = { code: "TEST-0001", name: "Pat Doe", agency: "Royal Canadian Mounted Police", date: "2027-05-06", template: "up1" };
let threw = "";
try { await certificatePdf(rec, { lang: "fr" }); } catch (e) { threw = e.message; }
ok("an uploaded design without French is not drawn on the French artwork (it asks for its own picture)", /lost its picture/.test(threw), threw);

// The email's French button: certfile with lang=fr gives the French certificate.
const code = (await certIndex("ngsfr")).f1;
const r0 = await certRecord(code);
await putMeta(`certs:code:${code}`, { ...r0, dl: "tok123" });
const res = await certfile(new Request(`https://events.ongia.org/api/certfile?c=${code}&d=tok123&lang=fr`));
const disp = res.headers.get("content-disposition") ?? "";
const viaLink = read(Buffer.from(await res.arrayBuffer()));
ok("the French button in the email downloads the French certificate", res.status === 200 && /certificat\.pdf/.test(disp) && /Certificat de r.ussite/.test(viaLink.info), `${res.status} ${disp}`);
const resEn = await certfile(new Request(`https://events.ongia.org/api/certfile?c=${code}&d=tok123`));
ok("and the English button the English one", /certificate\.pdf/.test(resEn.headers.get("content-disposition") ?? ""));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
