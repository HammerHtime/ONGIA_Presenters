import { getAttendees, putAttendees } from "./store.mjs";
import { writeableTo } from "./attendees.mjs";
import { letterProblems, eventProblems, renderLetter, attendeeReplyTo } from "./letters.mjs";
import { sendMail } from "./mail.mjs";
import { welcomeLetters, splitByGroup, extrasOf } from "./welcome.mjs";
import { hhmm24, zoneOf } from "./surveysend.mjs";
import { pacer, timeLeft } from "./bulk.mjs";
import { markRows } from "./attmail.mjs";

/**
 * The reminder to people joining online, a couple of hours before it starts, with how to log in (Andrew 5 Nov 2026:
 * "two hours before virtual event starts need to send out email with the log in info as a reminder"). One for each
 * online group (the Summit's Virtual registrations). It goes only once Andrew has read it and marked it ready; then at
 * its time to everyone in that group, and to anyone who registers after, until the first session has been on an hour.
 */
export const KIND = (key) => `join:${key}`;
const HOURS = [1, 2, 3, 4];

/** The online groups an event has. */
export const onlineGroups = (event) => extrasOf(event).filter((x) => x.link?.online);

/** "2026-11-09" + "09:30" in a time zone, as the instant it is. */
export function zonedInstant(date, hhmm, zone) {
  const guess = Date.parse(`${date}T${hhmm}:00Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const shown = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`);
  return new Date(guess - (shown - guess));
}

/** When the group's first session starts, and when the reminder goes. */
export function timesOf(event, key) {
  const x = onlineGroups(event).find((g) => g.key === key);
  const day = x?.link?.dayOne || event.dayOne;
  if (!day) return null;
  const start = hhmm24((event.schedule ?? []).find((d) => d.date === day)?.start) ?? "09:00";
  const zone = zoneOf(event);
  const startAt = zonedInstant(day, start, zone);
  const hours = HOURS.includes(Number(event.joinReminder?.[key]?.hours)) ? Number(event.joinReminder[key].hours) : 2;
  return { day, start, zone, hours, startAt: startAt.toISOString(), sendAt: new Date(startAt - hours * 3600e3).toISOString() };
}

/** The Zoom details from the group's welcome letter ("Join Zoom Meeting" to the passcode), to start the reminder from. */
function loginBlock(event, key) {
  const body = String(welcomeLetters(event)[key]?.body ?? "");
  const m = body.match(/(Join Zoom Meeting[\s\S]*?Passcode:[^\n]*)/i) ?? body.match(/(https?:\/\/\S*zoom\.us\S*[\s\S]*?(?:\n\s*\n|$))/i);
  return m ? m[1].trim() : "[THE ZOOM LINK, MEETING ID AND PASSCODE]";
}

/** The words: as saved, or a draft to start from. */
export function joinWords(event, key) {
  const saved = event.joinReminder?.[key];
  if (saved?.body) return { subject: saved.subject ?? "", body: saved.body };
  const t = timesOf(event, key);
  const when = t ? `${Number(t.start.slice(0, 2)) % 12 || 12}:${t.start.slice(3)} ${Number(t.start.slice(0, 2)) < 12 ? "a.m." : "p.m."}` : "";
  return {
    subject: "Starting today: how to join online",
    body: `Hello {first},

{event} starts online today${when ? ` at ${when} Eastern` : ""}. Here's how to join.

${loginBlock(event, key)}

Please join a few minutes early, using the same name you registered with. Cameras and microphones are off for attendees.

If your work computer blocks the Zoom app, open the link in your web browser instead.

Please watch from somewhere private, and don't record or take screenshots.

See you online.`,
  };
}

export const joinLetter = (event, key) => ({ id: `event-join-${key}`, kind: "welcome", audience: key, name: "Joining-online reminder", attachAgenda: false, ...joinWords(event, key) });

/** Everyone in that group with an address, and who has had the reminder. */
export function joinPeople(event, key, people) {
  const all = splitByGroup(people, writeableTo(people), event)[key] ?? [];
  const had = (p) => people.some((q) => q.email === p.email && (q.sent ?? []).includes(KIND(key)));
  return { all, owed: all.filter((p) => !had(p)) };
}

/** Whether it's time: marked ready, its time come, and not more than an hour into the first session. */
export function joinDue(event, key, now = new Date()) {
  const t = timesOf(event, key);
  if (!t || !event.joinReminder?.[key]?.readyAt) return false;
  return now >= new Date(t.sendAt) && now < new Date(Date.parse(t.startAt) + 3600e3);
}

/** Send it to everyone in the group still owed it. `force` is Send now: any time, once it's marked ready. */
export async function sendJoinRound(event, key, { deadline = null, pace = pacer(), force = false, now = new Date() } = {}) {
  if (!onlineGroups(event).some((g) => g.key === key)) return { blocked: ["That group isn't joining online."] };
  if (!event.joinReminder?.[key]?.readyAt) return { blocked: ["The reminder isn't marked ready yet."] };
  if (!force && !joinDue(event, key, now)) return { skipped: "not its time" };
  const letter = joinLetter(event, key);
  const wrong = [...letterProblems(letter), ...eventProblems(letter, event)];
  if (wrong.length) return { blocked: wrong };
  const stored = (await getAttendees(event.id)) ?? { people: [] };
  const people = stored.people ?? [];
  const { owed } = joinPeople(event, key, people);
  let sent = 0, failed = 0, left = 0;
  const trouble = [];
  for (const person of owed) {
    if (!timeLeft(deadline)) { left = owed.length - sent - failed; break; }
    await pace();
    try {
      const out = await sendMail({ to: person.email, replyTo: attendeeReplyTo(event), ...renderLetter(letter, event, person) });
      if (out.skipped) throw new Error(out.reason);
      markRows(people, person.email, KIND(key), { sent: true });
      sent++;
    } catch (e) { markRows(people, person.email, KIND(key), { why: e.message }); trouble.push({ email: person.email, why: e.message }); failed++; }
    await putAttendees(event.id, stored);
  }
  return { sent, failed, left, trouble: trouble.slice(0, 10), letter: letter.name };
}
