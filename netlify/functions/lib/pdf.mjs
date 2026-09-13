import PDFDocument from "pdfkit";
import { readFile } from "node:fs/promises";
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
const ASSETS = path.resolve(HERE, "../../../public/assets");

// Letter, in points.
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 42;
const BODY_W = PAGE_W - MARGIN * 2;

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
export async function buildAgreementPdf({ event, presenter, approval }) {
  const { banner, band } = await assets();
  const s = presenter.submission;
  const review = presenter.review ?? { ongiaCovers: {} };

  const doc = new PDFDocument({ size: "LETTER", margin: 0, info: {
    Title: `${presenter.last}_Presenter Agreement`,
    Author: "ONGIA Presenter Agreement Desk",
    Subject: `${event.title} — presenter agreement, ${presenter.first} ${presenter.last}`,
  }});
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const finished = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const p = new Painter(doc);

  /* ------------------------------------------------------------ page one */
  // Banner: 1056×288 source scaled to the full page width.
  const bannerH = (288 / 1056) * PAGE_W;
  doc.image(banner, 0, 0, { width: PAGE_W });
  p.y = bannerH + 8;

  p.heading("EVENT DETAILS");
  p.kvRow([
    ["Location(City):", event.city, 150],
    ["Event Title:", event.title, 160],
  ]);
  p.kvRow([["Address:", event.venue || event.city, 330]]);
  p.kvRow([
    ["Anticipated Presentation Date/Time:", fmt(event.dayOne), 100],
    ["Time Slot:", presenter.timeSlot || "To be confirmed", 110],
  ]);

  p.heading("PRESENTER INFORMATION");
  p.kvRow([
    ["Name:", `${presenter.first} ${presenter.last}`, 160],
    ["Contact#:", s.phone || "—", 110],
  ]);
  p.kvRow([["Organization:", presenter.organization || "—", 330]]);
  p.kvRow([["Email:", presenter.email, 330]]);
  p.kvRow([["Presentation Title:", s.talk, 330]]);

  p.gap(4);
  p.label("Biography (Max 250-300 words)", true);
  p.label("(This biography may be used to introduce you at the ONGIA event)");
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

  p.band(band);

  /* ------------------------------------------------------------ page two */
  doc.addPage();
  p.y = 24;

  p.heading("LOGISTICS AND COSTING");
  p.para(
    "ONGIA is a non-profit organization, and we look for opportunities to share the cost of presenter attendance " +
    "with the presenter's home agency. Where an agency contributes, it allows ONGIA to manage the conference " +
    "expenses fiscally. Below are the costs associated with this presenter's attendance, what their agency " +
    "confirmed it would cover, and what ONGIA has agreed to cover."
  );

  p.kvRow([
    ["Will you require travel:", cap(s.travel), 40, true],
    ["Dates:", s.travel === "yes" ? `${fmt(s.travelFrom)}  to  ${fmt(s.travelTo)}` : "—", 220, true],
  ]);
  p.kvRow([
    ["Will you require hotel accommodations:", cap(s.hotel), 40, true],
    ["Dates:", s.hotel === "yes" ? `${fmt(s.hotelFrom)}  to  ${fmt(s.hotelTo)}` : "—", 220, true],
  ]);

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
        : ["Other:", "not required"],
    ]
  );
  p.note(
    "*NOTE – Meal claims must be accompanied by a receipt or declaration. Maximum meal amounts will be utilized in " +
    "accordance with the Treasury Board of Canada. Maximum repayment amounts can be found at " +
    "https://www.njc-cnm.gc.ca/directive/d10/v238/s659/en"
  );
  p.small(
    "Presenter Agency records what the presenter's agency confirmed. ONGIA was completed by the reviewing " +
    "board member below."
  );

  p.heading("PRESENTATION EXPECTATIONS AND REQUESTS");
  p.bullets([
    "Please send us a .png or .JPEG-formatted picture of yourself (headshot) that can be used in training " +
      "material, ONGIA website and social media platforms",
    "If your presentation has audio or video components embedded in the PowerPoint, you either insert " +
      "transcripts, subtitles as the video/audio plays, or you provide a detailed narrative to accompany the audio/video",
    "Business casual dress minimum requirement",
    "All PowerPoint text must be a minimum 22 font",
  ]);
  p.small(`Headshot received with this agreement: ${s.headshotName ? "Yes — " + s.headshotName : "Not yet"}`);

  p.heading("PRESENTER AGREEMENT & AUTHORIZATIONS");
  p.tickLine(
    true,
    "The presentation/training presented is my work, or I have received all permissions required to use any " +
      "Copyrighted material or intellectual property presented.",
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

  p.heading("ONGIA CONTACT INFORMATION");
  p.kvRow([
    ["Name:", event.contact?.name || "—", 160],
    ["Email:", event.contact?.email || "—", 170],
  ]);
  p.kvRow([["Contact Number:", event.contact?.phone || "—", 130]]);

  p.gap(6);
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
      `Filed to ${event.sharePointFolder || "the event folder"} and emailed to the presenter.`
  );

  p.band(band);
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
  constructor(doc) {
    this.doc = doc;
    this.y = 0;
  }

  gap(n) { this.y += n; }

  heading(text) {
    this.y += 7;
    this.doc.font("Helvetica").fontSize(12).fillColor(GOLD).text(text, MARGIN, this.y, { width: BODY_W, lineBreak: false });
    this.y += 17;
  }

  label(text, bold = false, color = INK) {
    this.doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.7).fillColor(color)
      .text(text, MARGIN, this.y, { width: BODY_W });
    this.y += 12;
  }

  para(text) {
    this.doc.font("Helvetica").fontSize(8.7).fillColor(INK);
    const h = this.doc.heightOfString(text, { width: BODY_W, lineGap: 1.4 });
    this.doc.text(text, MARGIN, this.y, { width: BODY_W, lineGap: 1.4 });
    this.y += h + 5;
  }

  small(text) {
    this.doc.font("Helvetica").fontSize(8.2).fillColor(INK);
    const h = this.doc.heightOfString(text, { width: BODY_W });
    this.doc.text(text, MARGIN, this.y, { width: BODY_W });
    this.y += h + 4;
  }

  tiny(text) {
    this.doc.font("Helvetica").fontSize(7.4).fillColor(MUTED);
    const h = this.doc.heightOfString(text, { width: 470 });
    this.doc.text(text, MARGIN, this.y, { width: 470 });
    this.y += h + 4;
  }

  note(text) {
    this.doc.font("Helvetica").fontSize(8).fillColor(GOLD);
    const h = this.doc.heightOfString(text, { width: BODY_W });
    this.doc.text(text, MARGIN, this.y + 3, { width: BODY_W });
    this.y += h + 6;
  }

  /**
   * One row of label/value pairs. Each pair: [label, value, valueWidth, boldLabel, color].
   * Values sit on a thin rule, the way blanks do on the paper form.
   */
  kvRow(pairs) {
    const doc = this.doc;
    let x = MARGIN;
    const colW = BODY_W / pairs.length;
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

  box(text, { minHeight = 0 } = {}) {
    const doc = this.doc;
    const pad = 7;
    doc.font("Helvetica").fontSize(8.7).fillColor(INK);
    const th = doc.heightOfString(text, { width: BODY_W - pad * 2, lineGap: 1.2 });
    const h = Math.max(minHeight, th + pad * 2);
    doc.rect(MARGIN, this.y, BODY_W, h).lineWidth(0.8).strokeColor(INK).stroke();
    doc.text(text, MARGIN + pad, this.y + pad, { width: BODY_W - pad * 2, lineGap: 1.2 });
    this.y += h + 4;
  }

  bullets(items) {
    const doc = this.doc;
    doc.font("Helvetica").fontSize(8.7).fillColor(INK);
    for (const item of items) {
      doc.text("•", MARGIN + 6, this.y, { lineBreak: false });
      const h = doc.heightOfString(item, { width: BODY_W - 20 });
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
    this.tick(MARGIN, this.y + 1, on);
    doc.font("Helvetica-Bold").fontSize(8.7).fillColor(color);
    const h = doc.heightOfString(text, { width: BODY_W - 16 });
    doc.text(text, MARGIN + 16, this.y, { width: BODY_W - 16 });
    this.y += h + 4;
  }

  /** Expenses grid: label | ONGIA tick | Agency tick, or a row spanning "not required". */
  table(headers, fractions, rows) {
    const doc = this.doc;
    const widths = fractions.map((f) => f * BODY_W);
    const rowH = 15;
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

    for (const r of rows) {
      x = MARGIN;
      cell(x, widths[0], r[0], false, "left");
      x += widths[0];
      if (r[1] === "not required") {
        doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(MUTED)
          .text("not required", x, y + 4, { width: widths[1] + widths[2], align: "center", lineBreak: false });
      } else {
        this.tick(x + widths[1] / 2 - 4.5, y + 3, !!r[1]);
        this.tick(x + widths[1] + widths[2] / 2 - 4.5, y + 3, !!r[2]);
      }
      y += rowH;
      rule(MARGIN, MARGIN + BODY_W, y);
    }
    // verticals
    x = MARGIN;
    for (let i = 0; i <= widths.length; i++) {
      doc.moveTo(x, this.y).lineTo(x, y).lineWidth(0.8).strokeColor(INK).stroke();
      if (i < widths.length) x += widths[i];
    }
    this.y = y + 3;
  }

  /** Content | Internal (Yes/No) | Public (Yes/No). */
  consentTable(rows) {
    const doc = this.doc;
    const widths = [0.35 * BODY_W, 0.35 * BODY_W, 0.30 * BODY_W];
    const rowH = 15;
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

  signature(label, name, color = INK) {
    const doc = this.doc;
    doc.font("Helvetica-Bold").fontSize(8.7).fillColor(color).text(label, MARGIN, this.y + 8, { lineBreak: false });
    const lx = MARGIN + 52;
    doc.font("Helvetica-Oblique").fontSize(15).fillColor(NAVY).text(name ?? "", lx + 4, this.y, { lineBreak: false });
    doc.moveTo(lx, this.y + 19).lineTo(lx + 250, this.y + 19).lineWidth(0.8).strokeColor(INK).stroke();
    this.y += 24;
  }

  stamp(text) {
    const doc = this.doc;
    const pad = 6;
    doc.font("Helvetica").fontSize(7.6).fillColor(MUTED);
    const h = doc.heightOfString(text, { width: BODY_W - pad * 2 }) + pad * 2;
    this.y += 6;
    doc.rect(MARGIN, this.y, BODY_W, h).fillAndStroke("#f9f4e6", GOLD);
    doc.fillColor(MUTED).text(text, MARGIN + pad, this.y + pad, { width: BODY_W - pad * 2 });
    this.y += h + 4;
  }

  /** Footer band pinned to the page foot. */
  band(image) {
    const h = (85 / 1241) * PAGE_W;
    this.doc.image(image, 0, PAGE_H - h, { width: PAGE_W });
  }
}
