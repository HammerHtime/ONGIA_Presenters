import { json, fail, requireAdmin, adminWho } from "./lib/http.mjs";
import { mayCost } from "./lib/auth.mjs";
import { putMeta } from "./lib/store.mjs";
import { primeRoster } from "./lib/signature.mjs";
import { renderLetter, letterProblems } from "./lib/letters.mjs";
import { sendMail } from "./lib/mail.mjs";
import { letterWordsProblems, letterFileName, BOARD_LETTER } from "./lib/appreciation.mjs";
import { disposition } from "./lib/filenames.mjs";
import { officers } from "./lib/expenses.mjs";
import { signatureImage } from "./lib/thanks.mjs";
import { testAddresses } from "./lib/welcome.mjs";
import { KEY, BOARD_STANDARD, boardState, boardWords, boardLetterWords, boardLetter, boardPeople, boardLetterPdf, sendBoardRound, signedEvent } from "./lib/boardthanks.mjs";

/**
 * The board's thank-you, from the Admin page (Andrew 16 Nov 2026). The President and the VP only.
 *
 *   GET  /api/boardthanks                       the words, the letter, each board member and where theirs stands
 *   GET  /api/boardthanks?letter=<email>|sample one member's letter, as a PDF
 *   PUT  /api/boardthanks                       { subject, body, standard, letter, letterStandard } or { email, pick: yes|no|"" }
 *   POST /api/boardthanks?preview=1|test=1      the email as it would go / a test to { to }, marked TEST, letter attached
 *   POST /api/boardthanks?send=1[&email=…]      send now to everyone still owed this year's (or one); says how many are left
 */
export default async (req) => {
  await primeRoster();
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const who = adminWho(req);
  if (!mayCost(who)) return fail("Only the President and the VP of operations can thank the board.", 403);
  const url = new URL(req.url);
  let st = await boardState();
  const view = async () => {
    const people = await boardPeople(st);
    return json({ ...boardWords(st), standard: !st.body, letter: boardLetterWords(st), letterStandard: !st.letter, signature: !!(await signatureImage()),
      from: officers().president, people, year: people[0]?.year ?? "", problems: [...letterProblems(boardLetter(boardWords(st))), ...letterWordsProblems(boardLetterWords(st))] });
  };
  if (req.method === "GET" && url.searchParams.get("letter")) {
    const people = await boardPeople(st);
    const id = url.searchParams.get("letter");
    const v = id === "sample" ? people.find((p) => p.in) ?? people[0] : people.find((p) => p.email.toLowerCase() === id.toLowerCase());
    if (!v) return fail("No such board member.", 404);
    const words = url.searchParams.get("words");
    const pdf = await boardLetterPdf(v, words ? { ...st, letter: words } : st, { signature: await signatureImage() });
    return new Response(pdf, { headers: { "content-type": "application/pdf", "content-disposition": disposition(letterFileName(v), "inline"), "cache-control": "no-store" } });
  }
  if (req.method === "GET") return view();
  const body = await req.json().catch(() => ({}));
  if (req.method === "PUT") {
    if (body.email !== undefined) {
      const e = String(body.email).trim().toLowerCase();
      st.picks = { ...(st.picks ?? {}) };
      if (["yes", "no"].includes(body.pick)) st.picks[e] = body.pick; else delete st.picks[e];
    } else {
      if (body.standard === true) { delete st.subject; delete st.body; }
      else if (body.body !== undefined) {
        const w = { subject: String(body.subject ?? boardWords(st).subject).slice(0, 200), body: String(body.body).slice(0, 8000) };
        const wrong = letterProblems(boardLetter(w));
        if (wrong.length) return fail(wrong[0], 409);
        if (w.subject === BOARD_STANDARD.subject && w.body === BOARD_STANDARD.body) { delete st.subject; delete st.body; } else Object.assign(st, w);
      }
      if (body.letterStandard === true) delete st.letter;
      else if (body.letter !== undefined) {
        const w = String(body.letter).replace(/\r/g, "").slice(0, 8000);
        const wrong = letterWordsProblems(w);
        if (wrong.length) return fail(wrong[0], 409);
        if (w.trim() === BOARD_LETTER.trim()) delete st.letter; else st.letter = w;
      }
    }
    await putMeta(KEY, st);
    return view();
  }
  if (req.method !== "POST") return fail("Not allowed.", 405);
  const words = body.body !== undefined ? { subject: String(body.subject ?? "").slice(0, 200), body: String(body.body).slice(0, 8000) } : boardWords(st);
  const letter = boardLetter(words);
  const people = await boardPeople(st);
  const sample = people.find((p) => p.in) ?? people[0];
  if (url.searchParams.get("preview")) { const m = renderLetter(letter, signedEvent(), sample); return json({ subject: m.subject, html: m.html, problems: letterProblems(letter) }); }
  if (url.searchParams.get("test")) {
    const to = testAddresses(body.to);
    if (!to.length) return fail("Put an address to send the test to.");
    const wrong = letterProblems(letter);
    if (wrong.length) return fail(wrong[0], 409);
    // Made out to whoever the test goes to when they're on the board, so they see their own name.
    const me = people.find((p) => to.some((t) => t.toLowerCase() === p.email.toLowerCase())) ?? sample;
    const m = renderLetter(letter, signedEvent(), me);
    const pdf = await boardLetterPdf(me, body.letter !== undefined ? { ...st, letter: String(body.letter) } : st, { signature: await signatureImage() });
    const out = await sendMail({ to, replyTo: officers().president, ...m, subject: `TEST: ${m.subject}`, attachments: [{ filename: letterFileName(me), content: pdf, contentType: "application/pdf" }] }).catch((e) => ({ skipped: true, reason: e.message }));
    if (out.skipped) return fail(`The test couldn't be sent: ${out.reason}`, 502);
    return json({ sent: true, to });
  }
  if (!url.searchParams.get("send")) return fail("Send, test or preview?");
  const emails = (url.searchParams.get("emails") ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 100);
  const r = await sendBoardRound({ deadline: Date.now() + 18000, only: emails.length ? emails : url.searchParams.get("email") || null });
  if (r.blocked) return fail(r.blocked[0], 409);
  console.log(`boardthanks: sent by ${who?.email ?? "admin"}: ${r.sent} sent, ${r.failed} failed, ${r.left} left`);
  st = await boardState();
  return json({ ...r, ...(await (await view()).json()) });
};
