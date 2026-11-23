import { xlsx } from "./xlsx.mjs";
import { layout } from "./mail.mjs";

/*
 * The list of who is coming, for RBH (Andrew 23 Nov 2026: "for all the RBH events, now that I've taken over all the
 * registration piece, Danny is going to need a list of names and agencies for his government control back-end
 * paperwork … one of those standing things that we need to deliver to Danny prior to the event starting").
 *
 * Due two days before the first day; it goes only when someone presses Send. The email has the names and agencies in a
 * table, the same list as an Excel file (name and agency, one row per ticket, so it saves straight to CSV), and is signed
 * by the President, who gets a copy and the replies.
 */
export const RBH_LIST_KEY = "rbh-list-to";
export const DUE_DAYS = 2;
const NOT_COMING = new Set(["WITHDRAWN", "NOT_ATTENDING", "DECLINED", "CANCELED", "CANCELLED", "WAITLIST", "WAITING"]);

/** The day it's due: two days before the event's first day. */
export function dueOn(event) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(event?.dayOne ?? ""))) return null;
  return new Date(Date.parse(`${event.dayOne}T12:00:00Z`) - DUE_DAYS * 86400e3).toISOString().slice(0, 10);
}

const tidy = (s) => String(s ?? "").trim().replace(/\s+/g, " ");
// A name typed all in capitals or all in lower case, put right; one typed with care (McKinnon, de Souza) is left alone.
const nameCase = (s) => {
  const t = tidy(s);
  if (t !== t.toUpperCase() && t !== t.toLowerCase()) return t;
  return t.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\bMc(\p{L})/gu, (m, b) => `Mc${b.toUpperCase()}`);
};

/**
 * Who is coming, one entry per person: { name, agency, team } where `team` is how many more tickets they bought for
 * their team (Wix keeps only the buyer's name on those). Two sign-ups by the same name, each its own single-ticket
 * order, are the same person registered twice and count once. Sorted by agency, then last name.
 */
export function listPeople(people) {
  const coming = (people ?? []).filter((p) => !NOT_COMING.has(String(p.status ?? "").toUpperCase()) && (tidy(p.first) || tidy(p.last)));
  const by = new Map();
  for (const p of coming) {
    const first = nameCase(p.first), last = nameCase(p.last), name = tidy(`${first} ${last}`);
    const k = name.toLowerCase();
    const r = by.get(k) ?? { name, last, agency: tidy(p.agency) || tidy(p.organization) || "Not given", orders: new Set(), tickets: 0 };
    r.tickets++;
    r.orders.add(p.orderNumber || p.key);
    by.set(k, r);
  }
  return [...by.values()]
    .map((r) => ({ name: r.name, last: r.last, agency: r.agency, team: r.orders.size === r.tickets ? 0 : r.tickets - 1 }))
    .sort((a, b) => a.agency.localeCompare(b.agency) || a.last.localeCompare(b.last) || a.name.localeCompare(b.name));
}

export const countOf = (rows) => ({ people: rows.length + rows.reduce((n, r) => n + r.team, 0), named: rows.length, team: rows.reduce((n, r) => n + r.team, 0) });

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const first = (name) => tidy(name).split(" ")[0] || "there";

/** The Excel file: Name and Agency, headings on row 1, one row per ticket (a team ticket says whose team). */
export function listWorkbook(rows) {
  const out = [];
  for (const r of rows) {
    out.push([r.name, r.agency]);
    for (let i = 0; i < r.team; i++) out.push([`Name to come (${r.name}'s team)`, r.agency]);
  }
  return xlsx({ plain: true, sheet: "Attendees", columns: [{ head: "Name", width: 40 }, { head: "Agency", width: 58 }], rows: out });
}

export const fileName = (event) => `${tidy(event.title || "Event").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").slice(0, 80)} - Attendees and Agencies.xlsx`;

/**
 * The email to RBH: Andrew's words (23 Nov 2026), short, with the list as the attached Excel file only (Andrew 23 Nov
 * 2026: "With all the names in there, it looks really long and sloppy … we'll just leave it as an attachment").
 */
export function listMail({ event, rows, to, sign }) {
  const c = countOf(rows);
  const p = (t) => `<p style="margin:0 0 14px;line-height:1.55">${t}</p>`;
  const bodyHtml = [
    p(`Hi ${esc(first(to?.name))},`),
    p(`As per your request, attached is a list of the names and agencies that will be in attendance for the ${esc(event.title)}.`),
    c.team ? p("Certain people bought multiple tickets for their team. We won't know those names until the event.") : "",
    p("If you have any questions, please let me know."),
    `<p style="margin:0">${esc(sign?.name ?? "")}<br>${esc(sign?.role ?? "President, ONGIA")}</p>`,
  ].join("\n");
  return { subject: `Attendee list: ${event.title}`, html: layout({ heading: "Names and agencies attending", bodyHtml, event }) };
}
