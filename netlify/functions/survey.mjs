import { json, fail, requireAdmin, adminWho, text, editGuard, isEmail } from "./lib/http.mjs";
import { getEvent, putEvent, listEvents, getAttendees, listPresenters, getSurveyResponses, putSurveyResponse, getSurveyDone, putSurveyDone, putSurveyContact } from "./lib/store.mjs";
import { personalId, renderLetter, attendeeReplyTo, groupDaysOf } from "./lib/letters.mjs";
import { token as newToken } from "./lib/ids.mjs";
import { sendMail } from "./lib/mail.mjs";
import { siteUrl } from "./lib/site.mjs";
import { trainingDays } from "./lib/agenda.mjs";
import { directory } from "./lib/agencies.mjs";
import { primeRoster } from "./lib/signature.mjs";
import { startingSurvey, sessionsFrom, cleanSurvey, surveyProblems, daysFor, partFor, cleanResponse, surveyForPage } from "./lib/survey.mjs";
import { surveyLetter, sendSurveyRound, dailyTimes, localNow, zoneOf } from "./lib/surveysend.mjs";

/**
 * An event's survey (Andrew 27 Oct 2026; notes/surveys-plan.md).
 *
 * The attendee's side, by the survey's token (their own link adds who they are, only so nobody is asked twice):
 *   GET  /api/survey?t=…[&p=…][&part=…]     the questions for their part (a day, or "end")
 *   POST /api/survey?t=…[&p=…]              their answers, kept with no name on them (&preview=1: checked, not kept)
 *
 * The event page (signed in):
 *   GET  /api/survey?event=…                settings, sessions, when each part goes, how many have answered
 *   PUT  /api/survey?event=…                set it up the first time, or change it
 *   POST /api/survey?event=…&refresh=1      bring the sessions up to the presenter list (days kept)
 *   POST /api/survey?event=…&test=1         { to, part } the email, marked TEST, to up to five addresses
 *   POST /api/survey?event=…&send=1         { part } send that part now to everyone owed it
 */
export default async (req) => {
  await primeRoster();
  const url = new URL(req.url);
  const t = url.searchParams.get("t");
  if (t) return attendeeSide(req, url, text(t, 40), text(url.searchParams.get("p"), 40));

  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const event = await getEvent(url.searchParams.get("event"));
  if (!event) return fail("No such event.", 404);
  if (req.method === "GET") return show(event);
  const viewOnly = editGuard(req, event); if (viewOnly) return viewOnly;
  const body = await req.json().catch(() => ({}));
  if (req.method === "PUT") {
    event.survey = event.survey ? cleanSurvey(body, event.survey, event) : cleanSurvey(body, startingSurvey(event, await listPresenters(event.id)), event);
    event.updatedAt = new Date().toISOString();
    await putEvent(event);
    return show(event);
  }
  if (req.method === "POST") {
    if (!event.survey) return fail("Set up the survey first.", 409);
    if (url.searchParams.get("refresh")) {
      const fresh = sessionsFrom(await listPresenters(event.id));
      const had = new Map(event.survey.sessions.map((s) => [s.id, s]));
      // Keep what was set by hand (days, French titles, sessions added by hand); add presenters not yet listed.
      event.survey.sessions = [...event.survey.sessions, ...fresh.filter((s) => !had.has(s.id))];
      await putEvent(event);
      return show(event);
    }
    const part = partName(event, body.part);
    if (url.searchParams.get("test")) return testSend(event, text(body.to, 600), part, adminWho(req));
    if (url.searchParams.get("send")) {
      const out = await sendSurveyRound(event, part, { deadline: Date.now() + 8000 });
      if (out.blocked) return fail(`Not sent: ${out.blocked[0]}`, 409);
      return json(out);
    }
  }
  return fail("Method not allowed.", 405);
};

const partName = (event, p) => (event.survey?.mode === "daily" && trainingDays(event).includes(p) ? p : event.survey?.mode === "daily" ? trainingDays(event)[0] : "end");

async function show(event) {
  const s = event.survey;
  if (!s) return json({ survey: null, days: trainingDays(event) });
  const responses = await getSurveyResponses(event.id);
  const byPart = {};
  for (const r of responses) byPart[r.part] = (byPart[r.part] ?? 0) + 1;
  const people = ((await getAttendees(event.id)) ?? {}).people ?? [];
  const g = groupDaysOf(event);
  return json({
    survey: s, link: `${siteUrl()}/f/${s.token}`, problems: surveyProblems(event), days: trainingDays(event),
    group: g && (event.wixMore ?? []).length ? { name: event.wixMore[0].group || "Second group", ...g } : null,
    times: dailyTimes(event), zone: zoneOf(event), now: localNow(event),
    responses: responses.length, byPart,
    sent: Object.fromEntries(Object.entries(people.reduce((m, p) => { for (const k of p.sent ?? []) if (k.startsWith("survey:")) (m[k] ??= new Set()).add(p.email); return m; }, {})).map(([k, v]) => [k.slice(7), v.size])),
    attendeeMail: event.attendeeMail === true,
  });
}

async function eventByToken(tok) {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(tok)) return null;
  return (await listEvents()).find((e) => e.survey?.token === tok) ?? null;
}

/** Whose own link this is, by the anonymous id in it: their row on the attendee list (or a test address). */
async function personFor(event, pid) {
  if (!/^[a-f0-9]{16}$/.test(pid ?? "")) return null;
  const people = [...((await getAttendees(event.id))?.people ?? []), ...(event.survey.testers ?? [])];
  return people.find((p) => (p.key || p.email) && personalId(event.survey.token, p) === pid) ?? null;
}

/** Which part someone is answering: at the end, the one survey; daily, the day asked for, else the latest day so far they have not answered. */
function whichPart(event, person, asked, done) {
  if (event.survey.mode !== "daily") return "end";
  const days = daysFor(event, person);
  if (days.includes(asked)) return asked;
  const today = localNow(event).slice(0, 10);
  const open = days.filter((d) => d <= today && !(done.parts ?? []).includes(d));
  return open[open.length - 1] ?? days.find((d) => !(done.parts ?? []).includes(d)) ?? days[days.length - 1];
}

async function attendeeSide(req, url, tok, pid) {
  const event = await eventByToken(tok);
  if (!event) return fail("This link is not working. Reply to the email it came in and we will sort it out.", 404);
  const s = event.survey;
  const person = await personFor(event, pid);
  const done = (person ? await getSurveyDone(event.id, pid) : null) ?? {};
  if (req.method === "GET") {
    const part = whichPart(event, person, url.searchParams.get("part"), done);
    const asked = partFor(event, person, part, done);
    // Every agency on the master list, with its short forms, so typing "OPP" finds the Ontario Provincial Police.
    const agencies = (await directory()).map((a) => ({ name: a.name, also: (a.aliases ?? []).filter((x) => x.length <= 40).slice(0, 8) })).sort((a, b) => a.name.localeCompare(b.name, "fr"));
    return json({ ...surveyForPage(event, asked, agencies), open: s.open, answered: (done.parts ?? []).includes(part), daily: s.mode === "daily" });
  }
  if (req.method !== "POST") return fail("Method not allowed.", 405);
  if (!s.open) return fail("closed", 409);
  const body = await req.json().catch(() => null);
  if (!body) return fail("Expected a JSON body.");
  const part = whichPart(event, person, body.part, done);
  if ((done.parts ?? []).includes(part) && !url.searchParams.get("preview")) return json({ ok: true, already: true });
  const asked = partFor(event, person, part, done);
  const { rec, contact, missing } = cleanResponse(body, asked, body.lang);
  if (missing.length) return json({ error: "missing", missing }, 400);
  if (url.searchParams.get("preview")) return json({ ok: true, preview: true });
  const at = new Date().toISOString();
  // The answers carry no name, address or link id: only which part, the language, and the time.
  await putSurveyResponse(event.id, { id: newToken(16), at, ...rec, ...(person?.group ? { group: person.group } : {}) });
  if (contact) await putSurveyContact(event.id, { id: newToken(12), at, ...contact });
  if (person) await putSurveyDone(event.id, pid, { about: !!(done.about || asked.about), parts: [...new Set([...(done.parts ?? []), part])] });
  return json({ ok: true });
}

/** A test of the email to up to five addresses; each gets a link of their own, so they can try the survey. */
async function testSend(event, to, part, who) {
  const addresses = [...new Set(String(to || who?.email || "").split(/[,;\s]+/).map((a) => a.trim().toLowerCase()).filter(Boolean))];
  if (!addresses.length) return fail("Which address should the test go to?");
  if (addresses.length > 5) return fail("Up to five test addresses at a time.");
  if (addresses.some((a) => !isEmail(a))) return fail(`${addresses.find((a) => !isEmail(a))} is not an email address.`);
  const testers = addresses.map((email) => ({ key: `test:${email}`, first: email === String(who?.email ?? "").toLowerCase() ? String(who?.name ?? "").split(/\s+/)[0] : "", email }));
  event.survey = { ...event.survey, testers: [...testers, ...(event.survey.testers ?? []).filter((t) => !testers.some((n) => n.key === t.key))].slice(0, 10) };
  await putEvent(event);
  const letter = surveyLetter(event, part);
  for (const person of testers) {
    const mail = renderLetter(letter, event, person);
    const out = await sendMail({ to: person.email, replyTo: attendeeReplyTo(event), ...mail, subject: `TEST: ${mail.subject}` });
    if (out.skipped) return fail(`The test did not send: ${out.reason}`, 502);
  }
  return json({ ok: true, to: addresses.join(", ") });
}

