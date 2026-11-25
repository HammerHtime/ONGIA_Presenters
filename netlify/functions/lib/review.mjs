import { createHash, createHmac, randomBytes } from "node:crypto";
import { getMeta, putMeta, listMetaKeys, deleteMeta, getRoster, listEvents } from "./store.mjs";
import { isOwner, mayCost, deskOwners, readSession } from "./auth.mjs";
import { tokensMatch } from "./ids.mjs";
import { todayIso } from "./deadlines.mjs";

/**
 * The board review: an annual 360 for every director, the president included (spec: HammerHtime/general,
 * chief-of-staff/board-review-spec.md; Andrew 24–25 Nov 2026). Everyone reviews everyone on a short form, with
 * "not enough contact" on every question; a score shows only when at least FLOOR colleagues gave one.
 *
 * Anonymity is built into what is stored, not only into what is shown: a peer's ratings are written with no reviewer
 * on them at all (review:rate:<cycle>:<reviewed>:<random>), and who has reviewed whom is a separate list
 * (review:done:<cycle>:<reviewer>) that holds names, never answers. Nothing joins the two, so no screen, no API and no
 * one with the desk's keys can pair a rating with its author. Drafts of a peer review stay on the reviewer's own device.
 *
 * Until Andrew opens it to the board, only the testers (the president, the VP and John Healy) can see or use any of it,
 * and the server refuses everyone else. The desk's shared key is nobody here.
 */
export const FLOOR = 5;
export const SCALE = { 5: "Outstanding: a model for the board", 4: "Strong: does this well consistently", 3: "Meets expectations", 2: "Sometimes falls short", 1: "Rarely does this" };

/** The questions, kept on each cycle when it opens so a later year can change the wording without rewriting old reports. */
export const QUESTIONS = {
  director: [
    { id: "prep", title: "Prepared", text: "Attends meetings, or sends regrets ahead, and comes having read the material." },
    { id: "follow", title: "Follows through", text: "Does what they say they'll do, on time." },
    { id: "beyond", title: "Beyond meetings", text: "Helps with events, training or committee work between meetings." },
    { id: "voice", title: "Speaks up and listens", text: "Asks useful questions, raises a different view, and respects others'." },
    { id: "decide", title: "Supports decisions", text: "Supports board decisions once they're made." },
    { id: "trust", title: "Keeps confidences", text: "Keeps board matters confidential and declares conflicts of interest." },
    { id: "ambassador", title: "Represents ONGIA", text: "Represents ONGIA well with partners, agencies and the public." },
  ],
  president: [
    { id: "meetings", title: "Runs meetings well", text: "Runs meetings so every view is heard and decisions are clear." },
    { id: "direction", title: "Keeps the focus", text: "Keeps the board focused on ONGIA's direction and priorities." },
    { id: "include", title: "Includes directors", text: "Brings directors into decisions and uses their strengths." },
    { id: "steward", title: "Looks after ONGIA", text: "Looks after ONGIA's finances, partnerships and reputation responsibly." },
    { id: "account", title: "Holds to the rules", text: "Holds everyone, themselves included, to the bylaws and policies, and asks for feedback." },
  ],
  comment: { id: "note", text: "Optional: one thing they do well, or could do more of." },
  presidentComments: [{ id: "strength", text: "What are the president's main strengths?" }, { id: "improve", text: "How could the president improve?" }],
  self: [
    { id: "delivered", text: "What did I deliver this year? Three examples." },
    { id: "portfolio", text: "How did my area of responsibility move forward?" },
    { id: "short", text: "Where did I fall short, and why?" },
    { id: "commit", text: "What will I commit to in the coming year?" },
    { id: "support", text: "How can the board or the president support me?" },
    { id: "next", text: "What would I like to take on next year?" },
  ],
  board: [
    { id: "decisions", title: "Good decisions", text: "We make decisions the right way." },
    { id: "chance", title: "Everyone contributes", text: "Every director has a real chance to contribute." },
  ],
  boardComment: { id: "better", text: "One thing that would make this board more effective." },
};

const lc = (v) => String(v ?? "").trim().toLowerCase();
export const keyOf = (email) => createHash("sha256").update(lc(email)).digest("hex").slice(0, 12);
const rand = () => randomBytes(9).toString("base64url").replace(/[^a-zA-Z0-9]/g, "x");

/* ---------- who may come in ---------- */

/** The testers and the switch that opens the review to the board. Starts with the president, the VP and John Healy. */
/**
 * Advisors to the board (Andrew 25 Nov 2026: "Andy Bain and John Healy don't get a review. They are advisors to the
 * board"): never in a review, as reviewer or reviewed. An advisor can still sit on the review committee. Kept as a
 * list on this setting, changed on the review's own page, never decided by a name in the code.
 */
// Before anyone on the board list has a role, the advisors Andrew named (25 Nov 2026) stand in.
const ADVISORS = ["a.bain@ongia.ca", "j.healy@ongia.ca"];
/**
 * The board's roles, from the board list (Admin › Board members): the president, the VP, and the advisors, who are
 * never reviewed. Until anyone there has a role, the advisors Andrew named stand in and nobody is marked president.
 */
export async function rolesOf(roster = null) {
  const r = roster ?? (await getRoster()) ?? [];
  const has = (role) => r.filter((m) => m.role === role).map((m) => lc(m.email));
  if (!r.some((m) => m.role)) return { president: "", vp: "", advisors: ADVISORS, fromList: false };
  return { president: has("president")[0] ?? "", vp: has("vp")[0] ?? "", advisors: has("advisor"), fromList: true };
}
export async function testersOf() {
  const saved = await getMeta("review:testers");
  if (saved) { const { advisors, ...rest } = saved; return rest; }
  const vp = String(process.env.COSTING_USERS || "vp_operations@ongia.ca").split(/[,\s]+/).map(lc).filter(Boolean);
  return { emails: [...new Set([...deskOwners(), ...vp, "j.healy@ongia.ca"])], open: false };
}
export const putTesters = (t) => putMeta("review:testers", t);
/** The president and the VP manage the review: who tests it, opening it to the board, starting and deleting a cycle. */
export const mayManage = (email) => !!email && (isOwner(email) || mayCost({ email }));

/** May this person see the review at all? A tester always; anyone on the board list once it's open. */
export async function mayEnter(email) {
  const e = lc(email);
  if (!e) return false;
  const t = await testersOf();
  if (t.emails.map(lc).includes(e)) return true;
  if (!t.open) return false;
  return ((await getRoster()) ?? []).some((m) => lc(m.email) === e);
}

/* ---------- its own sign-in: the review and nothing else ---------- */
const SESSION_DAYS = 30;
const sessionKey = () => createHmac("sha256", String(process.env.ADMIN_KEY ?? "")).update("review-session-v1").digest();
const sign = (body) => createHmac("sha256", sessionKey()).update(body).digest("base64url");
export function issueReviewSession({ email, name }, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ e: lc(email), n: String(name ?? ""), x: now + SESSION_DAYS * 86400e3 })).toString("base64url");
  return `r1.${body}.${sign(body)}`;
}
function readReviewSession(value, now = Date.now()) {
  if (!process.env.ADMIN_KEY) return null;
  const [tag, body, mac] = String(value ?? "").split(".");
  if (tag !== "r1" || !body || !mac || !tokensMatch(mac, sign(body))) return null;
  let p; try { p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
  return p?.e && p.x > now ? { email: p.e, name: p.n } : null;
}
/** The person behind a request: a review sign-in, or a Briefing Room sign-in. The desk's shared key is nobody. */
export function reviewWho(req) {
  const v = req.headers.get("x-review-key") ?? "";
  if (v.startsWith("r1.")) return readReviewSession(v);
  if (v.startsWith("s1.")) { const s = readSession(v); return s ? { email: s.email, name: s.name } : null; }
  return null;
}

/* ---------- a cycle ---------- */
export const getCycle = (id) => getMeta(`review:cycle:${id}`);
export const putCycle = (c) => putMeta(`review:cycle:${c.id}`, c);
export async function listCycles() {
  const keys = await listMetaKeys("review:cycle:");
  return (await Promise.all(keys.map((k) => getMeta(k)))).filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** Where a cycle stands today: scheduled, self (week 1), peer (weeks 2–3), closed (reports). From its dates, never a flag. */
export function phaseOf(c, today = todayIso()) {
  if (today < c.selfOpens) return "scheduled";
  if (today < c.peerOpens) return "self";
  if (today <= c.closes) return "peer";
  return "closed";
}
export const directorOf = (c, email) => c.directors.find((d) => lc(d.email) === lc(email)) ?? null;
export const isCommittee = (c, email) => (c.committee ?? []).map(lc).includes(lc(email));
export const isPresidentOf = (c, email) => !!email && lc(c.president) === lc(email);
/**
 * Whom a director reviews: every other director, except anyone in their first year. A first-year director only does
 * a self-review: they're not rated yet, and don't rate colleagues they barely know (Treasury Board guidance).
 */
export const peersOf = (c, email) => (directorOf(c, email)?.firstYear ? [] : c.directors.filter((d) => lc(d.email) !== lc(email) && !d.firstYear));
export const questionsFor = (c, d) => [...c.questions.director, ...(isPresidentOf(c, d.email) ? c.questions.president : [])];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A new cycle, checked. Returns { cycle } or { error }. */
export async function newCycle(body, by, { testersOnly, testers }) {
  const year = Number(body.year) || new Date().getFullYear();
  const { selfOpens, peerOpens, closes } = body;
  if (![selfOpens, peerOpens, closes].every((d) => DAY.test(d ?? ""))) return { error: "Pick the three dates." };
  if (!(selfOpens < peerOpens && peerOpens <= closes)) return { error: "The peer round opens after the self-review week, and closes on or after it opens." };
  const roster = (await getRoster()) ?? [];
  const named = (e) => roster.find((m) => lc(m.email) === lc(e))?.name || e;
  const roles = await rolesOf(roster);
  const adv = new Set(roles.advisors);
  let emails = [...new Set((body.directors ?? []).map(lc).filter(Boolean))].filter((e) => !adv.has(e));
  if (testersOnly) emails = emails.filter((e) => testers.includes(e));
  if (emails.length < 2) return { error: testersOnly ? "Pick at least two of the testers: only testers can be in a cycle until the review is open to the board." : "Pick at least two directors." };
  const first = new Set((body.firstYear ?? []).map(lc));
  // The committee: directors in the review, or advisors (who are never reviewed).
  const committee = [...new Set((body.committee ?? []).map(lc).filter((e) => emails.includes(e) || (adv.has(e) && (!testersOnly || testers.includes(e)))))];
  // The president is the one marked on the board list; picked here only until someone is.
  const president = roles.president || lc(body.president);
  if (!committee.length) return { error: "Name the review committee: at least one director or advisor." };
  if (president && committee.includes(president)) return { error: "The president isn't on the review committee: it holds the president's own results." };
  return { cycle: {
    id: `${year}-${rand().slice(0, 6).toLowerCase()}`, year, test: testersOnly || body.test === true, createdAt: new Date().toISOString(), createdBy: by,
    selfOpens, peerOpens, closes, committee, committeeNames: committee.map(named), president: emails.includes(president) ? president : "",
    directors: emails.map((e) => ({ email: e, name: named(e), firstYear: first.has(e) })),
    questions: JSON.parse(JSON.stringify(QUESTIONS)), facts: {}, released: {}, commitments: {}, mail: {},
  } };
}

/* ---------- answers ---------- */
const selfKey = (c, email) => `review:self:${c.id}:${keyOf(email)}`;
const doneKey = (c, email) => `review:done:${c.id}:${keyOf(email)}`;
export const getSelf = (c, email) => getMeta(selfKey(c, email));
export const getDone = async (c, email) => (await getMeta(doneKey(c, email))) ?? { peers: [], board: false };

const score = (v) => (v === null || v === "na" ? "na" : Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 5 ? Number(v) : undefined);
/** Ratings for a set of questions: every one answered (1–5 or "na"). Returns { ratings } or { error }. */
function cleanRatings(qs, given) {
  const ratings = {};
  for (const q of qs) {
    const s = score(given?.[q.id]);
    if (s === undefined) return { error: `Answer "${q.title}": a number, or — if you haven't had enough contact to say.` };
    ratings[q.id] = s;
  }
  return { ratings };
}
const words = (v, n = 2000) => String(v ?? "").trim().slice(0, n);

/** Save (or send) one's own self-review. Sent is locked. */
export async function saveSelf(c, email, body, today = todayIso()) {
  const d = directorOf(c, email);
  if (!d) return { error: "You aren't in this review.", status: 403 };
  const phase = phaseOf(c, today);
  if (phase === "scheduled" || phase === "closed") return { error: phase === "closed" ? "This review has closed." : "The self-review hasn't opened yet.", status: 409 };
  const had = await getSelf(c, email);
  if (had?.sentAt) return { error: "Your self-review is sent, so it can't be changed.", status: 409 };
  const answers = Object.fromEntries(c.questions.self.map((q) => [q.id, words(body.answers?.[q.id])]));
  const qs = questionsFor(c, d);
  const ratings = Object.fromEntries(qs.map((q) => [q.id, score(body.ratings?.[q.id]) ?? null]));
  const rec = { answers, ratings, savedAt: new Date().toISOString() };
  if (body.send === true) {
    if (!answers.delivered) return { error: "Say what you delivered this year before you send it.", status: 400 };
    const missing = qs.find((q) => ratings[q.id] === null);
    if (missing) return { error: `Rate yourself on "${missing.title}" before you send it.`, status: 400 };
    rec.sentAt = rec.savedAt;
  }
  await putMeta(selfKey(c, email), rec);
  return { self: rec };
}

/** One peer review, sent: stored with no reviewer on it; the reviewer's done list gets the name. Once only. */
export async function sendPeer(c, email, revieweeKey, body, today = todayIso()) {
  if (!directorOf(c, email)) return { error: "You aren't in this review.", status: 403 };
  if (phaseOf(c, today) !== "peer") return { error: "The peer round isn't open.", status: 409 };
  const target = peersOf(c, email).find((d) => keyOf(d.email) === revieweeKey);
  if (!target) return { error: "That isn't one of the colleagues you review.", status: 404 };
  const done = await getDone(c, email);
  if (done.peers.includes(revieweeKey)) return { error: "You've already sent your review of this colleague.", status: 409 };
  const r = cleanRatings(questionsFor(c, target), body.ratings);
  if (r.error) return { error: r.error, status: 400 };
  const comments = Object.fromEntries([c.questions.comment, ...(isPresidentOf(c, target.email) ? c.questions.presidentComments : [])].map((q) => [q.id, words(body.comments?.[q.id], 1200)]).filter(([, v]) => v));
  // Marked done first: a second press, or a retry after a dropped connection, finds it and can't add a second rating.
  await putMeta(doneKey(c, email), { ...done, peers: [...done.peers, revieweeKey] });
  await putMeta(`review:rate:${c.id}:${revieweeKey}:${rand()}`, { ratings: r.ratings, comments });
  return { ok: true };
}

/** The board as a whole, once per director: stored with no name on it. */
export async function sendBoard(c, email, body, today = todayIso()) {
  if (!directorOf(c, email)) return { error: "You aren't in this review.", status: 403 };
  if (phaseOf(c, today) !== "peer") return { error: "The peer round isn't open.", status: 409 };
  const done = await getDone(c, email);
  if (done.board) return { error: "You've already sent this part.", status: 409 };
  const r = cleanRatings(c.questions.board, body.ratings);
  if (r.error) return { error: r.error, status: 400 };
  await putMeta(doneKey(c, email), { ...done, board: true });
  await putMeta(`review:board:${c.id}:${rand()}`, { ratings: r.ratings, comment: words(body.comment, 1200) });
  return { ok: true };
}

/* ---------- facts beside the ratings ---------- */
/** Events this director was a board member on, and led, in the review year (the year before the cycle's). */
export async function factsOf(c, email, events = null) {
  const year = String((c.year || new Date().getFullYear()) - 1);
  const list = (events ?? (await listEvents())).filter((e) => String(e.dayOne ?? "").startsWith(year) && !e.practice && !e.project);
  const mine = list.filter((e) => (e.board ?? []).some((m) => lc(m.email) === lc(email)));
  const led = mine.filter((e) => (e.board ?? []).some((m) => m.lead && lc(m.email) === lc(email)));
  return { year, on: mine.length, led: led.map((e) => e.city?.split(",")[0] || e.title).slice(0, 4), meetings: c.facts?.[keyOf(email)]?.meetings ?? "" };
}

/* ---------- reports ---------- */
const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
const shuffle = (xs) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
async function ratesOf(c, revieweeKey) {
  const keys = await listMetaKeys(`review:rate:${c.id}:${revieweeKey}:`);
  return (await Promise.all(keys.map((k) => getMeta(k)))).filter(Boolean);
}
/** Every rating on every director, for the board averages. */
async function allRates(c) {
  const out = {};
  for (const d of c.directors) out[keyOf(d.email)] = await ratesOf(c, keyOf(d.email));
  return out;
}

/** One director's report: averages beside the board's and their own, comments in random order, the facts. */
export async function reportOf(c, email, { all = null, events = null } = {}) {
  const d = directorOf(c, email);
  if (!d) return null;
  const k = keyOf(email);
  all ??= await allRates(c);
  const mine = all[k] ?? [];
  const self = await getSelf(c, email);
  const board = (qid) => avg(Object.values(all).flat().map((r) => r.ratings?.[qid]).filter((v) => typeof v === "number"));
  const rows = questionsFor(c, d).map((q) => {
    const vals = mine.map((r) => r.ratings?.[q.id]).filter((v) => typeof v === "number");
    return { id: q.id, title: q.title, n: vals.length, avg: vals.length >= FLOOR ? avg(vals) : null, board: board(q.id), self: typeof self?.ratings?.[q.id] === "number" && self?.sentAt ? self.ratings[q.id] : null };
  });
  const commentQs = [c.questions.comment, ...(isPresidentOf(c, email) ? c.questions.presidentComments : [])];
  const comments = commentQs.map((q) => {
    const said = mine.map((r) => r.comments?.[q.id]).filter(Boolean);
    return { id: q.id, text: q.text, n: said.length, items: said.length >= FLOOR ? shuffle(said) : [] };
  });
  return { name: d.name, key: k, firstYear: !!d.firstYear, president: isPresidentOf(c, email), raters: mine.length, rows, comments,
    self: self?.sentAt ? { answers: self.answers, sentAt: self.sentAt } : null, facts: await factsOf(c, email, events),
    released: c.released?.[k] ?? null, commitments: c.commitments?.[k] ?? [] };
}

/** The board-wide results: averages per question, the board-as-a-whole answers, how many finished. No individual scores. */
export async function resultsOf(c) {
  const all = await allRates(c);
  const flat = Object.values(all).flat();
  const qs = [...c.questions.director, ...c.questions.president];
  const rows = qs.map((q) => { const v = flat.map((r) => r.ratings?.[q.id]).filter((x) => typeof x === "number"); return { id: q.id, title: q.title, n: v.length, avg: v.length >= FLOOR ? avg(v) : null }; });
  const bkeys = await listMetaKeys(`review:board:${c.id}:`);
  const B = (await Promise.all(bkeys.map((k) => getMeta(k)))).filter(Boolean);
  const boardRows = c.questions.board.map((q) => { const v = B.map((r) => r.ratings?.[q.id]).filter((x) => typeof x === "number"); return { id: q.id, title: q.title, n: v.length, avg: v.length >= FLOOR ? avg(v) : null }; });
  const said = B.map((r) => r.comment).filter(Boolean);
  const progress = await progressOf(c);
  const owed = progress.reduce((n, p) => n + p.peersOwed, 0), sent = progress.reduce((n, p) => n + p.peersSent, 0);
  return { rows, board: boardRows, boardComments: said.length >= FLOOR ? shuffle(said) : [], boardAnswered: B.length,
    completion: { selves: progress.filter((p) => p.self).length, directors: progress.length, reviews: sent, reviewsOwed: owed } };
}

/** Who has done what: names and counts, never answers. For the committee and the president. */
export async function progressOf(c) {
  return Promise.all(c.directors.map(async (d) => {
    const [self, done] = await Promise.all([getSelf(c, d.email), getDone(c, d.email)]);
    const owed = peersOf(c, d.email).length;
    return { key: keyOf(d.email), name: d.name, firstYear: !!d.firstYear, president: isPresidentOf(c, d.email), committee: isCommittee(c, d.email),
      self: !!self?.sentAt, peersSent: done.peers.length, peersOwed: owed, board: !!done.board,
      finished: !!self?.sentAt && done.peers.length >= owed && !!done.board };
  }));
}

/** Everything a cycle has stored, for deleting it. */
export async function deleteCycleAll(c) {
  const keys = (await Promise.all([`review:self:${c.id}:`, `review:done:${c.id}:`, `review:rate:${c.id}:`, `review:board:${c.id}:`].map((p) => listMetaKeys(p)))).flat();
  for (const k of keys) await deleteMeta(k);
  await deleteMeta(`review:cycle:${c.id}`);
  return keys.length;
}

/* ---------- a sample cycle, made-up names, for seeing every screen ---------- */
const SAMPLE = [["Alex Morgan", true], ["Dana Cole"], ["Jordan Reyes"], ["Sam Okafor"], ["Lee Park"], ["Riley Tremblay"], ["Casey Lee"], ["Morgan Blake"], ["Taylor Singh"], ["Robin Ashe", false, true]];
const SAMPLE_NOTES = ["Brings new sponsors to every conversation.", "Always willing to help at the door.", "Could share updates from their area between meetings.",
  "Asks the question nobody else will.", "Follows up quickly after every meeting.", "Would love to see them at more events.", "Calm and fair when we disagree.", "Knows the agencies well."];
const SAMPLE_STRENGTHS = ["Clear about where ONGIA is going.", "Knows every partner agency by name.", "Calm when things go wrong at an event.", "Gets things done between meetings.", "Speaks well for ONGIA in public.", "Brings new people onto the board.", "Keeps meetings on time."];
const SAMPLE_IMPROVE = ["Share decisions with the board earlier.", "Delegate more of the event work.", "Send the papers a week ahead.", "Ask quieter directors for their view.", "Explain the budget in plainer terms.", "Give directors a clear job each.", "Check in between meetings."];
/** A finished cycle of made-up directors with made-up answers: only the testers see it; deleting it removes everything. */
export async function makeSample(by, testers) {
  const today = todayIso();
  const minus = (n) => new Date(Date.parse(`${today}T12:00:00Z`) - n * 86400e3).toISOString().slice(0, 10);
  const directors = SAMPLE.map(([name, , first]) => ({ email: `${name.toLowerCase().replace(/ /g, ".")}@example.invalid`, name, firstYear: !!first }));
  const c = { id: `sample-${rand().slice(0, 6).toLowerCase()}`, year: Number(today.slice(0, 4)) + 1, test: true, sample: true, createdAt: new Date().toISOString(), createdBy: by,
    selfOpens: minus(30), peerOpens: minus(23), closes: minus(2), committee: testers, president: directors[0].email, directors,
    questions: JSON.parse(JSON.stringify(QUESTIONS)), facts: Object.fromEntries(directors.map((d, i) => [keyOf(d.email), { meetings: `${8 - (i % 3)} of 8` }])),
    released: {}, commitments: {}, mail: {} };
  await putCycle(c);
  let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (const d of directors) {
    const base = 2.6 + rnd() * 2;
    const qs = questionsFor(c, d);
    await putMeta(selfKey(c, d.email), { answers: { delivered: "Led one of our trainings; brought in a new partner agency; helped at the Summit door.", portfolio: "Moved forward slowly.", short: "Missed two meetings in the spring.", commit: "Attend every meeting; take on one event.", support: "Earlier notice of event needs.", next: "Help plan the next symposium." },
      ratings: Object.fromEntries(qs.map((q) => [q.id, Math.min(5, Math.max(1, Math.round(base + 0.6 + rnd())))])), savedAt: c.selfOpens, sentAt: c.selfOpens });
    await putMeta(doneKey(c, d.email), { peers: peersOf(c, d.email).map((p) => keyOf(p.email)), board: true });
  }
  for (const d of directors.filter((x) => !x.firstYear)) {
    const reviewers = directors.filter((x) => x.email !== d.email && !x.firstYear);
    const base = 2.4 + rnd() * 2.2;
    for (const [i] of reviewers.entries()) {
      const ratings = Object.fromEntries(questionsFor(c, d).map((q) => [q.id, rnd() < 0.12 ? "na" : Math.min(5, Math.max(1, Math.round(base + (rnd() - 0.5) * 2)))]));
      const comments = rnd() < 0.7 ? { note: SAMPLE_NOTES[(i + d.name.length) % SAMPLE_NOTES.length] } : {};
      if (isPresidentOf(c, d.email) && rnd() < 0.8) Object.assign(comments, { strength: SAMPLE_STRENGTHS[i % SAMPLE_STRENGTHS.length], improve: SAMPLE_IMPROVE[i % SAMPLE_IMPROVE.length] });
      await putMeta(`review:rate:${c.id}:${keyOf(d.email)}:${rand()}`, { ratings, comments });
    }
  }
  for (let i = 0; i < directors.length; i++) await putMeta(`review:board:${c.id}:${rand()}`, { ratings: { decisions: 3 + (i % 3), chance: 2 + (i % 4) }, comment: ["Send papers a week ahead.", "More time on strategy, less on updates.", "", "Pair new directors with a mentor."][i % 4] });
  return c;
}
