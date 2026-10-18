import { text, isEmail } from "./http.mjs";
import { token, reference, safeFileName } from "./ids.mjs";
import { putVolunteer, putPdf } from "./store.mjs";
import { buildVolunteerPdf } from "./pdf.mjs";
import { fileVolunteerAgreement } from "./graph.mjs";
import { sendMail, volunteerContact, volunteerInvitationMail, volunteerSignedMail, volunteerNoticeMail, volunteerReceivedMail, volunteerReviewNeededMail } from "./mail.mjs";

/**
 * Volunteers: people ONGIA asks to sign the Volunteer Terms before an event.
 * A volunteer is not a presenter. They have no cost review, no materials and no
 * board approval, so signing is the whole flow:
 *
 *   added by the desk → emailed their link → opens it → reads the terms, ticks
 *   the two boxes, says whether they need a hotel room, signs.
 *     No room needed → final at once: the PDF is built, filed to SharePoint,
 *       emailed to them, and the board is told.
 *     Room needed → "submitted": a board member chooses their hotel nights (or
 *       says none after all), approves it, and only then is it final, filed,
 *       emailed back, and on the hotel rooming list.
 *   Statuses: invited → submitted (only when a room is wanted) → signed (final).
 *
 * Kept on their own records (see store.mjs) so none of the presenter counts,
 * reminders or rooming rows can pick one up.
 */

export const VOLUNTEER_MAX = 100;

/** The signed PDF is stored under this key, apart from presenters' (`pdf:<event>:<id>`). */
export const pdfKey = (eventId, id) => `vol:${eventId}:${id}`;

/** Name and email are needed; agency is optional. Returns { added, rejected } rows. */
export function cleanRows(rows, have = []) {
  const taken = new Set(have.map((v) => String(v.email).toLowerCase()));
  const ok = [], rejected = [];
  (Array.isArray(rows) ? rows : []).slice(0, VOLUNTEER_MAX).forEach((row, index) => {
    const first = text(row?.first, 80), last = text(row?.last, 80), email = text(row?.email, 200);
    // `index` is the line it came from, so the desk can leave just those lines in the box.
    if (!first || !last) { rejected.push({ row, index, why: "Needs a first and last name." }); return; }
    if (!isEmail(email)) { rejected.push({ row, index, why: `"${email}" is not an email address.` }); return; }
    if (taken.has(email.toLowerCase())) { rejected.push({ row, index, why: `${first} ${last} (${email}) is already a volunteer on this event.` }); return; }
    taken.add(email.toLowerCase());
    ok.push({ first, last, email, organization: text(row?.organization, 200) });
  });
  return { ok, rejected };
}

/** A new volunteer record. The event carries the running number the reference uses. */
export function newVolunteer(event, row) {
  const seq = event.nextVolunteerSeq ?? 1;
  event.nextVolunteerSeq = seq + 1;
  return {
    id: token(10), eventId: event.id, ...row,
    token: token(24),
    reference: reference(event.id, seq).replace(/^AGR-/, "VOL-"),
    status: "invited",
    createdAt: new Date().toISOString(),
    openedAt: null, signedAt: null, submission: null,
  };
}

/** Who hears about a volunteer: the event's lead, the volunteer lead, the board copies and the contact. */
export const boardRecipients = (event) =>
  [...new Set([event.reviewer?.email, event.volunteerLead?.email, ...(event.notify ?? []), event.contact?.email].filter(Boolean))];

/** Run a side effect and record how it went rather than throwing. */
export async function attempt(fn) {
  const at = new Date().toISOString();
  try {
    const result = await fn();
    if (result?.skipped) return { ok: false, skipped: true, reason: result.reason, at };
    return { ok: true, at, ...(result && typeof result === "object" ? result : {}) };
  } catch (e) {
    return { ok: false, error: e.message, at };
  }
}

/**
 * Email the volunteer their link. A failure is kept on the record: a toast that
 * vanishes in three seconds is not a report. Returns { ok } or { ok: false, why }.
 */
export async function inviteVolunteer(event, volunteer, origin, { remind = false, auto = false } = {}) {
  const link = `${origin}/v/${volunteer.token}`;
  const mail = volunteerInvitationMail({ event, volunteer, link, remind });
  try {
    const out = await sendMail({ to: volunteer.email, replyTo: volunteerContact(event).email || undefined, ...mail });
    if (out.skipped) {
      volunteer.lastSendError = { why: out.reason, at: new Date().toISOString() };
      await putVolunteer(volunteer);
      return { ok: false, why: out.reason };
    }
    volunteer.mail = [...(volunteer.mail ?? []), { type: remind ? (auto ? "reminder-auto" : "reminder") : "invitation", at: new Date().toISOString(), id: out.id }];
    volunteer.lastSendError = null;
    await putVolunteer(volunteer);
    return { ok: true };
  } catch (e) {
    volunteer.lastSendError = { why: e.message, at: new Date().toISOString() };
    await putVolunteer(volunteer);
    return { ok: false, why: e.message };
  }
}

/**
 * File the signed PDF, email the volunteer their copy and tell the board, each
 * recorded separately so a hiccup in one is retried alone. `which` picks the parts.
 */
export async function deliverVolunteer(event, volunteer, pdf, which = { filing: true, volunteerEmail: true, boardEmail: true }) {
  volunteer.delivery ??= {};
  const filename = `${safeFileName(volunteer.last, "Volunteer")}_Volunteer Agreement.pdf`;
  const replyTo = volunteerContact(event).email || undefined;

  // Filing first: the board's notice links to wherever it landed.
  if (which.filing) volunteer.delivery.filing = await attempt(() => fileVolunteerAgreement({ event, volunteer, pdf }));

  const sends = [];
  if (which.volunteerEmail) {
    sends.push(attempt(() => sendMail({ to: volunteer.email, replyTo, attachments: [{ filename, content: pdf }], ...volunteerSignedMail({ event, volunteer }) }))
      .then((r) => { volunteer.delivery.volunteerEmail = r; }));
  }
  if (which.boardEmail) {
    const recipients = boardRecipients(event);
    if (!recipients.length) volunteer.delivery.boardEmail = { ok: true, skipped: true, reason: "No board emails on this event." };
    else {
      const filing = volunteer.delivery.filing?.result ?? volunteer.delivery.filing;
      const attachments = filing?.folderUrl ? [] : [{ filename, content: pdf }];
      sends.push(attempt(() => sendMail({ to: recipients, replyTo, attachments, ...volunteerNoticeMail({ event, volunteer, filing }) }))
        .then((r) => { volunteer.delivery.boardEmail = r; }));
    }
  }
  await Promise.all(sends);
  return volunteer.delivery;
}

/** Build and keep the signed PDF from the record, then (optionally) deliver it. */
export async function buildAndStore(event, volunteer) {
  const pdf = await buildVolunteerPdf({ event, volunteer });
  await putPdf(pdfKey(event.id, volunteer.id), pdf);
  return pdf;
}

/** Make the agreement final: build the PDF, file it, email the volunteer, tell the board. */
export async function completeAgreement(event, volunteer) {
  const pdf = await buildAndStore(event, volunteer);
  volunteer.delivery = {};
  await deliverVolunteer(event, volunteer, pdf);
  await putVolunteer(volunteer);
  return volunteer.delivery;
}

/**
 * A volunteer who wants a hotel room has signed, but a board member has to choose the nights
 * before it is final. The volunteer is told it is with ONGIA; the board is told it is waiting.
 */
export async function requestReview(event, volunteer, origin) {
  const adminUrl = `${origin}/admin.html#event/${encodeURIComponent(event.id)}`;
  const replyTo = volunteerContact(event).email || undefined;
  const recipients = boardRecipients(event);
  volunteer.delivery = {
    received: await attempt(() => sendMail({ to: volunteer.email, replyTo, ...volunteerReceivedMail({ event, volunteer }) })),
    reviewNotice: recipients.length
      ? await attempt(() => sendMail({ to: recipients, replyTo, ...volunteerReviewNeededMail({ event, volunteer, adminUrl }) }))
      : { ok: true, skipped: true, reason: "No board emails on this event." },
  };
  await putVolunteer(volunteer);
}

/** What went wrong with a signed volunteer's delivery, if anything: the filing is the one that matters. */
export const notFiled = (v) => v.status === "signed" && v.delivery?.filing && v.delivery.filing.ok === false;

// `waiting` is the ones still to sign. A volunteer who has signed and wants a room is `review`:
// it is ONGIA's move, not theirs.
export const volunteerCounts = (list) => ({
  total: list.length,
  signed: list.filter((v) => v.status === "signed").length,
  review: list.filter((v) => v.status === "submitted").length,
  waiting: list.filter((v) => v.status === "invited").length,
  uninvited: list.filter((v) => v.status === "invited" && !v.mail?.length).length,
  notFiled: list.filter(notFiled).length,
});

