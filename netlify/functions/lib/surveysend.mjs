import { getAttendees, putAttendees } from "./store.mjs";
import { writeableTo } from "./attendees.mjs";
import { renderLetter, letterProblems, eventProblems, attendeeReplyTo } from "./letters.mjs";
import { sendMail } from "./mail.mjs";
import { pacer, timeLeft } from "./bulk.mjs";
import { trainingDays } from "./agenda.mjs";
import { guessProvince } from "./sow.mjs";
import { daysFor, surveyProblems, isPartner } from "./survey.mjs";

/**
 * Sending an event's survey (Andrew 27 Oct 2026):
 *  - at the end: once, on the day picked, in the morning run;
 *  - daily: each day's part 15 minutes after that day's last session ends, by its end time saved under Agenda and
 *    daily times, in the event's own time zone. A day with no end time is held back, never guessed.
 * Only while attendee emails are on. Each address gets each part once; someone registered only for some days (the
 * Summit's community partners) only gets those days.
 */

const ZONES = { BC: "America/Vancouver", AB: "America/Edmonton", SK: "America/Regina", MB: "America/Winnipeg", ON: "America/Toronto", QC: "America/Toronto",
  NB: "America/Moncton", NS: "America/Halifax", PE: "America/Halifax", NL: "America/St_Johns" };
export const zoneOf = (event) => ZONES[guessProvince(event?.city)] ?? "America/Toronto";

/** "2026-11-10 16:15" in the event's own time zone. */
export function localNow(event, now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zoneOf(event), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** A session time as typed on the event ("5:00 PM", "9:30 am", "17:00", "5 PM") as 24-hour "HH:MM", or null. */
export function hhmm24(v) {
  const m = String(v ?? "").trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?$/i);
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2] ?? 0);
  if (m[3]) { const pm = m[3].toLowerCase() === "p"; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  return h < 24 && min < 60 ? `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` : null;
}
// The Summit's times are kept as "5:00 PM" (Andrew types them that way): read either form (5 Nov 2026).
const add15 = (time) => { const v = hhmm24(time); if (!v) return null; const [h, m] = v.split(":").map(Number); const t = h * 60 + m + 15; return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };

/** When each daily part goes: 15 minutes after that day's last session. Days with no end time say so. */
export function dailyTimes(event) {
  const ends = new Map((event.schedule ?? []).filter((d) => d.end).map((d) => [d.date, d.end]));
  return trainingDays(event).map((day) => ({ day, at: ends.has(day) ? add15(ends.get(day)) : null }));
}

/** The parts due now: in daily mode, today's (or an earlier day's not yet sent, up to a day late); at the end, "end". */
export function partsDue(event, now = new Date()) {
  const s = event.survey;
  if (!s?.open) return [];
  const [today, time] = localNow(event, now).split(" ");
  // At the end: on its day from 9 in the morning, local time (never at midnight), or any later day if missed.
  if (s.mode === "end") return s.sendOn && (today > s.sendOn || (today === s.sendOn && time >= "09:00")) ? ["end"] : [];
  const yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
  return dailyTimes(event).filter((d) => d.at && (d.day < today ? d.day >= yesterday : d.day === today && time >= d.at)).map((d) => d.day);
}

/** The email, in both languages, with each person's own buttons. Words Andrew can change are kept on the event. */
const shortTitle = (event) => String(event?.title ?? "").split(/\s*:\s*/)[0].trim() || "{event}";
export function surveyLetter(event, part, { partner = false } = {}) {
  const s = event.survey ?? {};
  const daily = part !== "end";
  // The community partners' own email on their days (Andrew 9 Nov 2026: "use the separate email for community partners").
  const mine = partner && daily;
  const own = mine ? s.partnerWords : daily ? s.dailyWords : s.endWords;
  return {
    name: mine ? "Survey (community partners)" : "Survey", kind: "survey",
    // The event's name before its subtitle (Andrew 9 Nov 2026: "change the title line"): "National Gang Summit: how was
    // today?", not the whole "…: Organized Crime, Gangs & Youth: Building Solutions for a Safer Future: how was today?".
    subject: own?.subject || `${shortTitle(event)}: ${daily ? "how was today? / Votre avis sur la journée" : "tell us how it went / Votre avis"}`,
    body: own?.body || [
      "Hello {first},",
      mine ? "Thank you for joining us today as one of our community partners. Your view from the community matters to us. Please take two minutes to tell us how today's sessions went, while they're fresh. Your answers are anonymous."
        : daily ? "Thank you for being with us today. Please take two minutes to tell us how today's sessions went, while they're fresh. Your answers are anonymous."
        : "Thank you for being part of {event}. Please take a few minutes to tell us how it went. Your answers are anonymous and help us plan the next one.",
      "{surveyButton}",
      ...(daily ? ["Already scanned today's QR code? Then you're done. Thank you."] : []),
      "FRANÇAIS",
      "Bonjour {first},",
      mine ? "Merci d'avoir été des nôtres aujourd'hui à titre de partenaire communautaire. Le regard de la communauté compte pour nous. Prenez deux minutes pour nous dire ce que vous avez pensé des séances de la journée, pendant qu'elles sont fraîches à votre mémoire. Vos réponses sont anonymes."
        : daily ? "Merci d'avoir été des nôtres aujourd'hui. Prenez deux minutes pour nous dire ce que vous avez pensé des séances de la journée, pendant qu'elles sont fraîches à votre mémoire. Vos réponses sont anonymes."
        : "Merci d'avoir participé à {event}. Prenez quelques minutes pour nous dire comment ça s'est passé. Vos réponses sont anonymes et nous aident à préparer le prochain événement.",
      "{surveyButtonFr}",
      ...(daily ? ["Vous avez déjà balayé le code QR d'aujourd'hui? Alors c'est fait. Merci!"] : []),
    ].join("\n\n"),
    buttonLabel: "", buttonLink: "",
  };
}

const sentKey = (part) => `survey:${part}`;

/** One round of one part: everyone owed it gets it, once per address. */
export async function sendSurveyRound(event, part, { deadline = null, pace = pacer() } = {}) {
  const problems = surveyProblems(event);
  const letter = surveyLetter(event, part);
  const partnerLetter = surveyLetter(event, part, { partner: true });
  const wrong = [...new Set([...problems, ...[letter, partnerLetter].flatMap((l) => [...letterProblems(l), ...eventProblems(l, event)])])];
  if (wrong.length) return { event: event.id, title: event.title, kind: "survey", part, blocked: wrong };
  const stored = (await getAttendees(event.id)) ?? { people: [] };
  const owed = owedFor(event, part, stored.people ?? []);
  let sent = 0, failed = 0, left = 0;
  const trouble = [];
  for (const person of owed) {
    if (!timeLeft(deadline)) { left = owed.length - sent - failed; break; }
    await pace();
    try {
      const out = await sendMail({ to: person.email, replyTo: attendeeReplyTo(event), ...renderLetter(isPartner(event, person) ? partnerLetter : letter, event, person) });
      if (out.skipped) { trouble.push({ email: person.email, why: out.reason }); failed++; continue; }
      for (const same of (stored.people ?? []).filter((p) => p.email === person.email)) {
        same.sent = [...new Set([...(same.sent ?? []), sentKey(part)])];
        same.sentAt = { ...(same.sentAt ?? {}), [sentKey(part)]: new Date().toISOString() };
      }
      sent++;
      await putAttendees(event.id, stored);
    } catch (e) { trouble.push({ email: person.email, why: e.message }); failed++; }
  }
  await putAttendees(event.id, { ...stored, letterRounds: { ...(stored.letterRounds ?? {}), [sentKey(part)]: { at: new Date().toISOString(), sent, failed, left } } });
  return { event: event.id, title: event.title, kind: "survey", part, sent, failed, left, trouble: trouble.slice(0, 10) };
}

/** Who a part still has to go to: everyone registered who hasn't had it, and for a daily part only those there that day. */
export function owedFor(event, part, people) {
  const had = new Set(people.filter((p) => (p.sent ?? []).includes(sentKey(part))).map((p) => p.email));
  // A daily part only goes to people whose days include it (the Summit's community partners: their two days).
  return writeableTo(people).filter((p) => !had.has(p.email) && (part === "end" || daysFor(event, p).includes(part)));
}

/** Whether any survey part is due with someone still to get it: the 15-minute check starts the sending only then. */
export async function surveyWorkDue(events, now = new Date()) {
  for (const event of events) {
    if (event.attendeeMail !== true || !event.survey?.open) continue;
    const parts = partsDue(event, now);
    if (!parts.length) continue;
    const people = ((await getAttendees(event.id)) ?? {}).people ?? [];
    if (parts.some((part) => owedFor(event, part, people).length)) return true;
  }
  return false;
}

/** Every event's survey parts that are due. Called by the morning run and the 15-minute check. */
export async function runSurveyRounds(events, opts = {}) {
  const out = [];
  for (const event of events) {
    if (event.attendeeMail !== true || !event.survey?.open) continue;
    for (const part of partsDue(event, opts.now)) {
      try { out.push(await sendSurveyRound(event, part, opts)); }
      catch (e) { out.push({ event: event.id, title: event.title, kind: "survey", part, error: e.message }); }
    }
  }
  return out;
}
