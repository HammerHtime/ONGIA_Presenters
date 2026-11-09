import { json, fail, requireAdmin, editGuard, adminWho } from "./lib/http.mjs";
import { getEvent, getMeta, putEvent } from "./lib/store.mjs";
import { primeRoster } from "./lib/signature.mjs";
import { mailPeople, sendOne, KINDS } from "./lib/attmail.mjs";
import { emailSchedule } from "./lib/schedule.mjs";
import { onlineGroups, timesOf, joinWords, joinLetter, joinPeople, KIND as JOIN } from "./lib/joinreminder.mjs";
import { getAttendees } from "./lib/store.mjs";
import { letterProblems, eventProblems, renderLetter, attendeeReplyTo } from "./lib/letters.mjs";
import { sendMail } from "./lib/mail.mjs";
import { testAddresses } from "./lib/welcome.mjs";

/**
 * Who has had an email to attendees, person by person, and Send again (Andrew 5 Nov 2026).
 *
 *   GET  /api/attmail?event=…&kind=welcome|reply              everyone registered and where that email stands for them
 *   POST /api/attmail?event=…&kind=welcome|reply&to=<email>   send it to that one address now (their own version)
 *   GET  /api/attmail?event=…&kind=schedule                   every email that will go on its own from today, and to how many
 *   POST /api/attmail?event=…&kind=now&type=welcome&key=…     Send now from Coming up: that welcome version to all still owed it
 *   POST /api/attmail?event=…&kind=now&type=hotel&days=…      or that hotel reminder (both on the server, in the background)
 *   GET  /api/attmail?event=…&kind=join&key=…                 the reminder to those joining online: words, when, to how many
 *   PUT  /api/attmail?event=…&kind=join&key=…                 { subject, body, hours, ready } save it / mark it ready / hold it
 *   POST /api/attmail?event=…&kind=join&key=…&preview=1       { subject, body } the email as it would go
 *   POST /api/attmail?event=…&kind=join&key=…&test=1          { subject, body, to } a test, marked TEST
 */
export default async (req) => {
  await primeRoster();
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const url = new URL(req.url);
  const event = await getEvent(url.searchParams.get("event"));
  if (!event) return fail("No such event.", 404);
  const kind = url.searchParams.get("kind");
  if (req.method === "GET" && kind === "schedule") return json({ emails: await emailSchedule(event), sending: event.sendNow ?? null, replySending: event.replySending ?? null });
  if (req.method === "POST" && kind === "now") {
    const viewOnly = editGuard(req, event); if (viewOnly) return viewOnly;
    return startNow(event, url, adminWho(req));
  }
  if (kind === "join") return join(req, event, url);
  if (!KINDS.includes(kind)) return fail("Which email?");
  if (req.method === "GET") {
    const people = await mailPeople(event, kind);
    const b = (await getMeta("attmail:bounces")) ?? null;
    return json({ people, bounceCheck: b ? { at: b.at, error: b.error ?? null } : null });
  }
  if (req.method !== "POST") return fail("Not allowed.", 405);
  const viewOnly = editGuard(req, event); if (viewOnly) return viewOnly;
  const out = await sendOne(event, kind, url.searchParams.get("to"));
  if (out.problem) return fail(out.problem, 409);
  console.log(`attmail: ${kind} sent again to one attendee on ${event.id} by ${adminWho(req)?.email ?? "admin"}`);
  return json(out);
};

/** Start a Send now on the server; one at a time per event. */
async function startNow(event, url, who) {
  const type = url.searchParams.get("type");
  const key = url.searchParams.get("key") ?? "";
  const days = Number(url.searchParams.get("days"));
  if (!["welcome", "hotel", "join", "survey"].includes(type)) return fail("Which email?");
  // The survey early, when Andrew wants it out now (Andrew 9 Nov 2026): the end survey, or one day's part.
  if (type === "survey" && !event.survey?.open) return fail("The survey is closed. Open it first.", 409);
  if (type === "survey" && key !== "end" && !/^\d{4}-\d{2}-\d{2}$/.test(key)) return fail("Which part of the survey?");
  if (type === "survey" && event.attendeeMail !== true) return fail("Emails to attendees are off for this event, so the survey can't go. Turn them on first.", 409);
  if (type === "join" && !event.joinReminder?.[key]?.readyAt) return fail("Read the reminder and mark it ready first.", 409);
  if (type === "hotel" && ![30, 15, 7].includes(days)) return fail("Which hotel reminder?");
  if (type === "hotel" && event.attendeeMail !== true) return fail("Emails to attendees are off for this event, so the hotel reminder can't go. Turn them on first.", 409);
  if (event.sendNow && Date.now() - Date.parse(event.sendNow.at) < 20 * 60 * 1000) return json({ started: true, already: true });
  event.sendNow = { at: new Date().toISOString(), type, key, days: days || null, by: who?.name || who?.email || "the desk key", hop: 0 };
  await putEvent(event);
  try {
    const r = await fetch(`${url.origin}/api/attmail-send-background?event=${encodeURIComponent(event.id)}&type=${type}&key=${encodeURIComponent(key)}&days=${days || ""}`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "" } });
    if (r.status >= 400) throw new Error(`the server run answered ${r.status}`);
    console.log(`attmail: send now ${type} ${key || days} on ${event.id} by ${who?.email ?? "admin"}`);
    return json({ started: true });
  } catch (e) {
    delete event.sendNow; await putEvent(event);
    return fail(`It didn't start: ${e.message}. Nothing was sent; try again in a minute.`, 503);
  }
}

/** The reminder to those joining online (Andrew 5 Nov 2026). */
async function join(req, event, url) {
  const key = url.searchParams.get("key");
  if (!onlineGroups(event).some((g) => g.key === key)) return fail("That group isn't joining online.", 404);
  const view = async () => {
    const people = ((await getAttendees(event.id)) ?? {}).people ?? [];
    const { all, owed } = joinPeople(event, key, people);
    const letter = joinLetter(event, key);
    return json({ ...joinWords(event, key), saved: !!event.joinReminder?.[key]?.body, readyAt: event.joinReminder?.[key]?.readyAt ?? null, ...timesOf(event, key),
      reaches: all.length, had: all.length - owed.length, problems: [...new Set([...letterProblems(letter), ...eventProblems(letter, event)])] });
  };
  if (req.method === "GET") return view();
  const viewOnly = editGuard(req, event); if (viewOnly) return viewOnly;
  const body = await req.json().catch(() => ({}));
  const words = { subject: String(body.subject ?? joinWords(event, key).subject).slice(0, 200), body: String(body.body ?? joinWords(event, key).body).slice(0, 20000) };
  if (req.method === "PUT") {
    const had = event.joinReminder?.[key] ?? {};
    const next = { ...had, ...words, hours: [1, 2, 3, 4].includes(Number(body.hours)) ? Number(body.hours) : had.hours ?? 2 };
    if (body.ready === true) {
      const wrong = [...letterProblems({ ...joinLetter(event, key), ...words }), ...eventProblems({ ...joinLetter(event, key), ...words }, event)];
      if (wrong.length) return fail(`It can't be marked ready yet: ${wrong[0]}`, 409);
      next.readyAt = new Date().toISOString();
    } else if (body.ready === false) delete next.readyAt;
    event.joinReminder = { ...(event.joinReminder ?? {}), [key]: next };
    event.updatedAt = new Date().toISOString();
    await putEvent(event);
    return view();
  }
  if (req.method !== "POST") return fail("Not allowed.", 405);
  const letter = { ...joinLetter(event, key), ...words };
  const people = ((await getAttendees(event.id)) ?? {}).people ?? [];
  const sample = joinPeople(event, key, people).all[0] ?? { first: "Dana", last: "Sample", email: "dana@example.ca" };
  if (url.searchParams.get("preview")) { const m = renderLetter(letter, event, sample); return json({ subject: m.subject, html: m.html, problems: [...letterProblems(letter), ...eventProblems(letter, event)] }); }
  const to = testAddresses(body.to);
  if (!to.length) return fail("Put an address to send the test to.");
  const m = renderLetter(letter, event, sample);
  const out = await sendMail({ to, replyTo: attendeeReplyTo(event), ...m, subject: `TEST: ${m.subject}` }).catch((e) => ({ skipped: true, reason: e.message }));
  if (out.skipped) return fail(`The test couldn't be sent: ${out.reason}`, 502);
  return json({ sent: true, to });
}
