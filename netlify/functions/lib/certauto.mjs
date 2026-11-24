import { autoOn } from "./autosend.mjs";
import { localNow } from "./surveysend.mjs";
import { peopleOf } from "./certpeople.mjs";
import { templatesFor, certSettings, certIndex, certRecord, issueMany } from "./certs.mjs";
import { sendCertificate } from "./certmail.mjs";
import { siteOrigin } from "./site.mjs";
import { pacer, timeLeft } from "./bulk.mjs";

/**
 * Certificates emailed automatically (Andrew 24 Nov 2026: "I want the surveys and certificates to go out automatically").
 * While the event's Certificates switch is on (lib/autosend.mjs): at 10:00 in the event's own time on the day after its
 * last day (or the day and time set on the event), everyone checked in or online who has an email address is issued
 * their certificate and sent it, as Email everyone does. Anyone checked in later is sent theirs on the next check, for
 * 14 days. Nobody is sent it twice; one that bounced or couldn't send waits for a person to look (Email it again).
 */
export const CERTS_AT = "10:00";
export const CERTS_DAYS = 14;
const plusDay = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

/** The day and time they go, in the event's own time. */
export function certsWhen(event) {
  const end = event?.lastDay || event?.dayOne;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(event?.certs?.sendDay ?? "") ? event.certs.sendDay : /^\d{4}-\d{2}-\d{2}$/.test(end ?? "") ? plusDay(end, 1) : "";
  const time = /^\d{2}:\d{2}$/.test(event?.certs?.sendTime ?? "") ? event.certs.sendTime : CERTS_AT;
  return { day, time, until: day ? plusDay(day, CERTS_DAYS) : "" };
}

/** Whether this event's certificates are in their sending window now. */
export function certsDue(event, now = new Date()) {
  if (!autoOn(event, "certs") || event.practice) return false;
  const { day, time, until } = certsWhen(event);
  if (!day) return false;
  const local = localNow(event, now);
  return local >= `${day} ${time}` && local.slice(0, 10) <= until;
}

/** Who is owed one: checked in, with an address, and no certificate email yet (a bounce or a failure waits for a person). */
async function owedOf(event) {
  const people = (await peopleOf(event)).filter((p) => p.checkedIn && p.email);
  const index = await certIndex(event.id);
  const out = [];
  for (const p of people) {
    const rec = index[p.key] ? await certRecord(index[p.key]) : null;
    if (rec?.revokedAt) continue;
    if (rec?.mail?.sentAt || rec?.mail?.failed || rec?.mail?.bounced) continue;
    out.push({ person: p, code: index[p.key] ?? null });
  }
  return out;
}

/** For the 15-minute check: is any event's certificate run due with someone still owed one? */
export async function certsWorkDue(events, now = new Date()) {
  for (const event of events) {
    if (certsDue(event, now) && (await owedOf(event)).length) return true;
  }
  return false;
}

/** Issue and send what's due, on every event in its window. */
export async function runCertsRounds(events, { now = new Date(), deadline = null, pace = pacer(), origin = siteOrigin() } = {}) {
  const out = [];
  for (const event of events) {
    if (!certsDue(event, now)) continue;
    try {
      let owed = await owedOf(event);
      if (!owed.length) continue;
      // Issued first, as Email everyone does: a certificate gets its number and QR code once, for good.
      if (owed.some((o) => !o.code)) {
        const templates = await templatesFor(event);
        await issueMany(event, owed.filter((o) => !o.code).map((o) => o.person), { settings: certSettings(event, templates), by: "sent automatically" });
        const index = await certIndex(event.id);
        owed = owed.map((o) => ({ ...o, code: o.code ?? index[o.person.key] ?? null }));
      }
      let sent = 0, failed = 0, left = 0;
      const trouble = [];
      for (const { person, code } of owed) {
        if (!timeLeft(deadline)) { left = owed.length - sent - failed; break; }
        if (!code) { failed++; trouble.push({ email: person.email, why: "no certificate could be issued" }); continue; }
        await pace();
        const r = await sendCertificate({ event, person, code, origin, by: "sent automatically" });
        if (r.mail?.sentAt && !r.mail.failed) sent++;
        else { failed++; trouble.push({ email: person.email, why: r.mail?.failed || r.error || "not sent" }); }
      }
      out.push({ event: event.id, title: event.title, kind: "certs", sent, failed, left, trouble: trouble.slice(0, 10) });
    } catch (e) {
      out.push({ event: event.id, title: event.title, kind: "certs", error: e.message });
    }
  }
  return out;
}
