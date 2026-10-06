import { text } from "./http.mjs";

/**
 * The people coming to a training event.
 *
 * Two ways in: pulled from Wix, or pasted/uploaded as a CSV. Both land in the
 * same shape, and both can be true at once — someone who registered by phone
 * and was typed in by hand must survive the next Wix sweep.
 */

/** A real CSV reader: quoted fields, commas and newlines inside them, CRLF, BOM. */
export function parseCsv(raw) {
  const s = String(raw ?? "").replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }   // "" is an escaped quote
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/**
 * Work out which column is which. Wix's own export, a hand-made sheet and
 * Eventbrite all name these differently, so match on what the header means
 * rather than on one exact spelling.
 */
const HEADERS = {
  first: [/^first\s*name$/i, /^given\s*name$/i, /^first$/i],
  last: [/^last\s*name$/i, /^surname$/i, /^family\s*name$/i, /^last$/i],
  full: [/^(full\s*)?name$/i, /^attendee$/i, /^guest$/i],
  email: [/^e-?mail(\s*address)?$/i, /^email$/i],
  phone: [/^(phone|mobile|cell)(\s*number)?$/i, /^telephone$/i],
  org: [/^(organi[sz]ation|organisation|company|agency|service|employer)$/i],
  status: [/^(rsvp|attendance|attending|status)$/i],
};

export function columnsFrom(header) {
  const found = {};
  header.forEach((cell, i) => {
    const name = String(cell ?? "").trim();
    for (const [key, patterns] of Object.entries(HEADERS)) {
      if (found[key] === undefined && patterns.some((re) => re.test(name))) found[key] = i;
    }
  });
  return found;
}

/** "Dana Whitfield" → first and last, when the sheet only has one name column. */
function splitName(whole) {
  const parts = String(whole ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts.at(-1) };
}

const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v ?? "").trim());

/** Whatever the sheet said about attending, reduced to the three Wix uses. */
function readStatus(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "ATTENDING";
  if (/^(no|not attending|declined|cancel)/.test(s)) return "NOT_ATTENDING";
  if (/wait/.test(s)) return "IN_WAITLIST";
  return "ATTENDING";
}

/**
 * Turn a pasted or uploaded CSV into people. Rows without a usable email are
 * returned separately rather than dropped silently — a sheet with the email
 * column mislabelled should say so, not import forty blanks.
 */
export function readCsv(raw) {
  const rows = parseCsv(raw);
  if (!rows.length) return { people: [], skipped: [], problem: "That file had no rows in it." };
  const cols = columnsFrom(rows[0]);
  if (cols.email === undefined) {
    return { people: [], skipped: [], problem: `No email column found. The first row reads: ${rows[0].slice(0, 8).join(", ")}` };
  }
  const people = [], skipped = [];
  const at = (row, i) => (i === undefined ? "" : text(row[i], 200));
  for (const row of rows.slice(1)) {
    const email = at(row, cols.email).toLowerCase();
    let first = at(row, cols.first), last = at(row, cols.last);
    if (!first && !last && cols.full !== undefined) ({ first, last } = splitName(at(row, cols.full)));
    if (!isEmail(email)) { skipped.push({ row: row.slice(0, 4).join(", "), why: email ? "not an email address" : "no email" }); continue; }
    people.push({
      first, last, email,
      phone: at(row, cols.phone),
      organization: at(row, cols.org),
      status: readStatus(at(row, cols.status)),
      source: "csv",
    });
  }
  return { people, skipped, problem: null };
}

/**
 * Fold a fresh list into the one already stored, matching on email.
 *
 * Wix owns the people it knows about: if someone cancels there, that has to win
 * here. But a person typed in by hand is not in Wix at all, and a sweep must
 * not take them away — so only Wix-sourced people are retired when Wix stops
 * mentioning them, and only on a sweep of that whole event.
 */
export function merge(existing, incoming, { source, authoritative = false, at = new Date().toISOString() } = {}) {
  const byEmail = new Map((existing ?? []).map((p) => [p.email, { ...p }]));
  const seen = new Set();
  let added = 0, changed = 0;

  for (const person of incoming) {
    if (!person.email) continue;
    seen.add(person.email);
    const had = byEmail.get(person.email);
    const next = { ...(had ?? {}), ...person, source: person.source ?? source, updatedAt: at };
    if (!had) { next.addedAt = at; added++; byEmail.set(person.email, next); continue; }
    const moved = ["first", "last", "phone", "organization", "status"].some((k) => (had[k] ?? "") !== (next[k] ?? ""));
    if (moved) changed++;
    byEmail.set(person.email, next);
  }

  // Someone Wix used to list and no longer does has withdrawn. Say so rather
  // than deleting them, so the count on screen still explains itself.
  let withdrawn = 0;
  if (authoritative) {
    for (const [email, person] of byEmail) {
      if (person.source === source && !seen.has(email) && person.status !== "WITHDRAWN") {
        byEmail.set(email, { ...person, status: "WITHDRAWN", updatedAt: at });
        withdrawn++;
      }
    }
  }
  return { people: [...byEmail.values()].sort(byName), added, changed, withdrawn };
}

const byName = (a, b) =>
  (a.last || a.first || a.email).localeCompare(b.last || b.first || b.email) ||
  (a.first || "").localeCompare(b.first || "");

/** The tally a screen shows: who is coming, who is not, where they came from. */
export function tally(people = []) {
  const is = (s) => people.filter((p) => p.status === s).length;
  return {
    total: people.length,
    attending: is("ATTENDING"),
    notAttending: is("NOT_ATTENDING"),
    waitlist: is("IN_WAITLIST"),
    withdrawn: is("WITHDRAWN"),
    fromWix: people.filter((p) => p.source === "wix").length,
    byHand: people.filter((p) => p.source !== "wix").length,
  };
}

/** Who a letter actually goes to: the people still coming, with an address. */
export const writeableTo = (people = []) =>
  people.filter((p) => p.status === "ATTENDING" && isEmail(p.email));
