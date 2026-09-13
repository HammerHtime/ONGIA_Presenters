/**
 * Outbound email through Resend. Everything goes out from the app's own
 * address on send.ongia.ca; replies are steered to the event's ONGIA contact,
 * so a presenter who hits Reply reaches a person, not a mailbox nobody reads.
 *
 * With no RESEND_API_KEY the send is skipped, not failed — the rest of the
 * approval (PDF, filing) still completes and the dashboard says what didn't go.
 */
const FROM = process.env.MAIL_FROM || "ONGIA Training <agreements@send.ongia.ca>";

export async function sendMail({ to, cc, replyTo, subject, html, text, attachments }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { skipped: true, reason: "RESEND_API_KEY is not set." };

  const payload = {
    from: FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    text,
  };
  if (cc?.length) payload.cc = cc;
  if (replyTo) payload.reply_to = replyTo;
  if (attachments?.length) {
    payload.attachments = attachments.map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.content).toString("base64"),
    }));
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Email failed (${res.status}): ${body.message ?? body.error ?? "unknown"}`);
  return { id: body.id };
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** One consistent ONGIA wrapper so every message looks like it came from the same desk. */
export function layout({ heading, lines, button, footer }) {
  const paras = lines.map((l) => `<p style="margin:0 0 14px;line-height:1.55">${l}</p>`).join("");
  const cta = button
    ? `<p style="margin:22px 0"><a href="${esc(button.href)}" style="background:#b8922a;color:#12161f;text-decoration:none;
        font-weight:700;padding:13px 22px;border-radius:999px;display:inline-block">${esc(button.label)}</a></p>
       <p style="margin:0 0 14px;font-size:13px;color:#767f92;word-break:break-all">Or paste this into your browser: ${esc(button.href)}</p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f2efe8;padding:24px 12px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#12161f">
  <div style="max-width:560px;margin:0 auto;background:#fafaf7;border:1px solid #ddd7c8;border-radius:22px;overflow:hidden">
    <div style="background:#1a2f5e;color:#fff;padding:18px 24px">
      <div style="font-size:20px;font-weight:700;letter-spacing:.06em">ONGIA<span style="color:#d9ae4b">.</span></div>
      <div style="font-size:12px;color:#d9ae4b;letter-spacing:.14em;text-transform:uppercase">Knowledge · Network · Impact</div>
    </div>
    <div style="padding:24px;font-size:15px">
      <h1 style="font-size:22px;margin:0 0 16px;color:#1a2f5e">${esc(heading)}</h1>
      ${paras}${cta}
      ${footer ? `<p style="margin:20px 0 0;font-size:13px;color:#767f92;line-height:1.5">${footer}</p>` : ""}
    </div>
  </div></body></html>`;
}

const plain = (heading, lines, href) =>
  [heading, "", ...lines.map((l) => l.replace(/<[^>]+>/g, "")), href ? `\n${href}` : ""].join("\n");

/** The message a presenter gets with their link — and, with `remind`, the chase-up. */
export function invitationMail({ event, presenter, link, remind }) {
  const heading = remind
    ? `Reminder: your ONGIA presenter agreement is due ${event.deadlinesReadable.agreement}`
    : `Your ONGIA presenter agreement — ${event.title}`;
  const lines = [
    `Hello ${esc(presenter.first)},`,
    remind
      ? `We haven't yet received your presenter agreement for <b>${esc(event.title)}</b> in ${esc(event.city)} (${esc(event.dayOneReadable)}). It's due back by <b>${esc(event.deadlinesReadable.agreement)}</b>.`
      : `Thank you for presenting at <b>${esc(event.title)}</b> in ${esc(event.city)}, ${esc(event.dayOneReadable)}. Before the event we need your presenter agreement — it takes about ten minutes on a phone and there's nothing to print or scan.`,
    `Please complete it by <b>${esc(event.deadlinesReadable.agreement)}</b>. The form saves your details, asks about travel and which costs your agency is covering, and you sign by typing your name.`,
    `Draft materials are due ${esc(event.deadlinesReadable.draft)} and final materials ${esc(event.deadlinesReadable.final)}.`,
  ];
  const footer = `Questions? Reply to this email to reach ${esc(event.contact?.name || "ONGIA")}.`;
  return {
    subject: heading,
    html: layout({ heading, lines, button: { label: "Open my agreement", href: link }, footer }),
    text: plain(heading, lines, link),
  };
}

/** Sent to the presenter with the signed final copy attached. */
export function finalCopyMail({ event, presenter, approval, coverage }) {
  const heading = `Your signed presenter agreement — ${event.title}`;
  const covered = coverage.length ? coverage.join(", ") : "no costs (your agency is covering them)";
  const lines = [
    `Hello ${esc(presenter.first)},`,
    `${esc(approval.name)} has reviewed and approved your presenter agreement for <b>${esc(event.title)}</b>. The signed final copy is attached for your records.`,
    `ONGIA will cover: <b>${esc(covered)}</b>.`,
    `Next dates: draft materials by <b>${esc(event.deadlinesReadable.draft)}</b>; final, production-ready materials by <b>${esc(event.deadlinesReadable.final)}</b>.` +
      (event.materialsUploadUrl ? ` Upload them here: <a href="${esc(event.materialsUploadUrl)}">${esc(event.materialsUploadUrl)}</a>` : ""),
    `Reference ${esc(presenter.reference)}.`,
  ];
  return {
    subject: heading,
    html: layout({ heading, lines, footer: `Reply to this email to reach ${esc(event.contact?.name || "ONGIA")}.` }),
    text: plain(heading, lines),
  };
}

/** Sent to the board/notify list when a presenter submits, so someone reviews it. */
export function reviewNeededMail({ event, presenter, adminUrl }) {
  const heading = `Ready for review: ${presenter.first} ${presenter.last} — ${event.title}`;
  const lines = [
    `${esc(presenter.first)} ${esc(presenter.last)}${presenter.organization ? ` (${esc(presenter.organization)})` : ""} has submitted their presenter agreement for <b>${esc(event.title)}</b>.`,
    `Agency covering: ${esc(describeAgency(presenter.submission?.expenses))}.`,
    `A board member needs to confirm which costs ONGIA will cover and sign. Nothing is filed or sent to the presenter until that's done.`,
  ];
  return {
    subject: heading,
    html: layout({ heading, lines, button: { label: "Open the review", href: adminUrl } }),
    text: plain(heading, lines, adminUrl),
  };
}

/** Sent to the notify list once the final copy exists. */
export function approvedNoticeMail({ event, presenter, approval, coverage, filing }) {
  const heading = `Final: ${presenter.first} ${presenter.last} — ${event.title}`;
  const lines = [
    `${esc(approval.name)} approved ${esc(presenter.first)} ${esc(presenter.last)}'s presenter agreement. ONGIA covers: <b>${esc(coverage.length ? coverage.join(", ") : "nothing")}</b>.`,
    filing?.folderUrl
      ? `Filed to SharePoint: <a href="${esc(filing.folderUrl)}">${esc(filing.folderUrl)}</a>`
      : `SharePoint filing: ${esc(filing?.error ?? filing?.reason ?? "not attempted")}. The PDF is attached.`,
  ];
  return { subject: heading, html: layout({ heading, lines }), text: plain(heading, lines) };
}

/** When a board member sends an agreement back for changes. */
export function returnedMail({ event, presenter, link, note }) {
  const heading = `A change is needed on your presenter agreement — ${event.title}`;
  const lines = [
    `Hello ${esc(presenter.first)},`,
    `ONGIA has looked at your presenter agreement for <b>${esc(event.title)}</b> and needs one change before it can be approved:`,
    `<i>${esc(note)}</i>`,
    `Your answers are saved — open the link, adjust, and sign again.`,
  ];
  return {
    subject: heading,
    html: layout({ heading, lines, button: { label: "Update my agreement", href: link } }),
    text: plain(heading, lines, link),
  };
}

export function describeAgency(expenses) {
  if (!expenses) return "unknown";
  const labels = { transport: "transportation", hotel: "accommodation", meals: "meals", other: "other" };
  const yes = Object.entries(labels).filter(([k]) => expenses[k] === "yes").map(([, v]) => v);
  return yes.length ? yes.join(", ") : "none";
}
