import { getAttendees, putAttendees } from "./store.mjs";
import { writeableTo } from "./attendees.mjs";
import { groupsOf, extrasOf } from "./welcome.mjs";
import { letterProblems, eventProblems, renderLetter, attendeeReplyTo } from "./letters.mjs";
import { sendMail } from "./mail.mjs";
import { pacer, timeLeft } from "./bulk.mjs";
import { markRows } from "./attmail.mjs";
import { token } from "./ids.mjs";

/**
 * A message of Andrew's own to the people registered, or one group of them (Andrew 9 Nov 2026: "HOW DO I SEND email to
 * virtual attendees … I want to send it through the briefing room"). Written on the event's Communications tab, tried
 * with a test, sent on the server to everyone in the group, once per address. Anyone who registers later, or whose copy
 * didn't go, is sent the rest with one press.
 *
 * Groups are by registration: someone registered both in person and online is in both, so a message to those joining
 * online reaches every online registration (Becky Spohr's "TBD" seat among them).
 */
export const KIND = (id) => `msg:${id}`;

/** The groups an event's messages can go to: everyone, then each Wix event's people. */
export function messageGroups(event) {
  const g = groupsOf(event);
  const second = (event?.wixMore ?? [])[0];
  return [
    { key: "all", label: "Everyone" },
    ...(second ? [{ key: "main", label: g.main }, { key: "group", label: g.group }] : []),
    ...extrasOf(event).map((x) => ({ key: x.key, label: x.label })),
  ];
}

/** Everyone with an address in that group, once per address. */
export function groupPeople(event, key, people) {
  const second = (event?.wixMore ?? [])[0];
  const extras = extrasOf(event);
  const extraIds = new Set(extras.map((x) => x.link.eventId));
  const x = extras.find((e) => e.key === key);
  const rows = key === "all" ? people
    : key === "main" ? people.filter((p) => !p.group)
    : key === "group" ? people.filter((p) => p.group && (p.wixEventId ? p.wixEventId === second?.eventId : !extraIds.has(p.wixEventId)))
    : x ? people.filter((p) => p.wixEventId === x.link.eventId)
    : [];
  return writeableTo(rows);
}

export const messageLetter = (m) => ({ id: `event-msg-${m.id}`, kind: "welcome", ...(m.group === "group" ? { audience: "group" } : {}), name: "Message",
  subject: m.subject ?? "", body: m.body ?? "", attachAgenda: false });

/** Who it reaches, and who is still owed it. */
export function messagePeople(event, m, people) {
  const all = groupPeople(event, m.group, people);
  const had = new Set(people.filter((p) => (p.sent ?? []).includes(KIND(m.id))).map((p) => p.email));
  return { all, owed: all.filter((p) => !had.has(p.email)), trouble: all.filter((p) => !had.has(p.email) && p.mailTrouble?.[KIND(m.id)]) };
}

/** What stops one going. */
export function messageProblems(event, m) {
  if (!String(m.subject ?? "").trim()) return ["Give it a subject."];
  if (String(m.body ?? "").trim().length < 10) return ["Write the message first."];
  if (!messageGroups(event).some((g) => g.key === m.group)) return ["Pick who it goes to."];
  const letter = messageLetter(m);
  return [...new Set([...letterProblems(letter), ...eventProblems(letter, event)])];
}

/** A new message, from what was typed. */
export const newMessage = (body, who) => ({
  id: token(10), group: String(body.group ?? ""), subject: String(body.subject ?? "").slice(0, 200), body: String(body.body ?? "").slice(0, 20000),
  at: new Date().toISOString(), by: who?.name || who?.email || "the desk key",
});

/** Send it to everyone in its group still owed it. On the server (attmail-send-background), in rounds of up to 13 minutes. */
export async function sendMessageRound(event, id, { deadline = null, pace = pacer() } = {}) {
  const m = (event.messages ?? []).find((x) => x.id === id);
  if (!m) return { blocked: ["That message isn't on this event."] };
  const wrong = messageProblems(event, m);
  if (wrong.length) return { blocked: wrong };
  const letter = messageLetter(m);
  const stored = (await getAttendees(event.id)) ?? { people: [] };
  const people = stored.people ?? [];
  const { owed } = messagePeople(event, m, people);
  let sent = 0, failed = 0, left = 0;
  const trouble = [];
  for (const person of owed) {
    if (!timeLeft(deadline)) { left = owed.length - sent - failed; break; }
    await pace();
    try {
      const out = await sendMail({ to: person.email, replyTo: attendeeReplyTo(event), ...renderLetter(letter, event, person) });
      if (out.skipped) throw new Error(out.reason);
      markRows(people, person.email, KIND(id), { sent: true });
      sent++;
    } catch (e) { markRows(people, person.email, KIND(id), { why: e.message }); trouble.push({ email: person.email, why: e.message }); failed++; }
    await putAttendees(event.id, stored);
  }
  return { sent, failed, left, trouble: trouble.slice(0, 10), letter: `Message: ${m.subject}` };
}
