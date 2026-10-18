import { json, fail, text, yesNo, isEmail } from "./lib/http.mjs";
import { formatPhone } from "./lib/phone.mjs";
import { siteUrl } from "./lib/site.mjs";
import { resolveVolunteerToken, putVolunteer, getPdf } from "./lib/store.mjs";
import { formatDate } from "./lib/deadlines.mjs";
import { VOLUNTEER_TERMS, VOLUNTEER_TERMS_VERSION } from "./lib/terms.mjs";
import { buildAndStore, completeAgreement, requestReview, pdfKey } from "./lib/volunteers.mjs";
import { volunteerContact } from "./lib/mail.mjs";
import { safeFileName } from "./lib/ids.mjs";

/**
 * The volunteer's own endpoint. Like the presenter's, no account and no password:
 * the long token in their link is the credential.
 *
 *   GET  /api/volunteer?t=…          what the form needs to render
 *   GET  /api/volunteer?t=…&pdf=1    their signed copy, once it is final
 *   POST /api/volunteer?t=…          sign the agreement
 */
export default async (req) => {
  const url = new URL(req.url);
  const tok = url.searchParams.get("t");
  if (!tok) return fail("This link is missing its code.", 400);

  const found = await resolveVolunteerToken(tok);
  if (!found) return fail("This link isn't valid. Check it came from ONGIA, or ask us for a new one.", 404);

  const { event, volunteer } = found;
  if (req.method === "GET") return url.searchParams.get("pdf") ? download(event, volunteer) : showForm(event, volunteer);
  if (req.method === "POST") return sign(req, event, volunteer);
  return fail("Method not allowed.", 405);
};

async function showForm(event, volunteer) {
  // Opening the link is itself a signal: "never looked" and "looked and stopped" are different calls to make.
  if (!volunteer.openedAt && volunteer.status === "invited") {
    volunteer.openedAt = new Date().toISOString();
    await putVolunteer(volunteer);
  }
  return json({
    event: {
      title: event.title, city: event.city, venue: event.venue,
      dayOne: formatDate(event.dayOne), lastDay: formatDate(event.lastDay),
      dayOneIso: event.dayOne, lastDayIso: event.lastDay,
      contact: volunteerContact(event),
    },
    volunteer: {
      first: volunteer.first, last: volunteer.last, email: volunteer.email, organization: volunteer.organization,
      status: volunteer.status, signedAt: volunteer.signedAt, reference: volunteer.reference, language: volunteer.language ?? null,
      phone: volunteer.submission?.phone ?? "", accommodation: volunteer.submission?.accommodation ?? null,
    },
    terms: VOLUNTEER_TERMS,
  });
}

async function download(event, volunteer) {
  if (volunteer.status !== "signed") return fail("There is no signed copy yet.", 404);
  let pdf = await getPdf(pdfKey(event.id, volunteer.id)).then((b) => (b ? Buffer.from(b) : null));
  if (!pdf) pdf = await buildAndStore(event, volunteer);
  const name = `${safeFileName(volunteer.last, "Volunteer")}_Volunteer Agreement.pdf`;
  return new Response(pdf, { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
}

async function sign(req, event, volunteer) {
  if (volunteer.status !== "invited") return fail("This agreement has already been signed. Contact ONGIA if something needs changing.", 409);
  const body = await req.json().catch(() => null);
  if (!body) return fail("Expected a JSON body.");

  const problems = [];
  const first = text(body.first, 80), last = text(body.last, 80), email = text(body.email, 200);
  if (!first || !last) problems.push("Your first or last name is missing.");
  if (!isEmail(email)) problems.push("That email address doesn't look right.");
  if (String(body.phone ?? "").replace(/\D/g, "").length < 7) problems.push("Please add a contact number.");
  const accommodation = yesNo(body.accommodation);
  if (!accommodation) problems.push("Tell us whether you will need hotel accommodation.");
  if (body.termsAccepted !== true) problems.push("Please read and agree to the Volunteer Terms.");
  if (body.standing !== true) problems.push("Please confirm you are in good standing and not under a formal investigation.");
  const signature = text(body.signature, 160);
  if (!signature) problems.push("Please type your name to sign.");
  if (body.agreed !== true) problems.push("Please confirm your electronic signature.");
  if (problems.length) return json({ problems }, 422);

  const now = new Date().toISOString();
  Object.assign(volunteer, { first, last, email, organization: text(body.organization, 200) });
  volunteer.language = body.language === "fr" ? "fr" : "en";
  // Someone who needs a hotel room waits for a board member to choose their nights; anyone else is done.
  volunteer.status = accommodation === "yes" ? "submitted" : "signed";
  volunteer.signedAt = now;
  volunteer.submission = {
    phone: formatPhone(text(body.phone, 60)),
    accommodation,
    termsAccepted: true, termsVersion: VOLUNTEER_TERMS_VERSION, standing: true,
    signature, signedAt: now,
  };
  // The signature is saved before any network call: an email hiccup must never lose it.
  await putVolunteer(volunteer);

  if (volunteer.status === "submitted") {
    await requestReview(event, volunteer, siteUrl(req));
    return json({ ok: true, reference: volunteer.reference, review: true, emailed: volunteer.delivery.received?.ok === true, contact: volunteerContact(event).name ?? "" });
  }
  await completeAgreement(event, volunteer);
  return json({
    ok: true, reference: volunteer.reference, review: false,
    emailed: volunteer.delivery.volunteerEmail?.ok === true,
    contact: volunteerContact(event).name ?? "",
    pdf: `${siteUrl(req)}/api/volunteer?t=${encodeURIComponent(volunteer.token)}&pdf=1`,
  });
}
