import { layout } from "./mail.mjs";
import { siteUrl } from "./site.mjs";
import { formatDate } from "./deadlines.mjs";
import { dollars } from "./expenses.mjs";

/**
 * The emails ONGIA Expenses sends: to the people who approve a claim, to the person claiming when it is sent back,
 * approved or paid, to the VP when one is ready to pay, and to a stand-in when an officer hands off their approvals.
 * Each says what happened in a line or two and has one button straight to the claim in the app. A test claim's
 * subject starts [TEST].
 */
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const claimLink = (id) => `${siteUrl()}/expenses${id ? `#claim=${encodeURIComponent(id)}` : ""}`;
const FOOTER = "ONGIA Expenses: the board's expense claims. Open it from its icon on your phone, or at events.ongia.org/expenses.";
const tag = (c) => (c?.test ? "[TEST] " : "");
const strip = (l) => String(l).replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&bull;/g, "•").replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
function mail(claim, subject, heading, lines, button) {
  const html = layout({ heading, lines, button, footer: FOOTER });
  const text = [heading, "", ...lines.filter(Boolean).map(strip), button ? `\n${button.label}: ${button.href}` : "", "", "--", FOOTER].join("\n");
  return { subject: `${tag(claim)}${subject}`, html, text };
}
const what = (c) => {
  const s = c.sums ?? {};
  const bits = [s.receipts ? `${s.receipts} receipt${s.receipts === 1 ? "" : "s"}` : "", s.mileage ? `${s.mileage} mileage` : "", s.noreceipt ? `${s.noreceipt} with no receipt` : ""].filter(Boolean);
  return `${dollars(c.total ?? s.total ?? 0)} for ${esc(c.month)}${bits.length ? ` (${bits.join(", ")})` : ""}`;
};
const quote = (t) => `<span style="display:block;border-left:3px solid #b8922a;padding:4px 0 4px 12px;color:#2c3448;white-space:pre-wrap">${esc(t)}</span>`;
// A test claim is practice: every step comes back to the person who made it (Andrew, 3 Nov 2026). It is filed only under
// "Test claims (safe to delete)", and nothing is paid.
const testNote = (c) => (c?.test ? `<b>This is a test claim.</b> Every step comes back to you to try. Nothing is paid, it's filed only under Test claims (safe to delete), and it can be deleted with the other test claims.` : "");
const count = (n, one, many) => (n === 1 ? `One ${one}` : n < 10 ? `${["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"][n]} ${many}` : `${n} ${many}`);

/** To each person who needs to approve it. `acting`: the officer's title when they stand in, with `until`. */
export function needsApprovalMail({ claim, checks, acting = "", until = "", others = "", practice = "" }) {
  const owner = claim.owner?.name ?? "A board member";
  const lines = [
    testNote(claim),
    `<b>${what(claim)}</b>.`,
    acting ? `You're standing in for the ${esc(acting)}${until ? ` until ${esc(formatDate(until))}` : ""}.` : "",
    checks?.ok ? "Claude checked it: every receipt matches what's claimed, and nothing is claimed twice."
      : checks?.notes?.length ? `Claude checked it. ${count(checks.notes.length, "thing", "things")} to look at:<br>${checks.notes.map((n) => `&bull; ${esc(n)}`).join("<br>")}` : "",
    practice ? `Practice: you're approving it as the ${esc(practice)}.` : others ? `It needs your approval and ${esc(others)}'s.` : "It needs your approval.",
  ];
  return mail(claim, `Expense claim to approve: ${owner}, ${dollars(claim.total ?? 0)}`, `${owner} sent an expense claim`, lines, { label: "Open the claim", href: claimLink(claim.id) });
}

/** To the person claiming, when it is sent back. */
export function sentBackMail({ claim, by, comment }) {
  const lines = [
    testNote(claim),
    `${esc(by)} sent back your expense claim, ${what(claim)}, with this note:`,
    quote(comment),
    "Change what's needed in ONGIA Expenses and send it again. Nothing on it is lost.",
  ];
  return mail(claim, `Your ${claim.month} expense claim was sent back`, "Your expense claim was sent back", lines, { label: "Open my claim", href: claimLink(claim.id) });
}

/** To the person claiming, once both have approved. */
export function approvedMail({ claim, approvers, payer, practice = false }) {
  const lines = practice ? [
    testNote(claim),
    `You approved it as ${esc(approvers.join(" and "))}: ${what(claim)}.`,
    "Next, as the VP would, record a pretend e-transfer on the claim and see it lock.",
  ] : [
    testNote(claim),
    `${esc(approvers.join(" and "))} approved your expense claim: ${what(claim)}.`,
    `${esc(payer)} will send the e-transfer, and you'll get an email when it's paid.`,
  ];
  return mail(claim, `Your ${claim.month} expense claim is approved`, "Your expense claim is approved", lines, { label: "See the claim", href: claimLink(claim.id) });
}

/** To the VP (or her stand-in) when a claim is ready to pay. */
export function toPayMail({ claim, approvers, acting = "", practice = false }) {
  const owner = claim.owner?.name ?? "A board member";
  const lines = [
    testNote(claim),
    practice ? `You approved it as ${esc(approvers.join(" and "))}: ${what(claim)}.` : `${esc(approvers.join(" and "))} approved ${esc(owner)}'s expense claim: ${what(claim)}.`,
    acting ? `You're standing in for the ${esc(acting)}, who records the payments.` : "",
    practice ? "Practice: nothing is sent. Type a pretend reference on the claim (any letters and numbers, like TEST123) and it locks, as a paid claim does."
      : `Send the e-transfer to ${esc(owner)}${claim.owner?.email ? ` (${esc(claim.owner.email)})` : ""}, then add its reference number to the claim. That locks it.`,
  ];
  return mail(claim, `Expense claim to pay: ${owner}, ${dollars(claim.total ?? 0)}`, `Ready to pay: ${owner}`, lines, { label: "Record the payment", href: claimLink(claim.id) });
}

/** To the person claiming, once it is paid. */
export function paidMail({ claim, payer, paid }) {
  const lines = [
    testNote(claim),
    `${esc(payer)} paid your ${esc(claim.month)} expense claim by e-transfer on ${esc(formatDate(paid.date))}: <b>${dollars(claim.total ?? 0)}</b>.`,
    `The e-transfer reference is <b>${esc(paid.ref)}</b>.`,
  ];
  return mail(claim, `Paid: your ${claim.month} expense claim`, "Your expense claim is paid", lines, { label: "See the claim", href: claimLink(claim.id) });
}

/** To the VP and the President when a paid claim is unlocked. */
export function unlockedMail({ claim, by, reason }) {
  const owner = claim.owner?.name ?? "A board member";
  const lines = [
    testNote(claim),
    `${esc(by)} unlocked ${esc(owner)}'s expense claim, ${what(claim)}, which had been marked paid. The reason given:`,
    quote(reason),
    "It's approved again, waiting for the payment to be recorded.",
  ];
  return mail(claim, `Unlocked: ${owner}'s ${claim.month} expense claim`, `${owner}'s claim was unlocked`, lines, { label: "Open the claim", href: claimLink(claim.id) });
}

/** To the stand-in, and the second person, when an officer hands off their approvals. */
export function handoffMail({ from, title, d, isBackup = false, standIn = "", waiting = 0, pays = false }) {
  const when = `from ${formatDate(d.from)} to ${formatDate(d.until)}`;
  const lines = isBackup
    ? [`${esc(from)} is away ${esc(when)} and has handed the ${esc(title)}'s expense approvals to ${esc(standIn)}.`,
       `When ${esc(standIn)} can't take one (their own claim, or one they already approve), it comes to you instead. You'll get an email for each one.`]
    : [`${esc(from)} is away ${esc(when)} and has handed you the ${esc(title)}'s expense approvals${pays ? ", and recording the e-transfers" : ""}.`,
       waiting ? `${waiting === 1 ? "One claim is" : `${count(waiting, "claim", "claims")} are`} waiting for you now. You'll get an email for each new one.` : "You'll get an email for each claim that comes to you.",
       "Your approvals are recorded as you, standing in for the " + esc(title) + "."];
  // The second person isn't the stand-in, and their subject says so.
  const subject = isBackup ? `If ${standIn} can't take one: the ${title}'s approvals, ${formatDate(d.from)} to ${formatDate(d.until)}` : `You're standing in for the ${title}, ${formatDate(d.from)} to ${formatDate(d.until)}`;
  return mail(null, subject, isBackup ? `Second in line for the ${title}` : `Standing in for the ${title}`, lines, { label: "Open ONGIA Expenses", href: claimLink("") });
}
