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
import { formatDate, formatDateIn, formatDateFr, formatLong } from "./deadlines.mjs";
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
  // When Microsoft says "too many" (429), wait as long as it asks — at most a
  // minute — and try again, twice, before calling it a failure.
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(GRAPH_MAILBOX)}/sendMail`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ message, saveToSentItems: true }),
    });
    if (res.status !== 429 || attempt >= 2) break;
    const wait = Math.min(Number(res.headers.get("retry-after")) || 30, 60);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
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
 * Who a volunteer deals with: the volunteer lead the event names (Andrew, 18 Oct 2026), else the
 * event's own lead. Replies, the signature at the foot and the PDF's contact all follow this.
 */
export function volunteerContact(event) {
  const v = event?.volunteerLead;
  if (v?.email) return { name: v.name || v.email, email: v.email, phone: v.phone || "" };
  return coordinatorOf(event);
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
// Volunteer emails wear the volunteer form's teal, so the email, the form and the signed copy match.
const THEMES = {
  presenter: { bar: "#0e1a35", rule: "#b8922a", tag: "#d9ae4b", head: "#1a2f5e", btn: "#b8922a", btnText: "#12161f" },
  volunteer: { bar: "#0b3835", rule: "#1f7a72", tag: "#8fdccf", head: "#0f4c47", btn: "#1f7a72", btnText: "#ffffff" },
};

export function layout({ heading, lines = [], bodyHtml = null, button, buttons = [], footer, contact, event, lang = "en", theme = "presenter" }) {
  const C = THEMES[theme] ?? THEMES.presenter;
  // bodyHtml is for letters that carry their own structure — headings, lists —
  // and must not be wrapped paragraph by paragraph.
  // A line left empty (a date this event does not have) leaves no gap.
  // A list or a rule stands on its own; everything else is a paragraph.
  const paras = bodyHtml ?? lines.filter(Boolean).map((l) => (/^<(ul|hr)\b/.test(l) ? l : `<p style="margin:0 0 14px;line-height:1.55">${l}</p>`)).join("");
  // The primary button keeps its raw URL underneath for mail clients that strip
  // buttons; secondary ones (file uploads) are just a button — the address is
  // long, ugly and nobody types it.
  const cta = button
    ? `<p style="margin:22px 0"><a href="${esc(button.href)}" style="background:${C.btn};color:${C.btnText};text-decoration:none;
        font-weight:700;padding:13px 22px;border-radius:999px;display:inline-block">${esc(button.label)}</a></p>
       <p style="margin:0 0 14px;font-size:13px;color:#767f92;word-break:break-all">Or paste this into your browser: ${esc(button.href)}</p>`
    : "";
  const extra = buttons.filter((b) => b?.href).map((b) =>
    `<p style="margin:18px 0 6px"><a href="${esc(b.href)}" style="background:${C.head};color:#fff;text-decoration:none;
        font-weight:700;padding:12px 22px;border-radius:999px;display:inline-block">${esc(b.label)}</a></p>` +
    (b.note ? `<p style="margin:0 0 14px;font-size:13px;color:#767f92">${b.note}</p>` : "")).join("");
  // The header is centred, and the tagline is set narrower than the logo so phone
  // mail apps keep it on one line beneath it (Andrew, 18 Oct 2026).
  // The viewport line and the text-size lock stop phone mail apps from blowing
  // up paragraphs while leaving tables and buttons small beside them.
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#f2efe8;padding:24px 12px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#12161f;-webkit-text-size-adjust:100%;text-size-adjust:100%">
  <div style="max-width:560px;margin:0 auto;background:#fafaf7;border:1px solid #ddd7c8;border-radius:22px;overflow:hidden">
    <div style="background:${C.bar};color:#fff;padding:18px 24px;border-bottom:3px solid ${C.rule};text-align:center">
      ${siteUrl() ? `<img src="${siteUrl()}/assets/ongia-logo.png" alt="ONGIA" width="204" height="34" style="display:block;margin:0 auto;border:0;height:34px;width:204px">`
        : `<div style="font-size:20px;font-weight:700;letter-spacing:.06em">ONGIA<span style="color:${C.tag}">.</span></div>`}
      <div style="margin-top:8px;font-size:9.5px;line-height:1.3;color:${C.tag};letter-spacing:.1em;text-transform:uppercase">Knowledge · Network · Impact</div>
    </div>
    <div style="padding:24px;font-size:15px">
      <h1 style="font-size:22px;margin:0 0 16px;color:${C.head}">${esc(heading)}</h1>
      ${paras}${cta}${extra}
      ${footer ? `<p style="margin:20px 0 0;font-size:13px;color:#767f92;line-height:1.5">${footer}</p>` : ""}
      ${contact ? signatureBlock(contact, event, lang) : ""}
    </div>
  </div></body></html>`;
}

// The text copy of an email is read as text: "&amp;" in a title has to come back as "&".
const unescapeText = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const plain = (heading, lines, href, contact) =>
  [heading, "", ...lines.filter(Boolean).map((l) => unescapeText(l.replace(/<br\s*\/?>/g, "\n").replace(/<li[^>]*>/g, "\n• ").replace(/<[^>]+>/g, "").replace(/^\n/, ""))), href ? `\n${href}` : "",
    contact?.name ? `\n--\n${contact.name}\nONGIA${contact.email ? `\n${contact.email}` : ""}${contact.phone ? `\n${contact.phone}` : ""}` : ""].join("\n");

/**
 * The message a presenter gets with their link — and, with `remind`, the chase-up.
 * Bilingual: it goes out before the presenter has told us which language they
 * work in, so English comes first and French follows. The form itself has a
 * switch, and everything after that follows their choice.
 */
export function invitationMail({ event, presenter, link, remind, daysLeft = null }) {
  const d = event.deadlines;
  // Andrew's wording, 17 Oct 2026. Dates are written out the way a letter writes them.
  const en = (iso, weekday = true) => esc(formatLong(iso, "en", { weekday }));
  const fr = (iso, weekday = true) => esc(formatLong(iso, "fr", { weekday }));
  // An event can drop the agreement and draft dates (the Summit's re-sent agreements):
  // then the one date it names is when the presentation is due.
  const dated = event.noDeadlines !== true;
  const onFile = event.talkOnFile === true;
  // "That's in 3 days." / "That was 4 days ago." — the nudge gets sharper as the date nears.
  const urgencyEn = !dated || daysLeft === null ? "" : daysLeft > 1 ? ` That's in ${daysLeft} days.` : daysLeft === 1 ? " That's tomorrow." : daysLeft === 0 ? " That's today." : ` That was ${-daysLeft} day${daysLeft === -1 ? "" : "s"} ago.`;
  const urgencyFr = !dated || daysLeft === null ? "" : daysLeft > 1 ? ` C'est dans ${daysLeft} jours.` : daysLeft === 1 ? " C'est demain." : daysLeft === 0 ? " C'est aujourd'hui." : ` C'était il y a ${-daysLeft} jour${daysLeft === -1 ? "" : "s"}.`;
  const heading = remind
    ? dated ? `Reminder / Rappel — ONGIA presenter agreement due ${event.deadlinesReadable.agreement} · entente attendue le ${formatDateFr(d.agreement)}`
      : `Reminder / Rappel — your ONGIA presenter agreement · votre entente de conférencier ONGIA`
    : `Your ONGIA presenter agreement — ${event.title} / Votre entente de conférencier ONGIA`;
  // The event's own paragraph, as he typed it: line breaks kept, nothing else let through.
  const own = (t) => (t ? esc(t).replace(/\r?\n/g, "<br>") : "");
  const title = esc(event.title), city = esc(event.city);
  const bullets = (items) => `<ul style="margin:0 0 14px;padding-left:22px;line-height:1.55">${items.map((i) => `<li style="margin:0 0 4px">${i}</li>`).join("")}</ul>`;

  const lines = [
    `Hello ${esc(presenter.first)},`,
    remind
      ? `This is a friendly reminder that we haven't yet received your Presenter Agreement for <b>${title}</b>, taking place in ${city} on <b>${en(event.dayOne, false)}</b>.${dated ? ` It is due by <b>${en(d.agreement)}</b>.${urgencyEn}` : ""}`
      : `Thank you for agreeing to present at <b>${title}</b>, taking place in ${city} on <b>${en(event.dayOne, false)}</b>.`,
    own(event.inviteNote),
    ...(remind ? [] : [`As part of our event planning process, we kindly ask that you complete the Presenter Agreement${dated ? ` by <b>${en(d.agreement)}</b>` : ""}. This agreement serves as the formal contract between the Organization for National Gang Information and Awareness (ONGIA) and our presenters, outlining the expectations, responsibilities, and commitments of both parties. The form takes approximately 10 minutes to complete on your phone or computer, and there is no need to print, sign, or scan any documents.`]),
    `The agreement includes questions about ${onFile ? "your travel arrangements" : "your session, travel arrangements,"} and any expenses being covered by your organization. To sign the agreement, simply type your name. The form is available in both English and French, with a "Français" option located at the top of the page.`,
    onFile ? `We already have your biography and presentation outline from the program, so those two are greyed out and you can skip them. If you sent us an agreement for this event before, please complete this one too: it replaces the earlier copy.` : "",
    dated
      ? `To assist with conference planning and delegate materials, we also ask that you submit:`
      : `To assist with conference planning and delegate materials, we also ask that you submit your presentation by <b>${en(d.final)}</b>.`,
    dated ? bullets([`Draft presentation materials by <b>${en(d.draft)}</b>`, `Final presentation materials by <b>${en(d.final)}</b>`]) : "",
    `We greatly appreciate your contribution to the event and look forward to working with you to deliver a meaningful and engaging event.`,
    `<hr style="border:0;border-top:1px solid #ddd7c8;margin:18px 0">`,
    `Bonjour ${esc(presenter.first)},`,
    remind
      ? `Ceci est un rappel amical : nous n'avons pas encore reçu votre entente de conférencier pour <b>${title}</b>, qui aura lieu à ${city} le <b>${fr(event.dayOne, false)}</b>.${dated ? ` Elle est attendue d'ici le <b>${fr(d.agreement)}</b>.${urgencyFr}` : ""}`
      : `Merci d'avoir accepté de présenter à <b>${title}</b>, qui aura lieu à ${city} le <b>${fr(event.dayOne, false)}</b>.`,
    own(event.inviteNoteFr),
    ...(remind ? [] : [`Dans le cadre de la planification de l'événement, nous vous demandons de bien vouloir remplir l'entente de conférencier${dated ? ` d'ici le <b>${fr(d.agreement)}</b>` : ""}. Cette entente constitue le contrat officiel entre l'Organization for National Gang Information and Awareness (ONGIA) et ses conférenciers; elle précise les attentes, les responsabilités et les engagements de chaque partie. Le formulaire prend environ 10 minutes à remplir sur votre téléphone ou votre ordinateur, et vous n'avez aucun document à imprimer, à signer ou à numériser.`]),
    `L'entente comprend des questions sur ${onFile ? "vos déplacements" : "votre séance, vos déplacements"} et les frais assumés par votre organisation. Pour signer l'entente, il suffit de taper votre nom. Le formulaire est offert en français et en anglais; l'option « Français » se trouve en haut de la page.`,
    onFile ? `Nous avons déjà votre biographie et le plan de votre présentation tirés du programme; ces deux champs sont donc grisés et vous pouvez les passer. Si vous nous avez déjà envoyé une entente pour cet événement, veuillez tout de même remplir celle-ci : elle remplace la précédente.` : "",
    dated
      ? `Afin de faciliter la planification de la conférence et la préparation du matériel des participants, nous vous demandons également de nous faire parvenir :`
      : `Afin de faciliter la planification de la conférence et la préparation du matériel des participants, nous vous demandons également de nous faire parvenir votre présentation d'ici le <b>${fr(d.final)}</b>.`,
    dated ? bullets([`la version préliminaire de votre présentation d'ici le <b>${fr(d.draft)}</b>`, `la version finale de votre présentation d'ici le <b>${fr(d.final)}</b>`]) : "",
    `Nous vous remercions sincèrement de votre contribution à l'événement et nous nous réjouissons de travailler avec vous pour offrir un événement enrichissant et stimulant.`,
  ];
  return {
    subject: heading,
    html: layout({ heading, lines, button: { label: "Open my agreement / Ouvrir mon entente", href: link },
      contact: coordinatorOf(event), event, lang: "both" }),
    text: plain(heading, lines, link, coordinatorOf(event)),
  };
}

/**
 * The volunteer's agreement link. Bilingual like the presenters' (English first,
 * then French) because it goes out before we know which they prefer; the form has
 * its own switch and everything after follows their choice. Andrew, 18 Oct 2026:
 * the volunteer reads the terms, agrees, signs, and a signed copy comes back to us.
 */
export function volunteerInvitationMail({ event, volunteer, link, remind = false }) {
  const en = esc(formatLong(event.dayOne, "en", { weekday: false }));
  const fr = esc(formatLong(event.dayOne, "fr", { weekday: false }));
  const title = esc(event.title), city = esc(event.city);
  const heading = remind
    ? `Reminder / Rappel — your ONGIA volunteer agreement · votre entente de bénévole ONGIA`
    : `Your ONGIA volunteer agreement — ${event.title} / Votre entente de bénévole ONGIA`;
  const lines = [
    `Hello ${esc(volunteer.first)},`,
    remind
      ? `This is a friendly reminder that we haven't yet received your Volunteer Agreement for <b>${title}</b>, taking place in ${city} on <b>${en}</b>.`
      : `Thank you for volunteering with ONGIA at <b>${title}</b>, taking place in ${city} on <b>${en}</b>.`,
    ...(remind ? [] : [`Before the event, we ask every volunteer to read and sign the ONGIA Volunteer Agreement. It sets out how we expect volunteers to conduct themselves and to represent ONGIA and their own organization, and it asks you to confirm that you are in good standing with your organization and not currently under any formal investigation.`]),
    `It takes about five minutes on your phone or computer, and there is no need to print, sign, or scan anything. Read the terms, tick the boxes and type your name to sign. The form is available in both English and French, with a "Français" option at the top of the page. A signed copy will be emailed to you when you are done.`,
    `Thank you for helping to make the event a success.`,
    `<hr style="border:0;border-top:1px solid #ddd7c8;margin:18px 0">`,
    `Bonjour ${esc(volunteer.first)},`,
    remind
      ? `Ceci est un rappel amical : nous n'avons pas encore reçu votre entente de bénévole pour <b>${title}</b>, qui aura lieu à ${city} le <b>${fr}</b>.`
      : `Merci de faire du bénévolat avec ONGIA à <b>${title}</b>, qui aura lieu à ${city} le <b>${fr}</b>.`,
    ...(remind ? [] : [`Avant l'événement, nous demandons à chaque bénévole de lire et de signer l'entente de bénévole d'ONGIA. Elle précise comment nous nous attendons à ce que les bénévoles se comportent et représentent ONGIA et leur propre organisation, et elle vous demande de confirmer que vous êtes en règle auprès de votre organisation et que vous ne faites actuellement l'objet d'aucune enquête officielle.`]),
    `Cela prend environ cinq minutes sur votre téléphone ou votre ordinateur, et vous n'avez rien à imprimer, à signer ou à numériser. Lisez les conditions, cochez les cases et tapez votre nom pour signer. Le formulaire est offert en français et en anglais; l'option « Français » se trouve en haut de la page. Une copie signée vous sera envoyée par courriel lorsque vous aurez terminé.`,
    `Merci de contribuer à la réussite de l'événement.`,
  ];
  return {
    subject: heading,
    html: layout({ heading, lines, button: { label: "Open my agreement / Ouvrir mon entente", href: link },
      contact: volunteerContact(event), event, lang: "both", theme: "volunteer" }),
    text: plain(heading, lines, link, volunteerContact(event)),
  };
}

/** The volunteer's signed copy, in the language they signed in, with the PDF attached. */
export function volunteerSignedMail({ event, volunteer }) {
  const fr = volunteer.language === "fr";
  const when = esc(formatLong(event.dayOne, fr ? "fr" : "en", { weekday: false }));
  if (fr) {
    const heading = `Votre entente de bénévole signée — ${event.title}`;
    const lines = [
      `Bonjour ${esc(volunteer.first)},`,
      `Merci d'avoir signé l'entente de bénévole d'ONGIA pour <b>${esc(event.title)}</b> (${esc(event.city)}, le ${when}). Votre copie signée est jointe pour vos dossiers (le document officiel est en anglais).`,
      `Référence ${esc(volunteer.reference)}.`,
      `Si quelque chose doit être corrigé, répondez simplement à ce courriel.`,
    ];
    return { subject: heading, html: layout({ heading, lines, contact: volunteerContact(event), event, lang: "fr", theme: "volunteer" }), text: plain(heading, lines, null, volunteerContact(event)) };
  }
  const heading = `Your signed volunteer agreement — ${event.title}`;
  const lines = [
    `Hello ${esc(volunteer.first)},`,
    `Thank you for signing the ONGIA Volunteer Agreement for <b>${esc(event.title)}</b> (${esc(event.city)}, ${when}). Your signed copy is attached for your records.`,
    `Reference ${esc(volunteer.reference)}.`,
    `If anything needs correcting, just reply to this email.`,
  ];
  return { subject: heading, html: layout({ heading, lines, contact: volunteerContact(event), event, theme: "volunteer" }), text: plain(heading, lines, null, volunteerContact(event)) };
}

/** Tells the board a volunteer has signed, and where the copy went. */
export function volunteerNoticeMail({ event, volunteer, filing }) {
  const heading = `Signed: ${volunteer.first} ${volunteer.last} (volunteer) — ${event.title}`;
  const lines = [
    `${esc(volunteer.first)} ${esc(volunteer.last)}${volunteer.organization ? ` (${esc(volunteer.organization)})` : ""} signed the ONGIA Volunteer Agreement for <b>${esc(event.title)}</b>.`,
    filing?.folderUrl
      ? `Filed to SharePoint: <a href="${esc(filing.folderUrl)}">${esc(filing.folderUrl)}</a>`
      : `SharePoint filing: ${esc(filing?.error ?? filing?.reason ?? "not attempted")}. The PDF is attached.`,
  ];
  return { subject: heading, html: layout({ heading, lines, contact: volunteerContact(event), event, theme: "volunteer" }), text: plain(heading, lines, null, volunteerContact(event)) };
}

/** Tells the sponsorship lead a pack has landed and needs their eye. */
export function sponsorReviewNeededMail({ sponsor, events, adminUrl, lead }) {
  const heading = `${sponsor.company} has sent their sponsorship details`;
  const names = events.map((e) => `${esc(e.title)} (${esc(e.city)})`);
  const lines = [
    `Hello ${esc(lead?.name?.split(" ")[0] ?? "there")},`,
    `${esc(sponsor.company)} has filled in what they need. ${esc(sponsor.first)} ${esc(sponsor.last)} signed for them.`,
    names.length === 1
      ? `They are coming to <b>${names[0]}</b>.`
      : `They are coming to <b>${names.length}</b> events: ${names.join(", ")}.`,
    `Have a look at what they have asked for — tables, power, internet and the rest — and confirm what ONGIA can provide.`,
  ];
  const contact = lead ?? { name: "ONGIA", email: "", phone: "" };
  return {
    subject: heading,
    html: layout({ heading, lines, buttons: [{ href: adminUrl, label: "See what they need" }], contact, event: null }),
    text: plain(heading, lines, adminUrl, contact),
  };
}

/**
 * Book your room before the block closes. Goes to everyone still coming, 30,
 * 15 and 7 days before the cut-off — counted back from the cut-off rather than
 * the training, so the last one is a genuine last call instead of arriving
 * after the rate has gone.
 */
export function hotelCutoffMail({ event, person, hotel, daysLeft }) {
  const by = esc(formatDate(hotel.cutoff));
  const where = esc(hotel.name || "the event hotel");
  const last = daysLeft <= 7;
  const heading = last
    ? `Last few days to book your room for ${event.title}`
    : `Book your room for ${event.title} by ${formatDate(hotel.cutoff)}`;
  const lines = [
    `Hello${person.first ? " " + esc(person.first) : ""},`,
    `If you have already booked your room at ${where}, nothing to do — ignore this.`,
    `If you have not: our block closes on <b>${by}</b>${daysLeft > 0 ? `, ${daysLeft} day${daysLeft === 1 ? "" : "s"} from now` : ""}. After that the contracted rate is gone, and rooms are likely to cost more.`,
    hotel.rate ? `The rate while the block is open is <b>${esc(hotel.rate)}</b>.` : "",
    `We are looking forward to seeing you at ${esc(event.title)}${event.city ? ` in ${esc(event.city)}` : ""}.`,
  ].filter(Boolean);
  const contact = coordinatorOf(event);
  return {
    subject: heading,
    html: layout({ heading, lines, buttons: [{ href: hotel.link, label: "Book your room" }], contact, event }),
    text: plain(heading, lines, hotel.link, contact),
  };
}

/**
 * Sent the moment a sponsor is added. It thanks them first, because that is
 * what the message is for, and asks second.
 */
export function sponsorWelcomeMail({ sponsor, link, lead }) {
  const heading = `Thank you for supporting ONGIA`;
  const who = esc(sponsor.first);
  const lines = [
    `Hello ${who},`,
    `Thank you for supporting ONGIA. Your contribution puts training in front of the people who need it — police, corrections, educators and social workers working on street gangs, youth violence and human trafficking.`,
    `To get ${esc(sponsor.company)} set up, we need three things: which of our events you plan to attend, your logo, and what you need at your table.`,
    link
      ? `The button below opens a short form. It takes a few minutes, and you can come back to it later on the same link.`
      : `We will send you a short form for those shortly. Nothing is needed from you today.`,
  ];
  const contact = lead ?? { name: "ONGIA", email: process.env.MS_MAIL_FROM ?? "", phone: "" };
  return {
    subject: heading,
    html: layout({ heading, lines, buttons: link ? [{ href: link, label: "Set up our sponsorship" }] : [], contact, event: null }),
    text: plain(heading, lines, link, contact),
  };
}

/**
 * Room and equipment, asked once the agreement is approved. A presenter three
 * months out does not know what their deck will do; by approval they usually
 * do. Same link they already have, so there is nothing new to find.
 */
export function avRequestMail({ event, presenter, link, remind = false, due = "" }) {
  const lang = presenter.language === "fr" ? "fr" : "en";
  const first = esc(presenter.first);
  const title = esc(event.title);
  const by = due ? esc(formatDateIn(due, lang)) : "";
  if (lang === "fr") {
    const heading = remind
      ? `Rappel : vos besoins techniques pour ${event.title}`
      : `Votre entente est signée — une dernière question`;
    const lines = remind
      ? [`Bonjour ${first},`,
         `Il nous manque encore vos besoins techniques pour <b>${title}</b>.` + (by ? ` La préparation des salles commence avant le <b>${by}</b>.` : ""),
         `Une minute suffit : le micro, votre ordinateur, le son et Internet.`]
      : [`Bonjour ${first},`,
         `Votre entente de conférencier pour <b>${title}</b> est signée et classée. Merci.`,
         `Il reste une chose : dites-nous ce dont vous aurez besoin dans la salle, pour que tout soit prêt à votre arrivée.` + (by ? ` Idéalement d'ici le <b>${by}</b>.` : ""),
         `Une minute environ : le micro, votre ordinateur, le son et Internet.`];
    return { subject: heading,
      html: layout({ heading, lines, buttons: [{ href: link, label: "Mon équipement" }], contact: coordinatorOf(event), event, lang: "fr" }),
      text: plain(heading, lines, link, coordinatorOf(event)) };
  }
  const heading = remind
    ? `Reminder: your room and equipment for ${event.title}`
    : `Your agreement is signed — one last question`;
  const lines = remind
    ? [`Hello ${first},`,
       `We still need your room and equipment details for <b>${title}</b>.` + (by ? ` The venue starts setting rooms up ahead of <b>${by}</b>.` : ""),
       `It takes about a minute: the microphone, your laptop, sound, and internet.`]
    : [`Hello ${first},`,
       `Your presenter agreement for <b>${title}</b> is signed and filed. Thank you.`,
       `One thing left: tell us what you need in the room, so the venue has it ready before you walk in.` + (by ? ` Ideally by <b>${by}</b>.` : ""),
       `It takes about a minute: the microphone, your laptop, sound, and internet.`];
  return { subject: heading,
    html: layout({ heading, lines, buttons: [{ href: link, label: "Tell us what you need" }], contact: coordinatorOf(event), event }),
    text: plain(heading, lines, link, coordinatorOf(event)) };
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
      event.noDeadlines
        ? `Veuillez nous faire parvenir votre présentation d'ici le <b>${f(d.final)}</b>${event.materialsUploadUrl ? ", avec le bouton ci-dessous" : ""}.`
        : `Prochaines dates : version préliminaire du matériel d'ici le <b>${f(d.draft)}</b>; version finale, prête pour la production, d'ici le <b>${f(d.final)}</b>.` + (up ? ` Téléversez-le ici : ${up}` : ""),
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
    event.noDeadlines
      ? `Please send us your presentation by <b>${f(d.final)}</b>${event.materialsUploadUrl ? ", using the button below" : ""}.`
      : `Next dates: draft materials by <b>${f(d.draft)}</b>; final, production-ready materials by <b>${f(d.final)}</b>.` + (up ? ` Upload them here: ${up}` : ""),
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
/**
 * The Monday summary for the president and the VP: every upcoming event,
 * soonest first. Each event leads with the jobs still open — late ones in red
 * — then where the presenters are. Built for a phone: one column, two-column
 * tables at most, nothing that needs scrolling sideways.
 */
export function weeklyDigestMail({ sections, adminUrl }) {
  sections = [...sections].sort((a, b) => String(a.event.dayOne ?? "").localeCompare(String(b.event.dayOne ?? "")));
  // Plain text: layout() escapes the heading, and the subject is not HTML.
  const heading = sections.length === 1
    ? `Weekly summary: ${sections[0].event.title}`
    : `Weekly summary: ${sections.length} training events`;

  const C = { navy: "#1a2f5e", ink: "#12161f", body: "#2c3448", grey: "#767f92", rule: "#e9e4d8", late: "#a33328", gold: "#b8922a" };
  const label = (text) => `<div style="margin:16px 0 6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${C.gold};font-weight:700">${text}</div>`;
  // Two columns only: label left, number right. Four columns fold badly on a phone.
  const row = (left, right, last = false) =>
    `<tr><td style="padding:7px 8px 7px 0;font-size:15px;color:${C.body};${last ? "" : `border-bottom:1px solid ${C.rule}`}">${left}</td>
     <td style="padding:7px 0;font-size:15px;text-align:right;white-space:nowrap;font-weight:700;color:${C.ink};${last ? "" : `border-bottom:1px solid ${C.rule}`}">${right}</td></tr>`;
  const table = (rows) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0 8px">${rows.join("")}</table>`;
  const of = (n, total) => `${n} <span style="font-weight:400;color:${C.grey}">of ${total}</span>`;
  const when = (j) => j.days === 0 ? "today" : j.days === 1 ? "tomorrow" : j.days > 1 ? `in ${j.days} days` : `${-j.days} day${j.days === -1 ? "" : "s"} ago`;
  const jobLine = (j) => j.late
    ? `${esc(j.what)} <span style="color:${C.late}">was due ${esc(j.due)} (${when(j)})</span>`
    : `${esc(j.what)} <span style="color:${C.grey}">${esc(j.due)}, ${when(j)}${j.auto ? ` · ${esc(j.auto)}` : ""}</span>`;
  const jobsState = (jobs) => !jobs?.total ? "no job list"
    : jobs.late ? `<span style="color:${C.late}">${jobs.late} late</span>`
    : jobs.open.length ? `${jobs.open.length} to do` : "all done";

  let html = `<p style="margin:0 0 14px;line-height:1.55">Every upcoming training event, soonest first. Under each one: the jobs still open, then where the presenters are.</p>`;
  const text = [heading, "", "Every upcoming training event, soonest first.", ""];

  if (sections.length > 1) {
    html += label("At a glance") + table(sections.map((s, i) => row(
      `<b style="color:${C.navy}">${esc(s.event.title)}</b><br><span style="font-size:13px;color:${C.grey}">${esc(s.event.city)} · ${esc(s.event.datesReadable || s.event.dayOneReadable)}</span>`,
      jobsState(s.jobs), i === sections.length - 1)));
    for (const s of sections) text.push(`- ${s.event.title} (${s.event.datesReadable || s.event.dayOneReadable}): ${jobsState(s.jobs).replace(/<[^>]+>/g, "")}`);
    text.push("");
  }

  for (const s of sections) {
    const { event, counts, materials, overdue, next, rows, jobs } = s;
    html += `<hr style="border:0;border-top:1px solid #ddd7c8;margin:22px 0 16px">
      <div style="font-size:18px;font-weight:700;color:${C.navy};margin:0 0 2px">${esc(event.title)}</div>
      <div style="font-size:13px;color:${C.grey}">${esc(event.city)} · ${esc(event.datesReadable || event.dayOneReadable)}${event.reviewer?.name ? ` · lead ${esc(event.reviewer.name)}` : ""}</div>`;
    text.push("------------------------------", event.title, `${event.city} · ${event.datesReadable || event.dayOneReadable}${event.reviewer?.name ? ` · lead ${event.reviewer.name}` : ""}`, "");

    // The desk's own jobs.
    if (!jobs?.total) {
      html += label("Jobs") + `<p style="margin:0 0 8px;font-size:14px;color:${C.grey}">No job list on this event yet. Open it and press <b>Use the standard list</b>.</p>`;
      text.push("JOBS: no job list on this event yet.", "");
    } else if (!jobs.open.length) {
      html += label(`Jobs · all ${jobs.total} done`);
      text.push(`JOBS: all ${jobs.total} done.`, "");
    } else {
      html += label(`Jobs · ${jobs.done} of ${jobs.total} done`);
      text.push(`JOBS: ${jobs.done} of ${jobs.total} done. Still open:`);
      const dated = jobs.open.filter((j) => j.scheduled), undated = jobs.open.filter((j) => !j.scheduled);
      if (dated.length) {
        html += `<ul style="margin:0 0 8px;padding-left:20px;font-size:14px;line-height:1.45">${dated.map((j) =>
          `<li style="margin:0 0 6px${j.late ? `;color:${C.late}` : ""}">${jobLine(j)}</li>`).join("")}</ul>`;
        for (const j of dated) text.push(j.late ? `  ! ${j.what}: was due ${j.due} (${when(j)})` : `  - ${j.what}: ${j.due}, ${when(j)}${j.auto ? ` (${j.auto})` : ""}`);
      }
      if (undated.length) {
        html += `<p style="margin:0 0 8px;font-size:14px;line-height:1.5"><span style="color:${C.grey}">No date yet:</span> ${undated.map((j) => esc(j.what)).join(" · ")}</p>`;
        text.push(`  No date yet: ${undated.map((j) => j.what).join("; ")}`);
      }
      text.push("");
    }

    // The presenters.
    html += label("Presenters");
    if (!counts.total) {
      html += `<p style="margin:0 0 8px;font-size:14px;color:${C.grey}">No presenters added yet.</p>`;
      text.push("PRESENTERS: none added yet.");
    } else {
      html += table([
        row("Presenters", counts.total),
        row("Not submitted", counts.invited + counts.opened),
        row("Needs review", counts.submitted),
        row("Final", counts.approved),
        row("Draft materials received", of(materials.draft, counts.total)),
        row("Final materials received", of(materials.final, counts.total), true)]);
      text.push(`PRESENTERS: ${counts.total}. Not submitted ${counts.invited + counts.opened}, needs review ${counts.submitted}, final ${counts.approved}.`,
        `Materials received: draft ${materials.draft} of ${counts.total}, final ${materials.final} of ${counts.total}.`);
    }
    for (const o of overdue) {
      html += `<div style="margin:6px 0;font-size:14px"><b style="color:${C.late}">Overdue:</b> ${esc(o.label)} were due ${esc(o.due)} (${o.days} day${o.days === 1 ? "" : "s"} ago). Still outstanding: ${o.names.map(esc).join(", ")}</div>`;
      text.push(`Overdue: ${o.label} were due ${o.due} (${o.days} days ago). Still outstanding: ${o.names.join(", ")}`);
    }
    if (counts.submitted) {
      const ready = rows.filter((r) => r.status === "submitted").map((r) => r.name);
      html += `<div style="margin:6px 0;font-size:14px"><b>Ready to approve:</b> ${ready.map(esc).join(", ")}.</div>`;
      text.push(`Ready to approve: ${ready.join(", ")}.`);
    }
    if (next) {
      const inDays = next.days === 0 ? "today" : `in ${next.days} day${next.days === 1 ? "" : "s"}`;
      html += `<div style="margin:6px 0;font-size:14px"><b>Next:</b> ${esc(next.label)} ${esc(next.due)}, ${inDays}.</div>`;
      text.push(`Next: ${next.label} ${next.due}, ${inDays}.`);
    }
    html += `<p style="margin:14px 0 0"><a href="${esc(s.adminUrl)}" style="background:${C.navy};color:#fff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:999px;display:inline-block;font-size:14px">Open ${esc(event.city || event.title)}</a></p>`;
    text.push(`Open: ${s.adminUrl}`, "");
  }
  html += `<hr style="border:0;border-top:1px solid #ddd7c8;margin:22px 0 14px"><p style="margin:0;font-size:14px;line-height:1.5">Presenters who haven't submitted, and those whose materials are missing, are being reminded automatically.</p>`;
  text.push("------------------------------", "Presenters who haven't submitted, and those whose materials are missing, are being reminded automatically.", "", adminUrl);
  const footer = `This summary goes out every Monday while there are upcoming events. Sign in with the admin key to open an event.`;
  return { subject: heading, html: layout({ heading, bodyHtml: html, footer }), text: [...text, "", footer].join("\n") };
}

export function describeAgency(expenses) {
  if (!expenses) return "unknown";
  const labels = { transport: "transportation", hotel: "accommodation", meals: "meals", other: "other" };
  const yes = Object.entries(labels).filter(([k]) => expenses[k] === "yes").map(([, v]) => v);
  return yes.length ? yes.join(", ") : "none";
}
