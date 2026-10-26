import { json, fail, requireAdmin, adminWho, text, editGuard } from "./lib/http.mjs";
import { createHash } from "node:crypto";
import { getEvent, putEvent, listEvents, getReplies, getReply, putReply, deleteReply } from "./lib/store.mjs";
import { siteUrl } from "./lib/site.mjs";
import { sendMail } from "./lib/mail.mjs";
import { startingReply, cleanReply, cleanAnswer, dietarySheet, socialsSheet, replyProblems, renderReply, replyStatus, sendReplyRound,
  longDay, longDayFr, socialLine, socialLineFr, dateRange, dateRangeFr } from "./lib/reply.mjs";
import { slugOf } from "./lib/public.mjs";

/**
 * An event's housekeeping questions for attendees: food allergies and the socials (Andrew 26 Oct 2026).
 *
 * The attendee's side, by the event's form token:
 *   GET  /api/reply?t=…                  the questions
 *   POST /api/reply?t=…                  an answer
 *
 * The event page (signed in):
 *   GET  /api/reply?event=…              settings, where the email stands, every answer
 *   PUT  /api/reply?event=…              set it up the first time, or change the questions and the email
 *   POST /api/reply?event=…&preview=1    the email as it would go out
 *   POST /api/reply?event=…&test=1       send that email to one address, marked TEST
 *   POST /api/reply?event=…&send=1       send it to everyone registered who has not had it (a run; call again while some are left)
 *   GET  /api/reply?event=…&sheet=dietary|socials   the spreadsheet
 *   DELETE /api/reply?event=…&answer=…   remove one answer (a test, or someone who asked)
 */
export default async (req) => {
  const url = new URL(req.url);
  const t = url.searchParams.get("t");
  if (t) return attendeeSide(req, text(t, 40));

  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const event = await getEvent(url.searchParams.get("event"));
  if (!event) return fail("No such event.", 404);
  if (req.method === "GET") {
    const sheet = url.searchParams.get("sheet");
    return sheet ? download(event, sheet) : show(event);
  }
  const viewOnly = editGuard(req, event); if (viewOnly) return viewOnly;
  if (req.method === "PUT") return save(event, await req.json().catch(() => ({})));
  if (req.method === "DELETE") return removeAnswer(event, text(url.searchParams.get("answer"), 40));
  if (req.method === "POST") {
    if (!event.reply) return fail("Set up the questions first.", 409);
    const body = await req.json().catch(() => ({}));
    if (url.searchParams.get("preview")) return json({ ...renderReply(event, { first: "Alex" }), problems: replyProblems(event) });
    if (url.searchParams.get("test")) return testSend(event, text(body.to, 200), adminWho(req));
    if (url.searchParams.get("send")) return sendNow(event, adminWho(req));
  }
  return fail("Method not allowed.", 405);
};

const link = (event) => `${siteUrl()}/q/${event.reply.token}`;

async function show(event) {
  const answers = (await getReplies(event.id))?.answers ?? [];
  return json({ reply: event.reply ?? null, link: event.reply ? link(event) : "", status: event.reply ? await replyStatus(event) : null,
    problems: event.reply ? replyProblems(event) : [], answers, attendeeMail: event.attendeeMail === true });
}

async function save(event, body) {
  event.reply = event.reply ? cleanReply(body, event.reply) : cleanReply(body, startingReply(event));
  event.updatedAt = new Date().toISOString();
  await putEvent(event);
  return show(event);
}

async function testSend(event, to, who) {
  const address = to || who?.email;
  if (!address) return fail("Which address should the test go to?");
  const mail = renderReply(event, { first: (who?.name || "").split(" ")[0] || "there" });
  const out = await sendMail({ to: address, subject: `TEST: ${mail.subject}`, html: mail.html, text: mail.text });
  if (out.skipped) return fail(`The test did not send: ${out.reason}`, 502);
  return json({ ok: true, to: address });
}

async function sendNow(event, who) {
  const problems = replyProblems(event);
  if (problems.length) return fail(`Not sent: ${problems[0]}`, 409);
  if (!event.reply.sentAt) {
    event.reply = { ...event.reply, sentAt: new Date().toISOString(), sentBy: who?.name || who?.email || "the desk key" };
    await putEvent(event);
  }
  // A run stops a little before Netlify's limit; the page calls again while anyone is left.
  const round = await sendReplyRound(event, { deadline: Date.now() + 8000 });
  return json({ ...round, status: await replyStatus(event) });
}

async function download(event, which) {
  if (!event.reply) return fail("Set up the questions first.", 409);
  const answers = (await getReplies(event.id))?.answers ?? [];
  const bytes = which === "dietary" ? dietarySheet(event, answers) : which === "socials" ? socialsSheet(event, answers, event.reply) : null;
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

/** One record per person: the same name at the same address answering again lands on the same record. */
const answerId = (a) => createHash("sha256").update(`${a.email}|${a.first} ${a.last}`.toLowerCase().replace(/\s+/g, " ")).digest("hex").slice(0, 16);

/* ------------------------------------------------------------ the attendee's side */

async function eventByToken(tok) {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(tok)) return null;
  return (await listEvents()).find((e) => e.reply?.token === tok) ?? null;
}

async function attendeeSide(req, tok) {
  const event = await eventByToken(tok);
  if (!event) return fail("This link is not working. Reply to the email it came in and we will sort it out.", 404);
  const r = event.reply;
  if (req.method === "GET") {
    return json({
      title: event.title, dates: dateRange(event), datesFr: dateRangeFr(event), city: event.city, open: r.open, replyBy: r.replyBy,
      replyByLong: longDay(r.replyBy), replyByLongFr: longDayFr(r.replyBy),
      socials: (r.socials ?? []).map((s) => ({ id: s.id, en: socialLine(s), fr: socialLineFr(s) })),
      contact: event.contact?.email || event.reviewer?.email || "",
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
