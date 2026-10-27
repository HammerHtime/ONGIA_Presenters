import { text, isEmail } from "./http.mjs";
import { token } from "./ids.mjs";
import { checklistOf } from "./checklist.mjs";
import { groupDaysOf } from "./letters.mjs";
import { writeableTo } from "./attendees.mjs";

/**
 * An event's welcome letter, written on the event itself (Andrew 27 Oct 2026: "I need the one place to write the
 * letters. And then under the National Gang Summit event, I just need to click email attendees").
 *
 * The event keeps its own words: `event.welcome.main` for everyone, and, when the event pulls a second Wix event (the
 * Summit's community partners), `event.welcome.group` for the people from it. Each goes with its own agenda: the main
 * one with the event's agenda, the group's with theirs, attached whenever one is uploaded. Nothing to tick.
 *
 * Who gets which is the desk's call, from where each person registered: an address whose every registration came
 * from the second Wix event gets the group's; anyone also on the first gets the main one.
 */

const isSummit = (event) => /national gang summit/i.test(event?.title ?? "");
const town = (event) => String(event?.city ?? "").split(",")[0].trim();

/** Whether the event has a second group, and what to call each. */
export function groupsOf(event) {
  const g = (event?.wixMore ?? [])[0];
  if (!g) return { main: "Everyone", group: null };
  return { main: isSummit(event) ? "Justice partners" : "Everyone else", group: g.group || "The second group" };
}

/** The words a welcome letter starts with: the Summit's, written for its two groups; any other event's, the general one. */
export function startingWelcome(event, chosen = null) {
  const at = town(event) || "{city}";
  const summit = isSummit(event);
  const main = chosen?.body
    ? { subject: chosen.subject, body: chosen.body }
    : {
      subject: summit ? "Welcome to the National Gang Summit" : "Welcome to {event}",
      body: [
        "Hello {first},",
        summit ? `Thank you for registering for the National Gang Summit. We're glad you're joining us in ${at}.` : `Thank you for registering for {event}. We're glad you're joining us in ${at}.`,
        "WHEN AND WHERE",
        summit ? "The Summit runs {dates} at {venue}." : "It runs {dates} at {venue}.",
        "{schedule}",
        "The full agenda is attached.",
        "DRESS CODE",
        "Business casual.",
        "QUESTIONS",
        "If you have a question, or your plans change and you can't make it, reply to this email and let us know.",
        `See you in ${at}.`,
      ].join("\n\n"),
    };
  if (!groupsOf(event).group) return { main };
  const group = {
    subject: summit ? "Welcome to the National Gang Summit: community partners" : main.subject,
    body: [
      "Hello {first},",
      summit ? `Thank you for registering as a community partner for the National Gang Summit. We're glad you're joining us in ${at}.` : `Thank you for registering. We're glad you're joining us in ${at}.`,
      "WHEN AND WHERE",
      "You're with us {dates} at {venue}.",
      "{schedule}",
      "Your agenda for those days is attached.",
      "DRESS CODE",
      "Business casual.",
      "QUESTIONS",
      "If you have a question, or your plans change and you can't make it, reply to this email and let us know.",
      `See you in ${at}.`,
    ].join("\n\n"),
  };
  return { main, group };
}

/** The event's own words, or what they start as. */
export const welcomeOf = (event, chosen = null) => ({ ...startingWelcome(event, chosen), ...(event?.welcome ?? {}) });

/** The two versions as letters the sender and the preview understand. Agendas are attached whenever there is one. */
export function welcomeLetters(event, words = welcomeOf(event)) {
  const out = { main: { id: "event-welcome", kind: "welcome", name: groupsOf(event).group ? `Welcome letter (${groupsOf(event).main})` : "Welcome letter",
    subject: words.main?.subject ?? "", body: words.main?.body ?? "", attachAgenda: !!event.agendaFile } };
  if (groupsOf(event).group && words.group) {
    out.group = { id: "event-welcome-group", kind: "welcome", audience: "group", name: `Welcome letter (${groupsOf(event).group})`,
      subject: words.group.subject ?? "", body: words.group.body ?? "", attachAgenda: !!event.agendaGroupFile };
  }
  return out;
}

/** The words as typed on the event page. */
export function cleanWelcome(given, had = {}) {
  const one = (v, was) => (v === undefined ? was : { subject: text(v?.subject, 200), body: String(v?.body ?? "").replace(/\r/g, "").slice(0, 8000) });
  const out = { ...had };
  if (given?.main !== undefined) out.main = one(given.main, had.main);
  if (given?.group !== undefined) out.group = one(given.group, had.group);
  return out;
}

/** Who gets which: an address whose every registration came from the second Wix event is the group's. */
export function splitByGroup(people, owed) {
  const rows = people.filter((p) => p.status !== "WITHDRAWN");
  const groupOnly = (email) => rows.filter((p) => p.email === email).every((p) => p.group);
  return { main: owed.filter((p) => !groupOnly(p.email)), group: owed.filter((p) => groupOnly(p.email)) };
}

/** How many each version reaches, and how many have had it. */
export function welcomeReach(event, people = []) {
  const all = writeableTo(people);
  const split = groupsOf(event).group ? splitByGroup(people, all) : { main: all, group: [] };
  const had = (list) => list.filter((p) => people.some((q) => q.email === p.email && (q.sent ?? []).includes("welcome"))).length;
  return { main: { reaches: split.main.length, had: had(split.main) }, group: { reaches: split.group.length, had: had(split.group) } };
}

/** The day the welcome letter goes: its checklist job's date. */
export const welcomeJob = (event, today) => checklistOf(event, today).tasks.find((t) => t.auto === "welcome") ?? null;

/** Move the welcome letter's day: its checklist job, made if the event has none. Returns a problem, or null. */
export function setSendDay(event, iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso ?? "")) || !event.dayOne) return "Pick the day it goes.";
  const days = Math.round((Date.parse(event.dayOne) - Date.parse(iso)) / 86400000);
  if (days < 0) return "The welcome letter has to go before the event starts.";
  event.tasks ??= [];
  const job = event.tasks.find((t) => t.auto === "welcome");
  if (job) { job.daysBefore = days; delete job.from; job.na = false; }
  else event.tasks.push({ id: token(8), what: "Welcome letter sent to attendees", daysBefore: days, auto: "welcome", done: false, doneAt: null, na: false, addedAt: new Date().toISOString() });
  return null;
}

export const testAddresses = (to) => [...new Set(String(to ?? "").split(/[,;\s]+/).map((a) => a.trim().toLowerCase()).filter(Boolean))].filter(isEmail).slice(0, 5);

export const welcomeGroupDays = groupDaysOf;
