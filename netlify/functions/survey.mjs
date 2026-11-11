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
import { getSurveyContacts, deleteSurveyData } from "./lib/store.mjs";
import { surveyResults } from "./lib/surveyresults.mjs";
import { analyseSurvey } from "./lib/surveyanalysis.mjs";
import { describeSessions } from "./lib/topicdescribe.mjs";
import { surveySummaryPdf, surveyResponsesXlsx, surveyContactsXlsx, surveyQrPdf, surveyPresentersPdf } from "./lib/surveyreport.mjs";
import { infographicHtml, BLOCKS } from "./lib/infographic.mjs";
import { slugOf } from "./lib/public.mjs";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

/**
 * An event's survey (Andrew 27 Oct 2026; notes/surveys-plan.md).
 *
 * The attendee's side, by the survey's token (their own link adds who they are, only so nobody is asked twice):
 *   GET  /api/survey?t=…[&p=…][&part=…]     the questions for their part (a day, or "end")
 *   POST /api/survey?t=…[&p=…]              their answers, kept with no name on them (&preview=1: checked, not kept)
 *   GET|POST /api/survey?t=…&day=2026-11-10  a day's QR code: that day's sessions only, nobody's link, no About-you
 *
 * The event page (signed in):
 *   GET  /api/survey?event=…                settings, sessions, when each part goes, how many have answered
 *   PUT  /api/survey?event=…                set it up the first time, or change it
 *   POST /api/survey?event=…&refresh=1      bring the sessions up to the presenter list (days kept)
 *   POST /api/survey?event=…&test=1         { to, part } the email, marked TEST, to up to five addresses
 *   POST /api/survey?event=…&send=1         { part } send that part now to everyone owed it
 *
 * The results (Andrew 27 Oct 2026):
 *   GET  /api/survey?event=…&results=1                 the numbers, and Claude's read if it has been asked for
 *   GET  /api/survey?event=…&download=summary|answers|presenters   the summary PDF, every answer (.xlsx), who'd like to present (.xlsx)
 *   POST /api/survey?event=…&analyse=1                 ask Claude to read the results (kept on the event)
 *   GET  /api/survey?event=…&infographic=1&lang=en|fr[&block=…]   the infographic page, or one section as a square
 *   POST /api/survey?event=…&pdf=1&w=…&h=…&name=…      a PNG of it (the body) as a one-page PDF of the same size
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
  if (req.method === "GET") {
    if (url.searchParams.get("results")) return results(event, url.searchParams.get("who"), url.searchParams.get("day"));
    if (url.searchParams.get("download")) return download(event, url.searchParams.get("download"), url);
    if (url.searchParams.get("qr")) return qrCodes(event, url.searchParams.get("qr"));
    if (url.searchParams.get("infographic")) return infographic(event, url.searchParams.get("lang"), url.searchParams.get("block"), url.searchParams.get("who"), url.searchParams.get("day"));
    return show(event);
  }
  if (req.method === "POST" && url.searchParams.get("pdf")) return pngToPdf(req, url);
  const viewOnly = editGuard(req, event); if (viewOnly) return viewOnly;
  const body = await req.json().catch(() => ({}));
  // Clear every answer (Andrew 27 Oct 2026: the board tries the survey with made-up answers to see the results and the
  // infographic, then "clear all the data. So we have a fresh set for real feedback"). The questions, sessions and
  // settings stay; the answers, who has answered, the would-be presenters and Claude's read go.
  if (req.method === "POST" && url.searchParams.get("clear")) {
    if (!event.survey) return fail("Set up the survey first.", 409);
    if (body.confirm !== "CLEAR") return fail("Type CLEAR to confirm.");
    const removed = await deleteSurveyData(event.id);
    const { analysis, ...rest } = event.survey;
    event.survey = rest;
    await putEvent(event);
    return json({ ok: true, removed });
  }
  // Claude drafts the plain line under each session title on the infographic: those without one, or all with &all=1.
  if (req.method === "POST" && url.searchParams.get("describe")) {
    if (!event.survey) return fail("Set up the survey first.", 409);
    const all = url.searchParams.get("all") === "1";
    const presenters = await listPresenters(event.id);
    const outlineOf = (s) => {
      const p = presenters.find((x) => `p${x.id}`.slice(0, 40) === s.id) ?? presenters.find((x) => s.presenters.includes([x.first, x.last].filter(Boolean).join(" ").trim()));
      return p?.submission?.outline ?? "";
    };
    const want = event.survey.sessions.filter((s) => s.title && (all || !s.about));
    try {
      const lines = await describeSessions(want.map((s) => ({ id: s.id, title: s.title, presenters: s.presenters, outline: outlineOf(s) })));
      event.survey = { ...event.survey, sessions: event.survey.sessions.map((s) => (lines[s.id] ? { ...s, about: lines[s.id].en, aboutFr: lines[s.id].fr } : s)) };
      event.updatedAt = new Date().toISOString();
      await putEvent(event);
      return show(event);
    } catch (e) { return fail(e.message, 503); }
  }
  if (req.method === "POST" && url.searchParams.get("analyse")) {
    if (!event.survey) return fail("Set up the survey first.", 409);
    try {
      const R = await resultsOf(event);
      event.survey = { ...event.survey, analysis: await analyseSurvey(event, R) };
      await putEvent(event);
      return json({ analysis: event.survey.analysis });
    } catch (e) { return fail(e.message, 503); }
  }
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
    if (url.searchParams.get("test")) return testSend(event, text(body.to, 600), part, adminWho(req), body.as === "partner");
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

/**
 * The answers of one group, or everyone (Andrew 10 Nov 2026: "can we track the answers separately? Community Members and
 * Justice Community"). By what each person picked at the top of the survey; answers from before the choice existed go by
 * how the person registered, and a QR answer from then (nobody known) only counts under everyone.
 */
const whoOfAnswer = (r) => r.who || (r.partner ? "partner" : r.via === "qr" ? "" : "justice");
const byWho = (responses, who) => (who === "justice" || who === "partner" ? responses.filter((r) => whoOfAnswer(r) === who) : responses);

// One day's answers (Andrew 11 Nov 2026: "where can i see the results by days"): the answers given for that day's part.
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? "");
const byDay = (responses, day) => (isDay(day) ? responses.filter((r) => r.part === day) : responses);

async function results(event, who = "", day = "") {
  if (!event.survey) return json({ results: null });
  const all = await getSurveyResponses(event.id);
  const R = await resultsOf(event, byDay(byWho(all, who), day));
  const inDay = byDay(all, day);
  const counts = { all: inDay.length, justice: byWho(inDay, "justice").length, partner: byWho(inDay, "partner").length,
    days: Object.fromEntries(trainingDays(event).map((d) => [d, byDay(byWho(all, who), d).length])) };
  return json({ results: R, who: ["justice", "partner"].includes(who) ? who : "", day: isDay(day) ? day : "", daily: event.survey.mode === "daily", counts, analysis: event.survey.analysis ?? null, blocks: BLOCKS, presenters: (await getSurveyContacts(event.id)).length });
}

async function download(event, which, url = null) {
  if (!event.survey) return fail("Set up the survey first.", 409);
  const who = url?.searchParams.get("who") ?? "", day = url?.searchParams.get("day") ?? "";
  const responses = byDay(byWho(await getSurveyResponses(event.id), who), day);
  const dayN = isDay(day) ? trainingDays(event).indexOf(day) + 1 : 0;
  const base = `${slugOf(event.title) || "event"}-survey${dayN ? `-day-${dayN}` : ""}${who === "justice" ? "-justice" : who === "partner" ? "-community-partners" : ""}`;
  const send = (bytes, type, name) => new Response(bytes, { headers: { "content-type": type, "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
  if (which === "summary") return send(await surveySummaryPdf(event, await resultsOf(event, responses), event.survey.analysis ?? null), "application/pdf", `${base}-summary.pdf`);
  // Feedback on each presenter, one page each, or one presenter's (&session=…) (Andrew 9 Nov 2026).
  if (which === "feedback") {
    const only = /^[A-Za-z0-9_-]{1,40}$/.test(url?.searchParams.get("session") ?? "") ? url.searchParams.get("session") : "";
    const R = await resultsOf(event, responses);
    const one = only ? R.sessions.find((x) => x.id === only) : null;
    if (only && !one) return fail("That session isn't on this survey.", 404);
    const name = one ? `${slugOf(one.presenters.join(" ")) || "presenter"}-feedback.pdf` : `${base}-presenters.pdf`;
    return send(await surveyPresentersPdf(event, R, event.survey.analysis ?? null, { only }), "application/pdf", name);
  }
  if (which === "answers") return send(surveyResponsesXlsx(event, responses), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", `${base}-answers.xlsx`);
  if (which === "presenters") return send(surveyContactsXlsx(event, await getSurveyContacts(event.id)), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", `${base}-interested-in-presenting.xlsx`);
  return fail("Which download: summary, answers or presenters?");
}

async function infographic(event, lang, block, who = "", day = "") {
  if (!event.survey) return fail("Set up the survey first.", 409);
  const R = await resultsOf(event, byDay(byWho(await getSurveyResponses(event.id), who), day));
  const html = infographicHtml(event, R, event.survey.analysis ?? null, { lang: lang === "fr" ? "fr" : "en", block: block || "" });
  if (!html) return fail("There is nothing for that section yet.", 404);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

/** The infographic as a PDF: the PNG the page made, on one page of the same shape. */
async function pngToPdf(req, url) {
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length < 40 || bytes.length > 25 * 1024 * 1024 || bytes.toString("latin1", 1, 4) !== "PNG") return fail("That is not a PNG.");
  const w = Math.min(4000, Number(url.searchParams.get("w")) || 1080), h = Math.min(20000, Number(url.searchParams.get("h")) || 1080);
  const pw = 612, ph = Math.round((h / w) * pw);
  const doc = new PDFDocument({ size: [pw, ph], margin: 0, displayTitle: true, info: { Title: text(url.searchParams.get("name"), 120) || "ONGIA infographic", Author: "ONGIA" } });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  doc.image(bytes, 0, 0, { width: pw, height: ph });
  doc.end();
  return new Response(await done, { headers: { "content-type": "application/pdf", "cache-control": "no-store" } });
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
  // Only a day whose survey has gone: one before today, or today once its time has come (15 minutes after its last
  // session). Never a day still to come (Andrew 10 Nov 2026: Monday's link, opened again, showed Tuesday's sessions).
  const [today, time] = localNow(event).split(" ");
  const at = new Map(dailyTimes(event).map((t) => [t.day, t.at]));
  const gone = days.filter((d) => d < today || (d === today && at.get(d) && time >= at.get(d)));
  if (gone.includes(asked)) return asked;
  const open = gone.filter((d) => !(done.parts ?? []).includes(d));
  // The latest one not answered yet; all answered, the latest (it says "already answered"); none gone yet, the first.
  return open[open.length - 1] ?? gone[gone.length - 1] ?? days[0];
}

/** A day's QR link: that day's sessions and nothing else. Null when the day isn't one of the event's with sessions. */
function qrPart(event, day) {
  if (!trainingDays(event).includes(day)) return null;
  const sessions = (event.survey?.sessions ?? []).filter((s) => s.day === day);
  return sessions.length ? { part: day, partner: false, who: null, about: false, days: [{ day, sessions }], overall: false } : null;
}
const qrLink = (event, day) => `${siteUrl()}/f/${event.survey.token}?day=${day}`;
const qrPng = (link, width = 900) => QRCode.toBuffer(link, { margin: 2, width, errorCorrectionLevel: "M", color: { dark: "#14264d", light: "#ffffff" } });

/** The QR codes: one day's as a picture, or every day's on its own page of a PDF to print or put on screen. */
async function qrCodes(event, which) {
  if (!event.survey) return fail("Set up the survey first.", 409);
  const days = trainingDays(event).map((day, i) => ({ day, n: i + 1 })).filter((d) => qrPart(event, d.day));
  const base = `${slugOf(String(event.title).split(/\s*:\s*/)[0]) || "event"}-survey`;   // "national-gang-summit-survey-day-2-qr.png"
  if (which === "all") {
    if (!days.length) return fail("No day has sessions yet. Pick the day for each session first.", 409);
    for (const d of days) { d.url = qrLink(event, d.day); d.png = await qrPng(d.url); }
    return new Response(await surveyQrPdf(event, days), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${base}-qr-codes.pdf"`, "cache-control": "no-store" } });
  }
  const d = days.find((x) => x.day === which);
  if (!d) return fail("That day has no sessions to rate.", 404);
  return new Response(await qrPng(qrLink(event, d.day), 1200), { headers: { "content-type": "image/png", "content-disposition": `attachment; filename="${base}-day-${d.n}-qr.png"`, "cache-control": "no-store" } });
}

async function attendeeSide(req, url, tok, pid) {
  const event = await eventByToken(tok);
  if (!event) return fail("This link is not working. Reply to the email it came in and we will sort it out.", 404);
  const s = event.survey;
  const qrDay = url.searchParams.get("day");
  if (qrDay) return qrSide(req, url, event, qrDay);
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
  await putSurveyResponse(event.id, { id: newToken(16), at, ...rec, ...(person?.group ? { group: person.group } : {}), ...(rec.who === "partner" ? { partner: true } : {}) });
  if (contact) await putSurveyContact(event.id, { id: newToken(12), at, ...contact });
  if (person) await putSurveyDone(event.id, pid, { about: !!(done.about || asked.about), parts: [...new Set([...(done.parts ?? []), part])] });
  return json({ ok: true });
}

/** Someone who scanned a day's QR code: that day's sessions only. Anonymous, and not tied to anyone's emailed link. */
async function qrSide(req, url, event, day) {
  const asked = qrPart(event, day);
  if (!asked) return fail("This code is for a day with nothing to rate. Ask at the registration desk.", 404);
  if (req.method === "GET") return json({ ...surveyForPage(event, asked), open: event.survey.open, answered: false, daily: true, qr: true });
  if (req.method !== "POST") return fail("Method not allowed.", 405);
  if (!event.survey.open) return fail("closed", 409);
  const body = await req.json().catch(() => null);
  if (!body) return fail("Expected a JSON body.");
  const { rec, missing } = cleanResponse(body, asked, body.lang);
  if (missing.length) return json({ error: "missing", missing }, 400);
  if (url.searchParams.get("preview")) return json({ ok: true, preview: true });
  await putSurveyResponse(event.id, { id: newToken(16), at: new Date().toISOString(), ...rec, ...(rec.who === "partner" ? { partner: true } : {}), via: "qr" });
  return json({ ok: true });
}

/** A test of the email to up to five addresses; each gets a link of their own, so they can try the survey. */
async function testSend(event, to, part, who, partner = false) {
  const addresses = [...new Set(String(to || who?.email || "").split(/[,;\s]+/).map((a) => a.trim().toLowerCase()).filter(Boolean))];
  if (!addresses.length) return fail("Which address should the test go to?");
  if (addresses.length > 5) return fail("Up to five test addresses at a time.");
  if (addresses.some((a) => !isEmail(a))) return fail(`${addresses.find((a) => !isEmail(a))} is not an email address.`);
  // A test as a community partner gets their days and their questions (the second group's Wix event).
  const second = partner ? (event.wixMore ?? [])[0] : null;
  if (partner && !second) return fail("This event has no community partners group.");
  const testers = addresses.map((email) => ({ key: `test:${second ? "partner:" : ""}${email}`, first: email === String(who?.email ?? "").toLowerCase() ? String(who?.name ?? "").split(/\s+/)[0] : "", email,
    ...(second ? { group: second.group || "group", wixEventId: second.eventId } : {}) }));
  event.survey = { ...event.survey, testers: [...testers, ...(event.survey.testers ?? []).filter((t) => !testers.some((n) => n.key === t.key))].slice(0, 10) };
  await putEvent(event);
  const letter = surveyLetter(event, part, { partner: !!second });
  for (const person of testers) {
    const mail = renderLetter(letter, event, { ...person, surveyPart: part });
    const out = await sendMail({ to: person.email, replyTo: attendeeReplyTo(event), ...mail, subject: `TEST: ${mail.subject}` });
    if (out.skipped) return fail(`The test did not send: ${out.reason}`, 502);
  }
  return json({ ok: true, to: addresses.join(", ") });
}


/** The survey's numbers, with the agencies the event's registrations came from. */
async function resultsOf(event, responses = null) {
  return surveyResults(event, responses ?? await getSurveyResponses(event.id), await directory(), ((await getAttendees(event.id)) ?? {}).people ?? []);
}
