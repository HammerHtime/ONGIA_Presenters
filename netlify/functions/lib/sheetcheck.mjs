import { sameName } from "./rooming.mjs";

/**
 * The logistics sheet check: what the spreadsheet said about each presenter's hotel nights,
 * held still, against what the presenters' agreements say now.
 *
 * The sheet is uploaded once, as it stood before anyone corrected it, and kept as a baseline
 * (only the name, agency and the Sunday-to-Thursday night cells are kept, never the notes).
 * The comparison is worked out fresh every time it is looked at, so a presenter who submits or
 * is approved shows up at once. The sheet is never changed and never read from SharePoint.
 */

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (isoDate, n) => iso(new Date(Date.parse(isoDate) + n * 86400000));
const clip = (s, n = 160) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** The Sunday on or before the first day: the sheet's "Sunday" column is that night. */
const weekStart = (dayOne) => addDays(dayOne, -new Date(Date.parse(dayOne)).getUTCDay());

/**
 * Rows of cell text (from the uploaded sheet) → the baseline: the header row is the one that has
 * "Presenter" and the weekday columns, and only the compared cells are kept.
 * Returns { rows, nights } or { problem }.
 */
export function parseLogistics(cells, event) {
  const grid = (Array.isArray(cells) ? cells : []).slice(0, 400).map((r) => (Array.isArray(r) ? r.slice(0, 60).map((c) => clip(c, 200)) : []));
  const at = grid.slice(0, 12).findIndex((r) => r.some((c) => /^presenter\b/i.test(c)) && r.filter((c) => WEEKDAYS.some((w) => new RegExp(`\\b${w}\\b`, "i").test(c))).length >= 3);
  if (at < 0) return { problem: "That doesn't look like the logistics sheet: I couldn't find a row with \"Presenter\" and the Sunday to Thursday accommodation columns." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event?.dayOne ?? "")) return { problem: "This event has no first day yet, so the nights can't be put on dates." };
  const head = grid[at];
  const nameCol = head.findIndex((c) => /^presenter\b/i.test(c));
  const agencyCol = head.findIndex((c) => /^agency\b/i.test(c));
  const start = weekStart(event.dayOne);
  const nightCols = [];
  head.forEach((c, i) => WEEKDAYS.forEach((w, d) => { if (new RegExp(`\\b${w}\\b`, "i").test(c) && /accom/i.test(c)) nightCols.push({ col: i, date: addDays(start, d), label: w }); }));
  if (nightCols.length < 3) return { problem: "I found the Presenter column but not the accommodation columns for Sunday to Thursday." };
  const rows = [];
  for (const r of grid.slice(at + 1)) {
    const name = clip(r[nameCol], 120);
    if (!name || /^presenter/i.test(name)) continue;
    rows.push({ name, agency: agencyCol >= 0 ? clip(r[agencyCol], 120) : "", nights: nightCols.map((n) => ({ date: n.date, text: clip(r[n.col], 120) })) });
  }
  if (!rows.length) return { problem: "I found the headings but no presenters under them." };
  return { rows, nights: nightCols.map((n) => n.date) };
}

/* ---------- names ---------- */
const TITLES = new Set(["dr", "doctor", "a", "s", "sgt", "sergeant", "det", "detective", "insp", "inspector", "cst", "const", "constable", "staff", "prof", "professor", "mr", "ms", "mrs", "crown", "keynote", "cpl", "corporal", "supt", "chief"]);
const tokens = (s) => sameName(String(s ?? "").replace(/\([^)]*\)/g, " ").replace(/[\/.]/g, " ")).split(" ").filter((t) => t && !TITLES.has(t));
function distance(a, b) {
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);   // two letters swapped is one slip
  }
  return d[m][n];
}
const close = (a, b) => a === b || (Math.min(a.length, b.length) >= 5 && distance(a, b) <= 2) || (Math.min(a.length, b.length) >= 3 && distance(a, b) <= 1);
/** How well a sheet name fits a desk name: "exact", "close" (a spelling slip), "surname" (one name only), or null. */
export function nameFit(deskName, sheetName) {
  const a = tokens(deskName), b = tokens(sheetName);
  if (!a.length || !b.length) return null;
  if (a.join(" ") === b.join(" ")) return "exact";
  const [la, lb] = [a.at(-1), b.at(-1)];
  if (!close(la, lb)) return null;
  if (b.length === 1 || a.length === 1) return "surname";
  const [fa, fb] = [a[0], b[0]];
  if (fa === fb) return la === lb ? "exact" : "close";
  if (close(fa, fb) || fa[0] === fb[0] && (fa.length === 1 || fb.length === 1)) return "close";
  return null;
}

/* ---------- the sheet's side ---------- */
const booked = (text) => /^\s*yes\b/i.test(text);
const agencyPaying = (text) => /agency\s*(is\s*)?pay/i.test(text);
function sheetSide(row) {
  const nights = row.nights.filter((n) => booked(n.text)).map((n) => n.date);
  return {
    nights,
    checkIn: nights[0] ?? null,
    checkOut: nights.length ? addDays(nights.at(-1), 1) : null,
    gaps: nights.length > 1 && nights.some((d, i) => i && Date.parse(d) - Date.parse(nights[i - 1]) !== 86400000),
    agencyPays: row.nights.some((n) => agencyPaying(n.text)),
  };
}

/* ---------- the desk's side ---------- */
const nightsBetween = (from, to) => {
  const out = [];
  for (let d = from; d < to && out.length < 40; d = addDays(d, 1)) out.push(d);
  return out;
};
function deskSide(p) {
  const s = p.submission ?? {};
  if (p.status === "approved") {
    const h = p.review?.hotel;
    return { state: "approved", at: p.approvedAt, room: Boolean(h), checkIn: h?.from ?? null, checkOut: h?.to ?? null, nights: h ? nightsBetween(h.from, h.to) : [],
      block: h ? (p.review?.hotel?.block ?? (p.review?.ongiaCovers?.hotel ? "master" : "own")) : null };
  }
  if (p.status === "submitted") {
    const room = s.hotel === "yes";
    return { state: "submitted", at: p.submittedAt, room, checkIn: room ? s.hotelFrom : null, checkOut: room ? s.hotelTo : null, nights: room ? nightsBetween(s.hotelFrom, s.hotelTo) : [], block: null,
      agencySaid: s.expenses?.hotel ?? null };
  }
  return { state: "waiting", at: null, room: null, checkIn: null, checkOut: null, nights: [], block: null };
}

const day = (d) => new Date(Date.parse(d)).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).replace(/,/g, "");
const list = (ds) => ds.map(day).join(", ").replace(/, ([^,]*)$/, " and $1");
const span = (a, b) => (a && b ? `${day(a)} → ${day(b)}` : "no room");

/**
 * Compare every presenter on the desk with the frozen sheet. `links` maps a presenter id to the exact
 * sheet name chosen by hand when the automatic match was wrong or missing.
 */
export function compareSheet({ baseline, presenters, links = {} }) {
  const sheetRows = baseline?.rows ?? [];
  const used = new Set();
  const matched = new Map();   // presenter id → { row, how }
  const byName = (n) => sheetRows.find((r) => r.name === n);
  for (const p of presenters) {
    const forced = links[p.id] && byName(links[p.id]);
    if (forced) { matched.set(p.id, { row: forced, how: "linked" }); used.add(forced.name); }
  }
  const deskName = (p) => `${p.first ?? ""} ${p.last ?? ""}`.trim();
  for (const pass of ["exact", "close", "surname"]) {
    for (const p of presenters) {
      if (matched.has(p.id)) continue;
      const hits = sheetRows.filter((r) => !used.has(r.name) && nameFit(deskName(p), r.name) === pass);
      if (hits.length === 1 && (pass !== "surname" || presenters.filter((q) => !matched.has(q.id) && nameFit(deskName(q), hits[0].name)).length === 1)) {
        matched.set(p.id, { row: hits[0], how: pass });
        used.add(hits[0].name);
      }
    }
  }

  const rows = presenters.map((p) => {
    const desk = deskSide(p), m = matched.get(p.id);
    const out = { id: p.id, name: deskName(p), agency: p.organization ?? "", desk, sheet: null, matchedAs: null, how: null, status: "", issues: [] };
    if (m) {
      const sh = sheetSide(m.row);
      out.sheet = { name: m.row.name, ...sh }; out.matchedAs = m.row.name; out.how = m.how;
    }
    if (desk.state === "waiting") {
      out.status = "waiting";
      if (out.sheet?.nights.length) out.issues.push({ kind: "info", text: `The sheet already has ${out.sheet.nights.length} night${out.sheet.nights.length === 1 ? "" : "s"} booked (${span(out.sheet.checkIn, out.sheet.checkOut)}), but ${p.first} hasn't submitted an agreement yet.` });
      return out;
    }
    if (!m) {
      out.status = "nosheet";
      out.issues.push({ kind: "info", text: desk.room ? `Not on the sheet. The agreement has a room ${span(desk.checkIn, desk.checkOut)}.` : "Not on the sheet." });
      return out;
    }
    const label = desk.state === "approved" ? "agreement" : "requested on the agreement";
    const sh = out.sheet;
    if (!desk.room && sh.nights.length) out.issues.push({ kind: "differs", text: `The sheet has a room ${span(sh.checkIn, sh.checkOut)}, but the ${desk.state === "approved" ? "agreement" : "presenter"} says no hotel is needed.` });
    else if (desk.room && !sh.nights.length) out.issues.push({ kind: "differs", text: `The ${label} has a room ${span(desk.checkIn, desk.checkOut)}, but the sheet has no nights booked.` });
    else if (desk.room) {
      const missing = desk.nights.filter((d) => !sh.nights.includes(d)), extra = sh.nights.filter((d) => !desk.nights.includes(d));
      if (missing.length) out.issues.push({ kind: "differs", text: `The sheet is missing ${list(missing)} (the ${label} has them).` });
      if (extra.length) out.issues.push({ kind: "differs", text: `The sheet has ${list(extra)}, which the ${label} doesn't.` });
      if (sh.gaps && !missing.length && !extra.length) out.issues.push({ kind: "check", text: "The sheet's nights have a gap in them." });
    }
    if (desk.room && desk.block === "master" && sh.agencyPays) out.issues.push({ kind: "differs", text: "The sheet says the agency is paying, but the agreement has the room on ONGIA's master block (ONGIA pays)." });
    if (desk.room && desk.block === "own" && !sh.agencyPays) out.issues.push({ kind: "check", text: "The agreement has them paying their own room; the sheet doesn't say the agency is paying." });
    out.status = out.issues.some((i) => i.kind === "differs") ? "differs" : out.issues.length ? "check" : "match";
    return out;
  });

  const sheetOnly = sheetRows.filter((r) => !used.has(r.name)).map((r) => ({ name: r.name, agency: r.agency, ...sheetSide(r) })).filter((r) => r.nights.length);
  const count = (s) => rows.filter((r) => r.status === s).length;
  return {
    rows: rows.sort((a, b) => ORDER[a.status] - ORDER[b.status] || String(b.desk.at ?? "").localeCompare(String(a.desk.at ?? ""))),
    sheetOnly,
    sheetNames: sheetRows.map((r) => r.name),
    counts: { differs: count("differs"), check: count("check"), match: count("match"), waiting: count("waiting"), nosheet: count("nosheet"), sheetOnly: sheetOnly.length },
  };
}
const ORDER = { differs: 0, check: 1, nosheet: 2, waiting: 3, match: 4 };
