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
import { thanksWords, thanksLetter, thanksPeople, thanksDay, thanksOn, sendThanksRound, STANDARD as THANKS_STANDARD, THANKS_AT, letterOn, letterWords, signatureImage, letterAttachment, SIGNATURE_KEY } from "./lib/thanks.mjs";
import { STANDARD_LETTER, letterWordsProblems, appreciationPdf, letterFileName } from "./lib/appreciation.mjs";
import { putMeta } from "./lib/store.mjs";
import { listPresenters, getPresenter, putPresenter } from "./lib/store.mjs";
import { zoneOf } from "./lib/surveysend.mjs";
import { messageGroups, groupPeople, messagePeople, messageProblems, messageLetter, newMessage } from "./lib/message.mjs";

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
 *   GET  /api/attmail?event=…&kind=message                    a message of Andrew's own: the groups and how many each, the draft,
 *                                                             and the messages sent (Andrew 9 Nov 2026)
 *   PUT  /api/attmail?event=…&kind=message                    { group, subject, body } keep the draft
 *   POST /api/attmail?event=…&kind=message&preview=1|test=1   the email as it would go / a test, marked TEST
 *   POST /api/attmail?event=…&kind=message&send=1             { group, subject, body } send it now, on the server
 *   POST /api/attmail?event=…&kind=message&rest=<id>          send a message already sent to anyone still owed it
 *   GET  /api/attmail?event=…&kind=thanks                     the presenter thank-you: words, when, each presenter (Andrew 14 Nov 2026)
 *   PUT  /api/attmail?event=…&kind=thanks                     { subject, body, standard, off } save it; { id, pick: yes|no|"" } one presenter in or out
 *   POST /api/attmail?event=…&kind=thanks&preview=1|test=1    the email as it would go / a test, marked TEST
 *   POST /api/attmail?event=…&kind=thanks&send=1[&id=…]       send now to everyone still owed it (or to one presenter); says how many are left
 *   GET  /api/attmail?event=…&kind=thanks&letter=<id>|sample  that presenter's letter of appreciation, as a PDF
 *        (PUT also takes { letter, letterStandard, letterOff } for the letter's words and whether it goes)
 *   PUT  /api/attmail?kind=signature                          { png } the President's signature image, kept in the desk's store
 */
export default async (req) => {
  await primeRoster();
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const url = new URL(req.url);
  // The President's signature for the letters of appreciation (Andrew 14 Nov 2026: "you can use my signature"). In the
  // desk's own store, not the repository, which is public.
  if (url.searchParams.get("kind") === "signature") {
    if (req.method === "GET") {
      // The signature itself, for when Andrew asks for it on something else ("store that … as my signature to use when
      // I request", 14 Nov 2026): &png=1 the image, &svg=1 the original drawing.
      const s = await getMeta(SIGNATURE_KEY);
      const want = url.searchParams.get("svg") ? "svg" : url.searchParams.get("png") ? "png" : "";
      if (want === "svg" && s?.svg) return new Response(s.svg, { headers: { "content-type": "image/svg+xml", "content-disposition": 'attachment; filename="Andrew_Hammond-signature.svg"', "cache-control": "no-store" } });
      if (want === "png" && s?.png) return new Response(Buffer.from(s.png, "base64"), { headers: { "content-type": "image/png", "content-disposition": 'attachment; filename="Andrew_Hammond-signature.png"', "cache-control": "no-store" } });
      if (want) return fail("No signature saved.", 404);
      return json({ saved: !!s?.png, svg: !!s?.svg, at: s?.at ?? null });
    }
    if (req.method !== "PUT") return fail("Not allowed.", 405);
    const b = await req.json().catch(() => ({}));
    const png = Buffer.from(String(b.png ?? ""), "base64");
    if (png.length < 100 || png.length > 500000 || png.subarray(1, 4).toString() !== "PNG") return fail("Send the signature as a PNG.");
    // The original drawing is kept beside it when sent, so the signature can be had again at any size.
    const svg = /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/.test(String(b.svg ?? "")) && !/<script|on\w+=|href="(?!#)/i.test(b.svg) ? String(b.svg).slice(0, 200000) : null;
    await putMeta(SIGNATURE_KEY, { png: png.toString("base64"), ...(svg ? { svg } : {}), at: new Date().toISOString(), by: adminWho(req)?.email ?? "the desk key" });
    return json({ saved: true });
  }
  const event = await getEvent(url.searchParams.get("event"));
  if (!event) return fail("No such event.", 404);
  const kind = url.searchParams.get("kind");
  if (req.method === "GET" && kind === "schedule") return json({ emails: await emailSchedule(event), sending: event.sendNow ?? null, replySending: event.replySending ?? null });
  if (req.method === "POST" && kind === "now") {
    const viewOnly = editGuard(req, event); if (viewOnly) return viewOnly;
    return startNow(event, url, adminWho(req));
  }
  if (kind === "join") return join(req, event, url);
  if (kind === "message") return message(req, event, url);
  if (kind === "thanks") return thanks(req, event, url);
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
  if (!["welcome", "hotel", "join", "survey", "message"].includes(type)) return fail("Which email?");
  if (type === "message" && !(event.messages ?? []).some((m) => m.id === key)) return fail("That message isn't on this event.", 404);
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

/** A message of Andrew's own, to everyone or one group (Andrew 9 Nov 2026). */
async function message(req, event, url) {
  const people = ((await getAttendees(event.id)) ?? {}).people ?? [];
  const view = () => json({
    groups: messageGroups(event).map((g) => ({ ...g, reaches: groupPeople(event, g.key, people).length })),
    draft: event.messageDraft ?? null, replyTo: attendeeReplyTo(event) ?? "", mailOn: event.attendeeMail === true, sending: event.sendNow ?? null,
    sent: (event.messages ?? []).slice().reverse().map((m) => { const r = messagePeople(event, m, people);
      return { id: m.id, at: m.at, by: m.by, group: m.group, label: messageGroups(event).find((g) => g.key === m.group)?.label ?? m.group, subject: m.subject, reaches: r.all.length, had: r.all.length - r.owed.length, trouble: r.trouble.length }; }),
  });
  if (req.method === "GET") return view();
  const viewOnly = editGuard(req, event); if (viewOnly) return viewOnly;
  const body = await req.json().catch(() => ({}));
  const draft = { group: String(body.group ?? event.messageDraft?.group ?? ""), subject: String(body.subject ?? "").slice(0, 200), body: String(body.body ?? "").slice(0, 20000) };
  if (req.method === "PUT") { event.messageDraft = draft; await putEvent(event); return view(); }
  if (req.method !== "POST") return fail("Not allowed.", 405);
  const rest = url.searchParams.get("rest");
  if (rest) {
    if (event.attendeeMail !== true) return fail("Emails to attendees are off for this event. Turn them on first.", 409);
    const u = new URL(url); u.searchParams.set("type", "message"); u.searchParams.set("key", rest);
    return startNow(event, u, adminWho(req));
  }
  const sample = groupPeople(event, draft.group || "all", people)[0] ?? { first: "Dana", last: "Sample", email: "dana@example.ca" };
  const m = { id: "draft", ...draft };
  if (url.searchParams.get("preview")) { const out = renderLetter(messageLetter(m), event, sample); return json({ subject: out.subject, html: out.html, problems: messageProblems(event, m) }); }
  const wrong = messageProblems(event, m);
  if (wrong.length) return fail(wrong[0], 409);
  if (url.searchParams.get("test")) {
    const to = testAddresses(body.to);
    if (!to.length) return fail("Put an address to send the test to.");
    const out = renderLetter(messageLetter(m), event, sample);
    const r = await sendMail({ to, replyTo: attendeeReplyTo(event), ...out, subject: `TEST: ${out.subject}` }).catch((e) => ({ skipped: true, reason: e.message }));
    if (r.skipped) return fail(`The test couldn't be sent: ${r.reason}`, 502);
    return json({ sent: true, to });
  }
  if (!url.searchParams.get("send")) return fail("Send, test or preview?");
  if (event.attendeeMail !== true) return fail("Emails to attendees are off for this event. Turn them on first.", 409);
  if (event.sendNow && Date.now() - Date.parse(event.sendNow.at) < 20 * 60 * 1000) return fail("Something is already sending for this event. Try again when it's done.", 409);
  const msg = newMessage(draft, adminWho(req));
  event.messages = [...(event.messages ?? []), msg];
  delete event.messageDraft;
  await putEvent(event);
  const u = new URL(url); u.searchParams.set("type", "message"); u.searchParams.set("key", msg.id);
  const started = await startNow(event, u, adminWho(req));
  if (started.status >= 400) { event.messages = event.messages.filter((x) => x.id !== msg.id); event.messageDraft = draft; await putEvent(event); }
  return started;
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

/** The thank-you to each presenter, the morning after the event (Andrew 14 Nov 2026). */
async function thanks(req, event, url) {
  const view = async () => {
    const people = thanksPeople(event, await listPresenters(event.id));
    const letter = thanksLetter(event);
    return json({ ...thanksWords(event), standard: !event.presenterThanks?.body, on: thanksOn(event), day: thanksDay(event), at: THANKS_AT, zone: zoneOf(event),
      replyTo: attendeeReplyTo(event) ?? "", people, problems: [...new Set([...letterProblems(letter), ...eventProblems(letter, event), ...letterWordsProblems(letterWords(event))])],
      letter: letterWords(event), letterStandard: !event.presenterThanks?.letter, letterOn: letterOn(event), signature: !!(await signatureImage()),
      noOrg: people.filter((p) => p.in && !p.organization).map((p) => `${p.first} ${p.last}`.trim()) });
  };
  // One presenter's letter (or a sample), as a PDF to look at or print.
  if (req.method === "GET" && url.searchParams.get("letter")) {
    const id = url.searchParams.get("letter");
    const people = thanksPeople(event, await listPresenters(event.id));
    const v = id === "sample" ? (people.find((p) => p.in && p.talk) ?? people[0] ?? { first: "Dana", last: "Sample", talk: "Gangs in the Lower Mainland", organization: "Example Police Service" }) : people.find((p) => p.id === id);
    if (!v) return fail("No such presenter.", 404);
    const words = url.searchParams.get("words");
    const pdf = await appreciationPdf(event, v, { body: words || letterWords(event), signature: await signatureImage(), on: v.sentAt?.slice(0, 10) || undefined });
    return new Response(pdf, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${letterFileName(v).replace(/"/g, "")}"`, "cache-control": "no-store" } });
  }
  if (req.method === "GET") return view();
  const viewOnly = editGuard(req, event); if (viewOnly) return viewOnly;
  const body = await req.json().catch(() => ({}));
  if (req.method === "PUT" && body.id !== undefined) {
    const p = await getPresenter(event.id, String(body.id).slice(0, 40));
    if (!p) return fail("No such presenter.", 404);
    if (["yes", "no"].includes(body.pick)) p.thanksPick = body.pick; else delete p.thanksPick;
    await putPresenter(p);
    return view();
  }
  const words = body.standard === true ? { ...THANKS_STANDARD }
    : { subject: String(body.subject ?? thanksWords(event).subject).slice(0, 200), body: String(body.body ?? thanksWords(event).body).slice(0, 20000) };
  if (req.method === "PUT") {
    const had = event.presenterThanks ?? {};
    const next = { ...had };
    // Kept only when it differs from the standard, so a change to the standard reaches every event not changed by hand.
    if (words.subject === THANKS_STANDARD.subject && words.body === THANKS_STANDARD.body) { delete next.subject; delete next.body; }
    else {
      const wrong = [...letterProblems(thanksLetter(event, words)), ...eventProblems(thanksLetter(event, words), event)];
      if (wrong.length) return fail(wrong[0], 409);
      Object.assign(next, words);
    }
    if (body.off === true) next.off = true; else if (body.off === false) delete next.off;
    // The letter of appreciation: its words (kept only when changed from the standard) and whether it goes.
    if (body.letterStandard === true) delete next.letter;
    else if (body.letter !== undefined) {
      const w = String(body.letter).replace(/\r/g, "").slice(0, 8000);
      const wrong = letterWordsProblems(w);
      if (wrong.length) return fail(wrong[0], 409);
      if (w.trim() === STANDARD_LETTER.trim()) delete next.letter; else next.letter = w;
    }
    if (body.letterOff === true) next.letterOff = true; else if (body.letterOff === false) delete next.letterOff;
    event.presenterThanks = next;
    event.updatedAt = new Date().toISOString();
    await putEvent(event);
    return view();
  }
  if (req.method !== "POST") return fail("Not allowed.", 405);
  const letter = thanksLetter(event, words);
  const people = thanksPeople(event, await listPresenters(event.id));
  const sample = people.find((p) => p.in && p.talk) ?? people[0] ?? { first: "Dana", last: "Sample", email: "dana@example.ca", talk: "Gangs in the Lower Mainland", talkDay: event.dayOne };
  if (url.searchParams.get("preview")) { const m = renderLetter(letter, event, sample); return json({ subject: m.subject, html: m.html, problems: [...letterProblems(letter), ...eventProblems(letter, event)] }); }
  if (url.searchParams.get("test")) {
    const to = testAddresses(body.to);
    if (!to.length) return fail("Put an address to send the test to.");
    const wrong = [...letterProblems(letter), ...eventProblems(letter, event)];
    if (wrong.length) return fail(wrong[0], 409);
    const m = renderLetter(letter, event, sample);
    // With the letter attached, as the presenter will get it.
    const attachments = letterOn(event) ? [await letterAttachment(event, sample, { signature: await signatureImage() })] : [];
    const out = await sendMail({ to, replyTo: attendeeReplyTo(event), ...m, subject: `TEST: ${m.subject}`, attachments }).catch((e) => ({ skipped: true, reason: e.message }));
    if (out.skipped) return fail(`The test couldn't be sent: ${out.reason}`, 502);
    return json({ sent: true, to });
  }
  if (!url.searchParams.get("send")) return fail("Send, test or preview?");
  // Sent here, a few at a time; the page asks again while some are left.
  const r = await sendThanksRound(event, { force: true, deadline: Date.now() + 18000, only: url.searchParams.get("id") || null });
  if (r.blocked) return fail(r.blocked[0], 409);
  console.log(`thanks: sent now on ${event.id} by ${adminWho(req)?.email ?? "admin"}: ${r.sent} sent, ${r.failed} failed, ${r.left} left`);
  return json({ ...r, ...(await (await view()).json()) });
}
