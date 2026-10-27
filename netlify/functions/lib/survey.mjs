import { text, isEmail } from "./http.mjs";
import { token as newToken } from "./ids.mjs";
import { trainingDays } from "./agenda.mjs";
import { groupDaysOf } from "./letters.mjs";
import { PROVINCES } from "./agencies.mjs";

/**
 * An event's survey, built into the desk in place of SurveyMonkey (Andrew 27 Oct 2026; notes/surveys-plan.md).
 *
 * Bilingual, anonymous, star ratings with a word ("Option A"). One part per day when it goes out daily, or one survey
 * broken up by day when it goes at the end. "About you" is asked once per person; "The event overall" on their last
 * part. The National Gang Summit's community partners only see their own two days.
 *
 * Every question is defined here, once, in both languages: the page draws them, the server checks the answers against
 * them, and the results add them up, so the three can never disagree about what was asked.
 */

export const STARS = { en: ["Poor", "Fair", "Good", "Very good", "Excellent"], fr: ["Faible", "Passable", "Bien", "Très bien", "Excellent"] };
const yn = { en: ["Yes", "No"], fr: ["Oui", "Non"] };

export const ABOUT = [
  { id: "agency", kind: "agency", en: "Which agency do you work for?", fr: "Pour quel organisme travaillez-vous?" },
  { id: "province", kind: "province", en: "Which province or territory do you work in?", fr: "Dans quelle province ou quel territoire travaillez-vous?" },
  { id: "years", kind: "choice", en: "Years of service", fr: "Années de service", options: { en: ["0–3", "4–8", "9–15", "16–20", "21+"], fr: ["0–3", "4–8", "9–15", "16–20", "21+"] } },
  { id: "before", kind: "choice", en: "Have you attended an ONGIA event before?", fr: "Avez-vous déjà assisté à un événement de l'ONGIA?", options: yn },
  { id: "again", kind: "choice", en: "Are you considering attending again?", fr: "Envisagez-vous d'y assister de nouveau?", options: yn },
  { id: "heard", kind: "choice", optional: true, en: "How did you hear about this event?", fr: "Comment avez-vous entendu parler de cet événement?",
    options: { en: ["Email from ONGIA", "A colleague", "My agency", "LinkedIn", "ongia.ca", "Other"], fr: ["Courriel de l'ONGIA", "Un collègue", "Mon organisme", "LinkedIn", "ongia.ca", "Autre"] } },
];

// For each session: six star questions (Kingston's six, as questions), whether they'd book the presenter again, a comment.
export const SESSION = [
  { id: "relevant", kind: "stars", en: "How relevant was this to your work?", fr: "Dans quelle mesure était-ce pertinent pour votre travail?" },
  { id: "knowledge", kind: "stars", en: "How much did it add to what you knew?", fr: "Dans quelle mesure cela a-t-il enrichi vos connaissances?" },
  { id: "expectations", kind: "stars", en: "Did it live up to what you expected?", fr: "Cela a-t-il répondu à vos attentes?" },
  { id: "expert", kind: "stars", en: "How knowledgeable was the presenter?", fr: "Le présentateur maîtrisait-il son sujet?" },
  { id: "engaging", kind: "stars", en: "How engaging was the presenter?", fr: "Le présentateur était-il captivant?" },
  { id: "delivery", kind: "stars", en: "How well was it delivered?", fr: "La présentation était-elle bien livrée?" },
  { id: "rebook", kind: "choice", en: "Would you recommend this presenter for a future ONGIA event?", fr: "Recommanderiez-vous ce présentateur pour un futur événement de l'ONGIA?",
    options: { en: ["Yes", "Maybe", "No"], fr: ["Oui", "Peut-être", "Non"] } },
  { id: "comment", kind: "text", optional: true, en: "Anything else about this session?", fr: "Autre chose sur cette séance?" },
];

export const OVERALL = [
  { id: "quality", kind: "stars", en: "Overall, how would you rate the quality of the training?", fr: "Dans l'ensemble, comment évaluez-vous la qualité de la formation?" },
  { id: "pace", kind: "choice", en: "The pace of the training was…", fr: "Le rythme de la formation était…", options: { en: ["Too slow", "About right", "Too fast"], fr: ["Trop lent", "Juste bien", "Trop rapide"] } },
  { id: "confidence", kind: "stars", en: "How confident are you that you can apply what you learned?", fr: "Dans quelle mesure êtes-vous confiant de pouvoir appliquer ce que vous avez appris?" },
  { id: "variety", kind: "stars", en: "How valuable were the variety and depth of topics?", fr: "Quelle était la valeur de la variété et de la profondeur des sujets?" },
  { id: "practical", kind: "stars", en: "How many practical strategies are you leaving with?", fr: "Dans quelle mesure repartez-vous avec des stratégies pratiques?" },
  { id: "venue", kind: "stars", na: true, en: "How well did the venue and location work?", fr: "Le lieu et l'emplacement convenaient-ils?" },
  { id: "av", kind: "stars", na: true, en: "Could you see and hear the presentations clearly?", fr: "Pouviez-vous bien voir et entendre les présentations?" },
  { id: "registration", kind: "stars", na: true, en: "How easy were registration and check-in?", fr: "L'inscription et l'accueil étaient-ils faciles?" },
  { id: "food", kind: "stars", na: true, en: "How were the food and refreshments?", fr: "Qu'avez-vous pensé des repas et rafraîchissements?" },
  { id: "length", kind: "choice", en: "The length of the event was…", fr: "La durée de l'événement était…", options: { en: ["Too short", "About right", "Too long"], fr: ["Trop courte", "Juste bien", "Trop longue"] } },
  { id: "nps", kind: "nps", en: "How likely are you to recommend ONGIA training to a colleague?", fr: "Quelle est la probabilité que vous recommandiez les formations de l'ONGIA à un collègue?" },
  { id: "topics", kind: "text", optional: true, en: "What topics would you like at a future ONGIA event?", fr: "Quels sujets aimeriez-vous voir à un futur événement de l'ONGIA?" },
  { id: "where", kind: "province", optional: true, en: "Where would you like a future event held?", fr: "Où aimeriez-vous qu'un futur événement ait lieu?" },
  { id: "present", kind: "choice", optional: true, en: "Would you be interested in presenting at a future ONGIA event?", fr: "Aimeriez-vous présenter lors d'un futur événement de l'ONGIA?", options: yn },
  { id: "anything", kind: "text", optional: true, en: "Anything else you'd like to tell us?", fr: "Autre chose à nous dire?" },
];

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ""));
const plus = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

/** What a survey starts as: sent the day after the event ends, one session per signed-up presenter, days to be set. */
export function startingSurvey(event, presenters = []) {
  return {
    token: newToken(16), open: true, mode: "end", sendOn: event.lastDay || event.dayOne ? plus(event.lastDay || event.dayOne, 1) : "",
    sessions: sessionsFrom(presenters),
  };
}

/** One session per presenter with a talk, in the order they were added. Presenters sharing a talk title share a session. */
export function sessionsFrom(presenters = []) {
  const out = [];
  for (const p of presenters) {
    if (p.status === "withdrawn") continue;
    const title = text(p.submission?.talk, 200);
    const who = [p.first, p.last].filter(Boolean).join(" ").trim();
    if (!who) continue;
    const same = title && out.find((s) => s.title.toLowerCase() === title.toLowerCase());
    if (same) { if (!same.presenters.includes(who)) same.presenters.push(who); continue; }
    out.push({ id: `p${p.id}`.slice(0, 40), day: "", title: title || "", titleFr: "", presenters: [who] });
  }
  return out;
}

/** The settings as typed on the event page. */
export function cleanSurvey(given, had, event) {
  const out = { ...had };
  if (given?.open !== undefined) out.open = given.open === true;
  if (given?.mode !== undefined) out.mode = given.mode === "daily" ? "daily" : "end";
  if (given?.sendOn !== undefined) out.sendOn = isDate(given.sendOn) ? given.sendOn : "";
  if (Array.isArray(given?.sessions)) {
    const days = new Set(trainingDays(event));
    out.sessions = given.sessions.slice(0, 60).map((s, i) => ({
      id: /^[A-Za-z0-9_-]{1,40}$/.test(s?.id ?? "") ? s.id : `s${i + 1}${Date.now().toString(36)}`,
      day: days.has(s?.day) ? s.day : "",
      title: text(s?.title, 200), titleFr: text(s?.titleFr, 200),
      presenters: (Array.isArray(s?.presenters) ? s.presenters : String(s?.presenters ?? "").split(/\s*[,;&]\s*|\s+and\s+/)).map((n) => text(n, 120)).filter(Boolean).slice(0, 6),
    })).filter((s) => s.title || s.presenters.length);
  }
  return out;
}

/** Problems that stop the survey going out, in words Andrew can act on. */
export function surveyProblems(event) {
  const s = event.survey ?? {};
  const out = [];
  if (!s.sessions?.length) out.push("There are no sessions to rate yet. Add the presenters, or add sessions by hand.");
  const undated = (s.sessions ?? []).filter((x) => !x.day);
  if (undated.length) out.push(`${undated.length} session${undated.length === 1 ? " has" : "s have"} no day yet: ${undated.slice(0, 3).map((x) => x.title || x.presenters.join(", ")).join("; ")}${undated.length > 3 ? "…" : ""}. Pick the day for each.`);
  if (s.mode === "end" && !isDate(s.sendOn)) out.push("Pick the day the survey goes.");
  return out;
}

/** The days a person is asked about: their group's days, or every day of the event. */
export function daysFor(event, person) {
  const all = trainingDays(event);
  const g = person?.group ? groupDaysOf(event) : null;
  return g ? all.filter((d) => d >= g.dayOne && d <= g.lastDay) : all;
}

/**
 * What a person is asked in one part. `part` is a day ("2026-11-10") when the survey goes out daily, or "end".
 * About-you comes the first time; the event overall on their last part (daily) or always at the end.
 */
export function partFor(event, person, part, done = {}) {
  const days = daysFor(event, person);
  const sessions = event.survey?.sessions ?? [];
  const showDays = part === "end" ? days : days.filter((d) => d === part);
  return {
    part,
    about: !done.about,
    days: showDays.map((d) => ({ day: d, sessions: sessions.filter((s) => s.day === d) })).filter((d) => d.sessions.length),
    overall: part === "end" || part === days[days.length - 1],
  };
}

// A star answer: 1 to 5, or "na" (the small N/A under each question).
const star = (v) => (v === "na" ? "na" : Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 5 ? Number(v) : null);

function cleanAnswerFor(q, v, lang) {
  if (q.kind === "stars") return star(v);
  if (q.kind === "choice") { const i = Number(v); return Number.isInteger(i) && i >= 0 && i < q.options.en.length ? i : null; }
  if (q.kind === "nps") { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 10 ? n : null; }
  if (q.kind === "province") return PROVINCES[v] ? v : v === "other" ? "other" : null;
  if (q.kind === "agency") return text(v, 160) || null;
  if (q.kind === "text") return text(v, 2000) || null;
  return null;
}

/**
 * A submitted part, checked against what was asked. Returns the anonymous record to keep, the "would like to present"
 * contact to keep apart from it, and what is missing (by question id) when something required was left out.
 */
export function cleanResponse(body, asked, lang = "en") {
  const missing = [];
  const rec = { part: asked.part, lang: lang === "fr" ? "fr" : "en" };
  if (asked.about) {
    rec.about = {};
    for (const q of ABOUT) {
      const v = cleanAnswerFor(q, body?.about?.[q.id], lang);
      if (v === null) { if (!q.optional) missing.push(`about.${q.id}`); continue; }
      rec.about[q.id] = v;
    }
  }
  rec.sessions = {};
  for (const d of asked.days) {
    if (body?.skipDays?.includes?.(d.day)) { for (const s of d.sessions) rec.sessions[s.id] = { skipped: "day" }; continue; }
    for (const s of d.sessions) {
      const given = body?.sessions?.[s.id] ?? {};
      if (given.skipped) { rec.sessions[s.id] = { skipped: "session" }; continue; }
      const out = {};
      for (const q of SESSION) {
        const v = cleanAnswerFor(q, given[q.id], lang);
        if (v === null) { if (!q.optional) missing.push(`${s.id}.${q.id}`); continue; }
        out[q.id] = v;
      }
      rec.sessions[s.id] = out;
    }
  }
  let contact = null;
  if (asked.overall) {
    rec.overall = {};
    for (const q of OVERALL) {
      const v = cleanAnswerFor(q, body?.overall?.[q.id], lang);
      if (v === null) { if (!q.optional) missing.push(`overall.${q.id}`); continue; }
      rec.overall[q.id] = v;
    }
    const c = body?.contact ?? {};
    if (rec.overall.present === 0 && (text(c.name, 120) || isEmail(c.email))) contact = { name: text(c.name, 120), email: isEmail(c.email) ? String(c.email).trim().toLowerCase() : "", topic: text(c.topic, 300) };
  }
  return { rec, contact, missing };
}

/** The survey as the page draws it, in both languages, for one person's part. */
export function surveyForPage(event, asked, agencies = []) {
  const name = (s, lang) => (lang === "fr" && s.titleFr) || s.title || "";
  return {
    title: event.title, city: event.city, part: asked.part,
    dayNumber: Object.fromEntries(trainingDays(event).map((d, i) => [d, i + 1])),
    about: asked.about ? ABOUT.map((q) => ({ ...q, ...(q.kind === "agency" ? { agencies } : {}), ...(q.kind === "province" ? { provinces: PROVINCES } : {}) })) : null,
    days: asked.days.map((d) => ({ day: d.day, sessions: d.sessions.map((s) => ({ id: s.id, en: name(s, "en"), fr: name(s, "fr"), presenters: s.presenters })) })),
    session: SESSION, overall: asked.overall ? OVERALL.map((q) => (q.kind === "province" ? { ...q, provinces: PROVINCES } : q)) : null, stars: STARS,
  };
}
