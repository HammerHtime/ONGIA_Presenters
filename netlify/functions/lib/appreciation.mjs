import PDFDocument from "pdfkit";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { personFile } from "./filenames.mjs";

/**
 * The letter of appreciation that goes with each presenter's thank-you (Andrew 14 Nov 2026: "an attachment in PDF with
 * our letterhead … to whom it may concern … so presenters could print this off or forward it to their bosses, and they
 * get an official kind of kudos in their work file"). One page on the official letterhead (the logo and the navy
 * address band, taken from ONGIA_Letterhead.docx), Times, 1-inch margins, signed by the President. The words are
 * Andrew's (14 Nov 2026), and can be changed per event on the thank-you card.
 */
export const STANDARD_LETTER = `I am writing to recognize {name}, who presented “{talk}” at {event} in {city} on {date}.

ONGIA is a volunteer-led non-profit that provides training to police, corrections staff, educators, social workers and community partners across Canada. Our training addresses a wide range of issues affecting community safety and the people working to improve it. We bring people together to share what they know, learn from one another and take practical ideas back to the communities they serve.

Presenters such as {first} make this work possible. Preparing and delivering a session takes time and effort, often alongside an already demanding workload. It means taking time away from regular work commitments and, in many cases, travelling to share knowledge and experience with others. We recognize that commitment and do not take it for granted.

The value of this training comes from people like {first} who do the work and are willing to share what they have learned. Those experiences give others a chance to ask questions, consider a different approach and make connections with people facing similar challenges. By contributing to this event, {first} helped create that opportunity for our participants.

We are grateful to {first} for their preparation, professionalism and willingness to contribute, and to {organization} for supporting their participation. That support helps us continue offering practical, relevant training across the country.

We would appreciate having this letter placed on {first}’s personnel file in recognition of their contribution to ONGIA and the people we serve.`;

/**
 * The volunteer's letter (Andrew 16 Nov 2026: "thanking that volunteer for contributing their time and their away from
 * home … thanking their service for allowing the volunteer the time … onto their work file"). {attendees} is the
 * event's registrations rounded down to the 50 below, "550" for 562.
 */
export const VOLUNTEER_LETTER = `I am writing to recognize {name}, who volunteered at {event} in {city} on {date}.

The event brought together over {attendees} participants from the justice community and our community partners across Canada. An event of that size depends on its volunteers. {first} gave their own time and spent days away from home to make sure the event ran smoothly for participants and presenters.

Without the work, effort and professionalism of volunteers such as {first}, this event would not have been as successful as it was.

We are grateful to {organization} for allowing {first} the time to take part. That support makes it possible for ONGIA, a volunteer-led non-profit, to keep delivering practical training across the country.

We would appreciate having this letter placed on {first}’s personnel file in recognition of their contribution to ONGIA and the people we serve.`;

/**
 * A board member's letter for one event, for their employer (Andrew 16 Nov 2026: "tie it to an event specifically as
 * well as a thank you for (work) allowing them to be on the board").
 */
export const EVENT_BOARD_LETTER = `I am writing to recognize {name}, a member of the Board of Directors of ONGIA, for their work on {event} in {city} on {date}.

The event brought together over {attendees} participants from the justice community and our community partners across Canada. Our board plans and runs events like this one as volunteers, on top of their regular work. {first} helped make this one a success.

Thank you for allowing {first} to serve on ONGIA’s board. That support makes it possible for a volunteer-led non-profit like ONGIA to keep delivering practical training across the country.

We would appreciate having this letter placed on {first}’s personnel file in recognition of their contribution to ONGIA and the people we serve.`;

/** The board member's letter, for their employer (Andrew 16 Nov 2026), once a year from the Admin page. */
export const BOARD_LETTER = `I am writing to thank you for your continued support of {name}, who serves on the Board of Directors of ONGIA.

Over the past year, {first} has given their time and expertise to help ONGIA plan and deliver training across Canada. ONGIA has grown steadily over the last few years, and we continue to deliver important training to the justice community and our community partners. That growth depends on the people who serve on our board, and on the employers who make their participation possible.

Thank you for allowing {first} to take part in and contribute to ONGIA’s work this year.

We would appreciate having this letter placed on {first}’s personnel file in recognition of their contribution to ONGIA and the people we serve.`;

/** The blanks a letter may use. */
export const LETTER_BLANKS = ["name", "first", "talk", "event", "city", "date", "organization", "attendees", "year"];

/** Who signs: the template's own signature block. */
const SIGNER = ["Andrew Hammond", "416-230-9802", "President – ONGIA", "www.ongia.org"];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const full = (iso, weekday = false) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso ?? "")) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${weekday ? `${WEEKDAYS[dt.getUTCDay()]}, ` : ""}${MONTHS[m - 1]} ${d}, ${y}`;
};
/** "Victoria, BC" stays; a city typed with a street before it keeps only the last two parts. */
const cityOf = (e) => String(e?.city ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(-2).join(", ");
/** The event's name as a sentence carries it: "Canadian Forum … - Western Symposium" reads as typed. */
const eventOf = (e) => String(e?.title ?? "").trim();

/** "November 9 to 12, 2026", "October 30 to November 2, 2026", "December 30, 2026 to January 2, 2027". */
function spanOf(a, b) {
  const [ya, ma, da] = a.split("-").map(Number), [yb, mb, db] = String(b).split("-").map(Number);
  if (!yb) return full(a);
  if (ya !== yb) return `${full(a)} to ${full(b)}`;
  return ma === mb ? `${MONTHS[ma - 1]} ${da} to ${db}, ${ya}` : `${MONTHS[ma - 1]} ${da} to ${MONTHS[mb - 1]} ${db}, ${ya}`;
}

/** The values for one presenter. */
export function letterValues(event, p) {
  event = event ?? {};
  const day = p.talkDay || (!event.lastDay || event.lastDay === event.dayOne ? event.dayOne : "");
  return {
    name: `${p.first ?? ""} ${p.last ?? ""}`.trim(),
    first: String(p.first ?? "").trim() || `${p.first ?? ""} ${p.last ?? ""}`.trim(),
    talk: String(p.talk ?? "").replace(/^["“”']+|["“”']+$/g, "").trim(),
    event: eventOf(event),
    city: cityOf(event),
    date: day ? full(day, true) : event.dayOne ? spanOf(event.dayOne, event.lastDay) : "",
    span: !day && !!event.dayOne,
    organization: String(p.organization ?? "").trim().replace(/[\s,;:./-]+$/, ""),
    attendees: String(p.attendees ?? "").trim(),
    year: String(p.year ?? new Date().getFullYear()),
  };
}

/**
 * The words with the blanks filled. A blank with nothing for it is taken out with the words around it that only make
 * sense with it: no talk title, "who presented at…"; no city, no "in"; no organization, "their organization".
 */
export function fillLetter(body, v) {
  let t = String(body ?? "");
  if (!v.talk) t = t.replace(/\s*[“"]?\{talk\}[”"]?/g, "");
  if (!v.city) t = t.replace(/\s+in \{city\}/g, "").replace(/\s*\{city\}/g, "");
  if (!v.date) t = t.replace(/\s+on \{date\}/g, "").replace(/\s*\{date\}/g, "");
  // Several days read "from November 9 to 12, 2026", not "on …".
  if (v.span) t = t.replace(/\bon \{date\}/g, "from {date}");
  if (!v.organization) t = t.replace(/\{organization\}/g, "their organization");
  if (!v.attendees) t = t.replace(/\s*over \{attendees\}/g, "").replace(/\s*\{attendees\}/g, "");
  return t.replace(/\{([a-zA-Z]+)\}/g, (w, k) => (k in v ? v[k] : w));
}

/** Anything wrong with the words: a blank that isn't one. */
export function letterWordsProblems(body) {
  const out = [];
  for (const [, k] of String(body ?? "").matchAll(/\{([a-zA-Z0-9]+)\}/g)) if (!LETTER_BLANKS.includes(k)) out.push(`{${k}} is not a blank the letter knows. It can use ${LETTER_BLANKS.map((b) => `{${b}}`).join(", ")}.`);
  if (!String(body ?? "").trim()) out.push("The letter has no words in it.");
  return [...new Set(out)];
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSET_DIRS = [path.resolve(HERE, "../../../public/assets"), path.resolve(HERE, "../../public/assets"), path.resolve(process.cwd(), "public/assets"), "/var/task/public/assets"];
const ASSETS = () => ASSET_DIRS.find((d) => existsSync(path.join(d, "letterhead-top.png"))) ?? ASSET_DIRS[0];

/** A file name for one presenter's letter. */
export const letterFileName = (p, on = "") => personFile(p, "Letter of appreciation", on);

/** The PDF for one presenter. `on` is the letter's date (the day it goes). */
/** `signer` is the signature block's lines (the President's by default); `signature` his handwritten one, only for him. */
export async function appreciationPdf(event, p, { body = STANDARD_LETTER, on = new Date().toISOString().slice(0, 10), signature = null, signer = SIGNER } = {}) {
  const [top, band] = await Promise.all(["letterhead-top.png", "letterhead-band.png"].map((f) => readFile(path.join(ASSETS(), f)).catch(() => null)));
  const v = letterValues(event, p);
  const W = 612, H = 792, M = 72, BODY = W - M * 2;
  const doc = new PDFDocument({ size: "LETTER", margin: 0, autoFirstPage: false, displayTitle: true,
    info: { Title: `Letter of appreciation: ${v.name}`, Author: "ONGIA", Subject: v.event } });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  doc.addPage();
  // The letterhead: the logo centred at the top, the navy address band across the foot (as in the Word template).
  if (top) doc.image(top, (W - 300) / 2, 30, { width: 300 });
  if (band) doc.image(band, 0, H - 91, { width: W });
  const ink = "#111111";
  let size = 12;
  const paras = fillLetter(body, v).replace(/\r/g, "").split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  // One page: the type comes down a little for longer words rather than spilling onto a second page.
  const room = H - 100 - 150;
  const height = (sz) => { doc.font("Times-Roman").fontSize(sz); return paras.reduce((n, t) => n + doc.heightOfString(t, { width: BODY, lineGap: 1.5 }) + sz * 0.8, 0) + sz * 14; };
  while (size > 10 && height(size) > room) size -= 0.5;
  let y = 132;
  doc.font("Times-Roman").fontSize(size).fillColor(ink).text(full(on), M, y); y = doc.y + size;
  doc.font("Times-Bold").text(`Re: Letter of appreciation for ${v.name}${v.organization ? `, ${v.organization}` : ""}`, M, y, { width: BODY }); y = doc.y + size * 0.8;
  doc.font("Times-Roman");
  for (const t of paras) { doc.text(t, M, y, { width: BODY, lineGap: 1.5 }); y = doc.y + size * 0.8; }
  doc.text("Sincerely,", M, y);
  // Andrew's handwritten signature (Andrew 14 Nov 2026: "you can use my signature"), kept in the desk's own store,
  // never in the public repository. Without it, the space for a wet signature.
  if (signature) { try { doc.image(signature, M - 4, doc.y + 2, { width: 106 }); y = doc.y + 2 + 50; } catch { y = doc.y + size * 2.6; } }
  else y = doc.y + size * 2.6;
  for (const line of signer) { doc.text(line, M, y); y = doc.y; }
  doc.end();
  return done;
}
