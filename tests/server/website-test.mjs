// "Update website" for the CFAOC events (Andrew 22 Oct 2026): consent, the change summary, pressing twice, a second
// event as its own page, undoing by revert, and French that falls back to English. GitHub is a stand-in held in memory.
const REPO = new URL("../../", import.meta.url).pathname;
const F = REPO + "netlify/functions/";
process.env.CFAOC_GITHUB_TOKEN = "github_pat_test";
const websiteFn = (await import(F + "website.mjs")).default;
const { putEvent, putPresenter, getEvent, getPresenter, putHeadshot } = await import(F + "lib/store.mjs");
const { buildDeskFile, isWebsiteEvent, shownEvent } = await import(F + "lib/website.mjs");
const { issueSession } = await import(F + "lib/auth.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };

/* ---- a stand-in for GitHub's git data API, one repository ---- */
const { fakeGitHub } = await import(REPO + "tests/fake-github.mjs");
const { G, seed, read, revertHead, fetch: fakeFetch } = fakeGitHub("github_pat_test");
const eventsJson = {
  site: { name: "CFAOC" }, content: {},
  events: [{ slug: "victoria", status: "open", city: "Victoria", province: "BC", date: "2026-11-24", startTime: "08:00", endTime: "16:30", registerUrl: "https://www.ongia.org/event-details/old",
    blurb: "The Pacific gateway.", venue: { name: "Delta Ocean Pointe", street: "100 Harbour Road", city: "Victoria", region: "BC", postalCode: "V9A 0G1", country: "Canada" },
    hotel: { name: "Delta Ocean Pointe", rate: "$249", rateUnit: "per night", bookingUrl: "https://example.com/book", highlights: ["On the harbour"] },
    speakers: [{ name: "Ada Sample", title: "Analyst", org: "Sample Police Service", bio: ["Old bio."] }, { name: "Hand Typed", org: "Somewhere" }],
    agenda: [{ time: "08:00", end: "08:30", title: "Coffee", detail: "Harbour Room" }, { time: "08:30", end: "09:15", title: "Opening talk", detail: "Ada Sample" }] },
    { slug: "", regionLabel: "Central Canada", status: "tba", city: "Toronto", date: "2027-03-23", blurb: "The land-border corridor." }],
  i18n: { fr: { events: { victoria: { provinceName: "Colombie-Britannique", speakers: [{ name: "Ada Sample", title: "Analyste", org: "Service de police modèle", bio: ["Ancienne bio."] }], agenda: [{ time: "08:00", end: "08:30", title: "Café", detail: "Salle Harbour" }, { time: "08:30", end: "09:15", title: "Conférence d'ouverture", detail: "Ada Sample" }] } } } },
};
seed({ "events.json": JSON.stringify(eventsJson, null, 2), "build.js": "// site", "static/styles.css": "body{}" });

/* ---- the desk ---- */
const media = (summary, photo, bio) => ({ summary: { internal: "yes", public: summary }, photo: { internal: "yes", public: photo }, materials: { internal: "yes", public: "no" }, ...(bio ? { bio: { internal: "yes", public: bio } } : {}) });
const person = (id, first, last, status, m, extra = {}) => ({ id, eventId: "ev-west", first, last, email: `${first.toLowerCase()}@example.ca`, organization: "Sample Police Service", status,
  submission: { phone: "416-555-0100", talk: `${first}'s talk`, bio: `${first}'s bio.\n\nSecond paragraph.`, outline: `${first}'s outline`, headshotName: "me.jpg", media: m, sensitive: "yes", signature: `${first} ${last}`, ...extra } });
const west = { id: "ev-west", title: "Canadian Forum Against Organized Crime Western Symposium", city: "Victoria, BC", province: "BC", venue: "Delta Ocean Pointe", dayOne: "2026-11-24", lastDay: "2026-11-24",
  hotel: { name: "Delta Ocean Pointe", link: "https://example.com/book", cutoff: "2026-10-30", rate: "$209 contract", notes: "" }, board: [], wix: { eventId: "w1", url: "https://www.ongia.org/event-details/cfaoc-west" } };
await putEvent(west);
await putEvent({ id: "ev-other", title: "Human Trafficking Summit", city: "Toronto, ON", dayOne: "2026-12-01", board: [] });
const people = [
  person("a1", "Ada", "Sample", "approved", media("yes", "yes")),            // signed before the bio question: legacy
  person("b2", "Bo", "Example", "submitted", media("yes", "no", "yes")),     // public, no photo
  person("c3", "Cy", "Private", "approved", media("no", "yes", "yes")),      // said no to public summary: never shown
  person("d4", "Dee", "Notyet", "invited", media("yes", "yes", "yes")),      // not signed
  person("e5", "Eli", "Sentback", "returned", media("yes", "yes", "yes")),   // sent back for changes
  person("f6", "Fay", "Nobio", "approved", media("yes", "no", "no")),        // public, but said no to the bio
];
for (const p of people) await putPresenter(p);
await putHeadshot("ev-west", "a1", new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), { type: "image/jpeg" });
await putHeadshot("ev-west", "c3", new Uint8Array([0xff, 0xd8, 0xff, 9]), { type: "image/jpeg" });

const owner = { "x-admin-key": "testkey", "content-type": "application/json" };
const call = async (qs, { method = "POST", body, headers = owner } = {}) => {
  const res = await websiteFn(new Request(`http://localhost/api/website?${qs}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }), { fetchImpl: fakeFetch, client: fakeClaude });
  return { status: res.status, body: await res.json() };
};
const fakeClaude = { beta: { messages: { stream: (req) => ({ finalMessage: async () => {
  const given = JSON.parse(req.messages[0].content.slice(req.messages[0].content.indexOf("{")));
  return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ title: given.title ? `FR ${given.title}` : "", talk: `FR ${given.talk}`, bio: given.bio ? `FR ${given.bio}` : "", outline: `FR ${given.outline}` }) }] };
} }) } } };

/* who may */
ok("only CFAOC events have a website", isWebsiteEvent(west) && !isWebsiteEvent({ title: "Human Trafficking Summit" }) && isWebsiteEvent({ title: "Canadian Forum Against Organized Crime Eastern Symposium" }) && isWebsiteEvent({ title: "2026 Canadian Forum Against Organized Crime - Victoria" }) && isWebsiteEvent({ title: "CFAOC Western Symposium" }) && !isWebsiteEvent({ title: "Organized Crime Awareness Day" }));
const board = { "x-admin-key": issueSession({ email: "secretary@ongia.ca", name: "Lee" }), "content-type": "application/json" };
ok("a board member who is not the president or VP is refused", (await call("event=ev-west&preview=1", { headers: board })).status === 403);
ok("another event has no website", (await call("event=ev-other", { method: "GET" })).status === 409);
ok("without a page name, the button says what to do", /Website page/.test((await call("event=ev-west&preview=1")).body.error));

/* consent: the same rule as the presenter export */
const g = (await call("event=ev-west", { method: "GET" })).body;
ok("the desk lists who would be shown: signed and yes to public summary only", g.presenters.filter((p) => p.shown).map((p) => p.name).join(",") === "Bo Example,Fay Nobio,Ada Sample", g.presenters.filter((p) => p.shown).map((p) => p.name).join(","));
const built = await buildDeskFile(west, people, async (e, id) => (id === "a1" ? { bytes: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), type: "image/jpeg" } : id === "c3" ? { bytes: new Uint8Array([9]), type: "image/jpeg" } : null));
const sp = built.file.event.speakers;
ok("only public presenters go in (3 of 6)", sp.map((s) => s.name).join(",") === "Bo Example,Fay Nobio,Ada Sample");
ok("a photo only with a yes to public photos", sp.find((s) => s.name === "Ada Sample").photo === "/assets/speakers//ada-sample.jpg" || sp.find((s) => s.name === "Ada Sample").photo?.endsWith("ada-sample.jpg"));
ok("no photo for someone who said no to photos, and the private presenter's photo is never built", !sp.find((s) => s.name === "Bo Example").photo && built.photos.length === 1);
ok("a no to the bio means no bio, but they are still listed", !sp.find((s) => s.name === "Fay Nobio").bio);
ok("bios become paragraphs", JSON.stringify(sp.find((s) => s.name === "Bo Example").bio) === JSON.stringify(["Bo's bio.", "Second paragraph."]));
ok("signed before the bio question: shown, marked to ask again", built.people.find((p) => p.name === "Ada Sample").bioConsent === "legacy");
ok("no email, phone, signature, travel or the community-partners answer", !/@example\.ca|416-555|sensitive|signature|Private|Notyet|Sentback/i.test(built.text), built.text.match(/@example\.ca|416-555|sensitive|signature|Private|Notyet|Sentback/i)?.[0]);
ok("the registration link comes from Wix when none is typed", built.file.event.registerUrl === "https://www.ongia.org/event-details/cfaoc-west");
ok("the hotel's internal contract rate is not published", !built.text.includes("$209 contract"));

/* first: the page and the one-time fill from the website */
ok("saving the page name", (await call("event=ev-west", { method: "PUT", body: { page: "Victoria" } })).body.website.page === "victoria");
const filled = (await call("event=ev-west&fill=1")).body;
ok("the one-time fill brings the website's times, address, rate and program into the desk", filled.ok && filled.website.startTime === "08:00" && filled.website.street === "100 Harbour Road" && filled.website.hotelRate === "$249" && filled.website.agenda.length === 2 && filled.website.agenda[0].titleFr === "Café", JSON.stringify(filled).slice(0, 300));
const adaWeb = (await getPresenter("ev-west", "a1")).web;
ok("job titles come over by name, with the French already on the site, not marked as reviewed", adaWeb?.title === "Analyst" && adaWeb.titleFr === "Analyste" && adaWeb.orgFr === "Service de police modèle" && adaWeb.bioFr === "Ancienne bio." && adaWeb.frReviewed === false, JSON.stringify(adaWeb));

/* the change summary */
const pv = (await call("event=ev-west&preview=1")).body;
const said = pv.lines.join(" | ");
ok("summary: the first update from the desk", /first update from the desk/.test(said), said);
ok("summary: new presenters named", /2 new presenters: Bo Example, Fay Nobio/.test(said), said);
ok("summary: who comes off the website, by name", /1 presenter taken off the website: Hand Typed/.test(said), said);
ok("summary: Ada's bio updated and her photo added", /1 bio updated: Ada Sample/.test(said) && /Photos: 1 added/.test(said), said);
ok("summary: the registration link brought over from the website is kept, so no change", !/Registration link/.test(said), said);
ok("summary: French not there yet is flagged, and English is what shows", pv.notes.some((n) => /No French yet for .*English/.test(n)), pv.notes.join(" | "));
ok("summary: the earlier-agreement bio is noted", pv.notes.some((n) => /Ada Sample signed before the biography question/.test(n)), pv.notes.join(" | "));
ok("preview sends nothing", !G.calls.some((c) => /^(POST|PATCH)/.test(c)));

/* publish */
const before = G.ref;
const pub = (await call("event=ev-west&publish=1")).body;
ok("publishing makes one commit on main", pub.ok && G.ref !== before && G.commits.get(G.ref).parents[0] === before, JSON.stringify(pub).slice(0, 200));
ok("the commit message names the event and who pressed", /Canadian Forum Against Organized Crime Western Symposium/.test(G.commits.get(G.ref).message) && /Pressed by/.test(G.commits.get(G.ref).message));
ok("it writes desk/victoria.json and the one photo, and leaves events.json alone", !!read("desk/victoria.json") && !!read("static/assets/speakers/victoria/ada-sample.jpg") && read("events.json").toString() === JSON.stringify(eventsJson, null, 2));
ok("the desk remembers the last update", (await getEvent("ev-west")).website.lastPublished?.commit === pub.commit);
const shown = shownEvent(eventsJson, "victoria", JSON.parse(read("desk/victoria.json")));
ok("the page keeps what the desk does not own (hotel highlights, blurb)", shown.en.hotel.highlights[0] === "On the harbour" && shown.en.blurb === "The Pacific gateway.");
ok("French page: English where there is no French yet", shown.fr.speakers.find((s) => s.name === "Bo Example").bio[0] === "Bo's bio." && shown.fr.provinceName === "Colombie-Britannique");

/* pressing twice changes nothing */
const head1 = G.ref;
const again = (await call("event=ev-west&publish=1")).body;
ok("pressing twice changes nothing: no commit", again.unchanged === true && G.ref === head1);
ok("and the preview says so", (await call("event=ev-west&preview=1")).body.unchanged === true);

/* French: drafted, edited, reviewed */
const fr = (await call("event=ev-west&french=b2")).body;
ok("a French draft is saved, not yet reviewed", fr.web.bioFr.startsWith("FR Bo's bio") && fr.web.frReviewed === false);
ok("no French for someone not shown", (await call("event=ev-west&french=c3")).status === 409);
await call("event=ev-west&presenter=b2", { method: "PUT", body: { bioFr: "Biographie de Bo, revue.", frReviewed: true } });
const pv2 = (await call("event=ev-west&preview=1")).body;
ok("the summary after French: only the French changed, Bo no longer flagged", pv2.unchanged === false && pv2.lines.join() === "French updated for Bo Example." && !pv2.notes.join(" ").includes("Bo Example"), JSON.stringify(pv2));
await call("event=ev-west&publish=1");
const fr2 = shownEvent(eventsJson, "victoria", JSON.parse(read("desk/victoria.json")));
ok("the French page shows the edited French", fr2.fr.speakers.find((s) => s.name === "Bo Example").bio[0] === "Biographie de Bo, revue." && fr2.en.speakers.find((s) => s.name === "Bo Example").bio[0] === "Bo's bio.");

/* consent withdrawn: the photo comes down */
await putPresenter({ ...people[0], web: (await getPresenter("ev-west", "a1")).web, submission: { ...people[0].submission, media: media("yes", "no") } });
const pv3 = (await call("event=ev-west&preview=1")).body;
ok("a withdrawn photo yes takes the photo down", /Photos: 1 taken down/.test(pv3.lines.join(" ")), pv3.lines.join(" | "));
await call("event=ev-west&publish=1");
ok("and it is gone from the site", !read("static/assets/speakers/victoria/ada-sample.jpg"));

/* rollback by revert */
const deskBefore = read("desk/victoria.json", G.commits.get(G.ref).parents[0]).toString();
revertHead();
ok("reverting the last update puts the website file back as it was", read("desk/victoria.json").toString() === deskBefore && !!read("static/assets/speakers/victoria/ada-sample.jpg"));
const pv4 = (await call("event=ev-west&preview=1")).body;
ok("after a revert, the desk sees the difference and would publish it again", pv4.unchanged === false && /Photos: 1 taken down/.test(pv4.lines.join(" ")));

/* a second event is its own page */
const east = { id: "ev-east", title: "Canadian Forum Against Organized Crime Eastern Symposium", city: "Moncton, NB", venue: "Delta Beauséjour", dayOne: "2027-03-30", board: [], website: { page: "atlantic-canada", startTime: "08:30", endTime: "16:00", registerUrl: "https://www.ongia.org/event-details/east" } };
await putEvent(east);
await putPresenter({ ...person("z9", "Zed", "East", "approved", media("yes", "no", "yes")), eventId: "ev-east" });
await putPresenter({ ...person("y8", "Yan", "Hidden", "approved", media("no", "no", "no")), eventId: "ev-east" });
const westDesk = read("desk/victoria.json").toString();
const e1 = (await call("event=ev-east&publish=1")).body;
const eastFile = JSON.parse(read("desk/atlantic-canada.json"));
ok("the second event gets its own file", e1.ok && eastFile.event.slug === "atlantic-canada" && eastFile.event.speakers.map((s) => s.name).join() === "Zed East");
ok("and the first event's page is untouched", read("desk/victoria.json").toString() === westDesk);
ok("its own clock and province", eastFile.event.timezone === "America/Halifax" && eastFile.event.province === "NB");
const brandNew = { id: "ev-central", title: "Canadian Forum Against Organized Crime Central Symposium", city: "Winnipeg, MB", venue: "Hall", dayOne: "2027-06-01", board: [], website: { page: "prairies" } };
await putEvent(brandNew);
const central = { id: "ev-cent", title: "Canadian Forum Against Organized Crime Central Symposium", city: "Toronto, ON", venue: "Hall", dayOne: "2027-03-23", board: [], website: { page: "central-canada" } };
await putEvent(central);
const cpv = (await call("event=ev-cent&preview=1")).body;
ok("a city already on the site as \"to be announced\" is found by its region and not called new", !/new section/.test(cpv.lines.join(" ")) && /first update/.test(cpv.lines.join(" ")), cpv.lines.join(" | "));
await call("event=ev-cent&publish=1");
ok("and publishing opens its page", JSON.parse(read("desk/central-canada.json")).event.status === "open");
ok("a city the website has never had is announced as a new section", /A new section of the website/.test((await call("event=ev-central&preview=1")).body.lines.join(" ")));

/* someone else pushes in between: the desk reads again and still makes one clean commit */
await putEvent({ ...(await getEvent("ev-east")), website: { ...(await getEvent("ev-east")).website, startTime: "09:00" } });
G.moveUnderneath = true;
const r = (await call("event=ev-east&publish=1")).body;
ok("a race with another push is retried once and lands", r.ok && JSON.parse(read("desk/atlantic-canada.json")).event.startTime === "09:00", JSON.stringify(r));

/* no key */
delete process.env.CFAOC_GITHUB_TOKEN;
ok("without the key, the button says how to fix it and sends nothing", /CFAOC_GITHUB_TOKEN/.test((await call("event=ev-west&preview=1")).body.error));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
