// Master block or own room: chosen when the lead approves, and the hotel's list says so.
const REPO = new URL("../../", import.meta.url).pathname;   // the repository root
delete process.env.RESEND_API_KEY; delete process.env.MS_MAIL_FROM;
const F = REPO + "netlify/functions/";
const events = (await import(F + "events.mjs")).default;
const agreement = (await import(F + "agreement.mjs")).default;
const review = (await import(F + "review.mjs")).default;
const roster = (await import(F + "roster.mjs")).default;
const rooming = (await import(F + "rooming.mjs")).default;
const { listPresenters, getEvent } = await import(F + "lib/store.mjs");
const { roomingRows, roomingMail, roomingCsv, billingWords } = await import(F + "lib/rooming.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };
const H = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (h, url, method = "GET", body, headers = H) => { const r = await h(new Request("http://localhost" + url, { method, headers, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
await call(roster, "/api/roster");
const ev = (await call(events, "/api/events", "POST", { title: "Block Test", city: "Toronto", dayOne: "2026-11-09", lastDay: "2026-11-12", invite: false,
  board: [{ name: "Raj Jaswal", email: "treasurer@ongia.ca", lead: true }],
  presenters: [["Ann", "Master"], ["Bob", "Agency"], ["Cy", "Owner"], ["Di", "NoRoom"]].map(([first, last]) => ({ first, last, email: `${first.toLowerCase()}@example.ca`, organization: "Org " + first })) })).event;
const base = { phone: "4165550100", talk: "T", bio: "word ".repeat(40), outline: "An outline.", travel: "no", copyright: true, noInvestigation: true, termsAccepted: true,
  media: { photo: { internal: "yes", public: "yes" }, materials: { internal: "yes", public: "no" }, summary: { internal: "yes", public: "yes" } }, sensitive: "no", agreed: true, language: "en" };
const list = await listPresenters(ev.id);
const by = (first) => list.find((p) => p.first === first);
const plan = { Ann: { hotel: "yes", agency: "no" }, Bob: { hotel: "yes", agency: "yes" }, Cy: { hotel: "yes", agency: "no" }, Di: { hotel: "no", agency: "no" } };
for (const [first, x] of Object.entries(plan)) {
  const p = by(first);
  const r = await call(agreement, `/api/agreement?t=${p.token}`, "POST", { ...base, first, last: p.last, email: p.email, organization: p.organization, signature: `${first} ${p.last}`,
    hotel: x.hotel, ...(x.hotel === "yes" ? { hotelFrom: "2026-11-08", hotelTo: "2026-11-13" } : {}),
    expenses: { transport: "no", hotel: x.agency, meals: "no", other: "no", otherText: "" } }, { "content-type": "application/json" });
  if (r.status !== 200) console.log("submit", first, JSON.stringify(r));
}
const approve = (first, body) => call(review, `/api/review?event=${ev.id}&presenter=${by(first).id}&action=approve`, "POST", { approverName: "Raj Jaswal", attest: true, covers: {}, ...body });

console.log("— the choice is required");
let r = await approve("Ann", {});
ok("approving a presenter who wants a room with no choice is refused, with the reason", r.status >= 400 && /master block/.test(r.error ?? ""), JSON.stringify(r));
r = await approve("Ann", { hotelBlock: "maybe" });
ok("an unknown answer is refused too", r.status >= 400, JSON.stringify(r));
ok("nothing was approved by the refusals", (await listPresenters(ev.id)).every((p) => p.status !== "approved"));
r = await approve("Ann", { hotelBlock: "master" }); ok("Ann: master block, approved", r.ok === true, JSON.stringify(r));
r = await approve("Bob", { hotelBlock: "own" }); ok("Bob: own room, approved", r.ok === true, JSON.stringify(r));
r = await approve("Cy", { hotelBlock: "own", covers: { hotel: true } }); ok("Cy: own room wins over a stray tick, approved", r.ok === true, JSON.stringify(r));
r = await approve("Di", {}); ok("Di needs no room, so no choice is asked", r.ok === true, JSON.stringify(r));

console.log("— what is kept");
const ps = await listPresenters(ev.id);
const rv = (f) => ps.find((p) => p.first === f).review;
ok("Ann's choice is kept and ONGIA covers the hotel", rv("Ann").hotel.block === "master" && rv("Ann").ongiaCovers.hotel === true);
ok("Bob's and Cy's is kept and ONGIA does not cover the hotel, even where a tick said so", rv("Bob").hotel.block === "own" && rv("Bob").ongiaCovers.hotel === false && rv("Cy").ongiaCovers.hotel === false);
ok("Di has no hotel, so nothing is kept for one", rv("Di").hotel == null);

console.log("— the rooming list");
const e2 = await getEvent(ev.id);
const { rows } = roomingRows(e2, ps, [], [], []);
const row = (n) => rows.find((x) => x.name.startsWith(n));
ok("three rooms: Di has none", rows.length === 3);
ok("Ann is on the master block", row("Ann").billing === "ONGIA");
ok("Bob and Cy are not on the master block", row("Bob").billing === "Guest" && row("Cy").billing === "Guest");
ok("the words are the person's name and 'pays', and never mention an agency", billingWords("Guest", row("Cy")) === "Cy Owner pays" && billingWords("Guest", row("Bob")) === "Bob Agency pays" && billingWords("ONGIA") === "ONGIA master account");

console.log("— the hotel's email and spreadsheet");
const mail = roomingMail({ event: e2, rows });
const iM2 = mail.html.search(/Master block, ONGIA pays/), iO = mail.html.search(/Not on the master block/);
ok("two headed groups, the master block first", iM2 > -1 && iO > iM2, `${iM2} ${iO}`);
ok("Ann is under the master heading, Bob and Cy under the other", mail.html.indexOf("Ann Master") > iM2 && mail.html.indexOf("Ann Master") < iO && mail.html.indexOf("Bob Agency") > iO && mail.html.indexOf("Cy Owner") > iO);
ok("a note says only the master block is billed to ONGIA", /only the rooms on the master block are billed to ONGIA/.test(mail.html));
ok("each guest off the block has their own line, 'Bob Agency pays', and the hotel never hears of an agency", /Bob Agency pays/.test(mail.html) && /Cy Owner pays/.test(mail.html) && !/agenc/i.test(mail.html.replace(/Bob Agency/g, "")) && !/agenc/i.test(mail.text.replace(/Bob Agency/g, "")));
ok("the plain-text version is grouped too", /MASTER BLOCK, ONGIA PAYS \(1\)/.test(mail.text) && /NOT ON THE MASTER BLOCK \(2\)/.test(mail.text) && /Bob Agency.*Bob Agency pays/.test(mail.text) && mail.text.indexOf("Ann Master") < mail.text.indexOf("Bob Agency"));
const csv = roomingCsv(e2, rows).split("\r\n");
ok("the spreadsheet starts with a Master block Yes/No column", csv[0].startsWith("Master block,Guest name") && csv[1].startsWith("Yes,Ann Master") && csv[2].startsWith("No,") && csv[3].startsWith("No,"), csv.join(" | "));
const only = roomingMail({ event: e2, rows: rows.filter((x) => x.billing === "ONGIA") });
ok("with no one off the block there is no 'not on the master block' group and no warning", !/Not on the master block/.test(only.html) && !/only the rooms on the master block/.test(only.html) && /Master block, ONGIA pays/.test(only.html), only.html.match(/.{40}master block.{40}/g)?.join("|"));
const state = await call(rooming, `/api/rooming?event=${ev.id}`);
ok("the desk's list carries the same three", state.rows?.length === 3, JSON.stringify(state.rows));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
