import { formatDate } from "./deadlines.mjs";
import { datesOf } from "./letters.mjs";
import { layout, coordinatorOf } from "./mail.mjs";

/**
 * The rooming list: who ONGIA needs a hotel room for, which nights, and who
 * pays — built from what presenters said on their agreements, so nobody types
 * it twice.
 *
 *  - Approved presenters use what the board member confirmed at approval: the
 *    hotel dates, and whether ONGIA covers accommodation.
 *  - Presenters who have submitted but are not yet approved are listed with
 *    the dates they asked for, marked as not confirmed.
 *  - Presenters who have not answered yet are named, so it is clear the list
 *    may still grow.
 *  - Anyone else (a board member, staff) is added on the desk by hand.
 */

const nights = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86400000));
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""));
const shift = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

/**
 * The nights a room can be booked for someone who is not a presenter: three
 * days before the training to three days after it (Andrew, 6 Oct 2026: "that's
 * all my options should be"). Null when the event has no dates yet.
 */
export const GUEST_SPAN = 3;
export function guestWindow(event) {
  if (!isDate(event?.dayOne)) return null;
  const last = isDate(event.lastDay) && event.lastDay >= event.dayOne ? event.lastDay : event.dayOne;
  return { from: shift(event.dayOne, -GUEST_SPAN), to: shift(last, GUEST_SPAN) };
}

export function roomingRows(event, presenters, guests = event.roomingGuests ?? []) {
  const rows = [], waiting = [];
  for (const p of presenters) {
    const name = `${p.first ?? ""} ${p.last ?? ""}`.trim() || p.email;
    const s = p.submission ?? {};
    if (p.status === "approved") {
      const h = p.review?.hotel;
      if (!h) continue;                                       // approved, no room needed
      rows.push({ key: p.id, who: "presenter", name, organization: p.organization ?? "",
        checkIn: h.from, checkOut: h.to, nights: nights(h.from, h.to),
        billing: p.review?.ongiaCovers?.hotel ? "ONGIA" : "Guest", confirmed: true });
    } else if (p.status === "submitted") {
      if (s.hotel !== "yes") continue;
      rows.push({ key: p.id, who: "presenter", name, organization: p.organization ?? "",
        checkIn: s.hotelFrom, checkOut: s.hotelTo, nights: nights(s.hotelFrom, s.hotelTo),
        billing: "To confirm", confirmed: false, why: "agreement not approved yet" });
    } else {
      waiting.push({ name, status: p.status === "returned" ? "sent back to them for changes" : "has not submitted the agreement yet" });
    }
  }
  for (const g of guests) {
    rows.push({ key: g.id, who: "guest", name: g.name, organization: g.note ?? "",
      checkIn: g.checkIn, checkOut: g.checkOut, nights: nights(g.checkIn, g.checkOut), billing: g.billing, confirmed: true });
  }
  rows.sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.name.localeCompare(b.name));
  return { rows, waiting };
}

/** Only what the hotel needs, for comparing one sent list with the next. */
const essence = (r) => ({ key: r.key, name: r.name, checkIn: r.checkIn, checkOut: r.checkOut, billing: r.billing });
export const snapshot = (rows) => rows.map(essence);

/** What changed since the list last went to the hotel, in words the hotel can act on. */
export function changesSince(previous, rows) {
  if (!previous) return null;
  const before = new Map(previous.map((r) => [r.key, r]));
  const now = new Map(rows.map((r) => [r.key, essence(r)]));
  const out = [];
  for (const [k, r] of now) {
    const b = before.get(k);
    if (!b) { out.push({ kind: "added", name: r.name, text: `Added: ${r.name}, ${formatDate(r.checkIn)} to ${formatDate(r.checkOut)}` }); continue; }
    if (b.checkIn !== r.checkIn || b.checkOut !== r.checkOut) {
      out.push({ kind: "dates", name: r.name, text: `New dates for ${r.name}: ${formatDate(r.checkIn)} to ${formatDate(r.checkOut)} (was ${formatDate(b.checkIn)} to ${formatDate(b.checkOut)})` });
    }
    if (b.billing !== r.billing) out.push({ kind: "billing", name: r.name, text: `Billing for ${r.name} is now: ${billingWords(r.billing)}` });
  }
  for (const [k, b] of before) {
    if (!now.has(k)) out.push({ kind: "removed", name: b.name, text: `Cancelled: ${b.name} no longer needs a room` });
  }
  return out;
}

/**
 * A guest typed in on the desk, checked before it is kept. New or changed
 * dates must sit inside the event's window; a guest saved earlier with the same
 * dates is let through, so moving the training never blocks adding the next one.
 */
export function cleanGuest(g, makeId, win = null, had = null) {
  const name = String(g?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!name) return { problem: "Each guest needs a name." };
  if (!isDate(g?.checkIn) || !isDate(g?.checkOut)) return { problem: `${name} needs a check-in and a check-out date.` };
  if (g.checkOut <= g.checkIn) return { problem: `${name}: check-out must be after check-in.` };
  const unchanged = had && had.checkIn === g.checkIn && had.checkOut === g.checkOut;
  if (win && !unchanged && (g.checkIn < win.from || g.checkOut > win.to)) {
    return { problem: `${name}: rooms can be booked from ${formatDate(win.from)} to ${formatDate(win.to)}, three days either side of the training.` };
  }
  return { guest: { id: /^[a-z0-9]{6,20}$/i.test(String(g.id ?? "")) ? g.id : makeId(), name, checkIn: g.checkIn, checkOut: g.checkOut,
    billing: g.billing === "Guest" ? "Guest" : "ONGIA", note: String(g?.note ?? "").trim().slice(0, 120) } };
}

/** How the bill is described to the hotel. "To confirm" is a presenter not yet approved. */
export const billingWords = (b) => (b === "ONGIA" ? "ONGIA master account" : b === "Guest" ? "guest pays" : "to be confirmed");

const csvCell = (v) => (/[",\n]/.test(String(v ?? "")) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ""));

/** The spreadsheet a hotel can open or import: one row per room. */
export function roomingCsv(event, rows) {
  const head = ["Guest name", "Check-in", "Check-out", "Nights", "Billing", "Group"];
  const lines = rows.map((r) => [r.name, r.checkIn, r.checkOut, r.nights, billingWords(r.billing), `ONGIA - ${event.title}`]);
  return [head, ...lines].map((l) => l.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const short = (iso) => formatDate(iso).replace(/ \d{4}$/, "");      // "Sun 8 Nov" — the year is in the heading

/** The email to the hotel. Plain, and laid out to survive a phone. */
export function roomingMail({ event, rows, changes = null, sentBefore = null }) {
  const contact = coordinatorOf(event);
  const update = Boolean(sentBefore);
  const roomNights = rows.reduce((n, r) => n + r.nights, 0);
  const subject = `${update ? "Updated rooming list" : "Rooming list"}: ONGIA, ${event.title} (${datesOf(event)})`;
  const cell = "padding:8px 6px;border-bottom:1px solid #e9e4d8;font-size:14px;vertical-align:top";
  // Each guest is two lines: name and nights, then billing across the full width, so a phone never squeezes it.
  const top = "padding:9px 6px 2px;font-size:14px;vertical-align:top";
  const th = "padding:6px;border-bottom:2px solid #1a2f5e;font-size:12px;text-align:left;color:#1a2f5e;text-transform:uppercase;letter-spacing:.06em";
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:6px 0 14px">
    <tr><th style="${th}">Guest</th><th style="${th}">In</th><th style="${th}">Out</th><th style="${th};text-align:right">Nights</th></tr>
    ${rows.map((r) => `<tr><td style="${top}"><b>${esc(r.name)}</b></td>
      <td style="${top};white-space:nowrap">${esc(short(r.checkIn))}</td><td style="${top};white-space:nowrap">${esc(short(r.checkOut))}</td>
      <td style="${top};text-align:right">${r.nights}</td></tr>
      <tr><td colspan="4" style="${cell};padding-top:0;font-size:12.5px;color:#767f92">Billing: ${billingWords(r.billing)}</td></tr>`).join("")}
  </table>`;
  const hello = event.hotel?.name ? `Hello ${esc(event.hotel.name)} team,` : "Hello,";
  const intro = update
    ? `Here is our updated rooming list for ${esc(event.title)}, ${esc(datesOf(event))}. It replaces the one we sent on ${esc(formatDate(sentBefore.slice(0, 10)))}.`
    : `Here is the rooming list for ONGIA's group at ${esc(event.title)}, ${esc(datesOf(event))}.`;
  let body = `<p style="margin:0 0 14px;line-height:1.55">${hello}</p>
    <p style="margin:0 0 14px;line-height:1.55">${intro} That is ${rows.length} room${rows.length === 1 ? "" : "s"} and ${roomNights} room night${roomNights === 1 ? "" : "s"} in all. The same list is attached as a spreadsheet.</p>`;
  if (changes?.length) {
    body += `<p style="margin:0 0 6px;line-height:1.55"><b>What changed:</b></p>
      <ul style="margin:0 0 14px;padding-left:20px;line-height:1.5">${changes.map((c) => `<li style="margin:0 0 4px">${esc(c.text)}</li>`).join("")}</ul>`;
  }
  body += table + `<p style="margin:0 0 14px;line-height:1.55">Please reply to confirm, or let us know if anything is missing.</p>`;
  const html = layout({ heading: update ? "Updated rooming list" : "Rooming list", bodyHtml: body, contact, event });
  const text = [
    hello.replace(/&amp;/g, "&"), "",
    intro.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&") + ` That is ${rows.length} room${rows.length === 1 ? "" : "s"} and ${roomNights} room night${roomNights === 1 ? "" : "s"} in all. The same list is attached as a spreadsheet.`, "",
    ...(changes?.length ? ["What changed:", ...changes.map((c) => `- ${c.text}`), ""] : []),
    ...rows.map((r) => `${r.name}: ${formatDate(r.checkIn)} to ${formatDate(r.checkOut)} (${r.nights} night${r.nights === 1 ? "" : "s"}), billing: ${billingWords(r.billing)}`),
    "", "Please reply to confirm, or let us know if anything is missing.",
    contact?.name ? `\n--\n${contact.name}\nONGIA${contact.email ? `\n${contact.email}` : ""}${contact.phone ? `\n${contact.phone}` : ""}` : "",
  ].join("\n");
  return { subject, html, text, csv: roomingCsv(event, rows) };
}
