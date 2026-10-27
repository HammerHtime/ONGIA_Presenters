import { sendMail, officersTo, layout } from "./mail.mjs";

/**
 * When emails to attendees go out on the server, a short email to the officers if any did not go (Andrew 27 Oct 2026:
 * "Is there way for this to run in the background and just alert me when some emails dont send"). Nothing is sent
 * when everything went. `what` names the run; each row is one event's round:
 *   { title, what, sent, failed, left, trouble: [{ email, why }], blocked: [reason], error, warn }
 */
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** What each kind of round is called in the report. */
export const KIND_NAMES = { welcome: "The welcome letter", survey: "The survey email", reply: "The food-allergy email", "reply-reminder": "The food-allergy reminder" };

export const needsTelling = (r) => !!(r && ((r.failed ?? 0) > 0 || r.blocked?.length || r.error || r.warn));

export async function reportSends(what, rows, { send = sendMail } = {}) {
  const bad = (rows ?? []).filter(needsTelling);
  if (!bad.length) return { told: false };
  const lines = bad.map((r) => {
    const name = `<b>${esc(r.what)}</b> for ${esc(r.title)}`;
    if (r.error) return `${name} stopped: ${esc(r.error)}`;
    if (r.blocked?.length) return `${name} was held back, so nobody got it: ${esc(r.blocked[0])}`;
    if (r.warn) return `${name} is due but did not go: ${esc(r.warn)}`;
    const who = (r.trouble ?? []).slice(0, 10).map((t) => `${esc(t.email)} (${esc(t.why)})`).join("<br>");
    return `${name}: ${r.sent ?? 0} sent, <b>${r.failed} could not be sent</b>${r.left ? `, ${r.left} still to go` : ""}.${who ? `<br>${who}${r.failed > 10 ? `<br>…and ${r.failed - 10} more` : ""}` : ""}`;
  });
  const text = bad.map((r) => `${r.what} for ${r.title}: ${r.error ? `stopped: ${r.error}` : r.blocked?.length ? `held back: ${r.blocked[0]}` : r.warn ? `due but did not go: ${r.warn}` : `${r.sent ?? 0} sent, ${r.failed} could not be sent: ${(r.trouble ?? []).slice(0, 10).map((t) => `${t.email} (${t.why})`).join("; ")}`}`).join("\n");
  const subject = `[Desk] Some attendee emails did not go (${what})`;
  const html = layout({ heading: "Some attendee emails did not go", lines: [...lines, "While automatic emails to attendees are on, anyone who did not get it is tried again on the next run. A wrong address is fixed in Wix, or on the event's People tab."], footer: "Sent by the desk when an email to attendees does not go." });
  try { await send({ to: officersTo(), subject, html, text }); return { told: true }; }
  catch (e) { console.log(`could not send the report: ${e.message}`); return { told: false, error: e.message }; }
}
