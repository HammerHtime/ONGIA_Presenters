import { getAttendees, putAttendees, getReplies, getAgenda, getWelcomeFile, getMeta, putMeta, listEvents } from "./store.mjs";
import { writeableTo } from "./attendees.mjs";
import { letterProblems, eventProblems, renderLetter, attachmentsFor, attendeeReplyTo, ATTACH_LIMIT } from "./letters.mjs";
import { sendMail, graphMailbox } from "./mail.mjs";
import { welcomeLetters, splitByGroup, versionLabel, extrasOf, inTheRoom } from "./welcome.mjs";
import { renderReply, replyProblems, replyToOf, toldUs } from "./reply.mjs";
import { graphConfigured, graphAccessToken, graphGet } from "./graph.mjs";
import { todayIso } from "./deadlines.mjs";
import { pacer, timeLeft } from "./bulk.mjs";

/**
 * Who has had each email to attendees, one person at a time (Andrew 5 Nov 2026: "where can I see who and how many
 * haven't received the email? How do I resend to individual attendees"). One row per registered address: which welcome
 * letter is theirs, when it went, whether it bounced or couldn't be sent; and the same for the food-allergy email.
 * Send again goes to that one address, now, with their own version.
 */

export const KINDS = ["welcome", "reply"];
const nameOf = (p) => [p.first, p.last].map((v) => String(v ?? "").trim()).filter(Boolean).join(" ");

/** The welcome-letter version each address gets: the same rule the round uses. */
function versionsOf(event, people, list) {
  const split = splitByGroup(people, list, event);
  const out = new Map();
  for (const [k, ps] of Object.entries(split)) for (const p of ps) out.set(p.email, k);
  return out;
}

/** Everyone registered with an address, and where each email stands for them. */
export async function mailPeople(event, kind) {
  const stored = (await getAttendees(event.id)) ?? { people: [] };
  const people = stored.people ?? [];
  const all = writeableTo(people);
  const rowsOf = (email) => people.filter((p) => p.email === email);
  const stamp = (email, k) => rowsOf(email).map((p) => p.sentAt?.[k]).filter(Boolean).sort()[0] ?? null;
  const had = (email, k) => rowsOf(email).some((p) => (p.sent ?? []).includes(k));
  const trouble = (email, k) => rowsOf(email).map((p) => p.mailTrouble?.[k]).find(Boolean) ?? null;
  if (kind === "welcome") {
    const versions = versionsOf(event, people, all);
    return all.map((p) => {
      const key = versions.get(p.email) ?? "main";
      return { email: p.email, name: nameOf(p), version: versionLabel(event, key) || "", key,
        had: had(p.email, "welcome"), at: stamp(p.email, "welcome"), trouble: trouble(p.email, "welcome") };
    });
  }
  // The food-allergy email: only the people in the room get it; anyone who already answered is marked so.
  const room = new Set(writeableTo(inTheRoom(event, people)).map((p) => p.email));
  const told = toldUs(people, (await getReplies(event.id))?.answers ?? []);
  return all.filter((p) => room.has(p.email)).map((p) => ({ email: p.email, name: nameOf(p),
    had: had(p.email, "reply"), at: stamp(p.email, "reply"), answered: told.has(p.email), trouble: trouble(p.email, "reply") }));
}

/** Mark every row at an address: sent (clearing any trouble), or the trouble it ran into. */
export function markRows(people, email, kind, { sent = false, why = "" } = {}) {
  const at = new Date().toISOString();
  for (const p of people.filter((q) => q.email === email)) {
    if (sent) {
      p.sent = [...new Set([...(p.sent ?? []), kind])];
      p.sentAt = { ...(p.sentAt ?? {}), [kind]: at };
      if (p.mailTrouble?.[kind]) { const t = { ...p.mailTrouble }; delete t[kind]; p.mailTrouble = t; }
    } else p.mailTrouble = { ...(p.mailTrouble ?? {}), [kind]: { at, why: String(why).slice(0, 200), kind: "failed" } };
  }
}

/**
 * Send one email to one registered address, now: their own welcome-letter version, or the food-allergy email. Whether
 * they had it before or not. Returns { sent: true } or { problem }.
 */
export async function sendOne(event, kind, email) {
  email = String(email ?? "").trim().toLowerCase();
  const stored = (await getAttendees(event.id)) ?? { people: [] };
  const people = stored.people ?? [];
  const person = writeableTo(people).find((p) => p.email === email);
  if (!person) return { problem: "That address isn't registered for this event (or has withdrawn)." };
  let mail;
  let replyTo;
  let attachments = [];
  if (kind === "welcome") {
    if (!event.welcome?.main?.body) return { problem: "The welcome letter isn't saved yet." };
    const key = versionsOf(event, people, [person]).get(email) ?? "main";
    const letter = welcomeLetters(event)[key];
    const label = versionLabel(event, key);
    if (!letter?.body?.trim()) return { problem: `The ${label} welcome letter isn't written yet.` };
    if (extrasOf(event).some((x) => x.key === key) && !event.welcomeReady?.[key]) return { problem: `The ${label} letter isn't marked ready to send yet.` };
    const wrong = [...letterProblems(letter), ...eventProblems(letter, event)];
    if (wrong.length) return { problem: wrong[0] };
    attachments = await attachmentsFor(letter, event, getAgenda, getWelcomeFile);
    if (attachments.reduce((n, a) => n + a.content.length, 0) > ATTACH_LIMIT) return { problem: "Its attachments are over 3 MB." };
    mail = renderLetter(letter, event, person);
    replyTo = attendeeReplyTo(event);
  } else if (kind === "reply") {
    if (!event.reply) return { problem: "The food-allergy email isn't set up." };
    if (!writeableTo(inTheRoom(event, people)).some((p) => p.email === email)) return { problem: "They're joining online, so they don't get the food-allergy email." };
    const wrong = replyProblems(event);
    if (wrong.length) return { problem: wrong[0] };
    mail = renderReply(event, person);
    replyTo = replyToOf(event);
  } else return { problem: "Which email?" };
  try {
    const out = await sendMail({ to: email, replyTo, ...mail, attachments });
    if (out.skipped) throw new Error(out.reason);
  } catch (e) {
    const fresh = (await getAttendees(event.id)) ?? stored;
    markRows(fresh.people ?? [], email, kind, { why: e.message });
    await putAttendees(event.id, fresh);
    return { problem: `It couldn't be sent: ${e.message}` };
  }
  const fresh = (await getAttendees(event.id)) ?? stored;
  markRows(fresh.people ?? [], email, kind, { sent: true });
  await putAttendees(event.id, fresh);
  return { sent: true, to: email };
}

/**
 * Send now, from Coming up (Andrew 5 Nov 2026: "I see that people haven't received an email and I don't want to wait"):
 * one welcome-letter version to everyone it is still owed to, today, whatever its date. Each address is marked the
 * moment its email goes, so a run stopped part way sends nobody a second copy, and the usual round finds them done.
 */
export async function sendVersionNow(event, key, { deadline = null, pace = pacer() } = {}) {
  if (!event.welcome?.main?.body) return { blocked: ["The welcome letter isn't saved yet."] };
  const letter = welcomeLetters(event)[key];
  const label = versionLabel(event, key) || "welcome";
  if (!letter?.body?.trim()) return { blocked: [`The ${label} letter isn't written yet.`] };
  if (extrasOf(event).some((x) => x.key === key) && !event.welcomeReady?.[key]) return { blocked: [`The ${label} letter isn't marked ready to send yet.`] };
  const wrong = [...letterProblems(letter), ...eventProblems(letter, event)];
  if (wrong.length) return { blocked: wrong };
  const attachments = await attachmentsFor(letter, event, getAgenda, getWelcomeFile);
  if (attachments.reduce((n, a) => n + a.content.length, 0) > ATTACH_LIMIT) return { blocked: ["Its attachments are over 3 MB."] };
  const stored = (await getAttendees(event.id)) ?? { people: [] };
  const people = stored.people ?? [];
  const had = new Set(people.filter((p) => (p.sent ?? []).includes("welcome")).map((p) => p.email));
  const owed = splitByGroup(people, writeableTo(people).filter((p) => !had.has(p.email)), event)[key] ?? [];
  let sent = 0, failed = 0, left = 0;
  const trouble = [];
  for (const person of owed) {
    if (!timeLeft(deadline)) { left = owed.length - sent - failed; break; }
    await pace();
    try {
      const out = await sendMail({ to: person.email, replyTo: attendeeReplyTo(event), ...renderLetter(letter, event, person), attachments });
      if (out.skipped) throw new Error(out.reason);
      markRows(people, person.email, "welcome", { sent: true });
      sent++;
    } catch (e) { markRows(people, person.email, "welcome", { why: e.message }); trouble.push({ email: person.email, why: e.message }); failed++; }
    await putAttendees(event.id, stored);
  }
  return { sent, failed, left, trouble: trouble.slice(0, 10), letter: letter.name };
}

/* ---------- Bounces ---------- */

/**
 * Bounces (Andrew 5 Nov 2026). Attendee emails go from the Microsoft mailbox, so a bounce comes back to it as a
 * "Undeliverable" notice rather than to anyone's eye. Read those notices and mark the address on every upcoming event
 * that has it, under the email it bounced from (worked out from the notice's subject). At most once an hour.
 */
const NDR_SUBJECT = /^(undeliverable|undelivered mail|delivery (status notification|has failed)|mail delivery (failed|subsystem)|returned mail|failure notice|non remis|non distribuable)/i;
const NDR_FROM = /(postmaster|mailer-daemon|microsoftexchange)/i;
const ADDR = /[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** A bounce notice's bounced addresses, given its text and the mailbox's own address. */
export function bouncedAddresses(text, own = "") {
  const found = new Set();
  for (const m of String(text ?? "").matchAll(ADDR)) {
    const a = m[0].toLowerCase().replace(/[.]+$/, "");
    if (a === own || /^(postmaster|mailer-daemon|microsoftexchange|no-?reply)/.test(a)) continue;
    if (/@(ongia\.ca|ongia\.org)$/.test(a) || /(\.onmicrosoft\.com|\.outlook\.com|\.office365\.com)$/.test(a)) continue;
    found.add(a);
  }
  return [...found];
}

/** Which email a bounce came from, by the subject of the notice ("Undeliverable: Welcome to …"). */
export function kindOfBounce(subject, event) {
  const s = String(subject ?? "").replace(NDR_SUBJECT, "").replace(/^[\s:-]+/, "").toLowerCase();
  const letters = welcomeLetters(event);
  for (const l of Object.values(letters)) {
    const subj = String(l.subject ?? "").replace(/\{[^}]+\}/g, "").trim().toLowerCase();
    if (subj && s.includes(subj.slice(0, 30))) return "welcome";
  }
  if (event.reply?.subject) {
    const subj = String(event.reply.subject).replace(/\{[^}]+\}/g, "").trim().toLowerCase();
    if (subj && s.includes(subj.slice(0, 30))) return "reply";
  }
  return /welcome|bienvenue/.test(s) ? "welcome" : /allerg|food|dietary|aliment/.test(s) ? "reply" : "other";
}

export async function scanBounces({ force = false, now = new Date(), get = null, mailbox = graphMailbox() } = {}) {
  if (!mailbox || (!get && !graphConfigured())) return { skipped: "no Microsoft mailbox" };
  const last = (await getMeta("attmail:bounces")) ?? {};
  if (!force && last.at && now - Date.parse(last.at) < 55 * 60 * 1000) return { skipped: "read less than an hour ago" };
  const since = new Date(Math.max(Date.parse(last.through ?? 0) || 0, now - 14 * 86400000) - 3600000).toISOString();
  const today = todayIso();
  const events = (await listEvents()).filter((e) => !e.practice && (e.lastDay || e.dayOne) && (e.lastDay || e.dayOne) >= new Date(now - 30 * 86400000).toISOString().slice(0, 10));
  let read = 0, marked = 0;
  try {
    const fetchPath = get ?? (async (p) => graphGet(await graphAccessToken(), p));
    let path = `/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages?$filter=receivedDateTime ge ${since}&$select=id,subject,from,receivedDateTime,body&$orderby=receivedDateTime desc&$top=50`;
    const notices = [];
    while (path && read < 500) {
      const page = await fetchPath(path);
      for (const m of page.value ?? []) {
        read++;
        const from = `${m.from?.emailAddress?.name ?? ""} ${m.from?.emailAddress?.address ?? ""}`;
        if (NDR_SUBJECT.test(m.subject ?? "") || NDR_FROM.test(from)) notices.push(m);
      }
      const next = page["@odata.nextLink"];
      path = next ? next.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, "") : null;
    }
    for (const event of events) {
      const stored = await getAttendees(event.id);
      if (!stored?.people?.length) continue;
      let changed = false;
      for (const n of notices) {
        const text = String(n.body?.content ?? "").replace(/<[^>]+>/g, " ");
        const kind = kindOfBounce(n.subject, event);
        for (const a of bouncedAddresses(text, mailbox)) {
          const rows = stored.people.filter((p) => p.email === a);
          if (!rows.length) continue;
          // Bounced only if it went after the last time it was sent; a later Send again that got through clears it.
          for (const p of rows) {
            const k = kind === "other" ? (p.sent ?? []).includes("welcome") ? "welcome" : "reply" : kind;
            const sentAt = p.sentAt?.[k];
            if (sentAt && Date.parse(n.receivedDateTime) < Date.parse(sentAt) - 60000) continue;
            if (p.mailTrouble?.[k]?.kind === "bounced" && p.mailTrouble[k].at === n.receivedDateTime) continue;
            const why = (text.match(/(?:wasn't delivered|couldn't be delivered|could not be delivered|does not exist|doesn't exist|not found|rejected|blocked|mailbox (?:is )?(?:full|unavailable))[^.]{0,140}/i)?.[0] ?? "It bounced.").replace(/\s+/g, " ").trim();
            p.mailTrouble = { ...(p.mailTrouble ?? {}), [k]: { at: n.receivedDateTime, why: why.slice(0, 200), kind: "bounced" } };
            changed = true; marked++;
          }
        }
      }
      if (changed) await putAttendees(event.id, stored);
    }
    await putMeta("attmail:bounces", { at: now.toISOString(), through: now.toISOString(), read, notices: notices.length, marked, today });
    return { read, notices: notices.length, marked };
  } catch (e) {
    await putMeta("attmail:bounces", { ...last, at: now.toISOString(), error: String(e.message || e).slice(0, 300) });
    return { error: e.message };
  }
}
