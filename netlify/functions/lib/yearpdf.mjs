import PDFDocument from "pdfkit";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { shiftOn } from "./myschedule.mjs";

/**
 * The year as a wall calendar, one month a page (Andrew 27–28 Nov 2026: "a full 12 month calendar each page is a month
 * showing all the events … like I'm looking at a wall calendar … to find space to plan events or to move events
 * around"). Every event: ONGIA-led in navy, RBH in teal, external conferences in gold, each a bar across its days with its
 * name, city and who's going. The viewer's own schedule (lib/myschedule.mjs) sits in the top right corner of each day.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSET_DIRS = [path.resolve(HERE, "../../../public/assets"), path.resolve(HERE, "../../public/assets"), path.resolve(process.cwd(), "public/assets"), "/var/task/public/assets"];
const ASSETS = ASSET_DIRS.find((d) => existsSync(path.join(d, "ongia-logo-tagline-dark.png"))) ?? ASSET_DIRS[0];

const W = 792, H = 612, MX = 32, TOP = 28;
const NAVY = "#1a2f5e", NAVY_DEEP = "#0e1a35", GOLD = "#b8922a", INK = "#0e1a35", GREY = "#6b6f78", LINE = "#d9d4c4", LINE2 = "#e6e1d3";
const KIND = { ongia: { bg: NAVY, fg: "#ffffff" }, rbh: { bg: "#1f6f6a", fg: "#ffffff" }, ext: { bg: GOLD, fg: "#1c1608" } };
const CLASH = "#d0342c";
const SHIFT = { D: { bg: "#fbe7b5", fg: "#6b4a00" }, N: { bg: "#2b2f45", fg: "#ffffff" }, O: { bg: "#e3efe0", fg: "#2f6b3a" } };
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const ms = (s) => Date.parse(`${s}T00:00:00Z`);

/** Everything on the calendar: events (not practice ones, not projects) and the conferences. */
export function calendarItems(events, confs = []) {
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""));
  const first = (n) => String(n ?? "").trim().split(/\s+/)[0];
  return [
    ...events.filter((e) => ok(e.dayOne) && !e.practice && !e.project).map((e) => ({ kind: e.kind === "rbh" ? "rbh" : "ongia", title: String(e.title ?? ""),
      place: String(e.city ?? "").replace(/,\s*[A-Z]{2}$/, ""), from: e.dayOne, to: ok(e.lastDay) && e.lastDay >= e.dayOne ? e.lastDay : e.dayOne,
      who: [...(e.board ?? [])].sort((a, b) => !!b.lead - !!a.lead).map((m) => first(m.name || String(m.email ?? "").split("@")[0])).filter(Boolean) })),
    ...confs.filter((c) => ok(c.from)).map((c) => ({ kind: "ext", title: String(c.title ?? ""), place: String(c.place ?? ""), from: c.from, to: ok(c.to) && c.to >= c.from ? c.to : c.from, who: [] })),
  ].sort((a, b) => a.from.localeCompare(b.from) || a.title.localeCompare(b.title));
}

/**
 * An event on a day I work (Andrew 28 Nov 2026: "add the red edge for clashes"): any of its days is a D or an N on the
 * schedule. The whole bar gets the edge, on every week it crosses.
 */
export function clashes(item, schedule) {
  if (!schedule?.pattern) return false;
  for (let t = ms(item.from); t <= ms(item.to); t += DAY) if (["D", "N"].includes(shiftOn(schedule, iso(t)))) return true;
  return false;
}

/** The weeks (Sunday first) a month's page shows: 5 or 6 rows of 7 days. */
export function monthWeeks(year, m) {
  const first = Date.UTC(year, m, 1), last = Date.UTC(year, m + 1, 0);
  let d = first - new Date(first).getUTCDay() * DAY;
  const weeks = [];
  while (d <= last) { weeks.push(Array.from({ length: 7 }, (_, i) => iso(d + i * DAY))); d += 7 * DAY; }
  return weeks;
}

export async function buildYearPdf({ year, items, schedule = null, printed = "" }) {
  const logo = await readFile(path.join(ASSETS, "ongia-logo-tagline-dark.png")).catch(() => null);
  const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 0, displayTitle: true, info: { Title: `ONGIA calendar ${year}`, Author: "ONGIA", Subject: `ONGIA events, ${year}` } });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  for (let m = 0; m < 12; m++) { if (m) doc.addPage(); drawMonth(doc, { year, m, items, schedule, logo, printed }); }
  doc.end();
  return done;
}

function drawMonth(doc, { year, m, items, schedule, logo, printed }) {
  const mStart = iso(Date.UTC(year, m, 1)), mEnd = iso(Date.UTC(year, m + 1, 0));
  const inMonth = items.filter((i) => i.to >= mStart && i.from <= mEnd);
  // Header: the logo on navy, the month on the right, a gold rule.
  doc.roundedRect(MX, TOP, 116, 34, 5).fill(NAVY_DEEP);
  if (logo) doc.image(logo, MX + 8, TOP + 5, { fit: [100, 24], valign: "center" });
  doc.font("Times-Roman").fontSize(28);
  const yr = String(year), yw = doc.widthOfString(yr), mw = doc.widthOfString(`${MONTHS[m]} `);
  doc.fillColor(GOLD).text(yr, W - MX - yw, TOP, { lineBreak: false });
  doc.fillColor(NAVY).text(`${MONTHS[m]} `, W - MX - yw - mw, TOP, { lineBreak: false });
  doc.font("Helvetica").fontSize(9).fillColor(GREY).text(inMonth.length ? `${inMonth.length} event${inMonth.length > 1 ? "s" : ""}` : "No events", MX, TOP + 31, { width: W - MX * 2, align: "right" });
  doc.moveTo(MX, TOP + 46).lineTo(W - MX, TOP + 46).lineWidth(2).strokeColor(GOLD).stroke();

  const gx = MX, gw = W - MX * 2, cw = gw / 7, gy = TOP + 66, gh = H - 30 - gy;
  doc.font("Helvetica-Bold").fontSize(7).fillColor(GREY);
  DOW.forEach((d, k) => doc.text(d, gx + k * cw + 5, gy - 11, { characterSpacing: 1, lineBreak: false }));
  const weeks = monthWeeks(year, m), rh = gh / weeks.length;

  weeks.forEach((w, r) => {
    const y = gy + r * rh;
    w.forEach((d, k) => {
      const x = gx + k * cw, out = d < mStart || d > mEnd;
      const bg = out ? "#f3f1ea" : k === 0 || k === 6 ? "#faf8f2" : "#ffffff";
      doc.rect(x, y, cw, rh).fill(bg);
      doc.font("Helvetica-Bold").fontSize(9).fillColor(out ? "#b7b2a3" : INK).text(String(+d.slice(8)), x + 5, y + 4, { lineBreak: false });
      const s = shiftOn(schedule, d);
      if (s && SHIFT[s]) {
        doc.save(); if (out) doc.opacity(0.45);
        doc.roundedRect(x + cw - 17, y + 3, 13, 12, 2).fill(SHIFT[s].bg);
        doc.font("Helvetica-Bold").fontSize(7.5).fillColor(SHIFT[s].fg).text(s, x + cw - 17, y + 5.5, { width: 13, align: "center", lineBreak: false });
        doc.restore();
      }
    });
  });
  // Grid lines over the fills, under the bars.
  doc.lineWidth(0.5).strokeColor(LINE2);
  for (let k = 1; k < 7; k++) doc.moveTo(gx + k * cw, gy).lineTo(gx + k * cw, gy + gh).stroke();
  doc.strokeColor(LINE);
  for (let r = 1; r < weeks.length; r++) doc.moveTo(gx, gy + r * rh).lineTo(gx + gw, gy + r * rh).stroke();
  doc.roundedRect(gx, gy, gw, gh, 4).lineWidth(0.8).strokeColor(LINE).stroke();

  weeks.forEach((w, r) => {
    const y = gy + r * rh;
    // The events this week, each in the first lane it fits.
    const bars = items.filter((i) => i.to >= w[0] && i.from <= w[6]).map((i) => ({ i, a: i.from < w[0] ? 0 : w.indexOf(i.from), b: i.to > w[6] ? 6 : w.indexOf(i.to), cont: i.from < w[0], more: i.to > w[6] }));
    const lanes = [];
    for (const x of bars) { let l = 0; while (lanes[l]?.some((y2) => !(x.b < y2.a || x.a > y2.b))) l++; (lanes[l] ??= []).push(x); x.lane = l; }
    let ly = y + 18, hidden = 0;
    lanes.forEach((lane) => {
      const hs = lane.map((x) => barHeight(doc, x, cw));
      const lh = Math.max(...hs);
      if (ly + lh > y + rh - 2) { hidden += lane.length; return; }
      lane.forEach((x) => drawBar(doc, x, gx, cw, ly, lh, mStart, mEnd, clashes(x.i, schedule)));
      ly += lh + 2;
    });
    if (hidden) doc.font("Helvetica-Bold").fontSize(7).fillColor(GREY).text(`+${hidden} more`, gx + 5, y + rh - 10, { lineBreak: false });
  });
  // Footer: the key, the schedule's key, the page.
  const fy = H - 22;
  let fx = MX;
  const key = (bg, label, fg = null, letter = "") => {
    doc.roundedRect(fx, fy - 1, 9, 9, 1.5).fill(bg);
    if (letter) doc.font("Helvetica-Bold").fontSize(6.5).fillColor(fg).text(letter, fx, fy + 0.8, { width: 9, align: "center", lineBreak: false });
    doc.font("Helvetica").fontSize(7.5).fillColor(GREY).text(label, fx + 12, fy, { lineBreak: false });
    fx += 12 + doc.widthOfString(label) + 12;
  };
  key(KIND.ongia.bg, "ONGIA-led"); key(KIND.rbh.bg, "RBH"); key(KIND.ext.bg, "External conference");
  if (schedule?.pattern) { fx += 14; key(SHIFT.D.bg, "Days", SHIFT.D.fg, "D"); key(SHIFT.N.bg, "Nights", SHIFT.N.fg, "N"); key(SHIFT.O.bg, "Off", SHIFT.O.fg, "O");
    fx += 6; doc.roundedRect(fx + 0.8, fy - 0.2, 7.4, 7.4, 1.5).lineWidth(1.6).strokeColor(CLASH).stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor(GREY).text("On a day I work", fx + 12, fy, { lineBreak: false }); }
  doc.font("Helvetica").fontSize(7.5).fillColor(GREY).text(`ONGIA Briefing Room${printed ? ` · printed ${printed}` : ""} · page ${m + 1} of 12`, MX, fy, { width: W - MX * 2, align: "right", lineBreak: false });
}

const TITLE = 8, SUB = 7;
function lines(x) { return [x.i.place, x.i.who.length ? x.i.who.join(", ") : ""].filter(Boolean); }
function barHeight(doc, x, cw) {
  const w = (x.b - x.a + 1) * cw - 6 - 10;
  doc.font("Helvetica-Bold").fontSize(TITLE);
  const th = Math.min(doc.heightOfString(x.i.title, { width: w }), TITLE * 1.2 * 2);
  return 4 + th + lines(x).length * (SUB * 1.2) + 3;
}
function drawBar(doc, x, gx, cw, y, h, mStart, mEnd, clash = false) {
  const left = gx + x.a * cw + (x.cont ? 0 : 3), right = gx + (x.b + 1) * cw - (x.more ? 0 : 3), w = right - left;
  const c = KIND[x.i.kind] ?? KIND.ongia;
  doc.save();
  if (x.i.to < mStart || x.i.from > mEnd) doc.opacity(0.4);
  doc.roundedRect(left, y, w, h, 3).fill(c.bg);
  if (x.cont) doc.rect(left, y, 4, h).fill(c.bg);
  if (x.more) doc.rect(right - 4, y, 4, h).fill(c.bg);
  // On a work day: a red edge inside the bar, open where it carries on into the next or last week.
  if (clash) {
    const t = 1.8, r = 3, i = t / 2;
    doc.lineWidth(t).strokeColor(CLASH).lineJoin("round");
    if (!x.cont && !x.more) doc.roundedRect(left + i, y + i, w - t, h - t, r).stroke();
    else {
      const L = left + (x.cont ? 0 : i), R = right - (x.more ? 0 : i), T = y + i, B = y + h - i;
      doc.moveTo(L, T).lineTo(R, T).stroke(); doc.moveTo(L, B).lineTo(R, B).stroke();
      if (!x.cont) doc.moveTo(L, T).lineTo(L, B).stroke();
      if (!x.more) doc.moveTo(R, T).lineTo(R, B).stroke();
    }
  }
  const tw = w - 10;
  doc.font("Helvetica-Bold").fontSize(TITLE).fillColor(c.fg);
  const th = Math.min(doc.heightOfString(x.i.title, { width: tw }), TITLE * 1.2 * 2);
  doc.text(x.i.title, left + 5, y + 3, { width: tw, height: th + 0.5, ellipsis: true, lineGap: 0 });
  let ty = y + 3 + th;
  lines(x).forEach((t, n) => {
    doc.font(n === 1 || !x.i.place ? "Helvetica-Oblique" : "Helvetica").fontSize(SUB).fillColor(c.fg).text(t, left + 5, ty, { width: tw, height: SUB * 1.2, ellipsis: true, lineBreak: false });
    ty += SUB * 1.2;
  });
  doc.restore();
}
