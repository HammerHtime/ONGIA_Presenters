import { checklistOf } from "./checklist.mjs";
import { setSendDay } from "./welcome.mjs";
import { localNow, zoneOf, surveyAt } from "./surveysend.mjs";
import { thanksDay, thanksAt } from "./thanks.mjs";
import { certsWhen } from "./certauto.mjs";

/**
 * The day and time each automatic email goes, set from its line on Communications (Andrew 24 Nov 2026: "if I click that
 * a calendar and time window appears and I can set the date and time I want it to send"). Times are the event's own
 * (Victoria's in Pacific time). Each email keeps its own rule about when it may go:
 *
 *   welcome   a day before the event starts (never on or after day one: the backlog rule)
 *   survey    the survey after the event: on or after its last day
 *   certs     after the last day
 *   thanks    the presenter thank-you: after the last day
 *
 * and none can be set to a time already past. The hotel reminders, a daily survey and the food-allergy reminders follow
 * their own dates (the cut-off, each day's last session, the reminder days), changed where those are.
 */
export const SETTABLE = ["welcome", "survey", "certs", "thanks"];
const DAY = /^\d{4}-\d{2}-\d{2}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** When the morning run goes (14:00 UTC), in the event's own time on that day: the welcome letter's time if none is set. */
function morningIn(event, day) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zoneOf(event), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(`${day}T14:00:00Z`));
}

/** The day and time an email goes, as things stand. */
export function whenOf(event, kind) {
  if (kind === "welcome") {
    const due = checklistOf(event).tasks.find((t) => t.auto === "welcome" && !t.na)?.due ?? "";
    return { day: due, time: TIME.test(event.welcomeAt ?? "") ? event.welcomeAt : due ? morningIn(event, due) : "09:00", set: !!event.welcomeAt };
  }
  if (kind === "survey") return { day: event.survey?.mode === "end" ? event.survey?.sendOn ?? "" : "", time: surveyAt(event), set: !!event.survey?.sendAt };
  if (kind === "certs") { const w = certsWhen(event); return { day: w.day, time: w.time, set: !!(event.certs?.sendDay || event.certs?.sendTime) }; }
  if (kind === "thanks") return { day: thanksDay(event), time: thanksAt(event), set: !!(event.presenterThanks?.sendDay || event.presenterThanks?.sendTime) };
  return null;
}

/** Set an email's day and time. Changes the event in place; returns what's wrong, or null. */
export function setWhen(event, kind, day, time, now = new Date()) {
  if (!SETTABLE.includes(kind)) return "That email's dates are set where it lives.";
  if (!DAY.test(day ?? "")) return "Pick a day.";
  if (!TIME.test(time ?? "")) return "Pick a time.";
  const start = event.dayOne || "", end = event.lastDay || event.dayOne || "";
  if (`${day} ${time}` <= localNow(event, now)) return "That time has already passed. Pick a later one.";
  if (kind === "welcome") {
    if (!start) return "The event has no start date yet.";
    if (day >= start) return "The welcome letter goes before the event starts. Pick a day before its first day.";
    const problem = setSendDay(event, day);
    if (problem) return problem;
    event.welcomeAt = time;
    return null;
  }
  if (kind === "survey") {
    if (event.survey?.mode !== "end") return "A daily survey goes after each day's last session: change those times under Agenda.";
    if (end && day < end) return "The survey goes once the event is over: pick its last day or later.";
    event.survey = { ...event.survey, sendOn: day, sendAt: time };
    return null;
  }
  if (end && day <= end) return "It goes after the event: pick a day after its last day.";
  if (kind === "certs") { event.certs = { ...(event.certs ?? {}), sendDay: day, sendTime: time }; return null; }
  event.presenterThanks = { ...(event.presenterThanks ?? {}), sendDay: day, sendTime: time };
  return null;
}

/** Every settable email's day and time, for the desk. */
export const whenAll = (event) => ({ zone: zoneOf(event), ...Object.fromEntries(SETTABLE.map((k) => [k, whenOf(event, k)])) });
