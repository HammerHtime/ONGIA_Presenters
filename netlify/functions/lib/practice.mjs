import { getEvent, putEvent, putAttendees, putSurveyResponse, listEvents } from "./store.mjs";

/**
 * Practice events for the Sandbox (Andrew 30 Oct 2026: "add fake data to survey results so I can play around with
 * certificate and also build an RBH event (ITP week) and throw fake data from 12 attendees so I can play with the
 * executive summary as well as the infographic"). Made-up people at made-up addresses (@practice.invalid, which no mail
 * can reach and which the mailer refuses), on events marked practice that the nightly letters, reminders and sweeps
 * leave alone. Everything about them can be removed in one go.
 */
export const PRACTICE_DOMAIN = "practice.invalid";
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const FIRST = ["Jordan", "Sam", "Alex", "Casey", "Riley", "Morgan", "Taylor", "Jamie", "Avery", "Quinn", "Drew", "Reese", "Parker", "Rowan", "Sasha", "Devon", "Emerson", "Hayden", "Kendall", "Logan", "Marin", "Noel", "Peyton", "Skyler"];
const LAST = ["Tremblay", "Okafor", "Martin", "Nguyen", "Gagnon", "Singh", "Roy", "Chen", "Bouchard", "Wilson", "Côté", "Patel", "Fortin", "MacDonald", "Lavoie", "Brown", "Pelletier", "Ahmed", "Bélanger", "Campbell", "Leblanc", "Thompson", "Girard", "Hassan"];
// As people really type them: some to match at once, some misspelt, some by work email only.
const AGENCIES = ["TPS", "Toronto Polcie Service", "OPP - Gang Unit", "Ontario Provincial Police", "RCMP E Division", "GRC", "Peel Police", "CBSA", "Durham Regional Police", "Ottawa Police",
  "York Regional Police", "Hamilton PS", "Ministry of the Solicitor General", "Service de police de la Ville de Montréal", "Sûreté du Québec", "Correctional Service Canada"];
const person = (i, extra = {}) => {
  const first = FIRST[i % FIRST.length], last = LAST[(i * 7) % LAST.length];
  return { key: `practice-${i}`, first, last, email: `${first}.${last}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") + `@${PRACTICE_DOMAIN}`,
    organization: AGENCIES[i % AGENCIES.length], status: "ATTENDING", source: "csv", addedAt: new Date().toISOString(), ...extra };
};
const stars = (n) => Object.fromEntries(["relevant", "knowledge", "expectations", "expert", "engaging", "delivery"].map((k, j) => [k, Math.max(1, Math.min(5, n - (j === 5 && n > 3 ? 1 : 0)))]));

const ITP_SESSIONS = [
  ["Contraband tobacco trends and supply chains", "Tendances et chaînes d'approvisionnement du tabac de contrebande", [5, 5, 4, 5]],
  ["Legal and legislative framework", "Cadre juridique et législatif", [4, 3, 5, 4]],
  ["Agency presentations (RCMP, CBSA, SQ, HSI)", "Présentations des organismes (GRC, ASFC, SQ, HSI)", [5, 4, 4, 5]],
  ["Vape, pouches and counterfeit identification", "Identification des vapoteuses, sachets et contrefaçons", [4, 3, 4, 4]],
  ["Online monitoring and digital detection", "Surveillance en ligne et détection numérique", [5, 4, 4, 4]],
  ["Field visits (Kahnawake, Cornwall, Massena, Akwesasne)", "Visites sur le terrain (Kahnawake, Cornwall, Massena, Akwesasne)", [5, 5, 5, 5]],
  ["Factory tour and machinery identification", "Visite d'usine et identification de la machinerie", [5, 5, 4, 5]],
];
const ITP_COMMENTS = [
  ["en", "Touring the territories let us see the scope of the problem first hand. There is no substitute for that."],
  ["en", "Best training event I've been to in years. Will recommend it to my whole unit."],
  ["fr", "Les visites sur le terrain ont tout mis en perspective. Formation exceptionnelle."],
  ["en", "The vape and pouch session needed more hands-on identification time."],
  ["fr", "J'aurais aimé plus de temps sur la préparation au témoignage en cour."],
  ["en", "Seeing the machinery up close at the plant made the indicators click."],
  ["en", "Legal session was hard to apply across provinces. A jurisdiction cheat sheet would help."],
];
const SYMPOSIUM_SESSIONS = [
  ["Following the money: financial investigations", "Suivre l'argent : enquêtes financières", [5, 4, 5, 4]],
  ["Youth recruitment online", "Le recrutement des jeunes en ligne", [5, 5, 4, 5]],
  ["Ghost guns and 3D printing", "Armes fantômes et impression 3D", [4, 3, 4, 3]],
  ["Human trafficking indicators", "Indicateurs de traite de personnes", [5, 5, 5, 4]],
];

async function newEvent(base) {
  const id = `practice-${base.slug}-${Date.now().toString(36)}`;
  await putEvent({ id, nextSequence: 1, sessionMinutes: 60, sponsorsWelcome: false, offsets: { agreement: 90, draft: 50, final: 30 }, presenters: [], createdAt: new Date().toISOString(), ...base, slug: undefined, practice: true });
  return id;
}
async function answer(eventId, i, sessions, { lang = "en", base = 5, comment = "", topics = "" }) {
  const s = Object.fromEntries(sessions.map(([title, , scores], j) => [`s${j + 1}`, { ...stars(scores[(i + j) % scores.length] - (base < 5 && j % 3 === 0 ? 1 : 0)), rebook: 0, ...(j === (i % sessions.length) && comment ? { comment } : {}) }]));
  await putSurveyResponse(eventId, { id: `pr${i}${Date.now().toString(36)}`, at: new Date(Date.now() - (6 - (i % 5)) * 86400000).toISOString(), part: "end", lang,
    about: { agency: AGENCIES[i % AGENCIES.length], province: lang === "fr" ? "QC" : "ON", years: i % 5, before: i % 3 ? 0 : 1, again: i % 7 ? 0 : 1 },
    sessions: s, overall: { quality: base, pace: 1, confidence: Math.max(3, base - (i % 4 === 0 ? 1 : 0)), variety: 4 + (i % 2), practical: base, venue: 4 + (i % 2), av: 5, registration: 5, food: 3 + (i % 3), length: 1, nps: 8 + (i % 3), ...(topics ? { topics } : {}) } });
}

/** Make both practice events afresh (any earlier ones go first). `who` leads them. */
export async function makePractice(who, { remove }) {
  await remove();
  const board = [{ name: who.name || "Andrew Hammond", email: who.email || "president@ongia.ca", lead: true }];
  // An RBH week: 12 attendees, all checked in, all sent the survey, all of them answered.
  const itp = await newEvent({ slug: "itp", kind: "rbh", title: "Practice · ITP Week (Illicit Trade Prevention)", city: "Montréal and Québec City", venue: "Practice venue", province: "QC", invoicePrefix: "PRAC",
    dayOne: day(-12), lastDay: day(-8), board,
    survey: { token: `practiceitp${Date.now().toString(36)}`, open: true, mode: "end", sendOn: day(-7), sessions: ITP_SESSIONS.map(([title, titleFr], j) => ({ id: `s${j + 1}`, day: day(-12 + Math.min(4, j)), title, titleFr, presenters: [] })) } });
  await putAttendees(itp, { people: Array.from({ length: 12 }, (_, i) => person(i, { checkedIn: true, sent: ["survey:end"] })) });
  for (let i = 0; i < 12; i++) await answer(itp, i, ITP_SESSIONS, { lang: i % 3 === 2 ? "fr" : "en", base: i % 5 === 3 ? 4 : 5, comment: ITP_COMMENTS[i % ITP_COMMENTS.length][1], topics: ["Court testimony and expert witness preparation", "A Crown prosecution briefing", "Pipeline investigations", "Mail and parcel interdiction", "A farm tour"][i % 5] });
  // A general training: 24 registered, 20 checked in at the door, 16 answered the survey.
  const sym = await newEvent({ slug: "symposium", title: "Practice · Ontario Symposium", city: "Toronto, ON", venue: "Practice venue", dayOne: day(-10), lastDay: day(-9), board,
    survey: { token: `practicesym${Date.now().toString(36)}`, open: true, mode: "end", sendOn: day(-8), sessions: SYMPOSIUM_SESSIONS.map(([title, titleFr], j) => ({ id: `s${j + 1}`, day: day(-10 + (j > 1 ? 1 : 0)), title, titleFr, presenters: [] })) } });
  await putAttendees(sym, { people: Array.from({ length: 24 }, (_, i) => person(i + 3, { checkedIn: i < 20, sent: ["survey:end"] })) });
  for (let i = 0; i < 16; i++) await answer(sym, i, SYMPOSIUM_SESSIONS, { base: i % 4 === 1 ? 4 : 5, comment: i % 4 === 0 ? ["The youth recruitment session changed how we approach schools.", "Practical and current. Exactly what my unit needed.", "More time on ghost guns, please."][i % 3] : "", topics: i % 3 === 0 ? "Drill music and gang violence" : "" });
  return [await getEvent(itp), await getEvent(sym)];
}

export const practiceEvents = async () => (await listEvents()).filter((e) => e.practice);
