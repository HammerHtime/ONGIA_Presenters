import { primeRoster } from "./lib/signature.mjs";
import { json, fail, requireAdmin, adminWho, text, editGuard, isEmail } from "./lib/http.mjs";
import { createHash } from "node:crypto";
import { getEvent, putEvent, listEvents, getReplies, getReply, putReply, deleteReply, getAttendees } from "./lib/store.mjs";
import { personalId } from "./lib/letters.mjs";
import { readXlsx } from "./lib/xlsx.mjs";
import { siteUrl } from "./lib/site.mjs";
import { sendMail } from "./lib/mail.mjs";
import { renderReminder, summitSocialLabels, replyToOf, signOf, freshenedReply } from "./lib/reply.mjs";
import { startingReply, cleanReply, cleanAnswer, cleanDeskEntry, dietaryRowsOf, suggestedWording, dietarySheet, socialsSheet, addressesSheet, replyProblems, renderReply, replyStatus, sendReplyRound,
  longDay, longDayFr, socialLine, socialLineFr, dateRange, dateRangeFr } from "./lib/reply.mjs";
import { slugOf } from "./lib/public.mjs";

/**
 * An event's housekeeping questions for attendees: food allergies and the socials (Andrew 26 Oct 2026).
 *
 * The attendee's side, by the event's form token:
 *   GET  /api/reply?t=…[&p=…]            the questions; with p (from their own link) their name and email filled in
 *   POST /api/reply?t=…                  an answer
 *
 * The event page (signed in):
 *   GET  /api/reply?event=…              settings, where the email stands, every answer
 *   PUT  /api/reply?event=…              set it up the first time, or change the questions and the email
 *   POST /api/reply?event=…&preview=1    the email as it would go out (&reminder=1: the reminder)
 *   POST /api/reply?event=…&test=1       send that email to one address, marked TEST
 *   POST /api/reply?event=…&send=1       send it to everyone registered who has not had it (a run; call again while some are left)
 *   GET  /api/reply?event=…&sheet=dietary|socials   the spreadsheet
 *   GET  /api/reply?event=…&sheet=addresses   the registrations that share an email address, and those with none
 *   POST /api/reply?event=…&add=1        add someone's allergy by hand (they told us another way)
 *   POST /api/reply?event=…&upload=1     add everyone on a dietary sheet laid out like the hotel's (.xlsx)
 *   POST /api/reply?event=…&wording=1    put the suggested email back
 *   DELETE /api/reply?event=…&answer=…   remove one answer (a test, or someone who asked)
 */
export default async (req) => {
  const url = new URL(req.url);
  await primeRoster();
  const t = url.searchParams.get("t");
  if (t) return attendeeSide(req, text(t, 40), text(url.searchParams.get("p"), 40));

  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const event = await getEvent(url.searchParams.get("event"));
  if (!event) return fail("No such event.", 404);
  await freshen(event);
  if (req.method === "GET") {
    const sheet = url.searchParams.get("sheet");
    return sheet ? download(event, sheet) : show(event);
  }
  const viewOnly = editGuard(req, event); if (viewOnly) return viewOnly;
  if (req.method === "PUT") return save(event, await req.json().catch(() => ({})));
  if (req.method === "DELETE") return removeAnswer(event, text(url.searchParams.get("answer"), 40));
  if (req.method === "POST") {
    if (!event.reply) return fail("Set up the questions first.", 409);
    if (url.searchParams.get("upload")) return upload(event, Buffer.from(await req.arrayBuffer()));
    const body = await req.json().catch(() => ({}));
    if (url.searchParams.get("add")) return addByHand(event, body);
    if (url.searchParams.get("wording")) {
      // At the Summit, the socials' names come back in Andrew's latest wording too; their dates stay as set.
      const socials = /national gang summit/i.test(event.title) ? summitSocialLabels(event, event.reply.socials ?? []) : event.reply.socials ?? [];
      event.reply = { ...event.reply, socials, ...suggestedWording(event, socials) };
      await putEvent(event);
      return show(event);
    }
    if (url.searchParams.get("preview")) {
      // The words being edited in the preview window, not saved yet: shown as they would go, checked the same way.
      const trial = { ...event, reply: cleanReply({ subject: body.subject, body: body.body, buttonLabel: body.buttonLabel, signName: body.signName, signEmail: body.signEmail }, event.reply) };
      return json({ ...(url.searchParams.get("reminder") ? renderReminder : renderReply)(trial, { first: "Alex" }), problems: replyProblems(trial) });
    }
    if (url.searchParams.get("test")) return testSend(event, text(body.to, 600), adminWho(req));
    if (url.searchParams.get("send")) return sendNow(event, adminWho(req), url.origin);
  }
  return fail("Method not allowed.", 405);
};

const link = (event) => `${siteUrl()}/q/${event.reply.token}`;

async function show(event) {
  const answers = (await getReplies(event.id))?.answers ?? [];
  return json({ reply: event.reply ?? null, link: event.reply ? link(event) : "", status: event.reply ? await replyStatus(event) : null,
    sending: event.replySending && Date.now() - Date.parse(event.replySending.at) < 20 * 60 * 1000 ? event.replySending : null, lastSend: event.replyLastSend ?? null,
    problems: event.reply ? replyProblems(event) : [], sign: event.reply ? signOf(event) : null, answers, attendeeMail: event.attendeeMail === true });
}

async function save(event, body) {
  event.reply = event.reply ? cleanReply(body, event.reply) : cleanReply(body, startingReply(event));
  event.updatedAt = new Date().toISOString();
  await putEvent(event);
  return show(event);
}

/**
 * A test to one or more addresses (up to five, separated by commas). Each carries a personal link that fills the form
 * in as well as the desk can (Andrew 26 Oct 2026): someone registered gets exactly what their real email will give;
 * the sender gets their own name and ONGIA; anyone else gets their address. The test people are kept on the event's
 * settings, never on the attendee list, so they are not counted or emailed as attendees.
 */
async function testSend(event, to, who) {
  const addresses = [...new Set(String(to || who?.email || "").split(/[,;\s]+/).map((a) => a.trim().toLowerCase()).filter(Boolean))];
  if (!addresses.length) return fail("Which address should the test go to?");
  if (addresses.length > 5) return fail("Up to five test addresses at a time.");
  const bad = addresses.find((a) => !isEmail(a));
  if (bad) return fail(`${bad} is not an email address.`);
  const registered = (await getAttendees(event.id))?.people ?? [];
  const [first, ...rest] = String(who?.name || "").trim().split(/\s+/);
  const people = addresses.map((email) => registered.find((p) => p.email === email && p.status === "ATTENDING")
    ?? (email === String(who?.email ?? "").toLowerCase()
      ? { key: `test:${email}`, first: first || "", last: rest.join(" "), email, organization: "ONGIA" }
      : { key: `test:${email}`, first: "", last: "", email, organization: "" }));
  const testers = people.filter((p) => p.key?.startsWith("test:"));
  event.reply = { ...event.reply, testers: [...testers, ...(event.reply.testers ?? []).filter((t) => !testers.some((n) => n.key === t.key))].slice(0, 10) };
  await putEvent(event);
  const sentTo = [];
  for (const person of people) {
    const mail = renderReply(event, person);
    const out = await sendMail({ to: person.email, subject: `TEST: ${mail.subject}`, html: mail.html, text: mail.text, replyTo: replyToOf(event) });
    if (out.skipped) return fail(`The test did not send${sentTo.length ? ` to ${person.email} (it went to ${sentTo.join(", ")})` : ""}: ${out.reason}`, 502);
    sentTo.push(person.email);
  }
  return json({ ok: true, to: sentTo.join(", ") });
}

async function sendNow(event, who, origin) {
  const problems = replyProblems(event);
  if (problems.length) return fail(`Not sent: ${problems[0]}`, 409);
  if (!event.reply.sentAt) {
    event.reply = { ...event.reply, sentAt: new Date().toISOString(), sentBy: who?.name || who?.email || "the desk key" };
    await putEvent(event);
  }
  // The whole list goes on the server (reply-send-background), so closing the page does not stop it. One run at a time:
  // a second press while it is going only says so. If the server run cannot be started, a batch goes from here as before
  // and the page asks for the next.
  const going = event.replySending && Date.now() - Date.parse(event.replySending.at) < 20 * 60 * 1000;
  if (going) return json({ started: true, already: true, status: await replyStatus(event) });
  try {
    event.replySending = { at: new Date().toISOString(), by: who?.name || who?.email || "the desk key", hop: 0 };
    await putEvent(event);
    const r = await fetch(`${origin}/api/reply-send-background?event=${encodeURIComponent(event.id)}`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "" } });
    if (r.status >= 400) throw new Error(`the server run answered ${r.status}`);
    return json({ started: true, status: await replyStatus(event) });
  } catch (e) {
    console.log(`reply send: running a batch here instead (${e.message})`);
    delete event.replySending;
    await putEvent(event);
  }
  // A run stops a little before Netlify's limit; the page calls again while anyone is left.
  const round = await sendReplyRound(event, { deadline: Date.now() + 8000 });
  return json({ ...round, status: await replyStatus(event) });
}

async function download(event, which) {
  if (which === "addresses") {
    const { bytes } = addressesSheet(event, ((await getAttendees(event.id)) ?? {}).people ?? []);
    return new Response(bytes, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${slugOf(event.title) || "event"}-shared-addresses.xlsx"`, "cache-control": "no-store" } });
  }
  if (!event.reply) return fail("Set up the questions first.", 409);
  const answers = (await getReplies(event.id))?.answers ?? [];
  const bytes = which === "dietary" ? dietarySheet(event, answers) : which === "socials" && (event.reply.socials ?? []).length ? socialsSheet(event, answers, event.reply) : null;
  if (!bytes) return fail("Which list: dietary or socials?");
  const name = `${slugOf(event.title) || "event"}-${which === "dietary" ? "dietary-list" : "socials"}.xlsx`;
  return new Response(bytes, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
}

async function removeAnswer(event, id) {
  if (!/^[a-f0-9]{16}$/.test(id) || !(await getReply(event.id, id))) return fail("No such answer.", 404);
  await deleteReply(event.id, id);
  return show(event);
}

/**
 * What the form starts with on someone's own link: their name and email from the registration (agency when the desk
 * has it), and their earlier answers if they already sent some, so changing one thing is quick.
 */
async function prefill(event, pid) {
  const p = await personFor(event, pid);
  if (!p) return null;
  const you = { first: p.first || "", last: p.last || "", email: p.email || "", agency: p.organization || "" };
  const had = you.email && (you.first || you.last) ? await getReply(event.id, answerId(you)) : null;
  if (had) Object.assign(you, { agency: had.agency || you.agency, allergy: had.allergy ? "yes" : "no", dietary: had.dietary || "", socials: had.socials ?? {} });
  return you;
}

/** One record per person: the same name at the same address answering again lands on the same record. */
const answerId = (a) => createHash("sha256").update(`${a.email}|${a.first} ${a.last}`.toLowerCase().replace(/\s+/g, " ")).digest("hex").slice(0, 16);

async function keepDeskEntry(event, entry) {
  const id = answerId(entry);
  const had = await getReply(event.id, id);
  // Someone who already answered through the form keeps their answers to the socials.
  await putReply(event.id, { ...(had ?? {}), id, ...entry, socials: had?.socials ?? {}, at: new Date().toISOString(), firstAt: had?.firstAt ?? had?.at ?? new Date().toISOString() });
  return !!had;
}

async function addByHand(event, body) {
  const { entry, problem } = cleanDeskEntry(body);
  if (problem) return fail(problem);
  await keepDeskEntry(event, entry);
  return show(event);
}

/** Andrew's dietary sheet (Excel), laid out like the hotel's: everyone on it goes on the dietary list. */
async function upload(event, bytes) {
  if (!bytes.length) return fail("That file was empty.");
  if (bytes.length > 2 * 1024 * 1024) return fail("That file is over 2 MB.", 413);
  let rows;
  try { rows = readXlsx(bytes); } catch { return fail("That isn't an Excel (.xlsx) file the desk can read. Save it as .xlsx and try again."); }
  const found = dietaryRowsOf(rows);
  if (found.problem) return fail(found.problem);
  let added = 0, updated = 0;
  const skipped = [];
  for (const r of found.rows) {
    const { entry, problem } = cleanDeskEntry(r);
    if (problem) { skipped.push(problem); continue; }
    (await keepDeskEntry(event, entry)) ? updated++ : added++;
  }
  return json({ ...(await (await show(event)).json()), uploaded: { added, updated, skipped } });
}

/* ------------------------------------------------------------ the attendee's side */

/** An untouched old Summit email takes Andrew's current wording (see freshenedReply), and is saved that way. */
async function freshen(event) {
  const fresh = freshenedReply(event);
  if (!fresh) return;
  event.reply = fresh;
  await putEvent(event);
}

async function eventByToken(tok) {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(tok)) return null;
  return (await listEvents()).find((e) => e.reply?.token === tok) ?? null;
}

/** Whose own link this is: their row on the attendee list, found by the id in their link. */
async function personFor(event, pid) {
  if (!/^[a-f0-9]{16}$/.test(pid ?? "")) return null;
  const people = [...((await getAttendees(event.id))?.people ?? []), ...(event.reply.testers ?? [])];
  return people.find((p) => (p.key || p.email) && personalId(event.reply.token, p) === pid) ?? null;
}

async function attendeeSide(req, tok, pid) {
  const event = await eventByToken(tok);
  if (!event) return fail("This link is not working. Reply to the email it came in and we will sort it out.", 404);
  await freshen(event);
  const r = event.reply;
  if (req.method === "GET") {
    return json({
      title: event.title, dates: dateRange(event), datesFr: dateRangeFr(event), city: event.city, open: r.open, replyBy: r.replyBy,
      replyByLong: longDay(r.replyBy), replyByLongFr: longDayFr(r.replyBy),
      socials: (r.socials ?? []).map((s) => ({ id: s.id, en: socialLine(s), fr: socialLineFr(s) })),
      contact: event.contact?.email || event.reviewer?.email || "",
      you: await prefill(event, pid),
    });
  }
  if (req.method !== "POST") return fail("Method not allowed.", 405);
  if (!r.open) return fail("closed", 409);
  const body = await req.json().catch(() => null);
  if (!body) return fail("Expected a JSON body.");
  const { answer, problems } = cleanAnswer(body, r);
  if (problems) return json({ error: "missing", problems }, 400);
  const id = answerId(answer);
  const had = await getReply(event.id, id);
  const at = new Date().toISOString();
  await putReply(event.id, { id, ...answer, at, firstAt: had?.firstAt ?? had?.at ?? at });
  return json({ ok: true, again: !!had });
}
