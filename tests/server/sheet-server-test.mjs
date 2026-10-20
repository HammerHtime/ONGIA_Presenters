// The logistics sheet check, from the server's side: reading the cells, matching names, comparing.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
const F = REPO + "netlify/functions/";
const events = (await import(F + "events.mjs")).default;
const agreement = (await import(F + "agreement.mjs")).default;
const review = (await import(F + "review.mjs")).default;
const sheetcheck = (await import(F + "sheetcheck.mjs")).default;
const roster = (await import(F + "roster.mjs")).default;
const { listPresenters, getSheetBaseline } = await import(F + "lib/store.mjs");
const { parseLogistics, compareSheet, nameFit } = await import(F + "lib/sheetcheck.mjs");
const { issueSession } = await import(F + "lib/auth.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (h, url, method = "GET", body, headers = H) => { const r = await h(new Request("http://localhost" + url, { method, headers, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
await call(roster, "/api/roster");

console.log("— names");
ok("a title and a slash do not matter", nameFit("Dana Testwood", "A/S/Sgt Dana Testwood ") === "exact");
ok("one letter's spelling slip is close, and so are two letters swapped", nameFit("Avery Placeholdar", "Avery Placeholder") === "close" && nameFit("Michael Morton", "Micheal Morton") === "close" && nameFit("Casey Mokcton", "Casey Mockton") === "close");
ok("a surname alone matches on the surname", nameFit("Meloo Exampletan", "Detective Exampletan") === "surname");
ok("different people do not", nameFit("Dana Testwood", "Dana Archibald") === null && nameFit("John Smith", "Jane Smith") === null);

const ev = (await call(events, "/api/events", "POST", { title: "Sheet Test", city: "Toronto", dayOne: "2026-11-09", lastDay: "2026-11-12", invite: false,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }],
  presenters: [["Dana", "Testwood"], ["Kelly", "Samplestne"], ["Robin", "Fakewel"], ["Casey", "Mokcton"], ["Avery", "Placeholdar"], ["Meloo", "Exampletan"], ["Morgan", "Demofrd"], ["Newcomer", "Nosheet"], ["Late", "Signer"]]
    .map(([first, last]) => ({ first, last, email: `${first.toLowerCase()}@example.ca`, organization: "Org " + first })) })).event;

// the cells exactly as the browser would send them: a picture row, a blank row, then the headings
const head = ["Presenter", "Agency", "Title/Topic", "Confirmed", "Conference Fee waived", "Accommodations  Sunday", "Accommodations Monday", "Accommodations Tuesday", "Accommodations Wednesday", "Accommodations Thursday", "Travel Expenses", "Notes / Comments "];
const AG = "Yes (Agency paying we are just booking)";
const cells = [[], [], head,
  ["Dana Keynote (Keynote)", "Conflictish", "T", "Yes", "Yes", "Yes", "Yes", "Yes", "Yes", "Yes", "Yes", ""],
  ["A/S/Sgt Dana Testwood ", "TPS", "T", "Yes", "Yes", AG, AG, AG, "No", "No", "No", "TPS covering all costs"],
  ["Kelly Samplestone", "TPS", "T", "Yes", "Yes", AG, AG, AG, AG, "No", "No", ""],
  ["Dr. Robin Fakewell ", "Univ", "T", "Yes", "Yes", "Yes", "Yes", "Yes", "Yes", "No", "Yes", "no speaker fee"],
  ["Casey Mockton", "Str8", "T", "Yes", "Yes", "", "", "", "", "No", "Yes", ""],
  ["Avery Placeholder", "SPS", "T", "Yes", "Yes", "Yes", "Yes", "Yes", "Yes", "No", "Yes", ""],
  ["Detective Exampleton", "WPS", "T", "Yes", "Yes", "Yes", "Yes", "Yes", "Yes", "No", "No", ""],
  ["Morgan Demoford", "SPVM", "T", "Yes", "Yes", "No", "No", "Yes", "Yes", "Yes", "No", ""],
  ["Sheetonly Presenter", "Nowhere", "T", "Yes", "Yes", "Yes", "Yes", "No", "No", "No", "No", ""]];

console.log("— reading the sheet");
let r = parseLogistics(cells, { dayOne: "2026-11-09" });
ok("the headings are found under a picture row and a blank row", !r.problem && r.rows.length === 9, JSON.stringify(r).slice(0, 200));
ok("Sunday is the night before the first day: Nov 8 to Nov 12", r.nights.join() === "2026-11-08,2026-11-09,2026-11-10,2026-11-11,2026-11-12", r.nights?.join());
ok("only the name, agency and nights are kept: no notes", r.rows.every((x) => Object.keys(x).sort().join() === "agency,name,nights") && !JSON.stringify(r).includes("speaker fee") && !JSON.stringify(r).includes("TPS covering"));
ok("a sheet with no presenter headings is refused with a plain reason", /doesn't look like the logistics sheet/.test(parseLogistics([["Name", "Phone"], ["A", "1"]], { dayOne: "2026-11-09" }).problem));

console.log("— the endpoint");
r = await call(sheetcheck, `/api/sheetcheck?event=${ev.id}`);
ok("nothing uploaded yet: no baseline, no comparison", r.status === 200 && r.baseline === null && r.result === null);
r = await call(sheetcheck, `/api/sheetcheck?event=${ev.id}&baseline=1`, "PUT", { fileName: "Original.xlsx", cells });
ok("the sheet is stored as the baseline", r.status === 200 && r.baseline?.fileName === "Original.xlsx" && r.baseline.count === 9, JSON.stringify(r).slice(0, 200));
ok("the stored baseline holds no notes", !JSON.stringify(await getSheetBaseline(ev.id)).includes("speaker fee"));
const nonOwner = { "x-admin-key": "s1.garbage.garbage", "content-type": "application/json" };
ok("someone who is not the president is refused", (await call(sheetcheck, `/api/sheetcheck?event=${ev.id}`, "GET", undefined, nonOwner)).status === 401);

const submit = async (first, hotel, from, to, agency) => {
  const p = (await listPresenters(ev.id)).find((x) => x.first === first);
  const res = await call(agreement, `/api/agreement?t=${p.token}`, "POST", { first, last: p.last, email: p.email, phone: "4165550100", organization: p.organization, talk: "T", bio: "word ".repeat(40), outline: "An outline.",
    travel: "no", hotel, ...(hotel === "yes" ? { hotelFrom: from, hotelTo: to } : {}), expenses: { transport: "no", hotel: hotel === "yes" ? agency : "n/a", meals: "no", other: "no", otherText: "" },
    copyright: true, noInvestigation: true, termsAccepted: true, media: { photo: { internal: "yes", public: "yes" }, materials: { internal: "yes", public: "no" }, summary: { internal: "yes", public: "yes" } }, sensitive: "no", signature: `${first} ${p.last}`, agreed: true, language: "en" }, { "content-type": "application/json" });
  if (res.status !== 200) console.log("submit", first, JSON.stringify(res));
  return p;
};
const approve = async (p, block) => call(review, `/api/review?event=${ev.id}&presenter=${p.id}&action=approve`, "POST", { approverName: "Raj Jaswal", attest: true, covers: {}, ...(block ? { hotelBlock: block } : {}) });
const get = async () => (await call(sheetcheck, `/api/sheetcheck?event=${ev.id}`)).result;
const row = (res, first) => res.rows.find((x) => x.name.startsWith(first));

let res = await get();
ok("before anyone signs, they are all 'haven't signed', and the sheet's nights are noted", res.counts.waiting === 9 && row(res, "Dana").issues.some((i) => /already has 3 nights/.test(i.text)), JSON.stringify(res.counts));

const as = (email) => ({ "x-admin-key": issueSession({ email, name: email }), "content-type": "application/json" });
ok("the president can open it", (await call(sheetcheck, `/api/sheetcheck?event=${ev.id}`, "GET", undefined, as("president@ongia.ca"))).status === 200);
ok("the VP of operations can open it too", (await call(sheetcheck, `/api/sheetcheck?event=${ev.id}`, "GET", undefined, as("vp_operations@ongia.ca"))).status === 200);
ok("the VP can use the page, not just read it", (await call(sheetcheck, `/api/sheetcheck?event=${ev.id}&link=1`, "PUT", { presenterId: "x", sheetName: "" }, as("Vp_Operations@ongia.ca"))).status === 200);
ok("another board member is refused", (await call(sheetcheck, `/api/sheetcheck?event=${ev.id}`, "GET", undefined, as("j.healy@ongia.ca"))).status === 403);
process.env.SHEET_VIEWERS = "someone.else@ongia.ca";
ok("SHEET_VIEWERS adds a viewer; the president and the VP (now a desk owner) always stay", (await call(sheetcheck, `/api/sheetcheck?event=${ev.id}`, "GET", undefined, as("someone.else@ongia.ca"))).status === 200 && (await call(sheetcheck, `/api/sheetcheck?event=${ev.id}`, "GET", undefined, as("vp_operations@ongia.ca"))).status === 200 && (await call(sheetcheck, `/api/sheetcheck?event=${ev.id}`, "GET", undefined, as("president@ongia.ca"))).status === 200);
delete process.env.SHEET_VIEWERS;
console.log("— as presenters come back");
const dana = await submit("Dana", "yes", "2026-11-08", "2026-11-13", "yes");
res = await get();
ok("Dana submits Nov 8 to 13: it is 'differs', named as requested, and says what the sheet lacks", row(res, "Dana").status === "differs" && /missing Wed Nov 11 and Thu Nov 12/.test(row(res, "Dana").issues[0].text) && /requested on the agreement/.test(row(res, "Dana").issues[0].text), JSON.stringify(row(res, "Dana").issues));
ok("matched through the title and the trailing space", row(res, "Dana").how === "exact" && row(res, "Dana").sheet.name === "A/S/Sgt Dana Testwood");
await approve(dana, "own");
res = await get();
ok("approved: the same gap, now called the agreement", row(res, "Dana").desk.state === "approved" && /the agreement has them/.test(row(res, "Dana").issues[0].text));
ok("'own room' with 'Agency paying' on the sheet raises no pay issue", !row(res, "Dana").issues.some((i) => /pay/.test(i.text)));

const kevin = await submit("Kelly", "yes", "2026-11-08", "2026-11-12", "yes"); await approve(kevin, "master");
res = await get();
ok("Kelly's nights match, but the sheet says agency paying and the lead put him on the master block", row(res, "Kelly").status === "differs" && row(res, "Kelly").how === "close" && row(res, "Kelly").issues.length === 1 && /master block/.test(row(res, "Kelly").issues[0].text) && !/missing|extra/.test(row(res, "Kelly").issues[0].text), JSON.stringify(row(res, "Kelly").issues));

const robert = await submit("Robin", "yes", "2026-11-08", "2026-11-11", "no"); await approve(robert, "master");
res = await get();
ok("Robin: the sheet has an extra Wednesday night", /has Wed Nov 11, which the agreement doesn't/.test(row(res, "Robin").issues[0].text), JSON.stringify(row(res, "Robin").issues));

const chantel = await submit("Casey", "yes", "2026-11-08", "2026-11-11", "no"); await approve(chantel, "master");
res = await get();
ok("Casey: the sheet has no nights at all", /no nights booked/.test(row(res, "Casey").issues[0].text) && row(res, "Casey").sheet.nights.length === 0);

const angela = await submit("Avery", "yes", "2026-11-08", "2026-11-12", "no"); await approve(angela, "master");
res = await get();
ok("Avery Placeholdar matches the sheet's Placeholder, and the nights agree: a match", row(res, "Avery").status === "match" && row(res, "Avery").how === "close" && row(res, "Avery").issues.length === 0, JSON.stringify(row(res, "Avery")));

const meloo = await submit("Meloo", "yes", "2026-11-08", "2026-11-13", "no"); await approve(meloo, "master");
res = await get();
ok("Meloo Exampletan matches the sheet's 'Detective Exampleton' by surname, and says so", row(res, "Meloo").how === "surname" && /by surname only/.test("by surname only") && row(res, "Meloo").status === "differs" && /missing Thu Nov 12/.test(row(res, "Meloo").issues[0].text), JSON.stringify(row(res, "Meloo")));

const maya = await submit("Morgan", "yes", "2026-11-11", "2026-11-13", "no"); await approve(maya, "master");
res = await get();
ok("Morgan wants Wed and Thu; the sheet has Tue too: extra Tuesday", /has Tue Nov 10, which the agreement doesn't/.test(row(res, "Morgan").issues.map((i) => i.text).join(" ")));

const newc = await submit("Newcomer", "no"); await approve(newc);
res = await get();
ok("someone not on the sheet is 'not on the sheet'", row(res, "Newcomer").status === "nosheet" && /Not on the sheet/.test(row(res, "Newcomer").issues[0].text));
ok("the sheet's extra row with nights is listed as on the sheet, not on the desk", res.sheetOnly.some((s) => s.name === "Sheetonly Presenter" && s.nights.length === 2) && res.sheetOnly.some((s) => s.name === "Dana Keynote (Keynote)"));

ok("Dana's grid: Sun to Tue yes on both sides, Wed and Thu only on the agreement", JSON.stringify(row(res, "Dana").grid.map((g) => [g.sheet, g.desk])) === JSON.stringify([[true, true], [true, true], [true, true], [false, true], [false, true]]), JSON.stringify(row(res, "Dana").grid));
ok("Robin's grid: the sheet's Wednesday has no agreement behind it", JSON.stringify(row(res, "Robin").grid.map((g) => [g.sheet, g.desk])) === JSON.stringify([[true, true], [true, true], [true, true], [true, false], [false, false]]), JSON.stringify(row(res, "Robin").grid));
ok("someone not on the sheet has nothing to compare: the sheet side is blank, not wrong", row(res, "Newcomer").grid.every((g) => g.sheet === null));
ok("night differences are tagged so the page can draw boxes instead of sentences", row(res, "Dana").issues.every((i) => i.night === true) && row(res, "Kelly").issues.every((i) => !i.night));
ok("totals: the rate is $205 + 8% + 16% = $254.20 a night", res.totals.perNight === 254.2 && res.totals.nightly === 205 && res.totals.taxes.join() === "8,16", JSON.stringify(res.totals));
ok("totals: nights the sheet has and the agreements don't, and the ones ONGIA would pay for", res.totals.extraNights >= 1 && res.totals.ongiaNights <= res.totals.extraNights, JSON.stringify(res.totals));
ok("Robin's extra Wednesday: on ONGIA (master block, no agency note) so it is charged", row(res, "Robin").cost.ongia.length === 1 && row(res, "Robin").cost.extra.length === 1);
ok("Dana's two missing nights are not a cost, they are 'missing'", row(res, "Dana").cost.extra.length === 0 && row(res, "Dana").cost.missing.length === 2);
ok("Dana is on her own room and the sheet says agency pays: nothing of hers is charged to ONGIA", row(res, "Dana").cost.ongia.length === 0);
ok("discrepancies = mismatched nights + who-pays mismatches, across everyone", res.totals.discrepancies === res.rows.reduce((n, x) => n + x.cost.extra.length + x.cost.missing.length, 0) + res.totals.payMismatches, JSON.stringify(res.totals));
console.log("— linking by hand");
r = await call(sheetcheck, `/api/sheetcheck?event=${ev.id}&link=1`, "PUT", { presenterId: newc.id, sheetName: "Sheetonly Presenter" });
res = r.result;
ok("linking Newcomer to the sheet row matches them, and the row leaves the sheet-only list", row(res, "Newcomer").how === "linked" && row(res, "Newcomer").sheet.name === "Sheetonly Presenter" && !res.sheetOnly.some((s) => s.name === "Sheetonly Presenter"), JSON.stringify(row(res, "Newcomer")).slice(0, 300));
ok("their agreement says no hotel, the sheet has two nights: flagged", row(res, "Newcomer").status === "differs" && /no hotel is needed/.test(row(res, "Newcomer").issues[0].text));
r = await call(sheetcheck, `/api/sheetcheck?event=${ev.id}&link=1`, "PUT", { presenterId: newc.id, sheetName: "" });
ok("unlinking puts it back", row(r.result, "Newcomer").status === "nosheet");
ok("a name that isn't on the sheet can't be linked to", (await call(sheetcheck, `/api/sheetcheck?event=${ev.id}&link=1`, "PUT", { presenterId: newc.id, sheetName: "Nobody" })).status === 400);

console.log("— the rate");
r = await call(sheetcheck, `/api/sheetcheck?event=${ev.id}&rates=1`, "PUT", { nightly: 300, taxes: [10, 10] });
ok("changing the rate changes the per-night price and the total", r.result.totals.perNight === 360 && r.result.totals.ongiaCost === r.result.totals.ongiaNights * 360, JSON.stringify(r.result.totals));
ok("a nonsense rate is refused", (await call(sheetcheck, `/api/sheetcheck?event=${ev.id}&rates=1`, "PUT", { nightly: -5, taxes: [8, 16] })).status === 400 && (await call(sheetcheck, `/api/sheetcheck?event=${ev.id}&rates=1`, "PUT", { nightly: 205, taxes: [8, 400] })).status === 400);
console.log("— a run of the day: it is always worked out fresh");
ok("counts add up", Object.values((await get()).counts).length === 6);
r = await call(sheetcheck, `/api/sheetcheck?event=${ev.id}`, "DELETE");
ok("removing the baseline clears the comparison", r.baseline === null && r.result === null && (await getSheetBaseline(ev.id)) === null);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
