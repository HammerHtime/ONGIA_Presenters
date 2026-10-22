// The presenter export for an event's website (Andrew 22 Oct 2026): only what each presenter agreed to make public.
const REPO = new URL("../../", import.meta.url).pathname;
process.env.ADMIN_KEY ??= "testkey";
const { websiteExport, slugOf, default: exportFn } = await import(REPO + "netlify/functions/export.mjs");
const { readZip } = await import(REPO + "netlify/functions/lib/zip.mjs");
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { fail++; console.log("  FAIL", n, x); } };

const media = (summary, photo, materials = "no") => ({ summary: { internal: "yes", public: summary }, photo: { internal: "yes", public: photo }, materials: { internal: "yes", public: materials } });
const p = (id, first, last, status, m, extra = {}) => ({ id, first, last, email: `${first.toLowerCase()}@example.ca`, organization: "Sample Police Service", status,
  submission: { phone: "416-555-0100", talk: `${first}'s talk`, bio: `${first}'s bio`, outline: `${first}'s outline`, headshotName: "me.jpg", media: m, sensitive: "yes", signature: `${first} ${last}`, ...extra } });
const people = [
  p("a1", "Ada", "Sample", "approved", media("yes", "yes", "yes")),       // all public
  p("b2", "Bo", "Example", "submitted", media("yes", "no")),              // summary public, photo not
  p("c3", "Cy", "Private", "approved", media("no", "yes")),               // said no to the summary: left out entirely
  p("d4", "Dee", "Notyet", "invited", media("yes", "yes")),               // has not signed
  p("e5", "Eli", "Sentback", "returned", media("yes", "yes")),            // sent back for changes: not signed as it stands
];
const shots = { a1: { bytes: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), type: "image/jpeg" }, b2: { bytes: new Uint8Array([0xff, 0xd8, 0xff, 4]), type: "image/jpeg" }, c3: { bytes: new Uint8Array([0xff, 0xd8, 0xff, 5]), type: "image/jpeg" } };
const ev = { id: "ev1", title: "Canadian Forum Against Organized Crime - Western Symposium", city: "Victoria, BC", venue: "Sample Hall", dayOne: "2026-11-24" };
const { json, photos } = await websiteExport(ev, people, async (e, id) => shots[id] ?? null);

ok("only signed presenters who agreed to a public summary are in it (2 of 5), by last name", json.count === 2 && json.presenters.map((x) => x.first).join(",") === "Bo,Ada", json.presenters.map((x) => x.first).join(","));
ok("it counts who was left out, without naming them", json.leftOut.signedWithoutPublicConsent === 1 && json.leftOut.notSignedYet === 2 && !JSON.stringify(json).includes("Private") && !JSON.stringify(json).includes("Notyet"));
const ada = json.presenters.find((x) => x.first === "Ada"), bo = json.presenters.find((x) => x.first === "Bo");
ok("each has name, organization, bio, talk title and description", ada.name === "Ada Sample" && ada.organization === "Sample Police Service" && ada.bio === "Ada's bio" && ada.presentation.title === "Ada's talk" && ada.presentation.description === "Ada's outline");
ok("a photo only where they agreed to public photos", ada.photo === "photos/ada-sample.jpg" && bo.photo === null && photos.length === 1 && photos[0].file === "ada-sample.jpg");
ok("the consent answers that matter are recorded", ada.consent.publicPhoto === true && ada.consent.publicMaterials === true && bo.consent.publicPhoto === false);
ok("no email, phone, signature or the community-partners answer anywhere", !/@example\.ca|416-555|sensitive|signature/i.test(JSON.stringify(json)));
ok("session is empty: the desk keeps daily times, not each talk's slot", ada.session === null);
// The biography line (22 Oct 2026): a no keeps them listed without a bio; an agreement from before it is "legacy".
const withBio = (ans) => p("g7", "Gil", "Bioline", "approved", { ...media("yes", "no"), bio: { internal: "yes", public: ans } });
const nob = (await websiteExport(ev, [withBio("no")], async () => null)).json.presenters[0];
const yb = (await websiteExport(ev, [withBio("yes")], async () => null)).json.presenters[0];
ok("a no to the biography line: listed, no bio", nob.bio === null && nob.consent.publicBio === "no" && yb.bio === "Gil's bio" && yb.consent.publicBio === "yes");
ok("signed before the biography line: the summary covers it, marked legacy", ada.bio === "Ada's bio" && ada.consent.publicBio === "legacy");
ok("file names are safe", slugOf("Anastasiya Vasyl'yeva-Émond") === "anastasiya-vasyl-yeva-emond");

// Only the president and the VP may export.
const res = await exportFn(new Request("http://localhost/api/export?event=ev1"));
ok("without signing in, nobody gets an export", res.status === 401);
const { issueSession } = await import(REPO + "netlify/functions/lib/auth.mjs");
const board = issueSession({ email: "secretary@ongia.ca", name: "Lee Example" });
const res2 = await exportFn(new Request("http://localhost/api/export?event=ev1", { headers: { "x-admin-key": board } }));
ok("a board member who is not the president or VP is refused", res2.status === 403, String(res2.status));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
