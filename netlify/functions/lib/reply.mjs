import { text, isEmail } from "./http.mjs";
import { todayIso } from "./deadlines.mjs";
import { token as newToken } from "./ids.mjs";
import { getAttendees, putAttendees, getReplies } from "./store.mjs";
import { writeableTo } from "./attendees.mjs";
import { letterProblems, eventProblems, renderLetter, attendeeSignOf } from "./letters.mjs";
import { sendMail } from "./mail.mjs";
import { pacer, timeLeft } from "./bulk.mjs";
import { xlsx } from "./xlsx.mjs";

/**
 * Housekeeping questions for an event's attendees (Andrew 26 Oct 2026, for the National Gang Summit).
 *
 * One email to everyone registered, with one button to a short form: name, agency, email; a food allergy or
 * intolerance, only if they have one; and yes or no to each social. The answers keep two lists apart:
 *  - the dietary list, laid out like the sheet the hotel gets (first name, last name, allergy / dietary, table);
 *  - the socials list, yes or no to each, with totals.
 * Each comes out as its own spreadsheet. The form is at /q/<token>; the token is the event's, not a person's, so
 * one person can answer for someone else on their registration. A second answer from the same person replaces the
 * first.
 */

const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const JOUR = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const at = (iso) => { const [y, m, d] = String(iso).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
/** "Friday, October 30" */
export const longDay = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso ?? "") ? `${WEEKDAY[at(iso).getUTCDay()]}, ${MONTH[at(iso).getUTCMonth()]} ${at(iso).getUTCDate()}` : "");
/** "vendredi 30 octobre" */
export const longDayFr = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso ?? "") ? `${JOUR[at(iso).getUTCDay()]} ${at(iso).getUTCDate()} ${MOIS[at(iso).getUTCMonth()]}` : "");

/** Day n of an event as a date, "2026-11-10". */
const dayN = (event, n) => (event?.dayOne ? new Date(at(event.dayOne).getTime() + (n - 1) * 86400000).toISOString().slice(0, 10) : "");

/**
 * The National Gang Summit's two nights (Andrew 26 Oct 2026). Socials are asked about at the Summit only; every
 * event asks about food.
 */
const isSummit = (event) => /national gang summit/i.test(event?.title ?? "");
function summitSocials(event) {
  return [
    // Andrew's wording, 27 Oct 2026.
    { id: "s1", date: dayN(event, 2), label: "Networking Reception followed by a screening of the documentary WATTS",
      labelFr: "Réception de réseautage suivie de la projection du documentaire WATTS" },
    { id: "s2", date: dayN(event, 3), label: "Evening Social at the hotel featuring a live performance by District 6",
      labelFr: "Soirée à l'hôtel avec une prestation en direct de District 6" },
  ];
}

/** The Summit's socials as Andrew last worded them, by id, keeping whatever dates the event has. */
export const summitSocialLabels = (event, socials = []) => {
  const fresh = new Map(summitSocials(event).map((s) => [s.id, s]));
  return socials.map((s) => (fresh.has(s.id) ? { ...s, label: fresh.get(s.id).label, labelFr: fresh.get(s.id).labelFr } : s));
};

/** The National Gang Summit's email, in Andrew's words (27 Oct 2026). Only the blanks are the desk's. */
function summitWording(socials) {
  return {
    subject: "National Gang Summit: A Few Quick Questions / Quelques questions rapides",
    body: [
      "Hello {first},",
      "As we finalize arrangements for the National Gang Summit, we'd appreciate a few details to help us prepare for your visit.",
      "This survey is for all registered participants, whether you'll be attending the full Summit November 9-12 or joining us as a community partner on November 10 and 11.",
      "DIETARY REQUIREMENTS",
      "Please let us know if you have any food allergies, intolerances, or dietary requirements. We will share this information with the hotel to help ensure suitable meal options are available.",
      "SOCIAL EVENTS",
      "Please indicate whether you plan to attend the following events:",
      socials.map((_, i) => `* {social${i + 1}}`).join("\n"),
      "HOW TO RESPOND",
      "Simply click the button below to answer a few questions.",
      "Please submit your responses by {replyBy}, to allow sufficient time to finalize arrangements with the hotel. The survey should take less than one minute to complete.",
      "Thank you for your time. We look forward to welcoming you to the Summit.",
      "National Gang Summit Planning Committee",
      "{replyButton}",
      // The French half (Andrew 27 Oct 2026: "two sections, the top English with the link and the bottom French with
      // the link; the French link takes them to the French questions"). Translated from his English.
      "FRANÇAIS",
      "Bonjour {first},",
      "Alors que nous finalisons les préparatifs du Sommet national sur les gangs, nous aimerions obtenir quelques renseignements pour bien préparer votre visite.",
      "Ce sondage s'adresse à tous les participants inscrits, que vous assistiez à l'ensemble du Sommet, du 9 au 12 novembre, ou que vous vous joigniez à nous à titre de partenaire communautaire les 10 et 11 novembre.",
      "RESTRICTIONS ALIMENTAIRES",
      "Veuillez nous indiquer si vous avez des allergies, des intolérances ou des restrictions alimentaires. Nous transmettrons ces renseignements à l'hôtel afin que des repas adaptés soient offerts.",
      "ACTIVITÉS SOCIALES",
      "Veuillez indiquer si vous prévoyez assister aux activités suivantes :",
      socials.map((_, i) => `* {social${i + 1}Fr}`).join("\n"),
      "COMMENT RÉPONDRE",
      "Il suffit de cliquer sur le bouton ci-dessous pour répondre à quelques questions.",
      "Veuillez nous faire parvenir vos réponses d'ici le {replyByFr}, afin de nous laisser le temps de finaliser les arrangements avec l'hôtel. Le sondage prend moins d'une minute à remplir.",
      "Merci de votre temps. Nous avons hâte de vous accueillir au Sommet.",
      "Le comité organisateur du Sommet national sur les gangs",
      "{replyButtonFr}",
    ].join("\n\n"),
    buttonLabel: "Complete the survey",
    buttonLabelFr: "Répondre au sondage",
    // Signed by the board, with the Summit's own inbox, not by the event's lead (Andrew 27 Oct 2026).
    signName: "ONGIA Board",
    signEmail: "ngs@ongia.ca",
  };
}

/** The email as the desk suggests it, for these socials. Andrew can change every word on the event page. */
export function suggestedWording(event, socials = []) {
  const summit = isSummit(event);
  const n = socials.length;
  if (summit && n) return summitWording(socials);
  return plainWording(event, socials);
}

/** The wording every other event starts with (and the Summit did, before Andrew wrote his own). */
function plainWording(event, socials) {
  const summit = isSummit(event);
  const n = socials.length;
  return {
    subject: n ? "{event}: a few quick questions" : "{event}: any food allergies?",
    body: [
      "Hello {first},",
      "We're putting the final touches on the {event}, and we're looking forward to hosting you and to hearing from a great lineup of speakers.",
      // The Summit's community partners come for the two community days only (Andrew 26 Oct 2026).
      ...(summit ? ["This is for everyone coming, whether you're with us for the full Summit, November 9 to 12, or joining us as a community partner on November 10 and 11."] : []),
      `${n ? "A few housekeeping questions before then. First" : "One question before then"}: do you have a food allergy, intolerance or dietary need? We'll pass it to the hotel so they can plan your meals.`,
      ...(n ? [`We'd also like to know whether you'll come to ${n === 1 ? "the social" : "each of the socials"}:`, socials.map((_, i) => `* {social${i + 1}}`).join("\n")] : []),
      `Please answer by end of day {replyBy}, so the hotel has time to plan. It takes ${n ? "about a minute" : "a few seconds"}.`,
      "See you soon.",
    ].join("\n\n"),
    buttonLabel: n ? "Answer the questions" : "Tell us",
  };
}

/**
 * The Summit's email as it stood when it was set up, before Andrew wrote his own wording, untouched since: brought up
 * to his wording (English and French, the board's signature, the socials' new names) the next time anyone opens or
 * uses it. Andrew 27 Oct 2026: his test still went out in the old words. Anything he typed himself is left alone, and
 * nothing changes once the email has gone out. Returns the new settings, or null when there is nothing to do.
 */
export function freshenedReply(event) {
  const r = event?.reply;
  if (!r || r.sentAt || !isSummit(event) || !(r.socials ?? []).length) return null;
  const old = plainWording(event, r.socials);
  const same = (a, b) => String(a ?? "").replace(/\s+/g, " ").trim() === String(b ?? "").replace(/\s+/g, " ").trim();
  if (!same(r.body, old.body) || !same(r.subject, old.subject)) return null;
  const socials = summitSocialLabels(event, r.socials);
  return { ...r, socials, ...summitWording(socials) };
}

/** What an event's questions start as. */
export function startingReply(event, now = new Date()) {
  // The Friday of this week, or today if that has passed: Andrew's "end of this week".
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + ((5 - d.getUTCDay() + 7) % 7));
  const socials = isSummit(event) ? summitSocials(event) : [];
  return { token: newToken(16), open: true, replyBy: d.toISOString().slice(0, 10), socials, ...suggestedWording(event, socials) };
}

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ""));

/** The settings as typed on the event page. Anything not given stays as it was. */
export function cleanReply(given, had) {
  const out = { ...had };
  if (given?.open !== undefined) out.open = given.open === true;
  if (given?.replyBy !== undefined) out.replyBy = isDate(given.replyBy) ? given.replyBy : had.replyBy;
  if (given?.subject !== undefined) out.subject = text(given.subject, 200);
  if (given?.body !== undefined) out.body = text(given.body, 6000);
  if (given?.buttonLabel !== undefined) out.buttonLabel = text(given.buttonLabel, 60) || "Answer the questions";
  // Who the email is signed by and where replies go; left empty, the event's lead as usual.
  if (given?.signName !== undefined) out.signName = text(given.signName, 80);
  if (given?.signEmail !== undefined) out.signEmail = isEmail(given.signEmail) ? String(given.signEmail).trim().toLowerCase() : "";
  if (given?.buttonLabelFr !== undefined) out.buttonLabelFr = text(given.buttonLabelFr, 60) || "Répondre au sondage";
  // Reminder dates: up to four, in order, none after the reply-by date matters (the nightly run stops there).
  if (Array.isArray(given?.reminders)) out.reminders = [...new Set(given.reminders.filter(isDate))].sort().slice(0, 4);
  if (Array.isArray(given?.socials)) {
    out.socials = given.socials.slice(0, 4).map((s, i) => ({ id: `s${i + 1}`, date: isDate(s?.date) ? s.date : "", label: text(s?.label, 200), labelFr: text(s?.labelFr, 200) }))
      .filter((s) => s.label);
  }
  return out;
}

/** The questions as the form shows them: "Tuesday, November 10: Networking social, …". */
export const socialLine = (s) => [longDay(s.date), s.label].filter(Boolean).join(": ");
export const socialLineFr = (s) => [longDayFr(s.date), s.labelFr || s.label].filter(Boolean).join(" : ");

/** One answer from the form, checked. Returns { answer } or { problems }. */
export function cleanAnswer(body, reply) {
  const problems = [];
  const first = text(body?.first, 80), last = text(body?.last, 80), agency = text(body?.agency, 200), email = text(body?.email, 200).toLowerCase();
  if (!first) problems.push("first");
  if (!last) problems.push("last");
  if (!agency) problems.push("agency");
  if (!isEmail(email)) problems.push("email");
  // "Do you have a food allergy or intolerance?" is answered yes or no, so a skipped question is not a "no".
  const said = body?.allergy === true || body?.allergy === "yes" ? "yes" : body?.allergy === false || body?.allergy === "no" ? "no" : null;
  if (!said) problems.push("allergy");
  const allergy = said === "yes";
  const dietary = allergy ? text(body?.dietary, 600) : "";
  if (allergy && !dietary) problems.push("dietary");
  const socials = {};
  for (const s of reply.socials ?? []) {
    const v = body?.socials?.[s.id];
    if (v !== "yes" && v !== "no") problems.push(s.id);
    socials[s.id] = v === "yes" ? "yes" : v === "no" ? "no" : null;
  }
  if (problems.length) return { problems };
  return { answer: { first, last, agency, email, allergy, dietary, socials, lang: body?.lang === "fr" ? "fr" : "en" } };
}

const byName = (list) => [...list].sort((a, b) => `${a.last} ${a.first}`.localeCompare(`${b.last} ${b.first}`, "en", { sensitivity: "base" }));
/** "November 9–12, 2026", and in French "du 9 au 12 novembre 2026". */
export function dateRangeFr(event) {
  const a = at(event.dayOne), b = at(event.lastDay || event.dayOne);
  const day = (d) => (d.getUTCDate() === 1 ? "1er" : String(d.getUTCDate()));
  if (+a === +b) return `le ${day(a)} ${MOIS[a.getUTCMonth()]} ${a.getUTCFullYear()}`;
  if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) return `du ${day(a)} au ${day(b)} ${MOIS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
  return `du ${day(a)} ${MOIS[a.getUTCMonth()]}${a.getUTCFullYear() === b.getUTCFullYear() ? "" : ` ${a.getUTCFullYear()}`} au ${day(b)} ${MOIS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
}
export const dateRange = (event) => subtitleOf(event).replace(`ONGIA – ${event.title}, `, "");

/** "ONGIA – National Gang Summit, November 9–12, 2026", as on Andrew's sheet. */
function subtitleOf(event) {
  const a = at(event.dayOne), b = at(event.lastDay || event.dayOne);
  const [ma, mb, ya, yb] = [MONTH[a.getUTCMonth()], MONTH[b.getUTCMonth()], a.getUTCFullYear(), b.getUTCFullYear()];
  const range = +a === +b ? `${ma} ${a.getUTCDate()}, ${ya}`
    : ma === mb && ya === yb ? `${ma} ${a.getUTCDate()}–${b.getUTCDate()}, ${ya}`
    : ya === yb ? `${ma} ${a.getUTCDate()} – ${mb} ${b.getUTCDate()}, ${ya}` : `${ma} ${a.getUTCDate()}, ${ya} – ${mb} ${b.getUTCDate()}, ${yb}`;
  return `ONGIA – ${event.title}, ${range}`;
}

/** The dietary list for the hotel: only the people who told us about an allergy or intolerance. */
export function dietarySheet(event, answers) {
  // Someone Andrew added by hand who then answered the form too is listed once, with the latest of the two.
  const one = new Map();
  for (const a of [...answers].sort((x, y) => (x.at ?? "").localeCompare(y.at ?? ""))) {
    const k = `${a.first} ${a.last}`.toLowerCase().replace(/\s+/g, " ").trim();
    one.set(k, { ...a, table: a.table || one.get(k)?.table || "" });
  }
  const rows = byName([...one.values()].filter((a) => a.allergy)).map((a) => [a.first, a.last, a.dietary, a.table ?? ""]);
  return xlsx({
    title: "Allergy / Dietary List", subtitle: subtitleOf(event), sheet: "Dietary",
    columns: [{ head: "First Name", width: 16 }, { head: "Last Name", width: 16 }, { head: "Allergy / Dietary", width: 48 }, { head: "Table Number\n(If Applicable)", width: 16 }],
    rows,
  });
}

/** Who is coming to each social: yes or no, with the totals underneath. */
export function socialsSheet(event, answers, reply) {
  const socials = reply.socials ?? [];
  const list = byName(answers.filter((a) => a.source !== "desk"));   // added by hand on the desk: food only
  const rows = list.map((a) => [a.first, a.last, a.agency, ...socials.map((s) => (a.socials?.[s.id] === "yes" ? "Yes" : a.socials?.[s.id] === "no" ? "No" : ""))]);
  const yes = socials.map((s) => list.filter((a) => a.socials?.[s.id] === "yes").length);
  return xlsx({
    title: "Socials: who is coming", subtitle: subtitleOf(event), sheet: "Socials", landscape: socials.length > 2,
    columns: [{ head: "First Name", width: 16 }, { head: "Last Name", width: 16 }, { head: "Agency", width: 30 }, ...socials.map((s) => ({ head: socialLine(s), width: 26 }))],
    rows,
    footer: [["Total coming", "", `${list.length} answered`, ...yes.map((n) => n)]],
  });
}

/**
 * Someone's allergy added on the desk rather than through the form: a person who had already told Andrew (his
 * National Gang Summit sheet), or a phone call. Name and what it is; agency, email and table if known.
 */
export function cleanDeskEntry(body) {
  const first = text(body?.first, 80), last = text(body?.last, 80), dietary = text(body?.dietary, 600);
  if (!first && !last) return { problem: "Give at least a name." };
  if (!dietary) return { problem: `Say what ${first || last}'s allergy or dietary need is.` };
  const email = text(body?.email, 200).toLowerCase();
  return { entry: { first, last, agency: text(body?.agency, 200), email: isEmail(email) ? email : "", allergy: true, dietary, table: text(body?.table, 20), socials: {}, source: "desk" } };
}

/** The rows of a dietary sheet laid out like Andrew's: everything under the "First Name" header that has a name. */
export function dietaryRowsOf(rows) {
  const at = rows.findIndex((r) => /^\s*first\s*name\s*$/i.test(String(r[0] ?? "")));
  if (at < 0) return { problem: "That sheet has no \"First Name\" column heading. Use the same layout as the dietary list." };
  const head = rows[at].map((h) => String(h ?? "").toLowerCase());
  const col = (re, fallback) => { const i = head.findIndex((h) => re.test(h)); return i >= 0 ? i : fallback; };
  const [f, l, d, t, g, e] = [col(/first/, 0), col(/last/, 1), col(/allerg|diet/, 2), col(/table/, 3), col(/agency|organi/, -1), col(/e-?mail/, -1)];
  return { rows: rows.slice(at + 1).map((r) => ({ first: r[f], last: r[l], dietary: r[d], table: r[t], agency: g >= 0 ? r[g] : "", email: e >= 0 ? r[e] : "" }))
    .filter((r) => String(r.first ?? "").trim() || String(r.last ?? "").trim()) };
}

/** The email, as a letter: it uses the same layout and checks as the welcome letter. */
/** Where an answer to the email goes: the address it is signed with, or the event's lead. */
export const replyToOf = (event) => signOf(event)?.email || event.contact?.email || undefined;

/**
 * Who signs the questions email: the name typed on the card; for the National Gang Summit, the board and its inbox
 * unless something else is typed (Andrew 27 Oct 2026: "have it as ONGIA Board, email is ngs@ongia.ca"); otherwise
 * nobody here, and the event's lead signs as usual.
 */
export function signOf(event) {
  const r = event?.reply ?? {};
  if (r.signName) return { name: r.signName, email: r.signEmail || "" };
  if (attendeeSignOf(event)) return attendeeSignOf(event);
  return null;
}

export function replyLetter(reply, event = null) {
  const sign = signOf({ ...(event ?? {}), reply });
  // An email that places its own buttons ({replyButton}, {replyButtonFr}) has none added at the bottom.
  const placed = /\{replyButton(Fr)?\}/.test(reply.body ?? "");
  return { name: "Housekeeping questions", subject: reply.subject, body: reply.body, buttonLabel: reply.buttonLabel || "Answer the questions", buttonLink: placed ? "" : "{replyLink}",
    ...(sign ? { contact: { name: sign.name, email: sign.email, phone: sign.phone || "", ...(sign.member ? {} : { role: "" }) } } : {}) };
}
export const replyProblems = (event) => {
  const letter = replyLetter(event.reply, event);
  const out = [...letterProblems(letter), ...eventProblems(letter, event)];
  if (!event.reply.open) out.push("The form is closed. Open it before sending, or nobody can answer.");
  return [...new Set(out)];
};
export const renderReply = (event, person) => renderLetter(replyLetter(event.reply, event), event, person);

/**
 * Reminders (Andrew 26 Oct 2026: "a reminder for people to complete the form on Wednesday and Friday if they haven't").
 * The dates are the event's own; until someone sets them they are two days before the reply-by date and the day itself
 * (for the National Gang Summit, Wednesday 28 and Friday 30 October). The morning run (10 AM Eastern) sends each one.
 */
export function remindersOf(reply) {
  if (Array.isArray(reply?.reminders)) return reply.reminders;
  if (!isDate(reply?.replyBy)) return [];
  const two = new Date(at(reply.replyBy).getTime() - 2 * 86400000).toISOString().slice(0, 10);
  return [two, reply.replyBy];
}

/** The reminder: the same email, marked as a reminder at the top, so the words Andrew chose are the ones that go again. */
export function renderReminder(event, person) {
  const letter = replyLetter(event.reply, event);
  const paras = String(letter.body ?? "").split(/\n\s*\n/);
  // After the greeting ("Hello {first},"), one line saying why this has come again.
  const greet = paras.slice(0, 3).findIndex((p) => /^\s*(hello|hi|dear|bonjour)\b/i.test(p));
  const at1 = greet >= 0 ? greet + 1 : 0;
  paras.splice(at1, 0, "A quick reminder: we haven't had your answers yet. If you've already sent them, thank you, and please ignore this.");
  // And after the French half's greeting, the same in French.
  const bonjour = paras.findIndex((p, i) => i > at1 && /^\s*bonjour\b/i.test(p));
  if (bonjour > 0) paras.splice(bonjour + 1, 0, "Petit rappel : nous n'avons pas encore reçu vos réponses. Si vous les avez déjà envoyées, merci, et veuillez ne pas tenir compte de ce message.");
  return renderLetter({ ...letter, subject: `${bonjour > 0 ? "Reminder / Rappel" : "Reminder"}: ${letter.subject}`, body: paras.join("\n\n") }, event, person);
}

/** Who a reminder goes to: registered, had the email, and nobody at their address has answered yet. */
export function stillToAnswer(people, answers) {
  const told = toldUs(people, answers);
  return writeableTo(people).filter((p) => (p.sent ?? []).includes("reply") && !told.has(p.email));
}

/**
 * The registered addresses that have already told us (Andrew 26 Oct 2026: "I don't want to send an email again to
 * those who have answered already and who were on that Excel list"): anyone who answered the form, and anyone added
 * on the desk, by hand or from his sheet. A desk entry usually has no email, so it is matched to a registration by
 * first and last name. Neither the email nor its reminders go to these addresses.
 */
const nameKey = (p) => `${p.first ?? ""} ${p.last ?? ""}`.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]+/g, " ").trim();
export function toldUs(people, answers) {
  const out = new Set(answers.map((a) => a.email).filter(Boolean));
  const names = new Set(answers.filter((a) => !a.email).map(nameKey).filter(Boolean));
  for (const p of people) if (p.email && names.has(nameKey(p))) out.add(p.email);
  return out;
}

/** Today's reminder, if today is one of the dates: to everyone still to answer who has not had today's already. */
export async function sendReminderRound(event, { deadline = null, pace = pacer(), today = todayIso(), justSent = [] } = {}) {
  if (!event.reply?.sentAt) return { skipped: "the email has not been sent yet" };
  if (!remindersOf(event.reply).includes(today)) return { skipped: "no reminder today" };
  if (event.reply.replyBy && today > event.reply.replyBy) return { skipped: "past the reply-by date" };
  if (!event.reply.open) return { skipped: "the form is closed" };
  const problems = replyProblems(event);
  if (problems.length) return { blocked: problems };
  const mark = `reply-reminder:${today}`;
  const stored = (await getAttendees(event.id)) ?? { people: [] };
  const answers = (await getReplies(event.id))?.answers ?? [];
  // Someone whose first email went in this same run (they registered yesterday) is not reminded straight after it.
  const fresh = new Set(justSent);
  const owed = stillToAnswer(stored.people ?? [], answers).filter((p) => !(p.sent ?? []).includes(mark) && !fresh.has(p.email));
  let sent = 0, failed = 0, left = 0;
  const trouble = [];
  for (const person of owed) {
    if (!timeLeft(deadline)) { left = owed.length - sent - failed; break; }
    await pace();
    try {
      const out = await sendMail({ to: person.email, replyTo: replyToOf(event), ...renderReminder(event, person) });
      if (out.skipped) { trouble.push({ email: person.email, why: out.reason }); failed++; continue; }
      for (const same of (stored.people ?? []).filter((p) => p.email === person.email)) same.sent = [...new Set([...(same.sent ?? []), mark])];
      sent++;
      await putAttendees(event.id, stored);
    } catch (e) { trouble.push({ email: person.email, why: e.message }); failed++; }
  }
  await putAttendees(event.id, { ...stored, letterRounds: { ...(stored.letterRounds ?? {}), [mark]: { at: new Date().toISOString(), sent, failed, left, trouble: trouble.slice(0, 10) } } });
  return { sent, failed, left, trouble: trouble.slice(0, 10) };
}

/**
 * Send the email to everyone registered who has not had it. Each address is marked the moment its email goes, so a
 * run stopped part-way never sends anyone a second copy; whoever is left goes on the next run.
 */
export async function sendReplyRound(event, { deadline = null, pace = pacer(), today = todayIso() } = {}) {
  if (!event.reply?.sentAt) return { skipped: "not sent from the event page yet" };
  if (event.reply.replyBy && today > event.reply.replyBy) return { skipped: "past the reply-by date" };
  const problems = replyProblems(event);
  if (problems.length) return { blocked: problems };
  const stored = (await getAttendees(event.id)) ?? { people: [] };
  const had = new Set((stored.people ?? []).filter((p) => (p.sent ?? []).includes("reply")).map((p) => p.email));
  const told = toldUs(stored.people ?? [], (await getReplies(event.id))?.answers ?? []);
  const owed = writeableTo(stored.people ?? []).filter((p) => !had.has(p.email) && !told.has(p.email));
  let sent = 0, failed = 0, left = 0;
  const trouble = [];
  for (const person of owed) {
    if (!timeLeft(deadline)) { left = owed.length - sent - failed; break; }
    await pace();
    try {
      const out = await sendMail({ to: person.email, replyTo: replyToOf(event), ...renderReply(event, person) });
      if (out.skipped) { trouble.push({ email: person.email, why: out.reason }); failed++; continue; }
      for (const same of (stored.people ?? []).filter((p) => p.email === person.email)) {
        same.sent = [...new Set([...(same.sent ?? []), "reply"])];
        same.sentAt = { ...(same.sentAt ?? {}), reply: new Date().toISOString() };
      }
      sent++;
      await putAttendees(event.id, stored);
    } catch (e) { trouble.push({ email: person.email, why: e.message }); failed++; }
  }
  await putAttendees(event.id, { ...stored, letterRounds: { ...(stored.letterRounds ?? {}), reply: { at: new Date().toISOString(), sent, failed, left, trouble: trouble.slice(0, 10) } } });
  return { sent, failed, left, trouble: trouble.slice(0, 10), sentTo: owed.slice(0, sent + failed).map((p) => p.email) };
}

/** Where the email stands: how many it reaches, how many had it, the last round. */
export async function replyStatus(event) {
  const stored = (await getAttendees(event.id)) ?? { people: [] };
  const people = stored.people ?? [];
  const answers = (await getReplies(event.id))?.answers ?? [];
  return {
    reaches: new Set(writeableTo(people).map((p) => p.email)).size,
    // Why that is fewer than the registrations (Andrew 27 Oct 2026: "the button says 367 registered and the number at
    // the top says 403"): one email goes to each address, so registrations sharing an address get one between them,
    // and a registration with no email address gets none.
    registrations: people.filter((p) => p.status === "ATTENDING").length,
    noEmail: people.filter((p) => p.status === "ATTENDING" && !isEmail(p.email)).length,
    had: new Set(people.filter((p) => (p.sent ?? []).includes("reply")).map((p) => p.email)).size,
    round: stored.letterRounds?.reply ?? null,
    answered: answers.length,
    stillToAnswer: stillToAnswer(people, answers).length,
    // Registered addresses the email and reminders will skip, because someone there already told us.
    alreadyTold: [...toldUs(people, answers)].filter((e) => writeableTo(people).some((p) => p.email === e)).length,
    // Who "Send" would email right now: registered, not had it, nobody there has told us yet.
    toSend: (() => { const told = toldUs(people, answers); const had = new Set(people.filter((p) => (p.sent ?? []).includes("reply")).map((p) => p.email));
      return writeableTo(people).filter((p) => !had.has(p.email) && !told.has(p.email)).length; })(),
    reminders: remindersOf(event.reply).map((d) => ({ date: d, round: stored.letterRounds?.[`reply-reminder:${d}`] ?? null })),
  };
}
