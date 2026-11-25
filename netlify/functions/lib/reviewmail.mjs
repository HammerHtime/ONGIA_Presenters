import { esc } from "./text.mjs";
import { layout, sendMail } from "./mail.mjs";
import { siteUrl } from "./site.mjs";
import { formatDate, todayIso } from "./deadlines.mjs";
import { putMeta, getMeta } from "./store.mjs";
import { listCycles, phaseOf, peersOf, getSelf, getDone, keyOf, isCommittee } from "./review.mjs";

/**
 * The board review's emails (lib/review.mjs): one when a cycle opens (the self-review), one when the peer round opens,
 * and a reminder every three days to anyone not finished, which stops once they are. Each has one button to /board.
 * A test cycle's subject starts [TEST]. A sample cycle (made-up names) never emails. Failures are logged by the morning run.
 */
const REMIND_EVERY = 3;
const first = (name) => String(name ?? "").trim().split(/\s+/)[0] || "";
const day = (iso) => formatDate(iso);
const dayBefore = (iso) => new Date(Date.parse(`${iso}T12:00:00Z`) - 86400e3).toISOString().slice(0, 10);
const tag = (c) => (c.test ? "[TEST] " : "");
const committeeNames = (c) => c.committeeNames ?? c.directors.filter((d) => isCommittee(c, d.email)).map((d) => d.name);
const FOOTER = (c) => `ONGIA board review ${c.year} · review committee: ${committeeNames(c).join(" and ") || "to be named"}`;
const replyTo = (c) => c.committee?.[0] || undefined;
const strip = (l) => String(l).replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
// Exact, not overstated: who has reviewed whom is kept (for the progress counts); what each person said never carries their name.
const ANON = "Your ratings are saved without your name. Nobody, the committee included, can tell which ones are yours.";

function message(c, d, subject, heading, lines, label) {
  const button = { label, href: `${siteUrl()}/board` };
  const all = [`Hello ${esc(first(d.name))},`, ...lines].filter(Boolean);
  return { to: d.email, replyTo: replyTo(c), subject: `${tag(c)}${subject}`, html: layout({ heading, lines: all, button, footer: FOOTER(c) }),
    text: [heading, "", ...all.map((l) => `${strip(l)}\n`), `${label}: ${button.href}`, "", "--", FOOTER(c)].join("\n") };
}

/** When a cycle opens: the self-review. */
export function openMessage(c, d) {
  const peers = peersOf(c, d.email).length;
  return message(c, d, `Board review ${c.year}: your self-review`, "Your self-review is open", [
    "This year's board review has started. Every director, the president included, gets honest feedback from colleagues and sets a few commitments for the year ahead. The aim is to help each of us do better.",
    `Start with your self-review: what you delivered, where you fell short, and what you'll commit to. It takes about 15 minutes. Please send it by <b>${esc(day(dayBefore(c.peerOpens)))}</b>.`,
    peers ? `On ${esc(day(c.peerOpens))} you'll get a second email asking you to review your ${peers} colleague${peers === 1 ? "" : "s"}. That's ${c.questions?.director?.length ?? 7} quick ratings each, about 2 minutes a person.`
      : "This is your first year on the board, so this time you won't rate colleagues and they won't rate you. You'll still answer three questions about the board as a whole.",
    peers ? ANON : "",
  ], "Start my self-review");
}

/** When the peer round opens. */
export function peerMessage(c, d) {
  const peers = peersOf(c, d.email).length;
  return message(c, d, `Board review ${c.year}: review your colleagues`, "Time to review your colleagues", [
    peers ? `The self-review week is over. You can now review your ${peers} colleague${peers === 1 ? "" : "s"} and answer three questions about the board as a whole.`
      : "The self-review week is over. You can now answer three questions about the board as a whole.",
    peers ? `Each colleague takes about 2 minutes: ${c.questions?.director?.length ?? 7} quick ratings and an optional comment. Where you haven't had enough contact with someone to judge, choose —. You can stop and pick up later on the same phone or computer.` : "",
    `Please finish by <b>${esc(day(c.closes))}</b>.`,
    peers ? ANON : "",
  ], peers ? "Review my colleagues" : "Answer the three questions");
}

/** What a director still has to do, in a few words, or null when finished. */
export async function stillToDo(c, d, today = todayIso()) {
  const phase = phaseOf(c, today);
  if (phase === "scheduled" || phase === "closed") return null;
  const [self, done] = await Promise.all([getSelf(c, d.email), getDone(c, d.email)]);
  const left = [];
  if (!self?.sentAt) left.push("your self-review");
  if (phase === "peer") {
    const peers = peersOf(c, d.email);
    const owed = peers.filter((p) => !done.peers.includes(keyOf(p.email))).length;
    if (owed) left.push(`${owed} of ${peers.length} colleague${peers.length === 1 ? "" : "s"}`);
    if (!done.board) left.push("the three questions about the board");
  }
  return left.length ? left : null;
}

export async function reminderMessage(c, d, left, today = todayIso()) {
  const closes = phaseOf(c, today) === "self" ? dayBefore(c.peerOpens) : c.closes;
  const list = left.length > 1 ? `${left.slice(0, -1).join(", ")} and ${left.at(-1)}` : left[0];
  return message(c, d, `Reminder: board review, by ${day(closes)}`, "A few minutes left to do", [
    `Still to do: ${esc(list)}.`,
    `Please finish by <b>${esc(day(closes))}</b>. Thank you.`,
  ], "Finish my review");
}

async function send(msg) {
  const r = await sendMail(msg).catch((e) => ({ skipped: true, reason: e.message }));
  return r?.skipped ? { to: msg.to, failed: r.reason } : { to: msg.to, sent: true };
}
const real = (c) => !c.sample;

/** Every director, the opening email. */
export async function openMail(c) {
  if (!real(c)) return { skipped: "a sample" };
  const out = [];
  for (const d of c.directors) out.push(await send(openMessage(c, d)));
  await putMeta(`review:mail:${c.id}`, { ...((await getMeta(`review:mail:${c.id}`)) ?? {}), opened: new Date().toISOString() });
  return { sent: out.filter((x) => x.sent).length, failed: out.filter((x) => x.failed) };
}

/** A reminder to one director now (the committee's Remind). */
export async function remindOne(c, d) {
  if (!real(c)) return { error: "A sample doesn't send email." };
  const left = await stillToDo(c, d);
  if (!left) return { error: `${d.name} has nothing left to do.` };
  const r = await send(await reminderMessage(c, d, left));
  if (r.failed) return { error: r.failed };
  const m = (await getMeta(`review:mail:${c.id}`)) ?? {};
  await putMeta(`review:mail:${c.id}`, { ...m, reminded: { ...(m.reminded ?? {}), [keyOf(d.email)]: todayIso() } });
  return { sent: true };
}

/**
 * The morning run: the peer round's email on its first day, and a reminder every three days to anyone not finished.
 * Nobody is sent the same email twice in a day; a finished director gets nothing more.
 */
export async function runReviewMail(today = todayIso()) {
  const out = [];
  for (const c of (await listCycles()).filter(real)) {
    const phase = phaseOf(c, today);
    if (phase === "scheduled" || phase === "closed") continue;
    const m = (await getMeta(`review:mail:${c.id}`)) ?? {};
    m.reminded ??= {};
    if (phase === "peer" && !m.peer) {
      for (const d of c.directors) out.push({ cycle: c.id, kind: "peer", ...(await send(peerMessage(c, d))) });
      m.peer = today;
      for (const d of c.directors) m.reminded[keyOf(d.email)] = today;
    } else {
      const since = (iso) => Math.round((Date.parse(today) - Date.parse(iso)) / 86400e3);
      for (const d of c.directors) {
        const last = m.reminded[keyOf(d.email)] || (phase === "self" ? c.selfOpens : m.peer || c.peerOpens);
        if (since(last) < REMIND_EVERY) continue;
        const left = await stillToDo(c, d, today);
        if (!left) continue;
        out.push({ cycle: c.id, kind: "reminder", ...(await send(await reminderMessage(c, d, left, today))) });
        m.reminded[keyOf(d.email)] = today;
      }
    }
    await putMeta(`review:mail:${c.id}`, m);
  }
  return out;
}
