import { formatDate } from "./deadlines.mjs";
import { layout, coordinatorOf } from "./mail.mjs";
import { fitsTitle } from "./titles.mjs";

/**
 * Letters Andrew writes once and reuses: the welcome letter and the survey.
 *
 * A letter is plain text with blanks in curly brackets. The blanks are filled
 * from the event and from the person it is going to, so "Welcome to {event}"
 * works for every training of the same kind on any date.
 *
 * Three rules keep a letter from going out wrong:
 *  - A blank nobody recognises ({evnet}) is refused, not sent as written.
 *  - A blank the event has nothing for — {surveyLink} with no survey link — is
 *    refused for that event, with the reason.
 *  - A line in square brackets is a note to self ("[add parking here]"), and a
 *    letter that still has one does not go.
 */

/** Every blank a letter may use, what it means, and where its value comes from. */
export const BLANKS = {
  first:      { means: "the person's first name (\"there\" if Wix has none)", from: (e, p) => p?.first || "there", optional: true },
  event:      { means: "the event's title", from: (e) => e.title },
  dates:      { means: "the training dates, e.g. Tue 24 Nov 2026", from: (e) => datesOf(e) },
  venue:      { means: "the venue", from: (e) => e.venue },
  city:       { means: "the city", from: (e) => e.city },
  lead:       { means: "the ONGIA lead for the event", from: (e) => e.contact?.name || e.reviewer?.name },
  hotel:      { means: "the hotel's name", from: (e) => e.hotel?.name },
  hotelLink:  { means: "the hotel booking link", from: (e) => e.hotel?.link, link: true },
  cutoff:     { means: "the room block cut-off date", from: (e) => (e.hotel?.cutoff ? formatDate(e.hotel.cutoff) : "") },
  rate:       { means: "the room rate", from: (e) => e.hotel?.rate },
  surveyLink: { means: "the survey link for this event", from: (e) => e.surveyLink, link: true },
};

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Day n of the event, written the way a schedule reads: "Monday, September 28". */
export function dayOfEvent(e, n) {
  if (!e?.dayOne) return "";
  const [y, m, d] = e.dayOne.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n - 1));
  return `${WEEKDAY[dt.getUTCDay()]}, ${MONTH[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
}

/** How many days the event runs, first and last included. */
export const lengthOf = (e) => (e?.dayOne ? Math.round((Date.parse(e.lastDay || e.dayOne) - Date.parse(e.dayOne)) / 86400000) + 1 : 0);

for (let n = 1; n <= 7; n++) {
  BLANKS[`day${n}`] = { means: `day ${n} of the event, e.g. "Monday, September 28"`, from: (e) => dayOfEvent(e, n), day: n };
}

export function datesOf(e) {
  if (!e?.dayOne) return "";
  if (!e.lastDay || e.lastDay === e.dayOne) return formatDate(e.dayOne);
  // "Mon 9 Nov – Thu 12 Nov 2026" rather than repeating the year.
  const a = formatDate(e.dayOne), b = formatDate(e.lastDay);
  return a.slice(-4) === b.slice(-4) ? `${a.slice(0, -5)} – ${b}` : `${a} – ${b}`;
}

// A letter then letters or digits: {day3} has to match as well as {event}.
const BLANK = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;
const NOTE = /^\s*\[[^\]]*\]\s*$/;

/** Everything wrong with a letter on its own, before any event is involved. */
export function letterProblems(letter) {
  const out = [];
  const all = `${letter.subject ?? ""}\n${letter.body ?? ""}\n${letter.buttonLink ?? ""}`;
  for (const [, name] of all.matchAll(BLANK)) {
    if (!BLANKS[name]) out.push(`{${name}} is not a blank the desk knows. Check the spelling against the list.`);
  }
  for (const line of String(letter.body ?? "").split("\n")) {
    if (NOTE.test(line)) out.push(`Still has a note to fill in: ${line.trim()}`);
  }
  if (!String(letter.subject ?? "").trim()) out.push("It needs a subject line.");
  if (!String(letter.body ?? "").trim()) out.push("It has no words in it.");
  if (letter.buttonLink && !letter.buttonLabel) out.push("The button has a link but no words on it.");
  return [...new Set(out)];
}

/** A letter written for one kind of training (see titles.mjs) goes to those events only. */
export const fitsEvent = (letter, event) => fitsTitle(letter?.onlyFor, event?.title);

/** What a particular event is missing for this letter to be filled in. */
export function eventProblems(letter, event) {
  const out = [];
  if (!fitsEvent(letter, event)) {
    // Nothing else matters: this letter is not for this event at all.
    return [`This letter is only for events with "${String(letter.onlyFor).trim()}" in the title, and ${event.title || "this event"} is not one.`];
  }
  const all = `${letter.subject ?? ""}\n${letter.body ?? ""}\n${letter.buttonLink ?? ""}`;
  for (const [, name] of all.matchAll(BLANK)) {
    const b = BLANKS[name];
    if (!b || b.optional) continue;
    if (b.day && b.day > lengthOf(event)) {
      out.push(`Uses {${name}}, but ${event.title || "this event"} only runs ${lengthOf(event)} day${lengthOf(event) === 1 ? "" : "s"}.`);
      continue;
    }
    const v = String(b.from(event, null) ?? "").trim();
    if (!v) out.push(`Uses {${name}} (${b.means}), and ${event.title || "this event"} has none set.`);
    else if (b.link && !/^https?:\/\//i.test(v)) out.push(`{${name}} on ${event.title} is not a web address.`);
  }
  return [...new Set(out)];
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Fill the blanks. `html` escapes everything and turns web addresses into links. */
function fill(text, event, person, { html }) {
  return String(text ?? "").replace(BLANK, (whole, name) => {
    const b = BLANKS[name];
    if (!b) return whole;
    const v = String(b.from(event, person) ?? "");
    if (!html) return v;
    return b.link && /^https?:\/\//i.test(v) ? `<a href="${esc(v)}" style="word-break:break-all;overflow-wrap:anywhere">${esc(v)}</a>` : esc(v);
  });
}

/** Escape Andrew's own words, keep the links he typed clickable. */
function htmlOf(text, event, person) {
  // Split on blanks first so their values are escaped once, by fill().
  const parts = String(text).split(BLANK);
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) { out += fill(`{${parts[i]}}`, event, person, { html: true }); continue; }
    // A long address — a Drive folder, say — must wrap inside the card on a
    // phone rather than run off its edge.
    out += esc(parts[i]).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" style="word-break:break-all;overflow-wrap:anywhere">${u}</a>`);
  }
  return out;
}

/**
 * How a letter is laid out, using conventions Andrew already writes in:
 *  - a blank line starts a new block
 *  - a block that is one line in CAPITALS is a section heading
 *  - a line starting with *, - or • is a bullet; bullets next to each other are a list
 *  - a line that is only a day blank, like {day3}, is that day's heading
 * Anything else is an ordinary paragraph, with its line breaks kept.
 */
const BULLET = /^\s*[*\-•]\s+/;
const DAYLINE = /^\s*\{day[1-7]\}\s*$/;
const isCaps = (line) => /[A-Z]{3}/.test(line) && !/[a-z]/.test(line.replace(BLANK, "")) && line.trim().length <= 60;

function blocksOf(body) {
  return String(body ?? "").replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const lines = p.split("\n").map((l) => l.trimEnd());
    if (lines.length === 1 && isCaps(lines[0]) && !BULLET.test(lines[0])) return { type: "heading", text: lines[0].trim() };
    // Split the block into runs of bullets and runs of ordinary lines.
    const runs = [];
    for (const line of lines) {
      const bullet = BULLET.test(line);
      const last = runs[runs.length - 1];
      if (last && last.bullet === bullet) last.lines.push(bullet ? line.replace(BULLET, "") : line);
      else runs.push({ bullet, lines: [bullet ? line.replace(BULLET, "") : line] });
    }
    return { type: "block", runs };
  });
}

const H = {
  heading: "margin:26px 0 10px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#b8922a;font-weight:700;border-bottom:1px solid #ddd7c8;padding-bottom:6px",
  day: "display:block;font-size:16px;font-weight:700;color:#1a2f5e;margin:0 0 2px",
  p: "margin:0 0 14px;line-height:1.55",
  ul: "margin:4px 0 16px;padding-left:20px;line-height:1.5",
  li: "margin:0 0 5px",
};

function bodyHtmlOf(body, event, person) {
  return blocksOf(body).map((b) => {
    if (b.type === "heading") return `<h2 style="${H.heading}">${htmlOf(b.text, event, person)}</h2>`;
    return b.runs.map((run) => {
      if (run.bullet) return `<ul style="${H.ul}">${run.lines.map((l) => `<li style="${H.li}">${htmlOf(l, event, person)}</li>`).join("")}</ul>`;
      const parts = run.lines.map((l) => (DAYLINE.test(l) ? `<strong style="${H.day}">${htmlOf(l.trim(), event, person)}</strong>` : htmlOf(l, event, person)));
      // A day heading is followed by its description with no <br> between: the
      // heading is already its own line.
      let out = "";
      parts.forEach((part, i) => { out += part; if (i < parts.length - 1 && !DAYLINE.test(run.lines[i])) out += "<br>"; });
      return `<p style="${H.p}">${out}</p>`;
    }).join("");
  }).join("");
}

function bodyTextOf(body, event, person) {
  return blocksOf(body).map((b) => {
    if (b.type === "heading") return fill(b.text, event, person, { html: false }).toUpperCase();
    return b.runs.map((run) => run.lines.map((l) => (run.bullet ? "  • " : "") + fill(l, event, person, { html: false })).join("\n")).join("\n");
  }).join("\n\n");
}

/** The finished email for one person. */
export function renderLetter(letter, event, person) {
  const subject = fill(letter.subject, event, person, { html: false }).trim();
  const href = letter.buttonLink ? fill(letter.buttonLink, event, person, { html: false }).trim() : "";
  const buttons = href && /^https?:\/\//i.test(href) ? [{ href, label: letter.buttonLabel || "Open" }] : [];
  const contact = coordinatorOf(event);
  const html = layout({ heading: subject, bodyHtml: bodyHtmlOf(letter.body, event, person), buttons, contact, event });
  const text = [
    subject, "",
    bodyTextOf(letter.body, event, person),
    href ? `\n${letter.buttonLabel || "Link"}: ${href}` : "",
    contact?.name ? `\n--\n${contact.name}\nONGIA${contact.email ? `\n${contact.email}` : ""}${contact.phone ? `\n${contact.phone}` : ""}` : "",
  ].join("\n");
  return { subject, html, text };
}

/**
 * Where a desk starts. Deliberately nothing in them that only Andrew knows —
 * no start times, no parking, no room numbers. He adds those; until he does, a
 * bracketed note stops the letter going.
 */
export const STARTER_LETTERS = [
  {
    kind: "welcome",
    name: "Welcome letter",
    subject: "Welcome to {event}",
    body: [
      "Hello {first},",
      "Thank you for registering for {event}. We're glad you're coming.",
      "The training runs {dates} at {venue} in {city}.",
      "[Add arrival time, parking and anything people should bring, then delete this line.]",
      "If your plans change and you can't make it, reply to this email and let us know.",
      "See you in {city}.",
    ].join("\n\n"),
    buttonLabel: "",
    buttonLink: "",
  },
  {
    kind: "survey",
    name: "Survey",
    subject: "How was {event}?",
    body: [
      "Hello {first},",
      "Thank you for joining us at {event}.",
      "We'd like to know what worked and what we should change. Please take a few minutes to tell us.",
      "Thanks again for coming.",
    ].join("\n\n"),
    buttonLabel: "Take the survey",
    buttonLink: "{surveyLink}",
  },
];
