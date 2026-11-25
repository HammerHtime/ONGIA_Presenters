import { json, fail, text } from "./lib/http.mjs";
import { verifyIdToken, signinConfig } from "./lib/auth.mjs";
import { getRoster, listEvents } from "./lib/store.mjs";
import {
  testersOf, putTesters, mayManage, mayEnter, issueReviewSession, reviewWho, getCycle, putCycle, listCycles, phaseOf, directorOf,
  isCommittee, isPresidentOf, peersOf, questionsFor, newCycle, getSelf, getDone, saveSelf, sendPeer, sendBoard, factsOf, reportOf,
  resultsOf, progressOf, deleteCycleAll, makeSample, keyOf, FLOOR, SCALE,
} from "./lib/review.mjs";
import { openMail, remindOne } from "./lib/reviewmail.mjs";

/**
 * The board review (lib/review.mjs), on its own page /board with its own sign-in.
 *
 *   POST /api/boardreview?signin=1                     { idToken, nonce } → a review session (the review and nothing else)
 *   GET  /api/boardreview                              who I am, whether it's open, the cycles I can see
 *   GET  /api/boardreview?cycle=…                      that cycle as I may see it: my part; the progress (committee, president)
 *   GET  /api/boardreview?cycle=…&peer=<key>           reviewing one colleague: their questions, what they delivered, the facts
 *   POST /api/boardreview?cycle=…&self=1               { answers, ratings, send }
 *   POST /api/boardreview?cycle=…&peer=<key>           { ratings, comments }  (once; stored with no reviewer)
 *   POST /api/boardreview?cycle=…&board=1              { ratings, comment }   (once)
 *   GET  /api/boardreview?cycle=…&report=<key>         a director's report: the committee any; the director their own once released
 *   GET  /api/boardreview?cycle=…&results=1            the board-wide results: the committee and the president
 *   POST /api/boardreview?cycle=…&release=<key>        the committee releases a director's report to them
 *   PUT  /api/boardreview?cycle=…&notes=<key>          { meetings, commitments } the committee's own record
 *   POST /api/boardreview?cycle=…&remind=<key>         the committee: a reminder to one director now
 *   POST /api/boardreview?cycle=new                    the president or VP: { year, selfOpens, peerOpens, closes, directors, committee, president, firstYear }
 *   POST /api/boardreview?sample=1                     the president or VP: a finished cycle of made-up directors, to see every screen
 *   DELETE /api/boardreview?cycle=…                    the president or VP: the cycle and every answer in it
 *   GET/PUT /api/boardreview?testers=1                 the president or VP: { emails, open }
 */
export default async (req) => {
  const url = new URL(req.url);
  const q = (k) => url.searchParams.get(k);
  if (req.method === "POST" && q("signin")) return signIn(req);
  const who = reviewWho(req);
  if (!who) return fail("Sign in to see the board review.", 401);
  if (!(await mayEnter(who.email))) return fail("The board review isn't open to you yet.", 403);
  const manage = mayManage(who.email);

  if (q("testers")) {
    if (!manage) return fail("Only the president and the VP can change who tests the review.", 403);
    if (req.method === "GET") return json(await testersOf());
    if (req.method !== "PUT") return fail("Not allowed.", 405);
    const body = await req.json().catch(() => ({}));
    const had = await testersOf();
    const emails = [...new Set((Array.isArray(body.emails) ? body.emails : had.emails).map((e) => text(e, 200).toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
    if (!emails.some((e) => mayManage(e))) return fail("Keep the president or the VP on the list.");
    const open = typeof body.open === "boolean" ? body.open : had.open;
    const advisors = [...new Set((Array.isArray(body.advisors) ? body.advisors : had.advisors ?? []).map((e) => text(e, 200).toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
    const next = { emails, open, advisors, ...(open !== had.open ? { openChanged: { at: new Date().toISOString(), by: who.email, open } } : { openChanged: had.openChanged }) };
    await putTesters(next);
    return json(next);
  }

  if (req.method === "POST" && q("sample")) {
    if (!manage) return fail("Only the president and the VP can make a sample.", 403);
    const c = await makeSample(who.email, (await testersOf()).emails);
    return json({ cycle: c.id });
  }

  if (req.method === "POST" && q("cycle") === "new") {
    if (!manage) return fail("Only the president and the VP can open a review.", 403);
    const t = await testersOf();
    const made = await newCycle(await req.json().catch(() => ({})), who.email, { testersOnly: !t.open, testers: t.emails.map((e) => e.toLowerCase()), advisors: t.advisors ?? [] });
    if (made.error) return fail(made.error);
    await putCycle(made.cycle);
    const mail = await openMail(made.cycle).catch((e) => ({ error: e.message }));
    return json({ cycle: made.cycle.id, mail });
  }

  if (!q("cycle")) return home(who, manage);
  const c = await getCycle(q("cycle"));
  if (!c) return fail("No such review.", 404);
  const me = directorOf(c, who.email);
  const committee = isCommittee(c, who.email), president = isPresidentOf(c, who.email);
  // A sample (made-up directors) is for the testers to see every screen: each of them sees it as the committee does.
  const testers = (await testersOf()).emails.map((e) => e.toLowerCase());
  if (c.sample && !testers.includes(who.email.toLowerCase())) return fail("No such review.", 404);
  if (!me && !committee && !manage) return fail("You aren't in this review.", 403);

  if (req.method === "DELETE") {
    if (!manage) return fail("Only the president and the VP can delete a review.", 403);
    const n = await deleteCycleAll(c);
    console.log(`review: cycle ${c.id} deleted by ${who.email} (${n} answers)`);
    return json({ deleted: true });
  }

  const pk = q("peer");
  if (pk && req.method === "GET") {
    if (!me) return fail("You aren't in this review.", 403);
    const target = peersOf(c, who.email).find((d) => keyOf(d.email) === pk);
    if (!target) return fail("That isn't one of the colleagues you review.", 404);
    const self = await getSelf(c, target.email);
    const done = await getDone(c, who.email);
    return json({ name: target.name, key: pk, president: isPresidentOf(c, target.email), sent: done.peers.includes(pk), phase: phaseOf(c),
      // Peers see only what the colleague delivered: the rest of a self-review is for the committee and their own report.
      delivered: self?.sentAt ? self.answers.delivered : null,
      facts: await factsOf(c, target.email), questions: questionsFor(c, target), comments: [c.questions.comment, ...(isPresidentOf(c, target.email) ? c.questions.presidentComments : [])], scale: SCALE });
  }
  if (req.method === "POST" && pk) { const r = await sendPeer(c, who.email, pk, await req.json().catch(() => ({}))); return r.error ? fail(r.error, r.status) : json(r); }
  if (req.method === "POST" && q("self")) { const r = await saveSelf(c, who.email, await req.json().catch(() => ({}))); return r.error ? fail(r.error, r.status) : json(r); }
  if (req.method === "POST" && q("board")) { const r = await sendBoard(c, who.email, await req.json().catch(() => ({}))); return r.error ? fail(r.error, r.status) : json(r); }

  const rk = q("report");
  if (rk && req.method === "GET") {
    const d = c.directors.find((x) => keyOf(x.email) === rk);
    if (!d) return fail("No such director in this review.", 404);
    const own = d.email.toLowerCase() === who.email.toLowerCase();
    // The committee reads every report; a director (the president too) reads their own, once the committee releases it.
    if (!committee && !(own && c.released?.[rk])) return fail(own ? "Your report isn't released yet: the committee releases it, usually at your one-on-one." : "Only the review committee can read a director's report.", 403);
    if (phaseOf(c) !== "closed") return fail("Reports are made when the peer round closes.", 409);
    return json({ report: await reportOf(c, d.email), floor: FLOOR, scale: SCALE });
  }
  if (q("results") && req.method === "GET") {
    if (!committee && !president) return fail("The board-wide results are for the committee and the president.", 403);
    if (phaseOf(c) !== "closed") return fail("The results are made when the peer round closes.", 409);
    return json({ results: await resultsOf(c), floor: FLOOR });
  }
  if (req.method === "POST" && q("release")) {
    if (!committee) return fail("The review committee releases reports.", 403);
    if (phaseOf(c) !== "closed") return fail("Reports are made when the peer round closes.", 409);
    const k = q("release");
    if (!c.directors.some((d) => keyOf(d.email) === k)) return fail("No such director in this review.", 404);
    c.released = { ...(c.released ?? {}), [k]: { at: new Date().toISOString(), by: who.email } };
    await putCycle(c);
    return json({ released: c.released[k] });
  }
  if (req.method === "PUT" && q("notes")) {
    if (!committee) return fail("Only the review committee keeps these.", 403);
    const k = q("notes");
    if (!c.directors.some((d) => keyOf(d.email) === k)) return fail("No such director in this review.", 404);
    const body = await req.json().catch(() => ({}));
    if (body.meetings !== undefined) c.facts = { ...(c.facts ?? {}), [k]: { ...(c.facts?.[k] ?? {}), meetings: text(body.meetings, 40) } };
    if (Array.isArray(body.commitments)) c.commitments = { ...(c.commitments ?? {}), [k]: body.commitments.map((x) => text(x, 300)).filter(Boolean).slice(0, 3) };
    await putCycle(c);
    return json({ ok: true });
  }
  if (req.method === "POST" && q("remind")) {
    if (!committee) return fail("The review committee sends reminders.", 403);
    const d = c.directors.find((x) => keyOf(x.email) === q("remind"));
    if (!d) return fail("No such director in this review.", 404);
    const r = await remindOne(c, d).catch((e) => ({ error: e.message }));
    return r.error ? fail(`The reminder didn't go: ${r.error}`, 502) : json(r);
  }
  if (req.method !== "GET") return fail("Not allowed.", 405);
  return cycleView(c, who, { me, committee, president, manage });
};

async function signIn(req) {
  if (!signinConfig()) return fail("Microsoft sign-in isn't set up on this site yet.", 503);
  if (!process.env.ADMIN_KEY) return fail("The site isn't set up for signing in yet.", 503);
  const body = await req.json().catch(() => null);
  let person;
  try { person = await verifyIdToken(text(body?.idToken, 20000), text(body?.nonce, 200)); }
  catch (e) { return fail(e.message, 401); }
  if (!(await mayEnter(person.email))) return fail(`The board review isn't open to ${person.email} yet.`, 403);
  const member = ((await getRoster()) ?? []).find((m) => String(m.email).toLowerCase() === person.email);
  const name = member?.name || person.name;
  return json({ session: issueReviewSession({ email: person.email, name }), me: { email: person.email, name } });
}

/** Who I am, whether it's open to the board, and the cycles I can see. */
async function home(who, manage) {
  const t = await testersOf();
  const tester = t.emails.map((e) => e.toLowerCase()).includes(who.email.toLowerCase());
  const cycles = (await listCycles()).filter((c) => (c.sample ? tester : manage || directorOf(c, who.email) || isCommittee(c, who.email)));
  return json({ me: { email: who.email, name: who.name, manage, tester }, open: !!t.open,
    cycles: cycles.map((c) => ({ id: c.id, year: c.year, test: !!c.test, sample: !!c.sample, phase: phaseOf(c), selfOpens: c.selfOpens, peerOpens: c.peerOpens, closes: c.closes,
      directors: c.directors.length, mine: !!directorOf(c, who.email), committee: isCommittee(c, who.email) })),
    roster: manage ? ((await getRoster()) ?? []).map((m) => ({ email: m.email, name: m.name })) : undefined, testers: manage ? t : undefined });
}

/** A cycle as this person may see it. */
async function cycleView(c, who, { me, committee, president, manage }) {
  const phase = phaseOf(c);
  const out = { id: c.id, year: c.year, test: !!c.test, sample: !!c.sample, phase, selfOpens: c.selfOpens, peerOpens: c.peerOpens, closes: c.closes,
    committee: c.committeeNames ?? c.directors.filter((d) => isCommittee(c, d.email)).map((d) => d.name), president: c.directors.find((d) => isPresidentOf(c, d.email))?.name ?? "",
    roles: { director: !!me, committee, president, manage }, questions: c.questions, scale: SCALE, floor: FLOOR };
  if (me) {
    const [self, done] = await Promise.all([getSelf(c, who.email), getDone(c, who.email)]);
    out.mine = { firstYear: !!me.firstYear, self: self ? { answers: self.answers, ratings: self.ratings, sentAt: self.sentAt ?? null } : null,
      selfQuestions: questionsFor(c, me), board: done.board,
      peers: peersOf(c, who.email).map((d) => ({ key: keyOf(d.email), name: d.name, president: isPresidentOf(c, d.email), sent: done.peers.includes(keyOf(d.email)) })),
      released: c.released?.[keyOf(who.email)] ? keyOf(who.email) : null };
  }
  if (committee || president) out.progress = await progressOf(c);
  if (committee) out.notes = Object.fromEntries(c.directors.map((d) => [keyOf(d.email), { meetings: c.facts?.[keyOf(d.email)]?.meetings ?? "", commitments: c.commitments?.[keyOf(d.email)] ?? [], released: c.released?.[keyOf(d.email)] ?? null }]));
  return json(out);
}


