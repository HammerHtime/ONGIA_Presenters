// An RBH event's presenter agreement: accommodation only, no flights or other travel.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
delete process.env.RESEND_API_KEY; delete process.env.MS_MAIL_FROM;
const F = REPO + "netlify/functions/";
const events = (await import(F + "events.mjs")).default;
const agreement = (await import(F + "agreement.mjs")).default;
const review = (await import(F + "review.mjs")).default;
const roster = (await import(F + "roster.mjs")).default;
const { listPresenters, getEvent } = await import(F + "lib/store.mjs");
const { buildAgreementPdf } = await import(F + "lib/pdf.mjs");
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const pdfText = (buf) => { const d = mkdtempSync(path.join(tmpdir(), "pdf-")); writeFileSync(path.join(d, "x.pdf"), buf); return execFileSync("pdftotext", ["-layout", path.join(d, "x.pdf"), "-"]).toString(); };
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (h, url, method = "GET", body, headers = H) => { const r = await h(new Request("http://localhost" + url, { method, headers, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
await call(roster, "/api/roster");
const mk = async (kind, title) => (await call(events, "/api/events", "POST", { title, city: "Montreal", dayOne: "2026-09-28", lastDay: "2026-10-02", invite: false, kind, province: "QC",
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }], presenters: [{ first: "Ann", last: "Presenter", email: `ann.${kind || "own"}@example.ca`, organization: "Org" }] })).event;
const rbh = await mk("rbh", "ITP RBH"), own = await mk("", "ONGIA Own");
const pOf = async (ev) => (await listPresenters(ev.id))[0];
const base = { phone: "4165550100", talk: "T", bio: "word ".repeat(40), outline: "An outline.", copyright: true, noInvestigation: true, termsAccepted: true,
  media: { photo: { internal: "yes", public: "yes" }, materials: { internal: "yes", public: "no" }, summary: { internal: "yes", public: "yes" } }, sensitive: "no", agreed: true, language: "en", first: "Ann", last: "Presenter", organization: "Org", signature: "Ann Presenter" };
const form = async (ev) => (await call(agreement, `/api/agreement?t=${(await pOf(ev)).token}`, "GET", undefined, {}));
ok("the form tells an RBH event's presenter there is no travel to ask about", (await form(rbh)).event.noTravel === true);
ok("an ordinary event's form still asks", (await form(own)).event.noTravel === false);
const submit = async (ev, extra) => { const p = await pOf(ev); return call(agreement, `/api/agreement?t=${p.token}`, "POST", { ...base, email: p.email, ...extra }, { "content-type": "application/json" }); };

console.log("— the form submits without any travel answers");
let r = await submit(rbh, { hotel: "yes", hotelFrom: "2026-09-27", hotelTo: "2026-10-02", expenses: { hotel: "no", meals: "no", other: "no", otherText: "" } });
ok("accepted with no travel and no transportation answer", r.status === 200 && !r.error, JSON.stringify(r));
let s = (await pOf(rbh)).submission;
ok("kept as no travel, no dates, transportation not applicable", s.travel === "no" && s.travelFrom === "" && s.expenses.transport === "n/a", JSON.stringify([s.travel, s.expenses]));
ok("the hotel answers are kept", s.hotel === "yes" && s.hotelFrom === "2026-09-27" && s.expenses.hotel === "no");
console.log("— a travel request sent anyway is set aside");
r = await submit(rbh, { travel: "yes", travelFrom: "2026-09-27", travelTo: "2026-10-02", hotel: "no", expenses: { transport: "yes", hotel: "n/a", meals: "no", other: "no", otherText: "" } });
s = (await pOf(rbh)).submission;
ok("travel is still 'no', with no dates, and transportation not applicable", r.status === 200 && s.travel === "no" && s.travelFrom === "" && s.travelTo === "" && s.expenses.transport === "n/a", JSON.stringify([r, s.travel]));
console.log("— an ordinary event is unchanged");
r = await submit(own, { hotel: "no", expenses: { hotel: "n/a", meals: "no", other: "no", otherText: "" } });
ok("still asks whether travel is needed", r.status >= 400 && /travel/i.test(JSON.stringify(r)), JSON.stringify(r));
r = await submit(own, { travel: "no", hotel: "no", expenses: { hotel: "n/a", meals: "no", other: "no", otherText: "" } });
ok("and whether the agency covers transportation", r.status >= 400 && /transportation/i.test(JSON.stringify(r)), JSON.stringify(r));
r = await submit(own, { travel: "yes", travelFrom: "2026-09-27", travelTo: "2026-10-02", hotel: "no", expenses: { transport: "yes", hotel: "n/a", meals: "no", other: "no", otherText: "" } });
ok("and takes travel dates", r.status === 200 && (await pOf(own)).submission.travel === "yes" && (await pOf(own)).submission.travelFrom === "2026-09-27", JSON.stringify(r));

console.log("— the board's review");
const approve = async (ev, body) => { const p = await pOf(ev); return call(review, `/api/review?event=${ev.id}&presenter=${p.id}&action=approve`, "POST", { approverName: "Raj Jaswal", attest: true, ...body }); };
const shown = await call(review, `/api/review?event=${rbh.id}&presenter=${(await pOf(rbh)).id}`);
ok("the review screen is told there is no travel", shown.event.noTravel === true);
r = await approve(rbh, { covers: { transport: true, meals: false }, hotelBlock: undefined });
ok("approved; ONGIA covering transportation is refused silently (not covered on an RBH event)", r.ok === true && (await pOf(rbh)).review.ongiaCovers.transport === false, JSON.stringify(r));
r = await approve(own, { covers: { transport: true } });
ok("an ordinary event still lets the board cover transportation", r.ok === true && (await pOf(own)).review.ongiaCovers.transport === true, JSON.stringify(r));

console.log("— the signed PDF");
const pdf = async (ev) => pdfText(await buildAgreementPdf({ event: await getEvent(ev.id), presenter: await pOf(ev), approval: { name: "Raj Jaswal", role: "", at: new Date().toISOString() } }));
let t = await pdf(rbh);
ok("an RBH agreement has no travel line and no transportation row", !/require travel/i.test(t) && !/Transportation/i.test(t), t.slice(t.indexOf("PROJECTED") - 400, t.indexOf("PROJECTED") + 300));
ok("it still has the accommodation, meals and other rows", /Hotels\/Accommodations|Accommodations/.test(t) && /Meals/.test(t));
t = await pdf(own);
ok("an ordinary agreement keeps both", /require travel/i.test(t) && /Transportation/i.test(t));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
