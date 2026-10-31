import { randomBytes } from "node:crypto";
import { layout, sendAttendeeMail, coordinatorOf, ATTENDEE_REPLY_TO, CERT_FROM } from "./mail.mjs";
import { formatLong } from "./deadlines.mjs";
import { putMeta, getMeta } from "./store.mjs";
import { certificatePdf, certFileName, certRecord } from "./certs.mjs";

/**
 * Each person's certificate by email (Andrew 31 Oct 2026, from the mock-up he approved): one message, English then
 * French, with the PDF attached and a personal download link, so the desk knows who fetched theirs. It goes through
 * Resend from certificates@send.ongia.ca and replies reach the shared ONGIA Events mailbox, not the lead's own inbox.
 * What happened is kept on the certificate: sent, downloaded, or bounced (from Resend's webhook) or couldn't send.
 */
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** "November 9 to 12, 2026" / "du 9 au 12 novembre 2026", or a single day. */
export function dateRange(dayOne, lastDay, lang) {
  const a = formatLong(dayOne, lang, { weekday: false }), b = formatLong(lastDay || dayOne, lang, { weekday: false });
  if (!dayOne || a === b) return lang === "fr" ? `le ${a}` : a;
  const [ay, by] = [dayOne.slice(0, 7), (lastDay || dayOne).slice(0, 7)];
  if (lang === "fr") return ay === by ? `du ${a.replace(/ \S+ \d{4}$/, "")} au ${b}` : `du ${a} au ${b}`;
  return ay === by ? `${a.replace(/, \d{4}$/, "")} to ${b.replace(/^\S+ /, "")}` : `${a} to ${b}`;
}

export const downloadUrl = (origin, rec, lang = "en") => `${origin}/api/certfile?c=${encodeURIComponent(rec.code)}&d=${encodeURIComponent(rec.dl)}${lang === "fr" ? "&lang=fr" : ""}`;

export function certMailMessage({ event, rec, first, origin }) {
  const verify = `${origin}/verify.html?c=${rec.code}`;
  const lead = coordinatorOf(event);
  const where = event.city ? String(event.city).split(",")[0].trim() : "";
  const p = (t) => `<p style="margin:0 0 14px;line-height:1.55">${t}</p>`;
  const small = (t) => `<p style="margin:0 0 14px;font-size:13px;color:#767f92;line-height:1.5">${t}</p>`;
  const btn = (href, label) => `<p style="margin:18px 0 8px"><a href="${esc(href)}" style="background:#b8922a;color:#12161f;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:999px;display:inline-block">${esc(label)}</a></p>`;
  const rule = (t) => `<p style="margin:26px 0 10px;padding-top:16px;border-top:1px solid #ddd7c8;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#767f92">${t}</p>`;
  const title = esc(event.title);
  const hi = first ? ` ${esc(first)}` : "";
  const bodyHtml = [
    p(`Hello${hi},`),
    p(`Thank you for attending <b>${title}</b>${where ? ` in ${esc(where)}` : ""}, ${esc(dateRange(event.dayOne, event.lastDay, "en"))}. Your certificate of completion is attached as a PDF.`),
    btn(downloadUrl(origin, rec), "Download your certificate"),
    small(`Certificate no. <b>${esc(rec.code)}</b>. Anyone can check it's genuine by scanning its QR code or at <a href="${esc(verify)}" style="color:#1a2f5e">events.ongia.org/verify</a>, where you can also add it to your LinkedIn profile.`),
    rule("Français"),
    p(`Bonjour${hi},`),
    p(`Merci d'avoir participé à <b>${title}</b>${where ? ` à ${esc(where)}` : ""}, ${esc(dateRange(event.dayOne, event.lastDay, "fr"))}. Votre certificat de réussite est joint en format PDF.`),
    btn(downloadUrl(origin, rec, "fr"), "Télécharger votre certificat"),
    small(`Certificat n<sup>o</sup> <b>${esc(rec.code)}</b>. Toute personne peut en vérifier l'authenticité en balayant son code QR ou à <a href="${esc(verify)}" style="color:#1a2f5e">events.ongia.org/verify</a>, où vous pouvez aussi l'ajouter à votre profil LinkedIn.`),
    // Signed by the lead, but replies go to the shared mailbox, so the signature says so rather than "replies go to Raj".
    `<div style="margin:24px 0 0;padding-top:15px;border-top:1px solid #ddd7c8;font-size:13px;color:#4a5563;line-height:1.6">
      ${lead?.name ? `<div style="font-weight:700;color:#12161f;font-size:14px">${esc(lead.name)}</div><div>ONGIA — lead for ${title}</div>` : `<div style="font-weight:700;color:#12161f;font-size:14px">ONGIA</div>`}
      <div style="margin-top:6px;color:#767f92">Replies go to the ONGIA events team at <a href="mailto:${esc(ATTENDEE_REPLY_TO)}" style="color:#1a2f5e">${esc(ATTENDEE_REPLY_TO)}</a>.</div>
      <div style="margin-top:6px;color:#767f92">Les réponses sont acheminées à l'équipe des événements d'ONGIA, à ${esc(ATTENDEE_REPLY_TO)}.</div></div>`,
  ].join("");
  const subject = `Your certificate: ${event.title} / Votre certificat`;
  const text = [`Hello${first ? " " + first : ""},`, "",
    `Thank you for attending ${event.title}${where ? ` in ${where}` : ""}, ${dateRange(event.dayOne, event.lastDay, "en")}. Your certificate of completion is attached as a PDF.`, "",
    `Download your certificate: ${downloadUrl(origin, rec)}`, `Certificate no. ${rec.code}. Check it's genuine at ${verify}`, "", "— Français —", "",
    `Bonjour${first ? " " + first : ""},`, "",
    `Merci d'avoir participé à ${event.title}${where ? ` à ${where}` : ""}, ${dateRange(event.dayOne, event.lastDay, "fr")}. Votre certificat de réussite est joint en format PDF.`, "",
    `Télécharger votre certificat : ${downloadUrl(origin, rec, "fr")}`, `Certificat no ${rec.code}. Vérification : ${verify}`, "",
    `--`, lead?.name ? `${lead.name}, ONGIA — lead for ${event.title}` : "ONGIA", `Replies go to ${ATTENDEE_REPLY_TO}.`].join("\n");
  return { subject, html: layout({ heading: "Your certificate · Votre certificat", bodyHtml, event }), text };
}

/**
 * Email one person their certificate. The record gets a download token the first time, and what happened: sent (with
 * Resend's id, so a bounce can find it again), or why it couldn't go. Returns the mail status as the list shows it.
 */
export async function sendCertificate({ event, person, code, origin, by = null }) {
  let rec = await certRecord(code);
  if (!rec || rec.revokedAt) return { error: "No certificate in use for this person." };
  if (!person.email) return { error: "No email address on the list for this person." };
  if (!rec.dl) rec = { ...rec, dl: randomBytes(12).toString("base64url") };
  const now = new Date().toISOString();
  const was = rec.mail ?? {};
  try {
    const msg = certMailMessage({ event, rec, first: person.first, origin });
    const pdf = await certificatePdf(rec, { origin });
    const out = await sendAttendeeMail({ to: person.email, ...msg, attachments: [{ filename: certFileName(rec), content: pdf }] }, { from: CERT_FROM });
    const mail = out.skipped
      ? { ...was, to: person.email, tried: now, by, failed: out.reason, bounced: undefined }
      : { ...was, to: person.email, sentAt: now, by, id: out.id, sends: (was.sends ?? 0) + 1, failed: undefined, bounced: undefined, deliveredAt: undefined };
    rec = { ...rec, mail };
    await putMeta(`certs:code:${rec.code}`, rec);
    if (out.id) await putMeta(`certs:mailid:${out.id}`, { code: rec.code });
    return { mail: mailCard(rec) };
  } catch (e) {
    rec = { ...rec, mail: { ...was, to: person.email, tried: now, by, failed: String(e.message || e).slice(0, 300) } };
    await putMeta(`certs:code:${rec.code}`, rec);
    return { mail: mailCard(rec) };
  }
}

/** What the list shows for a certificate's email. */
export const mailCard = (rec) => {
  const m = rec?.mail;
  if (!m) return null;
  return { to: m.to, sentAt: m.sentAt ?? null, downloadedAt: m.downloadedAt ?? null, deliveredAt: m.deliveredAt ?? null, bounced: m.bounced ?? null, failed: m.failed ?? null, sends: m.sends ?? 0 };
};

/** Resend's webhook: delivered, bounced or marked as spam, matched back to the certificate by the email's id. */
export async function noteMailEvent(type, data) {
  const id = data?.email_id;
  const link = id ? await getMeta(`certs:mailid:${id}`) : null;
  const rec = link ? await certRecord(link.code) : null;
  if (!rec?.mail || rec.mail.id !== id) return false;
  const at = new Date().toISOString();
  const m = { ...rec.mail };
  if (type === "email.delivered") m.deliveredAt = at;
  else if (type === "email.bounced") m.bounced = String(data?.bounce?.message || data?.bounce?.subType || data?.bounce?.type || "Bounced").slice(0, 200);
  else if (type === "email.complained") m.bounced = "Marked as spam by the recipient";
  else return false;
  await putMeta(`certs:code:${rec.code}`, { ...rec, mail: m });
  return true;
}

/**
 * "Email me a sample": the real message and a real PDF, but a sample certificate (number SAMP-LE00, which verifies
 * nothing) in the sender's own name, to the board member asking. Its download link works for 30 days.
 */
export async function sendSample({ event, settings, to, name, origin }) {
  const rec = { code: "SAMP-LE00", name: name || "Your Name", agency: "ONGIA", date: settings.date, course: settings.course, template: settings.template, eventTitle: event.title,
    dl: randomBytes(12).toString("base64url"), sample: true, until: new Date(Date.now() + 30 * 86400000).toISOString() };
  await putMeta(`certs:sample:${rec.dl}`, rec);
  const msg = certMailMessage({ event, rec, first: String(name || "").split(" ")[0], origin });
  // A refusal from Resend (a domain not verified, a bad address) comes back as words, not as a crash.
  try {
    const out = await sendAttendeeMail({ to, ...msg, subject: `[Sample] ${msg.subject}`, attachments: [{ filename: certFileName(rec), content: await certificatePdf(rec, { origin }) }] }, { from: CERT_FROM });
    return out.skipped ? { skipped: out.reason } : { sent: true, to };
  } catch (e) { return { skipped: String(e.message || e).slice(0, 300) }; }
}
