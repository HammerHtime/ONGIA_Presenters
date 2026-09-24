import PDFDocument from "pdfkit";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { formatDate } from "./deadlines.mjs";

/**
 * The final Presenter Agreement as a PDF — the same two-page shape as the
 * document ONGIA sends today, with ONGIA's own banner and footer band, and
 * nothing left blank. Generated once, at approval, from the presenter's
 * submission plus the board member's cost decision.
 *
 * pdfkit rather than headless Chrome: deterministic, fast, and it fits in a
 * serverless function without a 50MB browser.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Locally this file sits at netlify/functions/lib/; in the deployed bundle
// esbuild flattens it into /var/task/netlify/functions/<fn>.mjs and the
// included assets land at /var/task/public/assets. Try both shapes.
const ASSET_DIRS = [
  path.resolve(HERE, "../../../public/assets"),
  path.resolve(HERE, "../../public/assets"),
  path.resolve(process.cwd(), "public/assets"),
  "/var/task/public/assets",
];
const ASSETS = ASSET_DIRS.find((d) => existsSync(path.join(d, "ongia-banner.jpg"))) ?? ASSET_DIRS[0];
// Typed signatures are drawn in a script face (Great Vibes, SIL Open Font Licence; see assets/fonts/OFL-GreatVibes.txt).
const SCRIPT_FONT = path.join(ASSETS, "fonts", "GreatVibes-Regular.ttf");

// Letter, in points.
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 42;
const BODY_W = PAGE_W - MARGIN * 2;
// The footer band sits on every page; nothing may be drawn over it. Content that
// runs past BOTTOM moves to a new page instead of spilling (long bios did that).
const BAND_H = (85 / 1241) * PAGE_W;
const TOP = 18;
const BOTTOM = PAGE_H - BAND_H - 6;

// ONGIA's palette.
const INK = "#12161f";
const GOLD = "#b8922a";
const NAVY = "#1a2f5e";
const RED = "#a33328";
const MUTED = "#4a5563";
const RULE = "#9aa2b1";


async function assets() {
  const [banner, band] = await Promise.all([
    readFile(path.join(ASSETS, "ongia-banner.jpg")),
    readFile(path.join(ASSETS, "ongia-band.jpg")),
  ]);
  return { banner, band };
}

const fmt = (v) => (v ? formatDate(v) : "");
const yes = (v) => v === "yes";

/** Build the PDF and resolve to a Buffer. */
export async function buildAgreementPdf({ event, presenter, approval, headshot, preview = false }) {
  const { banner, band } = await assets();
  const s = presenter.submission;
  const review = presenter.review ?? { ongiaCovers: {} };

  const doc = new PDFDocument({ size: "LETTER", margin: 0, info: {
    Title: `${preview ? "DRAFT " : ""}${presenter.last}_Presenter Agreement`,
    Author: "ONGIA Presenter Agreement Desk",
    Subject: `${event.title} — presenter agreement, ${presenter.first} ${presenter.last}`,
  }});
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const finished = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const p = new Painter(doc, band, preview);
  if (existsSync(SCRIPT_FONT)) { doc.registerFont("Script", SCRIPT_FONT); p.script = true; }

  /* ------------------------------------------------------------ page one */
  // Banner: 1056×288 source scaled to the full page width.
  const bannerH = (288 / 1056) * PAGE_W;
  doc.image(banner, 0, 0, { width: PAGE_W });
  p.y = bannerH + 8;
  if (preview) p.ribbon();

  p.heading("EVENT DETAILS");
  p.kvRow([
    ["Location (City):", event.city, 150],
    ["Event Title:", event.title, 160],
  ]);
  p.kvRow([["Address:", event.venue || event.city, 330]]);
  p.kvRow([
    ["Anticipated Presentation Date/Time:", fmt(event.dayOne), 100],
    ["Time Slot:", presenter.timeSlot || "To be confirmed", 110],
  ]);

  // The presenter's own photo sits beside their details, the way it does on the
  // programme. The rows narrow while it is there so nothing runs underneath it.
  const photoTop = p.y + 3;
  p.heading("PRESENTER INFORMATION");
  if (headshot?.bytes?.byteLength) p.photo(headshot.bytes, { top: photoTop, w: 84, h: 104 });
  p.kvRow([
    ["Name:", `${presenter.first} ${presenter.last}`, 160],
    ["Contact #:", s.phone || "—", 110],
  ]);
  p.kvRow([["Organization:", presenter.organization || "—", 330]]);
  p.kvRow([["Email:", presenter.email, 330]]);
  p.kvRow([["Presentation Title:", s.talk, 330]]);

  p.gap(4);
  p.label("Biography (250–300 words)", true);
  p.label("(This biography may be used to introduce you at the ONGIA event)");
  p.clearPhoto();
  p.box(s.bio);

  p.heading("PRESENTATION INFORMATION");
  p.para(
    "ONGIA training events may include a combination of in-person, virtual, and hybrid formats, providing " +
    "flexible participation options. As with all ONGIA training events, organizers require presenters to prepare " +
    `a syllabus and adhere to a standard presentation time allotment of ${event.sessionMinutes ?? 70} minutes. ` +
    "This allotment may vary depending on the event schedule; presenters will be notified in advance should any " +
    "adjustments be required. Presenters may also be asked to participate in additional facilitator- or " +
    "panel-style sessions during the training event."
  );
  p.para(
    "As a presenter at this ONGIA training event, you are required to submit your presentation materials by " +
    `${fmt(event.deadlines.draft)} for review. This review period allows sufficient time to assess content for ` +
    "alignment with training objectives, third-party privacy considerations, technical requirements, ONGIA Board " +
    "approval, necessary edits, and IT preparation. ONGIA aims to review all presentations to ensure consistency " +
    "with the overall theme and learning goals. Final, production-ready presentation materials must be submitted by " +
    `${fmt(event.deadlines.final)}.`
  );

  p.heading("PRESENTATION OUTLINE");
  p.box(`${s.talk}\n\n${s.outline}`, { minHeight: 70 });

  // Room and equipment, so the filed agreement is the one place the venue's AV
  // crew has to look. Every line is optional; a presenter who skipped them all
  // gets no section rather than a page of "not specified".
  const av = s.av ?? {};
  const AV_WORDS = {
    mic: { lapel: "Clip-on", handheld: "Handheld", podium: "At the podium", none: "None needed" },
    laptop: { own: "Their own laptop", house: "The room's computer" },
    plug: { hdmi: "HDMI", usbc: "USB-C", other: "Something else", unsure: "Not sure — bringing an adapter" },
    seating: { theatre: "Theatre", classroom: "Classroom", rounds: "Round tables", any: "No preference" },
  };
  const avRows = [
    ["Microphone:", AV_WORDS.mic[av.mic], 150],
    ["Presenting from:", AV_WORDS.laptop[av.laptop], 150],
    ["Connection:", AV_WORDS.plug[av.plug], 150],
    ["Sound from the presentation:", av.sound ? cap(av.sound) : null, 90],
    ["Slide advancer:", av.clicker ? cap(av.clicker) : null, 90],
    ["Room layout:", AV_WORDS.seating[av.seating], 150],
  ].filter(([, value]) => value);
  if (avRows.length || av.notes) {
    p.heading("ROOM AND EQUIPMENT");
    for (let i = 0; i < avRows.length; i += 2) p.kvRow(avRows.slice(i, i + 2));
    if (av.notes) { p.label("Also requested:"); p.box(av.notes); }
    p.small("Answered by the presenter for the venue's audio-visual crew. Blank lines were left as no preference.");
  }

  /* ------------------------------------------------------------ page two */
  // Logistics starts a fresh page, as on the paper form. If a long biography or
  // outline already ran onto a second page, carry on there rather than leave it near-empty.
  if (p.page === 1) p.newPage(); else p.gap(8);

  p.heading("LOGISTICS AND COSTING");
  p.para(
    "ONGIA is a non-profit organization, and we look for opportunities to share the cost of presenter attendance " +
    "with the presenter's home agency. Where an agency contributes, it allows ONGIA to manage the conference " +
    "expenses fiscally. Below are the costs associated with this presenter's attendance, what their agency " +
    "confirmed it would cover, and what ONGIA has agreed to cover."
  );

  // Approved dates come from the review; the presenter's request is kept
  // underneath only when the board changed it.
  const travelDates = review.travel ?? (s.travel === "yes" ? { from: s.travelFrom, to: s.travelTo } : null);
  const hotelDates = review.hotel ?? (s.hotel === "yes" ? { from: s.hotelFrom, to: s.hotelTo } : null);
  p.kvRow([
    ["Will you require travel:", cap(s.travel), 40, true],
    ["Dates:", travelDates ? `${fmt(travelDates.from)}  to  ${fmt(travelDates.to)}` : "—", 220, true],
  ]);
  if (review.travel?.changed) p.tiny(`Presenter requested ${fmt(s.travelFrom)} to ${fmt(s.travelTo)}; dates set by ONGIA at review.`);
  p.kvRow([
    ["Will you require hotel accommodations:", cap(s.hotel), 40, true],
    ["Dates:", hotelDates ? `${fmt(hotelDates.from)}  to  ${fmt(hotelDates.to)}` : "—", 220, true],
  ]);
  if (review.hotel?.changed) p.tiny(`Presenter requested ${fmt(s.hotelFrom)} to ${fmt(s.hotelTo)}; dates set by ONGIA at review.`);

  const ex = s.expenses ?? {};
  const oc = review.ongiaCovers ?? {};
  p.table(
    ["PROJECTED EXPENSES", "ONGIA", "PRESENTER AGENCY"],
    [0.55, 0.2, 0.25],
    [
      ["Transportation (Ground/Air)", !!oc.transport, yes(ex.transport)],
      s.hotel === "yes"
        ? ["Hotels/Accommodations", !!oc.hotel, yes(ex.hotel)]
        : ["Hotels/Accommodations", "not required"],
      ["Meals (Receipts Req.)", !!oc.meals, yes(ex.meals)],
      ex.other === "yes"
        ? [`Other: ${ex.otherText || "—"}`, !!oc.other, true]
        : ["Other:", "none claimed"],
    ]
  );
  p.note(
    "*NOTE – Meal claims must be accompanied by a receipt or declaration. Maximum meal amounts will be utilized in " +
    "accordance with the Treasury Board of Canada directive. Maximum repayment amounts can be found at " +
    "https://www.njc-cnm.gc.ca/directive/d10/v238/s659/en"
  );
  p.small(
    "The Presenter Agency column records what the presenter's agency confirmed; the ONGIA column was completed by the reviewing " +
    "board member below."
  );

  p.heading("PRESENTATION EXPECTATIONS AND REQUESTS");
  p.bullets([
    "Please send us a .png or .jpeg picture of yourself (headshot) that can be used in training " +
      "material, ONGIA website and social media platforms",
    "If your presentation has audio or video embedded in the PowerPoint, either insert transcripts or subtitles " +
      "that run as it plays, or provide a detailed narrative to accompany it",
    "Business casual dress is the minimum requirement",
    "All PowerPoint text must be at least 22-point",
  ]);
  p.small(`Headshot received with this agreement: ${s.headshotName ? "Yes — " + s.headshotName : "Not yet"}`
    + (headshot?.bytes?.byteLength && !p.photoDrawn ? " (the image could not be read, so it is not shown above)" : ""));

  p.heading("PRESENTER AGREEMENT & AUTHORIZATIONS");
  p.tickLine(
    true,
    "I confirm that this presentation is my own work, or that I have obtained all necessary permissions to use " +
      "any copyrighted material, images, content, or other intellectual property included in it.",
    RED
  );
  p.tickLine(
    s.goodStanding === true,
    "I confirm that I am currently in good standing with my agency, and that I am not subject to any disciplinary proceedings or under investigation of any kind.",
    RED
  );

  p.gap(4);
  p.label("MEDIA AND CONTENT SHARING AUTHORIZATION", true);
  p.label("Please indicate your consent for ONGIA to use the following content:");
  const m = s.media ?? {};
  p.consentTable([
    ["Presenter Photograph(s)", m.photo],
    ["Presentation Materials", m.materials],
    ["Presentation Summary", m.summary],
  ]);

  p.heading(`PLEASE RETURN COMPLETED DOCUMENT BY ${fmt(event.deadlines.agreement)}`);
  p.kvRow([
    ["Name:", `${presenter.first} ${presenter.last}`, 160],
    ["Date:", fmt(s.signedAt?.slice(0, 10)), 90],
  ]);
  p.kvRow([["Email:", presenter.email, 260]]);
  p.signature("Signature:", s.signature);
  p.tiny(
    `Signed electronically on ${stamp(s.signedAt)}. The presenter typed their name as their electronic signature ` +
      `and confirmed the information above is accurate. Submission reference ${presenter.reference}.`
  );

  // The ONGIA contact is the event's lead board member. An event approved with no
  // lead falls back to whoever approved it, reached through the speakers mailbox.
  const contact = event.contact?.name || event.contact?.email
    ? event.contact
    : { name: approval.name, email: event.reviewer?.email || process.env.MS_MAIL_FROM || "", phone: "" };
  p.heading("ONGIA CONTACT INFORMATION");
  p.kvRow([
    ["Name:", contact.name || "—", 160],
    ["Email:", contact.email || "—", 170],
  ]);
  p.kvRow([["Contact Number:", contact.phone || "—", 130]]);

  p.gap(3);
  if (preview) {
    p.label("This document has NOT been approved.", true, RED);
    p.small("The approving board member's name, title, date and signature are added here when the agreement is approved.");
    p.stamp(
      `DRAFT PREVIEW — how the agreement will read once a board member approves it. Nothing has been issued, ` +
        `emailed or filed. The ONGIA expenses column is completed at approval, so it shows unticked here.`
    );
  } else {
    p.label("This document has been reviewed and approved by:", true, NAVY);
    p.kvRow([
      ["Name:", approval.name, 160, false, NAVY],
      ["Title/Role:", approval.role, 150, false, NAVY],
    ]);
    p.kvRow([["Date:", fmt(approval.approvedAt?.slice(0, 10)), 90, false, NAVY]]);
    p.signature("Signature:", approval.name, NAVY);

    p.stamp(
      `FINAL COPY — issued on ${fmt(approval.approvedAt?.slice(0, 10))} when ${approval.name} approved it. ` +
        `Presenter submitted ${fmt(s.signedAt?.slice(0, 10))}; ONGIA cost coverage was set at review, not by the presenter. ` +
        `ONGIA files it to ${event.sharePointFolder || "the event folder"} and emails it to the presenter.`
    );
  }

  p.finish();
  doc.end();
  return finished;
}

const cap = (v) => (v ? v[0].toUpperCase() + v.slice(1) : "—");

function stamp(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  const date = formatDate(isoString.slice(0, 10));
  const hh = d.getUTCHours(), mm = String(d.getUTCMinutes()).padStart(2, "0");
  const h12 = ((hh + 11) % 12) + 1;
  return `${date} at ${h12}:${mm} ${hh < 12 ? "a.m." : "p.m."} UTC`;
}

/**
 * Keeps a running y-cursor and draws each kind of block the document uses.
 * Nothing here is clever — it's the HTML layout, expressed as coordinates.
 */
class Painter {
  constructor(doc, band, preview = false) {
    this.doc = doc;
    this.band = band;
    this.preview = preview;
    this.y = 0;
    this.page = 1;
    this.script = false;
    this.inset = 0;        // right margin reserved by a floated photo
    this.photoBottom = 0;
    this.photoDrawn = false;
  }

  gap(n) { this.y += n; }

  /** Usable width, narrowed while something floats in the right margin. */
  bodyW() { return BODY_W - this.inset; }

  /**
   * The presenter's headshot, floated into the right margin from `top`. Rows
   * drawn after this are narrowed until clearPhoto(). A picture that pdfkit
   * cannot read is skipped: an unreadable upload must not cost them the PDF.
   */
  photo(bytes, { top, w = 84, h = 104 } = {}) {
    const doc = this.doc;
    const x = MARGIN + BODY_W - w;
    if (top + h > BOTTOM) return;
    try {
      const src = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      doc.save();
      doc.rect(x, top, w, h).clip();
      doc.image(src, x, top, { cover: [w, h], align: "center", valign: "center" });
      doc.restore();
    } catch {
      doc.restore();
      return;
    }
    doc.rect(x, top, w, h).lineWidth(0.8).strokeColor(RULE).stroke();
    this.inset = w + 16;
    this.photoBottom = top + h;
    this.photoDrawn = true;
  }

  /** Stop reserving the right margin, and clear the photo vertically. */
  clearPhoto() {
    if (!this.inset) return;
    this.inset = 0;
    this.y = Math.max(this.y, this.photoBottom + 8);
    this.photoBottom = 0;
  }

  /** Room left above the footer band on this page. */
  room() { return BOTTOM - this.y; }

  /** Start a new page if the next block of height h would run into the band. */
  ensure(h) { if (this.y + h > BOTTOM) this.newPage(); }

  drawBand() { this.doc.image(this.band, 0, PAGE_H - BAND_H, { width: PAGE_W }); }

  newPage() {
    this.drawBand();
    this.doc.addPage();
    this.page += 1;
    this.y = TOP;
    if (this.preview) this.ribbon();
  }

  /** A preview must never be mistaken for the issued agreement, on any page. */
  ribbon() {
    const doc = this.doc;
    const h = 17;
    doc.rect(0, this.y, PAGE_W, h).fill(RED);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#ffffff")
       .text("DRAFT PREVIEW — NOT APPROVED, NOT ISSUED, NOT SENT", MARGIN, this.y + 4.6,
             { width: BODY_W, align: "center", lineBreak: false, characterSpacing: 0.8 });
    this.y += h + 8;
  }

  finish() { this.drawBand(); }

  heading(text) {
    this.ensure(48); // a heading never sits alone at the foot of a page
    this.y += 3;
    this.doc.font("Helvetica").fontSize(12).fillColor(GOLD).text(text, MARGIN, this.y, { width: BODY_W, lineBreak: false });
    this.y += 14;
  }

  label(text, bold = false, color = INK) {
    this.ensure(24);
    this.doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.7).fillColor(color)
      .text(text, MARGIN, this.y, { width: this.bodyW() });
    this.y += 12;
  }

  para(text) {
    this.doc.font("Helvetica").fontSize(8.7).fillColor(INK);
    const h = this.doc.heightOfString(text, { width: BODY_W, lineGap: 1.4 });
    this.ensure(h + 5);
    this.doc.text(text, MARGIN, this.y, { width: BODY_W, lineGap: 1.4 });
    this.y += h + 5;
  }

  small(text) {
    this.doc.font("Helvetica").fontSize(8.2).fillColor(INK);
    const h = this.doc.heightOfString(text, { width: BODY_W });
    this.ensure(h + 4);
    this.doc.text(text, MARGIN, this.y, { width: BODY_W });
    this.y += h + 4;
  }

  tiny(text) {
    this.doc.font("Helvetica").fontSize(7.4).fillColor(MUTED);
    const h = this.doc.heightOfString(text, { width: 470 });
    this.ensure(h + 4);
    this.doc.text(text, MARGIN, this.y, { width: 470 });
    this.y += h + 4;
  }

  note(text) {
    this.doc.font("Helvetica").fontSize(8).fillColor(GOLD);
    const h = this.doc.heightOfString(text, { width: BODY_W });
    this.ensure(h + 6);
    this.doc.text(text, MARGIN, this.y + 3, { width: BODY_W });
    this.y += h + 6;
  }

  /**
   * One row of label/value pairs. Each pair: [label, value, valueWidth, boldLabel, color].
   * Values sit on a thin rule, the way blanks do on the paper form.
   */
  kvRow(pairs) {
    const doc = this.doc;
    this.ensure(15);
    let x = MARGIN;
    const colW = this.bodyW() / pairs.length;
    for (const [label, value, valueW, boldLabel = false, color = INK] of pairs) {
      doc.font(boldLabel ? "Helvetica-Bold" : "Helvetica").fontSize(8.7).fillColor(color);
      doc.text(label, x, this.y, { lineBreak: false });
      const lw = doc.widthOfString(label) + 5;
      const vx = x + lw;
      const vw = Math.min(valueW, colW - lw - 8);
      doc.font("Helvetica-Bold").fontSize(8.7).fillColor(INK);
      doc.text(String(value ?? ""), vx + 3, this.y, { width: vw, lineBreak: false, ellipsis: true });
      doc.moveTo(vx, this.y + 10.5).lineTo(vx + vw, this.y + 10.5).lineWidth(0.6).strokeColor(RULE).stroke();
      x += colW;
    }
    this.y += 15;
  }

  /**
   * A bordered text box. Text that will not fit above the band continues in a
   * second box on the next page, split between paragraphs (or, for one huge
   * paragraph, between words) so nothing is ever drawn off the page.
   */
  box(text, { minHeight = 0 } = {}) {
    const doc = this.doc;
    const pad = 7;
    const opts = { width: BODY_W - pad * 2, lineGap: 1.2 };
    const font = () => doc.font("Helvetica").fontSize(8.7).fillColor(INK);
    const height = (str) => { font(); return doc.heightOfString(str, opts); };
    // Largest k such that the first k items, joined, fit in `avail` points.
    const fit = (items, joiner, avail) => {
      let lo = 0, hi = items.length;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (height(items.slice(0, mid).join(joiner)) <= avail) lo = mid; else hi = mid - 1; }
      return lo;
    };
    let pending = String(text ?? "").split("\n");
    let whole = true;
    while (pending.length) {
      const fullPage = BOTTOM - TOP - pad * 2 - 4;
      let avail = this.room() - pad * 2 - 4;
      if (avail < 60 && avail < fullPage) { this.newPage(); avail = this.room() - pad * 2 - 4; }
      let take = fit(pending, "\n", avail);
      if (take === 0) {
        // One paragraph taller than the space left: break it between words.
        const words = pending[0].split(" ");
        const n = Math.max(1, fit(words, " ", avail));
        const head = words.slice(0, n).join(" "), tail = words.slice(n).join(" ");
        pending = [head, ...(tail ? [tail] : []), ...pending.slice(1)];
        take = 1;
      }
      const chunk = pending.slice(0, take).join("\n");
      pending = pending.slice(take);
      const h = Math.max(whole && !pending.length ? minHeight : 0, height(chunk) + pad * 2);
      doc.rect(MARGIN, this.y, BODY_W, h).lineWidth(0.8).strokeColor(INK).stroke();
      font();
      doc.text(chunk, MARGIN + pad, this.y + pad, opts);
      this.y += h + 4;
      whole = false;
      if (pending.length) this.newPage();
    }
  }

  bullets(items) {
    const doc = this.doc;
    doc.font("Helvetica").fontSize(8.7).fillColor(INK);
    for (const item of items) {
      const h = doc.heightOfString(item, { width: BODY_W - 20 });
      this.ensure(h + 2);
      doc.text("•", MARGIN + 6, this.y, { lineBreak: false });
      doc.text(item, MARGIN + 18, this.y, { width: BODY_W - 20 });
      this.y += h + 2;
    }
    this.y += 2;
  }

  /** A drawn checkbox, ticked or not, at (x, y). Returns width consumed. */
  tick(x, y, on) {
    const doc = this.doc;
    doc.rect(x, y, 9, 9).lineWidth(0.8).strokeColor(INK).stroke();
    // Drawn, not a glyph: a font-based check mark depends on the viewer having
    // the symbol font, and phone PDF viewers often don't.
    if (on) {
      doc.save().lineWidth(1.4).strokeColor(INK).lineCap("round").lineJoin("round")
        .moveTo(x + 2, y + 4.8).lineTo(x + 3.9, y + 7).lineTo(x + 7.3, y + 2.2).stroke().restore();
    }
    return 9;
  }

  tickLine(on, text, color = INK) {
    const doc = this.doc;
    doc.font("Helvetica-Bold").fontSize(8.7).fillColor(color);
    const h = doc.heightOfString(text, { width: BODY_W - 16 });
    this.ensure(h + 4);
    this.tick(MARGIN, this.y + 1, on);
    doc.font("Helvetica-Bold").fontSize(8.7).fillColor(color);
    doc.text(text, MARGIN + 16, this.y, { width: BODY_W - 16 });
    this.y += h + 4;
  }

  /** Expenses grid: label | ONGIA tick | Agency tick, or a row spanning "not required". */
  table(headers, fractions, rows) {
    const doc = this.doc;
    const widths = fractions.map((f) => f * BODY_W);
    const rowH = 15;
    this.ensure(rowH * (rows.length + 1) + 3);
    let y = this.y;

    const cell = (x, w, text, bold, align = "center", color = INK) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.7).fillColor(color)
        .text(text, x + 5, y + 4, { width: w - 10, align, lineBreak: false, ellipsis: true });
    };
    const rule = (x0, x1, yy) => doc.moveTo(x0, yy).lineTo(x1, yy).lineWidth(0.8).strokeColor(INK).stroke();

    // header
    let x = MARGIN;
    headers.forEach((h, i) => { cell(x, widths[i], h, true, i === 0 ? "left" : "center"); x += widths[i]; });
    rule(MARGIN, MARGIN + BODY_W, y);
    y += rowH;
    rule(MARGIN, MARGIN + BODY_W, y);

    // A row whose second cell is a string has nothing to tick: the note is set
    // across both tick columns, and the divider between them is left out of that
    // band so the line does not run through the middle of the words.
    const merged = [];
    for (const r of rows) {
      x = MARGIN;
      cell(x, widths[0], r[0], false, "left");
      x += widths[0];
      if (typeof r[1] === "string") {
        merged.push([y, y + rowH]);
        doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(MUTED)
          .text(r[1], x, y + 4, { width: widths[1] + widths[2], align: "center", lineBreak: false, ellipsis: true });
      } else {
        this.tick(x + widths[1] / 2 - 4.5, y + 3, !!r[1]);
        this.tick(x + widths[1] + widths[2] / 2 - 4.5, y + 3, !!r[2]);
      }
      y += rowH;
      rule(MARGIN, MARGIN + BODY_W, y);
    }
    // verticals — the inner one breaks around any merged band
    const top = this.y;
    x = MARGIN;
    for (let i = 0; i <= widths.length; i++) {
      const inner = i > 0 && i < widths.length;
      const gaps = inner && i === widths.length - 1 ? merged : [];
      let from = top;
      for (const [g0, g1] of gaps) {
        if (g0 > from) doc.moveTo(x, from).lineTo(x, g0).lineWidth(0.8).strokeColor(INK).stroke();
        from = g1;
      }
      if (y > from) doc.moveTo(x, from).lineTo(x, y).lineWidth(0.8).strokeColor(INK).stroke();
      if (i < widths.length) x += widths[i];
    }
    this.y = y + 3;
  }

  /** Content | Internal (Yes/No) | Public (Yes/No). */
  consentTable(rows) {
    const doc = this.doc;
    const widths = [0.35 * BODY_W, 0.35 * BODY_W, 0.30 * BODY_W];
    const rowH = 15;
    this.ensure(rowH * (rows.length + 1) + 3);
    let y = this.y;
    const rule = (yy) => doc.moveTo(MARGIN, yy).lineTo(MARGIN + BODY_W, yy).lineWidth(0.8).strokeColor(INK).stroke();

    doc.font("Helvetica-Bold").fontSize(8.7).fillColor(INK);
    doc.text("Content", MARGIN + 5, y + 4, { lineBreak: false });
    doc.text("Internal-ONGIA (Paid Members Only)", MARGIN + widths[0], y + 4, { width: widths[1], align: "center", lineBreak: false });
    doc.text("Social Media/Public Platforms", MARGIN + widths[0] + widths[1], y + 4, { width: widths[2], align: "center", lineBreak: false });
    rule(y); y += rowH; rule(y);

    const pair = (x, w, value) => {
      const cx = x + w / 2;
      this.tick(cx - 44, y + 3, value === "yes");
      doc.font("Helvetica").fontSize(8.7).fillColor(INK).text("Yes", cx - 32, y + 4, { lineBreak: false });
      this.tick(cx + 6, y + 3, value === "no");
      doc.text("No", cx + 18, y + 4, { lineBreak: false });
    };
    for (const [label, m] of rows) {
      doc.font("Helvetica").fontSize(8.7).fillColor(INK).text(label, MARGIN + 5, y + 4, { lineBreak: false });
      pair(MARGIN + widths[0], widths[1], m?.internal);
      pair(MARGIN + widths[0] + widths[1], widths[2], m?.public);
      y += rowH; rule(y);
    }
    let x = MARGIN;
    for (let i = 0; i <= 3; i++) {
      doc.moveTo(x, this.y).lineTo(x, y).lineWidth(0.8).strokeColor(INK).stroke();
      if (i < 3) x += widths[i];
    }
    this.y = y + 3;
  }

  /**
   * A typed electronic signature: the name in a script face sitting on the
   * signature line, with the plain typed name beside it so it stays legible.
   */
  signature(label, name, color = INK) {
    const doc = this.doc;
    this.ensure(30);
    const text = String(name ?? "");
    const lx = MARGIN + 52, lineW = 250, lineY = this.y + 24;
    doc.font("Helvetica-Bold").fontSize(8.7).fillColor(color).text(label, MARGIN, lineY - 11, { lineBreak: false });
    if (this.script && text) {
      let size = 23;
      doc.font("Script").fontSize(size);
      const w = doc.widthOfString(text);
      if (w > lineW - 10) { size = Math.max(11, (size * (lineW - 10)) / w); doc.fontSize(size); }
      const ascent = ((doc._font?.ascender ?? 800) / 1000) * size;
      doc.fillColor(NAVY).text(text, lx + 6, lineY - ascent - 1, { lineBreak: false });
    } else {
      doc.font("Helvetica-Oblique").fontSize(15).fillColor(NAVY).text(text, lx + 4, lineY - 17, { lineBreak: false });
    }
    doc.moveTo(lx, lineY).lineTo(lx + lineW, lineY).lineWidth(0.8).strokeColor(INK).stroke();
    if (text) doc.font("Helvetica").fontSize(7).fillColor(MUTED).text(`typed: ${text}`, lx + lineW + 8, lineY - 8, { width: BODY_W - (lx - MARGIN) - lineW - 8, lineBreak: false, ellipsis: true });
    this.y = lineY + 3;
  }

  stamp(text) {
    const doc = this.doc;
    const pad = 6;
    doc.font("Helvetica").fontSize(7.6).fillColor(MUTED);
    const h = doc.heightOfString(text, { width: BODY_W - pad * 2 }) + pad * 2;
    // Close the gap above rather than send one closing note to a page of its own.
    const gap = this.y + h + 6 <= BOTTOM ? 6 : 1;
    this.ensure(h + gap);
    this.y += gap;
    doc.rect(MARGIN, this.y, BODY_W, h).fillAndStroke("#f9f4e6", GOLD);
    doc.fillColor(MUTED).text(text, MARGIN + pad, this.y + pad, { width: BODY_W - pad * 2 });
    this.y += h + 4;
  }

  /** Footer band pinned to the page foot. */
}
