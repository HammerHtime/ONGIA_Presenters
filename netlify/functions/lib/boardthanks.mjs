import { getRoster, getMeta, putMeta } from "./store.mjs";
import { renderLetter, letterProblems } from "./letters.mjs";
import { appreciationPdf, letterFileName, BOARD_LETTER } from "./appreciation.mjs";
import { sendMail } from "./mail.mjs";
import { officers } from "./expenses.mjs";
import { signatureImage } from "./thanks.mjs";
import { pacer, timeLeft } from "./bulk.mjs";
import { fromMeContact } from "./message.mjs";

/**
 * The thank-you to the board, once a year, sent by the President when he chooses (Andrew 16 Nov 2026: "a separate
 * button for the board members so I can send them a thank you email, just a brief one … I've attached a thank you
 * letter that you could forward to your … boss"). Each member on the board roster gets a short email from him and a
 * letter on letterhead for their employer. He is left off his own list; anyone can be skipped or added. Who has had
 * this year's is kept, so nobody gets it twice in a year.
 */
export const KEY = "board-thanks";
export const BOARD_STANDARD = {
  subject: "Thank you for another year with ONGIA",
  body: `Hi {first},

Thank you for another successful year. The time and work you put into the board keep ONGIA moving forward, and I'm grateful for it.

I've attached a letter of appreciation you can forward to your supervisor.

Thank you again,`,
};

const yearNow = () => String(new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" }).slice(0, 4));
const low = (s) => String(s ?? "").trim().toLowerCase();

export async function boardState() { return (await getMeta(KEY)) ?? {}; }
export const boardWords = (st) => (st.body ? { subject: st.subject ?? BOARD_STANDARD.subject, body: st.body } : { ...BOARD_STANDARD });
export const boardLetterWords = (st) => st.letter || BOARD_LETTER;
/** The email as a letter the desk can draw: signed by the President, from the roster. */
export const boardLetter = (words) => ({ id: "board-thanks", kind: "thanks", name: "Board thank-you", attachAgenda: false, ...words, contact: fromMeContact() });
const signedEvent = () => ({ id: "board", title: "", signature: { member: low(officers().president) } });

/** Each board member, whether they're on this year's list, and whether theirs has gone. */
export async function boardPeople(st = null, year = yearNow()) {
  st ??= await boardState();
  const roster = (await getRoster()) ?? [];
  const sent = st.sent?.[year] ?? {};
  return roster.filter((m) => m?.email).map((m) => {
    const email = low(m.email), parts = String(m.name ?? "").trim().split(/\s+/);
    const pick = st.picks?.[email] ?? "";
    return {
      email: m.email, name: m.name ?? m.email, first: parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0] ?? "", last: parts.length > 1 ? parts.at(-1) : "",
      organization: String(m.employer ?? "").trim(), year,
      in: pick === "yes" || (pick !== "no" && email !== low(officers().president)), pick,
      sentAt: sent[email]?.at ?? null, why: sent[email]?.why ?? "",
    };
  });
}

/** One member's letter for their employer. */
export async function boardLetterPdf(v, st, { signature = null, on } = {}) {
  return appreciationPdf(null, v, { body: boardLetterWords(st), signature, on });
}

/** Send this year's to everyone on the list still owed it, or to one address. */
export async function sendBoardRound({ deadline = null, pace = pacer(), only = null } = {}) {
  const st = await boardState(), year = yearNow();
  const letter = boardLetter(boardWords(st));
  const wrong = letterProblems(letter);
  if (wrong.length) return { blocked: wrong };
  const people = await boardPeople(st, year);
  // `only` is one address or a list of them (the ones ticked on the page).
  const picked = only ? new Set([].concat(only).map(low)) : null;
  const owed = people.filter((v) => (picked ? picked.has(low(v.email)) : v.in && !v.sentAt));
  const signature = await signatureImage();
  let sent = 0, failed = 0, left = 0;
  const trouble = [];
  st.sent = { ...(st.sent ?? {}), [year]: { ...(st.sent?.[year] ?? {}) } };
  for (const v of owed) {
    if (!timeLeft(deadline)) { left = owed.length - sent - failed; break; }
    await pace();
    try {
      const pdf = await boardLetterPdf(v, st, { signature });
      const out = await sendMail({ to: v.email, replyTo: officers().president, ...renderLetter(letter, signedEvent(), v), attachments: [{ filename: letterFileName(v), content: pdf, contentType: "application/pdf" }] });
      if (out.skipped) throw new Error(out.reason);
      st.sent[year][low(v.email)] = { at: new Date().toISOString() };
      sent++;
    } catch (e) {
      st.sent[year][low(v.email)] = { why: String(e.message).slice(0, 200), failedAt: new Date().toISOString() };
      trouble.push({ email: v.email, why: e.message }); failed++;
    }
    await putMeta(KEY, st);
  }
  return { sent, failed, left, trouble: trouble.slice(0, 10) };
}

export { signedEvent };
