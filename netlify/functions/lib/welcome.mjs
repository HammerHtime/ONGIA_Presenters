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

/**
 * Further groups (Andrew 3 Nov 2026: the Summit's virtual attendees register on a third Wix event, and need their own
 * welcome letter, with its own attachments ticked, beside the justice and community partners'). Each Wix event linked
 * after the second is a group with its own version of the letter, keyed by its Wix event so the key never moves.
 */
export const extraKey = (link) => `x${String(link?.eventId ?? "").replace(/[^a-z0-9]/gi, "").slice(0, 10)}`;
export const extrasOf = (event) => (event?.wixMore ?? []).slice(1).filter((l) => l?.eventId)
  .map((l) => ({ key: extraKey(l), label: l.group || "Another group", link: l }));

/** Every version this event's welcome letter has: main, the second group's, then any further group's. */
export const versionKeys = (event) => ["main", ...(groupsOf(event).group ? ["group"] : []), ...extrasOf(event).map((x) => x.key)];

/** What each version is called on the event page. */
export const versionLabel = (event, key) => (key === "main" || key === "group" ? groupsOf(event)[key] : extrasOf(event).find((x) => x.key === key)?.label) ?? "";

/** The Wix events whose people are online, not in the room: no housekeeping questions (meals, receptions) for them. */
export const onlineLinks = (event) => new Set((event?.wixMore ?? []).filter((l) => l?.online && l.eventId).map((l) => l.eventId));
export const inTheRoom = (event, people) => { const off = onlineLinks(event); return off.size ? people.filter((p) => !off.has(p.wixEventId)) : people; };

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

/**
 * The event's own words, or what they start as. A further group's version starts empty: it is written for them (the
 * virtual attendees join on Zoom, with no venue or dress code), and until it is saved its people are sent nothing.
 */
export const welcomeOf = (event, chosen = null) => ({ ...startingWelcome(event, chosen),
  ...Object.fromEntries(extrasOf(event).map((x) => [x.key, { subject: "", body: "" }])), ...(event?.welcome ?? {}) });

/** The two versions as letters the sender and the preview understand. Agendas are attached whenever there is one. */
export function welcomeLetters(event, words = welcomeOf(event)) {
  const out = { main: { id: "event-welcome", kind: "welcome", name: groupsOf(event).group ? `Welcome letter (${groupsOf(event).main})` : "Welcome letter",
    subject: words.main?.subject ?? "", body: words.main?.body ?? "", attachAgenda: !!event.agendaFile } };
  if (groupsOf(event).group && words.group) {
    out.group = { id: "event-welcome-group", kind: "welcome", audience: "group", name: `Welcome letter (${groupsOf(event).group})`,
      subject: words.group.subject ?? "", body: words.group.body ?? "", attachAgenda: !!event.agendaGroupFile };
  }
  // A further group's agenda goes as one of the PDFs ticked for it, so it has no agenda slot of its own.
  for (const x of extrasOf(event)) {
    out[x.key] = { id: `event-welcome-${x.key}`, kind: "welcome", audience: x.key, name: `Welcome letter (${x.label})`,
      subject: words[x.key]?.subject ?? "", body: words[x.key]?.body ?? "", attachAgenda: false };
  }
  return out;
}

/** The words as typed on the event page: one entry per version the event has. */
export function cleanWelcome(given, had = {}, keys = ["main", "group"]) {
  const one = (v, was) => (v === undefined ? was : { subject: text(v?.subject, 200), body: String(v?.body ?? "").replace(/\r/g, "").slice(0, 8000) });
  const out = { ...had };
  for (const k of new Set(["main", "group", ...keys])) if (given?.[k] !== undefined) out[k] = one(given[k], had[k]);
  return out;
}

/**
 * Who gets which: an address with any registration on the event's own Wix event gets the main letter; failing that, one
 * on the second Wix event gets the second group's; failing both, a further group's (the first of them it is on).
 */
export function splitByGroup(people, owed, event = null) {
  const rows = people.filter((p) => p.status !== "WITHDRAWN");
  const extras = extrasOf(event);
  const extraIds = new Map(extras.map((x) => [x.link.eventId, x.key]));
  const out = { main: [], group: [], ...Object.fromEntries(extras.map((x) => [x.key, []])) };
  for (const p of owed) {
    const mine = rows.filter((q) => q.email === p.email);
    const keys = (mine.length ? mine : [p]).map((q) => (!q.group ? "main" : extraIds.get(q.wixEventId) ?? "group"));
    const k = keys.includes("main") ? "main" : keys.includes("group") ? "group" : extras.map((x) => x.key).find((x) => keys.includes(x)) ?? "main";
    out[k].push(p);
  }
  return out;
}

/** Everyone the letter can go to, split by version. */
export const splitForEvent = (event, people, owed) => (versionKeys(event).length > 1 ? splitByGroup(people, owed, event) : { main: owed });

/** How many each version reaches, and how many have had it. */
export function welcomeReach(event, people = []) {
  const split = splitForEvent(event, people, writeableTo(people));
  const had = (list) => list.filter((p) => people.some((q) => q.email === p.email && (q.sent ?? []).includes("welcome"))).length;
  return Object.fromEntries(["main", "group", ...versionKeys(event)].map((k) => [k, { reaches: (split[k] ?? []).length, had: had(split[k] ?? []) }]));
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
