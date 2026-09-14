/**
 * Outbound email. Two transports, chosen by configuration:
 *
 *   Microsoft 365 (preferred) — MS_MAIL_FROM names a mailbox in the ONGIA
 *   tenant (e.g. ongiaspeakers@ongia.ca); the app sends as that mailbox using
 *   the same Entra credentials it files to SharePoint with (Mail.Send).
 *   Mail then carries ONGIA's own SPF/DKIM and lands in that mailbox's Sent
 *   Items, so there is a record outside the app.
 *
 *   Resend — RESEND_API_KEY, from MAIL_FROM on a verified sending domain.
 *
 * Replies are steered to the event's ONGIA contact either way, so a presenter
 * who hits Reply reaches a person. With neither transport configured the send
 * is skipped, not failed — the rest of the approval still completes and the
 * dashboard says what didn't go.
 */
import { graphAccessToken, graphConfigured } from "./graph.mjs";
import { formatDate, formatDateIn, formatDateFr } from "./deadlines.mjs";
import { siteUrl } from "./site.mjs";

const RESEND_FROM = process.env.MAIL_FROM || "ONGIA Training <agreements@send.ongia.ca>";
const GRAPH_MAILBOX = process.env.MS_MAIL_FROM || "";
const GRAPH_DISPLAY = process.env.MS_MAIL_FROM_NAME || "ONGIA Training";

export function mailTransport() {
  if (GRAPH_MAILBOX && graphConfigured()) return { kind: "microsoft", from: `${GRAPH_DISPLAY} <${GRAPH_MAILBOX}>` };
  if (process.env.RESEND_API_KEY) return { kind: "resend", from: RESEND_FROM };
  return null;
}

export async function sendMail(message) {
  const transport = mailTransport();
  if (!transport) return { skipped: true, reason: "No email transport is configured (MS_MAIL_FROM or RESEND_API_KEY)." };
  return transport.kind === "microsoft" ? sendViaGraph(message) : sendViaResend(message);
}

const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);

async function sendViaGraph({ to, cc, replyTo, subject, html, text, attachments }) {
  const token = await graphAccessToken();
  const recipient = (address) => ({ emailAddress: { address } });
  const message = {
    subject,
    body: { contentType: "HTML", content: html || `<pre>${text ?? ""}</pre>` },
    toRecipients: list(to).map(recipient),
    ccRecipients: list(cc).map(recipient),
    replyTo: replyTo ? [recipient(replyTo)] : [],
    from: { emailAddress: { address: GRAPH_MAILBOX, name: GRAPH_DISPLAY } },
    attachments: (attachments ?? []).map((a) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: a.filename,
      contentType: a.contentType ?? "application/pdf",
      contentBytes: Buffer.from(a.content).toString("base64"),
    })),
  };
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(GRAPH_MAILBOX)}/sendMail`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });
  if (res.status !== 202) {
    const body = await res.json().catch(() => ({}));
    const code = body.error?.code ?? res.status;
    const hint = res.status === 403 ? " — the app needs the Mail.Send application permission with admin consent" : "";
    throw new Error(`Email failed (${code}): ${body.error?.message ?? "Graph sendMail refused"}${hint}`);
  }
  return { id: res.headers.get("request-id") ?? "sent", transport: "microsoft" };
}

async function sendViaResend({ to, cc, replyTo, subject, html, text, attachments }) {
  const payload = { from: RESEND_FROM, to: list(to), subject, html, text };
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
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Email failed (${res.status}): ${body.message ?? body.error ?? "unknown"}`);
  return { id: body.id, transport: "resend" };
}

/** The person replies should reach: the event's lead board member, else the ONGIA contact. */
export function coordinatorOf(event) {
  const phone = event?.reviewer?.phone || event?.contact?.phone || "";
  if (event?.reviewer?.email) return { name: event.reviewer.name || event.reviewer.email, email: event.reviewer.email, phone };
  if (event?.contact?.email || event?.contact?.name) return { name: event.contact.name || event.contact.email, email: event.contact.email || "", phone };
  return { name: "ONGIA", email: "", phone: "" };
}

/**
 * Who the presenter is actually dealing with, at the foot of every message: the
 * event's lead board member, by name, address and number. Replies already go to
 * them (every send sets reply-to), and this says so.
 */
function signatureBlock(contact, event, lang = "en") {
  if (!contact?.name) return "";
  const bits = [];
  if (contact.email) bits.push(`<a href="mailto:${esc(contact.email)}" style="color:#1a2f5e">${esc(contact.email)}</a>`);
  if (contact.phone) bits.push(`<a href="tel:${esc(String(contact.phone).replace(/[^\d+x]/gi, ""))}" style="color:#1a2f5e;text-decoration:none">${esc(contact.phone)}</a>`);
  const replies = {
    en: `Replies to this email go straight to ${esc(contact.name)}.`,
    fr: `Les réponses à ce courriel sont acheminées directement à ${esc(contact.name)}.`,
  };
  const role = {
    en: `ONGIA${event?.title ? ` — lead for ${esc(event.title)}` : ""}`,
    fr: `ONGIA${event?.title ? ` — responsable de ${esc(event.title)}` : ""}`,
  };
  const langs = lang === "both" ? ["en", "fr"] : [lang];
  return `<div style="margin:24px 0 0;padding-top:15px;border-top:1px solid #ddd7c8;font-size:13px;color:#4a5563;line-height:1.6">
    <div style="font-weight:700;color:#12161f;font-size:14px">${esc(contact.name)}</div>
    <div>${role[langs[0]]}</div>
    ${bits.length ? `<div>${bits.join(" &middot; ")}</div>` : ""}
    ${langs.map((l) => `<div style="margin-top:6px;color:#767f92">${replies[l]}</div>`).join("")}
  </div>`;
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** One consistent ONGIA wrapper so every message looks like it came from the same desk. */
export function layout({ heading, lines, button, buttons = [], footer, contact, event, lang = "en" }) {
  const paras = lines.map((l) => `<p style="margin:0 0 14px;line-height:1.55">${l}</p>`).join("");
  // The primary button keeps its raw URL underneath for mail clients that strip
  // buttons; secondary ones (file uploads) are just a button — the address is
  // long, ugly and nobody types it.
  const cta = button
    ? `<p style="margin:22px 0"><a href="${esc(button.href)}" style="background:#b8922a;color:#12161f;text-decoration:none;
        font-weight:700;padding:13px 22px;border-radius:999px;display:inline-block">${esc(button.label)}</a></p>
       <p style="margin:0 0 14px;font-size:13px;color:#767f92;word-break:break-all">Or paste this into your browser: ${esc(button.href)}</p>`
    : "";
  const extra = buttons.filter((b) => b?.href).map((b) =>
    `<p style="margin:18px 0 6px"><a href="${esc(b.href)}" style="background:#1a2f5e;color:#fff;text-decoration:none;
        font-weight:700;padding:12px 22px;border-radius:999px;display:inline-block">${esc(b.label)}</a></p>` +
    (b.note ? `<p style="margin:0 0 14px;font-size:13px;color:#767f92">${b.note}</p>` : "")).join("");
  return `<!doctype html><html><body style="margin:0;background:#f2efe8;padding:24px 12px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#12161f">
  <div style="max-width:560px;margin:0 auto;background:#fafaf7;border:1px solid #ddd7c8;border-radius:22px;overflow:hidden">
    <div style="background:#0e1a35;color:#fff;padding:18px 24px;border-bottom:3px solid #b8922a">
      ${siteUrl() ? `<img src="${siteUrl()}/assets/ongia-logo.png" alt="ONGIA" width="168" height="28" style="display:block;border:0;height:28px;width:auto">`
        : `<div style="font-size:20px;font-weight:700;letter-spacing:.06em">ONGIA<span style="color:#d9ae4b">.</span></div>`}
      <div style="margin-top:8px;font-size:12px;color:#d9ae4b;letter-spacing:.14em;text-transform:uppercase">Knowledge · Network · Impact</div>
    </div>
    <div style="padding:24px;font-size:15px">
      <h1 style="font-size:22px;margin:0 0 16px;color:#1a2f5e">${esc(heading)}</h1>
      ${paras}${cta}${extra}
      ${footer ? `<p style="margin:20px 0 0;font-size:13px;color:#767f92;line-height:1.5">${footer}</p>` : ""}
      ${contact ? signatureBlock(contact, event, lang) : ""}
    </div>
  </div></body></html>`;
}

const plain = (heading, lines, href, contact) =>
  [heading, "", ...lines.map((l) => l.replace(/<[^>]+>/g, "")), href ? `\n${href}` : "",
    contact?.name ? `\n--\n${contact.name}\nONGIA${contact.email ? `\n${contact.email}` : ""}${contact.phone ? `\n${contact.phone}` : ""}` : ""].join("\n");

/**
 * The message a presenter gets with their link — and, with `remind`, the chase-up.
 * Bilingual: it goes out before the presenter has told us which language they
 * work in, so English comes first and French follows. The form itself has a
 * switch, and everything after that follows their choice.
 */
export function invitationMail({ event, presenter, link, remind, daysLeft = null }) {
  const d = event.deadlines;
  const fr = (iso) => esc(formatDateFr(iso));
  // "That's in 3 days." / "That was 4 days ago." — the nudge gets sharper as the date nears.
  const urgencyEn = daysLeft === null ? "" : daysLeft > 1 ? ` That's in ${daysLeft} days.` : daysLeft === 1 ? " That's tomorrow." : daysLeft === 0 ? " That's today." : ` That was ${-daysLeft} day${daysLeft === -1 ? "" : "s"} ago.`;
  const urgencyFr = daysLeft === null ? "" : daysLeft > 1 ? ` C'est dans ${daysLeft} jours.` : daysLeft === 1 ? " C'est demain." : daysLeft === 0 ? " C'est aujourd'hui." : ` C'était il y a ${-daysLeft} jour${daysLeft === -1 ? "" : "s"}.`;
  const heading = remind
    ? `Reminder / Rappel — ONGIA presenter agreement due ${event.deadlinesReadable.agreement} · entente attendue le ${formatDateFr(d.agreement)}`
    : `Your ONGIA presenter agreement — ${event.title} / Votre entente de conférencier ONGIA`;
  const lines = [
    `Hello ${esc(presenter.first)},`,
    remind
      ? `We haven't yet received your presenter agreement for <b>${esc(event.title)}</b> in ${esc(event.city)} (${esc(event.dayOneReadable)}). It's due back by <b>${esc(event.deadlinesReadable.agreement)}</b>.${urgencyEn}`
      : `Thank you for presenting at <b>${esc(event.title)}</b> in ${esc(event.city)}, ${esc(event.dayOneReadable)}. Before the event we need your presenter agreement — it takes about ten minutes on a phone and there's nothing to print or scan.`,
    `Please complete it by <b>${esc(event.deadlinesReadable.agreement)}</b>. The form asks about your session, travel, and which costs your agency is covering, and you sign by typing your name. It's available in English and French (a "Français" button at the top of the page).`,
    `Draft materials are due ${esc(event.deadlinesReadable.draft)} and final materials ${esc(event.deadlinesReadable.final)}.`,
    `<hr style="border:0;border-top:1px solid #ddd7c8;margin:18px 0">`,
    `Bonjour ${esc(presenter.first)},`,
    remind
      ? `Nous n'avons pas encore reçu votre entente de conférencier pour <b>${esc(event.title)}</b> à ${esc(event.city)} (${fr(event.dayOne)}). Elle est attendue d'ici le <b>${fr(d.agreement)}</b>.${urgencyFr}`
      : `Merci de présenter à <b>${esc(event.title)}</b> à ${esc(event.city)}, le ${fr(event.dayOne)}. Avant l'événement, nous avons besoin de votre entente de conférencier — une dizaine de minutes sur un téléphone, rien à imprimer ni à numériser.`,
    `Veuillez la remplir d'ici le <b>${fr(d.agreement)}</b>. Le formulaire est offert en français et en anglais (bouton « Français » en haut de la page); vous signez en tapant votre nom.`,
    `Version préliminaire du matériel attendue le ${fr(d.draft)}; version finale le ${fr(d.final)}.`,
  ];
  return {
    subject: heading,
    html: layout({ heading, lines, button: { label: "Open my agreement / Ouvrir mon entente", href: link },
      contact: coordinatorOf(event), event, lang: "both" }),
    text: plain(heading, lines, link, coordinatorOf(event)),
  };
}

/** Sent to the presenter with the signed final copy attached. */
export function finalCopyMail({ event, presenter, approval, coverage }) {
  const lang = presenter.language === "fr" ? "fr" : "en";
  const d = event.deadlines;
  const f = (iso) => esc(formatDateIn(iso, lang));
  const up = ""; // the upload link is a button below the text, not a pasted address
  const uploadBtn = event.materialsUploadUrl
    ? [{ href: event.materialsUploadUrl, label: lang === "fr" ? "Téléverser le matériel" : "Upload Material",
        note: lang === "fr" ? "Le bouton ouvre le dossier de dépôt d'ONGIA pour cette formation — déposez-y vos fichiers, rien d'autre à faire." : "Opens ONGIA's drop folder for this event — add your files there and you're done." }]
    : [];
  if (lang === "fr") {
    const heading = `Votre entente de conférencier signée — ${event.title}`;
    const covered = coverage.length ? coverage.map(frCost).join(", ") : "aucuns frais (votre organisation les assume)";
    const lines = [
      `Bonjour ${esc(presenter.first)},`,
      `${esc(approval.name)} a examiné et approuvé votre entente de conférencier pour <b>${esc(event.title)}</b>. La copie finale signée est jointe pour vos dossiers (le document officiel est en anglais).`,
      `ONGIA prend en charge : <b>${esc(covered)}</b>.`,
      describeDates(presenter, "fr"),
      `Prochaines dates : version préliminaire du matériel d'ici le <b>${f(d.draft)}</b>; version finale, prête pour la production, d'ici le <b>${f(d.final)}</b>.` + (up ? ` Téléversez-le ici : ${up}` : ""),
      `Référence ${esc(presenter.reference)}.`,
    ];
    return { subject: heading, html: layout({ heading, lines, buttons: uploadBtn, contact: coordinatorOf(event), event, lang: "fr" }),
      text: plain(heading, lines, event.materialsUploadUrl, coordinatorOf(event)) };
  }
  const heading = `Your signed presenter agreement — ${event.title}`;
  const covered = coverage.length ? coverage.join(", ") : "no costs (your agency is covering them)";
  const lines = [
    `Hello ${esc(presenter.first)},`,
    `${esc(approval.name)} has reviewed and approved your presenter agreement for <b>${esc(event.title)}</b>. The signed final copy is attached for your records.`,
    `ONGIA will cover: <b>${esc(covered)}</b>.`,
    describeDates(presenter),
    `Next dates: draft materials by <b>${f(d.draft)}</b>; final, production-ready materials by <b>${f(d.final)}</b>.` + (up ? ` Upload them here: ${up}` : ""),
    `Reference ${esc(presenter.reference)}.`,
  ];
  return {
    subject: heading,
    html: layout({ heading, lines, buttons: uploadBtn, contact: coordinatorOf(event), event }),
    text: plain(heading, lines, event.materialsUploadUrl, coordinatorOf(event)),
  };
}

const frCost = (c) => ({ transportation: "le transport", accommodation: "l'hébergement", meals: "les repas", "other costs": "les autres frais" }[c] ?? c);

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
    html: layout({ heading, lines, button: { label: "Open the review", href: adminUrl }, contact: coordinatorOf(event), event }),
    text: plain(heading, lines, adminUrl, coordinatorOf(event)),
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
  return { subject: heading, html: layout({ heading, lines, contact: coordinatorOf(event), event }), text: plain(heading, lines, null, coordinatorOf(event)) };
}

/** When a board member sends an agreement back for changes. */
export function returnedMail({ event, presenter, link, note }) {
  if (presenter.language === "fr") {
    const heading = `Une modification est requise dans votre entente de conférencier — ${event.title}`;
    const lines = [
      `Bonjour ${esc(presenter.first)},`,
      `ONGIA a examiné votre entente de conférencier pour <b>${esc(event.title)}</b> et demande une modification avant de pouvoir l'approuver :`,
      `<i>${esc(note)}</i>`,
      `Vos réponses sont conservées — ouvrez le lien, apportez la correction et signez de nouveau.`,
    ];
    return { subject: heading, html: layout({ heading, lines, button: { label: "Mettre à jour mon entente", href: link }, contact: coordinatorOf(event), event, lang: "fr" }),
      text: plain(heading, lines, link, coordinatorOf(event)) };
  }
  const heading = `A change is needed on your presenter agreement — ${event.title}`;
  const lines = [
    `Hello ${esc(presenter.first)},`,
    `ONGIA has looked at your presenter agreement for <b>${esc(event.title)}</b> and needs a change before it can be approved:`,
    `<i>${esc(note)}</i>`,
    `Your answers are saved — open the link, adjust, and sign again.`,
  ];
  return {
    subject: heading,
    html: layout({ heading, lines, button: { label: "Update my agreement", href: link }, contact: coordinatorOf(event), event }),
    text: plain(heading, lines, link, coordinatorOf(event)),
  };
}

function describeDates(presenter, lang = "en") {
  const r = presenter.review ?? {};
  const s = presenter.submission ?? {};
  const fmt = (v) => esc(formatDateIn(v, lang));
  const fr = lang === "fr";
  const parts = [];
  const travel = r.travel ?? (s.travel === "yes" ? { from: s.travelFrom, to: s.travelTo } : null);
  const hotel = r.hotel ?? (s.hotel === "yes" ? { from: s.hotelFrom, to: s.hotelTo } : null);
  const adj = fr ? " (ajustées par ONGIA)" : " (adjusted by ONGIA)";
  if (travel) parts.push(`${fr ? "transport" : "travel"} <b>${fmt(travel.from)} – ${fmt(travel.to)}</b>${r.travel?.changed ? adj : ""}`);
  if (hotel) parts.push(`${fr ? "hôtel" : "hotel"} <b>${fmt(hotel.from)} – ${fmt(hotel.to)}</b>${r.hotel?.changed ? adj : ""}`);
  if (!parts.length) return fr ? "Aucun transport ni hôtel n'a été demandé." : "No travel or hotel was requested.";
  return fr ? `Dates confirmées : ${parts.join("; ")}.` : `Confirmed dates: ${parts.join("; ")}.`;
}

/**
 * Monday summary for the lead board member: where every presenter stands,
 * what's overdue, what's next, and a button into the event on the admin page.
 */
export function weeklyDigestMail({ sections, adminUrl }) {
  const totalFinal = sections.reduce((n, s) => n + s.counts.approved, 0);
  const totalAll = sections.reduce((n, s) => n + s.counts.total, 0);
  const anyOverdue = sections.some((s) => s.overdue.length);
  const heading = sections.length === 1
    ? `Weekly summary: ${esc(sections[0].event.title)}`
    : `Weekly summary: ${sections.length} training events`;
  void totalFinal; void totalAll; void anyOverdue;
  // Two columns only: label left, number right. Four columns fold badly on a phone.
  const row = (label, value, last = false) =>
    `<tr><td style="padding:7px 0;font-size:15px;color:#2c3448;${last ? "" : "border-bottom:1px solid #e9e4d8"}">${label}</td>
     <td style="padding:7px 0;font-size:15px;text-align:right;white-space:nowrap;font-weight:700;color:#12161f;${last ? "" : "border-bottom:1px solid #e9e4d8"}">${value}</td></tr>`;
  const of = (n, total) => `${n} <span style="font-weight:400;color:#767f92">of ${total}</span>`;
  const lines = [`Monday summary of every upcoming training event. Each section has a button that opens the event on the admin page.`];
  for (const s of sections) {
    const { event, counts, materials, overdue, next, rows } = s;
    const numbers = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0 12px">
      ${row("Presenters", counts.total)}
      ${row("Not submitted", counts.invited + counts.opened)}
      ${row("Needs review", counts.submitted)}
      ${row("Final", counts.approved)}
      ${row("Draft materials received", of(materials.draft, counts.total))}
      ${row("Final materials received", of(materials.final, counts.total), true)}</table>`;
    let block = `<hr style="border:0;border-top:1px solid #ddd7c8;margin:18px 0">
      <div style="font-size:18px;font-weight:700;color:#1a2f5e;margin:0 0 2px">${esc(event.title)}</div>
      <div style="font-size:13px;color:#767f92;margin-bottom:4px">${esc(event.city)} · ${esc(event.dayOneReadable)}${event.reviewer?.name ? ` · lead ${esc(event.reviewer.name)}` : ""}</div>${numbers}`;
    if (overdue.length) block += `<div style="margin:6px 0;font-size:14px"><b style="color:#a33328">Overdue:</b> ${overdue.map((o) => `${esc(o.label)} were due ${esc(o.due)} (${o.days} day${o.days === 1 ? "" : "s"} ago) — still outstanding: ${o.names.map(esc).join(", ")}`).join("<br>")}</div>`;
    if (counts.submitted) block += `<div style="margin:6px 0;font-size:14px"><b>Ready to approve:</b> ${rows.filter((r) => r.status === "submitted").map((r) => esc(r.name)).join(", ")}.</div>`;
    if (next) block += `<div style="margin:6px 0;font-size:14px"><b>Next:</b> ${esc(next.label)} ${esc(next.due)}, ${next.days === 0 ? "today" : `in ${next.days} day${next.days === 1 ? "" : "s"}`}.</div>`;
    block += `<p style="margin:12px 0 0"><a href="${esc(s.adminUrl)}" style="background:#1a2f5e;color:#fff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:999px;display:inline-block;font-size:14px">Open ${esc(event.city)}</a></p>`;
    lines.push(block);
  }
  lines.push(`<hr style="border:0;border-top:1px solid #ddd7c8;margin:18px 0">Presenters who haven't submitted, and those whose materials are missing, are being reminded automatically.`);
  return {
    subject: heading,
    html: layout({ heading, lines, footer: `This summary goes out every Monday while there are upcoming events. Sign in with the admin key to open an event.` }),
    text: plain(heading, lines, adminUrl),
  };
}

export function describeAgency(expenses) {
  if (!expenses) return "unknown";
  const labels = { transport: "transportation", hotel: "accommodation", meals: "meals", other: "other" };
  const yes = Object.entries(labels).filter(([k]) => expenses[k] === "yes").map(([, v]) => v);
  return yes.length ? yes.join(", ") : "none";
}
