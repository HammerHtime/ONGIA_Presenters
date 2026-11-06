import { layout } from "./mail.mjs";
import { siteUrl } from "./site.mjs";
import { formatDate } from "./deadlines.mjs";
import { dollars, andList } from "./expenses.mjs";

/**
 * The emails ONGIA Expenses sends: to the people who approve a claim, to the person claiming when it is sent back,
 * approved or paid, to the VP when one is ready to pay, and to a stand-in when an officer hands off their approvals.
 * Short (Andrew, 3 Nov 2026: "I don't think it needs to be so wordy"): the officers' subject is just "Expense claim for
 * {name}", the approval email lists the items one to a line, and each has one button straight to the claim in the app.
 * A test claim's subject starts [TEST].
 */
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const claimLink = (id) => `${siteUrl()}/expenses${id ? `#claim=${encodeURIComponent(id)}` : ""}`;
const FOOTER = "ONGIA Expenses";
const tag = (c) => (c?.test ? "[TEST] " : c?.trial ? "[BOARD TEST] " : "");
const strip = (l) => String(l).replace(/<\/tr>/g, "\n").replace(/<\/td><td[^>]*>/g, "   ").replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&bull;/g, "•").replace(/&hellip;/g, "…").replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/ +\n/g, "\n").replace(/\s+$/, "");
function mail(claim, subject, heading, lines, button) {
  const html = layout({ heading, lines, button, footer: FOOTER });
  const text = [heading, "", ...lines.filter(Boolean).map((l) => `${strip(l)}\n`), button ? `${button.label}: ${button.href}` : "", "", "--", FOOTER].join("\n");
  return { subject: `${tag(claim)}${subject}`, html, text };
}
const ownerOf = (c) => c?.owner?.name ?? "A board member";
const what = (c) => {
  const s = c.sums ?? {};
  const bits = [s.receipts ? `${s.receipts} receipt${s.receipts === 1 ? "" : "s"}` : "", s.mileage ? `${s.mileage} mileage` : "", s.noreceipt ? `${s.noreceipt} with no receipt` : ""].filter(Boolean);
  return `${dollars(c.total ?? s.total ?? 0)} for ${esc(c.month)}${bits.length ? ` (${bits.join(", ")})` : ""}`;
};
const quote = (t) => `<span style="display:block;border-left:3px solid #b8922a;padding:4px 0 4px 12px;color:#2c3448;white-space:pre-wrap">${esc(t)}</span>`;
// A test claim is practice: every step comes back to the person who made it (Andrew, 3 Nov 2026), and nothing is paid.
// A board-test claim (Andrew 3 Nov 2026) goes to the real people, so it says, every time, that nothing is paid.
const testNote = (c) => (c?.test ? `<b>Test claim.</b> Every step comes back to you, and nothing is paid.`
  : c?.trial ? `<b>Board test.</b> This claim is part of testing the app, so no money is sent.` : "");
const count = (n, one, many) => (n === 1 ? `One ${one}` : n < 10 ? `${["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"][n]} ${many}` : `${n} ${many}`);

// One line per item, its amount on the right, the total under them: a quick look, not the claim itself. A long name is
// cut so each item stays on one line on a phone.
const ITEMS_SHOWN = 15;
const itemName = (l) => l.kind === "mileage" ? `Mileage${l.from || l.to ? `: ${l.from || "?"} to ${l.to || "?"}` : ""}` : l.paidTo || (l.kind === "noreceipt" ? "No receipt" : "Receipt");
const cut = (s, n = 30) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const CELL = "padding:7px 0;border-bottom:1px solid #e6e1d5;vertical-align:middle";
// Beside each amount, its receipt check (Andrew, 3 Nov 2026: "a green check mark to the right of the amount indicating
// that the receipt amount and claim amount are same. And a red x if something is off"). A card statement can't confirm
// an amount, so it gets an amber "?", as the app flags it, not a red x. Mileage and a stipend have no receipt: no mark.
// Each is a small filled circle, white on green, red or amber, big enough to read at a glance on a phone; U+FE0E keeps
// a phone from drawing ✓ and ✗ as emoji.
// The key's words are Andrew's: "amount verified against receipt" (3 Nov 2026).
const MARKS = { ok: ["\u2713\uFE0E", "#2f6b4f", "Claude verified the amount against the receipt"], bad: ["\u2717\uFE0E", "#a33328", "doesn't match the receipt"], open: ["?", "#8a5d0c", "couldn't be verified"] };
export const markOf = (l) => {
  const st = l.check?.state;
  if (!st || st === "mileage" || st === "stipend") return "";
  if (st === "match") return l.check.currency ? "open" : "ok";
  return st === "differs" || st === "notreceipt" ? "bad" : "open";
};
const badge = (m) => `<span style="display:inline-block;width:18px;height:18px;line-height:18px;border-radius:9px;background:${MARKS[m][1]};color:#ffffff;font-size:12px;font-weight:700;text-align:center;vertical-align:middle">${MARKS[m][0]}</span>`;
const markCell = (m) => `<td style="${CELL};width:26px;text-align:right;white-space:nowrap">${m ? badge(m) : ""}</td>`;
function itemsTable(lines, total) {
  const sorted = [...lines].sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
  const rows = sorted.slice(0, ITEMS_SHOWN).map((l) =>
    `<tr><td style="${CELL};padding-right:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(cut(itemName(l)))}</td><td style="${CELL};width:90px;text-align:right;white-space:nowrap">${l.amount === null || l.amount === undefined ? "" : dollars(l.amount)}</td>${markCell(markOf(l))}</tr>`);
  if (sorted.length > ITEMS_SHOWN) rows.push(`<tr><td style="${CELL};color:#767f92" colspan="3">and ${sorted.length - ITEMS_SHOWN} more</td></tr>`);
  rows.push(`<tr><td style="padding:9px 12px 0 0;font-weight:700">Total</td><td style="padding:9px 0 0;width:90px;text-align:right;white-space:nowrap;font-weight:700">${dollars(total)}</td><td style="width:26px"></td></tr>`);
  const table = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:15px;line-height:1.35;margin:0 0 16px">${rows.join("")}</table>`;
  // What the marks mean, only those that show.
  const used = Object.keys(MARKS).filter((m) => sorted.slice(0, ITEMS_SHOWN).some((l) => markOf(l) === m));
  // One to a line: "Claude verified the amount against the receipt" is wider than the narrowest phone, so it may wrap,
  // its circle kept with its first word.
  const key = used.map((m) => `${badge(m)}&nbsp;${MARKS[m][2].replace(" ", "&nbsp;")}`).join("<br>");
  return [table, key ? `<span style="font-size:13px;color:#767f92">${key}</span>` : ""];
}

/**
 * To each person who needs to approve it (Andrew, 3 Nov 2026): who sent it, the items and amounts, who it waits on,
 * and Review. `waitingOn`: each sign-off it waits for, as "President Andrew Hammond". `acting`: the officer's title when
 * the reader stands in, with `until`. `practice`: a test claim, where both sign-offs are the reader's.
 */
export function needsApprovalMail({ claim, lines = [], checks, waitingOn = [], acting = "", until = "", practice = false }) {
  const owner = ownerOf(claim);
  const flagged = checks?.notes?.length ?? 0;
  const out = [
    testNote(claim),
    `${esc(owner)} has submitted an expense claim for the following:`,
    ...itemsTable(lines, claim.total ?? claim.sums?.total ?? 0),
    flagged ? `${count(flagged, "thing is", "things are")} flagged to check. ${flagged === 1 ? "It's" : "They're"} listed on the claim.` : "",
    waitingOn.length ? `Waiting on approval from ${esc(andList(waitingOn))}${practice ? ` (${waitingOn.length > 1 ? "both you" : "you"}, for practice)` : ""}.` : "",
    acting ? `You're standing in for the ${esc(acting)}${until ? ` until ${esc(formatDate(until))}` : ""}.` : "",
  ];
  return mail(claim, `Expense claim for ${owner}`, "New expense claim", out, { label: "Review", href: claimLink(claim.id) });
}

/** To the person claiming, when it is sent back. */
export function sentBackMail({ claim, by, comment }) {
  const lines = [
    testNote(claim),
    `${esc(by)} sent back your expense claim, ${what(claim)}, with this note:`,
    quote(comment),
    "Change what's needed and send it again. Nothing on it is lost.",
  ];
  return mail(claim, `Your ${claim.month} expense claim was sent back`, "Your expense claim was sent back", lines, { label: "Open my claim", href: claimLink(claim.id) });
}

/** To the person claiming, once both have approved. `approvedBy`: "the President", or "Raj Jaswal for the Treasurer". */
export function approvedMail({ claim, approvedBy = [], payer, practice = false }) {
  const lines = [
    testNote(claim),
    `Your expense claim for ${esc(claim.month)}, <b>${dollars(claim.total ?? 0)}</b>, has been approved by ${esc(andList(approvedBy))}.`,
    practice ? "Next, record a pretend payment on it, as the VP would." : `${esc(payer)} will send the e-transfer.`,
  ];
  return mail(claim, `Your ${claim.month} expense claim is approved`, "Your expense claim is approved", lines, { label: "See the claim", href: claimLink(claim.id) });
}

/**
 * To the VP (or her stand-in) when a claim is ready to pay (Andrew, 3 Nov 2026: "approved by President and Treasurer,
 * ready to be paid out"). The button opens the claim with the cursor in the transaction number.
 */
export function toPayMail({ claim, approvedBy = [], acting = "", practice = false }) {
  const owner = ownerOf(claim);
  const lines = [
    testNote(claim),
    `The expense claim for ${esc(owner)} has been approved by ${esc(andList(approvedBy))} and is ready to be paid.`,
    `<b>${dollars(claim.total ?? 0)}</b> by e-transfer to ${esc(claim.owner?.email || owner)}`,
    practice ? "Practice: nothing is sent. Type any transaction number, like TEST123." : claim?.trial ? "Don't send any money: type any transaction number, like TEST123, and it locks as a paid claim does." : "",
    acting ? `You're standing in for the ${esc(acting)}, who records the payments.` : "",
  ];
  return mail(claim, `Expense claim for ${owner}`, "Ready to be paid", lines, { label: "Record the payment", href: claimLink(claim.id) });
}

/** To the person claiming, once it is paid. */
export function paidMail({ claim, payer, paid }) {
  const lines = [
    testNote(claim),
    `${esc(payer)} paid your ${esc(claim.month)} expense claim, <b>${dollars(claim.total ?? 0)}</b>, by e-transfer on ${esc(formatDate(paid.date))}.`,
    `Transaction number: <b>${esc(paid.ref)}</b>`,
  ];
  return mail(claim, `Paid: your ${claim.month} expense claim`, "Your expense claim is paid", lines, { label: "See the claim", href: claimLink(claim.id) });
}

/** To the VP and the President when a paid claim is unlocked. */
export function unlockedMail({ claim, by, reason }) {
  const owner = ownerOf(claim);
  const lines = [
    testNote(claim),
    `${esc(by)} unlocked the expense claim for ${esc(owner)} (${dollars(claim.total ?? 0)}, ${esc(claim.month)}), which had been marked paid. The reason:`,
    quote(reason),
    "It's back to approved, waiting for the payment to be recorded again.",
  ];
  return mail(claim, `Expense claim for ${owner}`, "A paid claim was unlocked", lines, { label: "Open the claim", href: claimLink(claim.id) });
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
