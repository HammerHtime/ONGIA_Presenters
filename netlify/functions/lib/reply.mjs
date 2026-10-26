import { text, isEmail } from "./http.mjs";
import { todayIso } from "./deadlines.mjs";
import { token as newToken } from "./ids.mjs";
import { getAttendees, putAttendees, getReplies } from "./store.mjs";
import { writeableTo } from "./attendees.mjs";
import { letterProblems, eventProblems, renderLetter } from "./letters.mjs";
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

/** What a new event's questions start as: the National Gang Summit's two nights, which Andrew can reword. */
export function startingReply(event, now = new Date()) {
  // The Friday of this week, or today if that has passed: Andrew's "end of this week".
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + ((5 - d.getUTCDay() + 7) % 7));
  return {
    token: newToken(16),
    open: true,
    replyBy: d.toISOString().slice(0, 10),
    socials: [
      { id: "s1", date: dayN(event, 2), label: "Networking social, followed by a screening of the documentary WATTS",
        labelFr: "Activité de réseautage, suivie de la projection du documentaire WATTS" },
      { id: "s2", date: dayN(event, 3), label: "Social at the hotel, with a live band",
        labelFr: "Soirée à l'hôtel, avec un groupe de musique" },
    ],
    subject: "{event}: a few quick questions",
    body: [
      "Hello {first},",
      "We're putting the final touches on the {event}, and we're looking forward to hosting you and to hearing from a great lineup of speakers.",
      "A few housekeeping questions before then. We'd like to know about any food allergy or intolerance, so the hotel can plan your meals. If you have none, you can skip that part.",
      "We'd also like to know whether you'll come to each of the socials:",
      "* {social1}\n* {social2}",
      "Please answer by end of day {replyBy}, so the hotel has time to plan. It takes about a minute.",
      "See you soon.",
    ].join("\n\n"),
    buttonLabel: "Answer the questions",
  };
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
  const allergy = body?.allergy === true;
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
  const rows = byName(answers.filter((a) => a.allergy)).map((a) => [a.first, a.last, a.dietary, ""]);
  return xlsx({
    title: "Allergy / Dietary List", subtitle: subtitleOf(event), sheet: "Dietary",
    columns: [{ head: "First Name", width: 16 }, { head: "Last Name", width: 16 }, { head: "Allergy / Dietary", width: 48 }, { head: "Table Number\n(If Applicable)", width: 16 }],
    rows,
  });
}

/** Who is coming to each social: yes or no, with the totals underneath. */
export function socialsSheet(event, answers, reply) {
  const socials = reply.socials ?? [];
  const list = byName(answers);
  const rows = list.map((a) => [a.first, a.last, a.agency, ...socials.map((s) => (a.socials?.[s.id] === "yes" ? "Yes" : a.socials?.[s.id] === "no" ? "No" : ""))]);
  const yes = socials.map((s) => list.filter((a) => a.socials?.[s.id] === "yes").length);
  return xlsx({
    title: "Socials: who is coming", subtitle: subtitleOf(event), sheet: "Socials", landscape: socials.length > 2,
    columns: [{ head: "First Name", width: 16 }, { head: "Last Name", width: 16 }, { head: "Agency", width: 30 }, ...socials.map((s) => ({ head: socialLine(s), width: 26 }))],
    rows,
    footer: [["Total coming", "", `${list.length} answered`, ...yes.map((n) => n)]],
  });
}

/** The email, as a letter: it uses the same layout and checks as the welcome letter. */
export function replyLetter(reply) {
  return { name: "Housekeeping questions", subject: reply.subject, body: reply.body, buttonLabel: reply.buttonLabel || "Answer the questions", buttonLink: "{replyLink}" };
}
export const replyProblems = (event) => {
  const letter = replyLetter(event.reply);
  const out = [...letterProblems(letter), ...eventProblems(letter, event)];
  if (!event.reply.open) out.push("The form is closed. Open it before sending, or nobody can answer.");
  if (!(event.reply.socials ?? []).length) out.push("There are no socials to ask about. Add at least one.");
  return [...new Set(out)];
};
export const renderReply = (event, person) => renderLetter(replyLetter(event.reply), event, person);

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
  const owed = writeableTo(stored.people ?? []).filter((p) => !had.has(p.email));
  let sent = 0, failed = 0, left = 0;
  const trouble = [];
  for (const person of owed) {
    if (!timeLeft(deadline)) { left = owed.length - sent - failed; break; }
    await pace();
    try {
      const out = await sendMail({ to: person.email, replyTo: event.contact?.email || undefined, ...renderReply(event, person) });
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
  return { sent, failed, left, trouble: trouble.slice(0, 10) };
}

/** Where the email stands: how many it reaches, how many had it, the last round. */
export async function replyStatus(event) {
  const stored = (await getAttendees(event.id)) ?? { people: [] };
  const people = stored.people ?? [];
  const answers = (await getReplies(event.id))?.answers ?? [];
  return {
    reaches: new Set(writeableTo(people).map((p) => p.email)).size,
    had: new Set(people.filter((p) => (p.sent ?? []).includes("reply")).map((p) => p.email)).size,
    round: stored.letterRounds?.reply ?? null,
    answered: answers.length,
  };
}
