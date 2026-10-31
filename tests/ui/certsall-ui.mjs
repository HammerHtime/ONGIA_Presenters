// Issue & download all (audit, 30 Oct 2026, from the mock-up Andrew picked): on Survey & certificates, one button issues a
// certificate to everyone checked in who doesn't have one yet, then downloads every certificate in use as one ZIP. Someone
// not checked in, or whose certificate was withdrawn, is left out; one issued earlier keeps its number.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
process.env.ADMIN_KEY = "testkey";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const { readZip } = await import(REPO + "netlify/functions/lib/zip.mjs");
const fs = await import("node:fs");
const { execFileSync } = await import("node:child_process");
const D = new URL(".", import.meta.url).pathname;
const S = "http://127.0.0.1:8788", H = { "x-admin-key": "testkey", "content-type": "application/json" };
const api = async (p, i = {}) => (await fetch(S + p, { ...i, headers: { ...H, ...(i.headers ?? {}) } })).json();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
await api("/api/roster");
const T = Date.now().toString(36);
const ev = (await api("/api/events", { method: "POST", body: JSON.stringify({ title: `Prairie Gang Forum ${T}`, city: "Regina, SK", dayOne: "2031-06-02", lastDay: "2031-06-03", invite: false, presenters: [],
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }] }) })).event;
// Five checked in (two of them both called Casey Lee), one not.
await fetch(`${S}/api/attendees?event=${ev.id}&csv=1`, { method: "POST", headers: { "x-admin-key": "testkey", "content-type": "text/csv" },
  body: `First name,Last name,Email,Organization,Checked in\nJordan,Tremblay,jt.${T}@torontopolice.on.ca,TPS,Yes\nSam,Okafor,so.${T}@opp.ca,OPP,Yes\nCasey,Lee,cl1.${T}@rcmp.ca,RCMP,Yes\nCasey,Lee,cl2.${T}@peelpolice.ca,Peel Police,Yes\nRiley,Gagnon,rg.${T}@sq.qc.ca,SQ,Yes\nAlex,Martin,am.${T}@peelpolice.ca,Peel Police,\n` });
// Jordan's was issued earlier; Riley's was issued and then withdrawn.
const C0 = await api(`/api/certificates?event=${ev.id}`);
const key = (n) => C0.people.find((p) => p.name === n).key;
await fetch(`${S}/api/certificates?event=${ev.id}&pdf=${encodeURIComponent(key("Jordan Tremblay"))}`, { headers: H });
await fetch(`${S}/api/certificates?event=${ev.id}&pdf=${encodeURIComponent(key("Riley Gagnon"))}`, { headers: H });
await api(`/api/certificates?event=${ev.id}&revoke=${encodeURIComponent(key("Riley Gagnon"))}`, { method: "POST", body: "{}" });
const jordanCode = (await api(`/api/certificates?event=${ev.id}`)).people.find((p) => p.name === "Jordan Tremblay").cert.code;

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, tag] of [[1440, 1000, "wide"], [390, 844, "phone"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, acceptDownloads: true });
  await p.addInitScript(([t, x]) => { try { sessionStorage.setItem("ongia-admin-key", t); sessionStorage.setItem("ongia-desk-who", JSON.stringify(x)); } catch {} }, [issueSession({ email: "treasurer@ongia.ca", name: "Raj Jaswal" }), { email: "treasurer@ongia.ca", name: "Raj Jaswal" }]);
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(`${S}/admin.html#v=` + encodeURIComponent(JSON.stringify({ name: "event", eventId: ev.id, tab: "survey", svw: "certs" })), { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  ok(`${tag}: the address opens straight on Certificates`, await p.locator("#certsfold").isVisible() && await p.locator('[data-svgo="certs"]').getAttribute("aria-selected") === "true" && !(await p.locator("#svhead").isVisible()));
  if (tag === "wide") {
    const tiles = await p.locator(".certtiles").innerText();
    ok("the counts: 5 checked in, 1 issued, 3 to go, 1 withdrawn", /5\s*Checked in\s*1\s*Issued\s*3\s*Checked in, not issued yet\s*1\s*Withdrawn/i.test(tiles), tiles);
    await p.locator("#certsfold").screenshot({ path: D + "certsall-wide.png" });
    let asked = "";
    p.once("dialog", (d) => { asked = d.message(); d.accept(); });
    const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 60000 }), p.locator("#cert-all").click()]);
    ok("it asks first, saying how many it will issue", /Issue certificates to the 3 people checked in who don't have one yet/.test(asked), asked);
    ok("the ZIP is named for the event", dl.suggestedFilename() === `prairie-gang-forum-${T}-certificates.zip`, dl.suggestedFilename());
    const files = readZip(fs.readFileSync(await dl.path()));
    const names = files.map((f) => f.name).sort();
    ok("it holds the four certificates in use: both Casey Lees, Jordan and Sam; not Alex (not checked in) or Riley (withdrawn)", names.length === 4 && names.filter((n) => /^Casey Lee/.test(n)).length === 2 && names.includes("Jordan Tremblay - certificate.pdf") && names.includes("Sam Okafor - certificate.pdf"), JSON.stringify(names));
    const jordan = files.find((f) => f.name === "Jordan Tremblay - certificate.pdf");
    fs.writeFileSync("/tmp/certsall-jordan.pdf", jordan.data);
    const words = execFileSync("pdftotext", ["-layout", "/tmp/certsall-jordan.pdf", "-"]).toString();
    ok("each file is a real certificate: Jordan's, with the official agency", /Jordan Tremblay/.test(words) && /Toronto Police Service/.test(words), words.slice(0, 200));
    await p.waitForTimeout(1200);
    ok("afterwards: 5 checked in, 4 issued, none to go, and it says what's in the ZIP", /5\s*Checked in\s*4\s*Issued\s*0\s*Checked in, not issued yet\s*1\s*Withdrawn/i.test(await p.locator(".certtiles").innerText()) && /4 certificates in the ZIP/.test(await p.locator("#cert-said").innerText()), await p.locator(".certtiles").innerText() + " / " + await p.locator("#cert-said").innerText());
    const after = await api(`/api/certificates?event=${ev.id}`);
    const by = (n) => after.people.filter((x) => x.name === n);
    ok("Jordan keeps the number issued earlier; Riley stays withdrawn; Alex has none", by("Jordan Tremblay")[0].cert.code === jordanCode && by("Riley Gagnon")[0].cert.revoked && !by("Alex Martin")[0].cert);
    ok("the two Casey Lees have their own numbers", by("Casey Lee").length === 2 && by("Casey Lee")[0].cert.code !== by("Casey Lee")[1].cert.code);
    // Pressing it again issues nothing new and doesn't ask.
    let askedAgain = false;
    p.once("dialog", (d) => { askedAgain = true; d.accept(); });
    const [dl2] = await Promise.all([p.waitForEvent("download", { timeout: 60000 }), p.locator("#cert-all").click()]);
    ok("again: no question, the same four", !askedAgain && readZip(fs.readFileSync(await dl2.path())).length === 4);
    await p.waitForTimeout(800);
  } else {
    await p.locator("#certsfold").screenshot({ path: D + "certsall-phone.png" });
    ok("phone: the ZIP button fills the width", (await p.locator("#cert-all").boundingBox()).width > 300);
  }
  ok(`${tag}: no sideways scroll, no errors`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth) && !errs.length, errs.join(" | "));
  await p.close();
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
