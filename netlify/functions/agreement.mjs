import { json, fail, text, yesNo, isEmail } from "./lib/http.mjs";
import { resolveToken, putPresenter } from "./lib/store.mjs";
import { formatDate, describeEvent } from "./lib/deadlines.mjs";
import { sendMail, reviewNeededMail } from "./lib/mail.mjs";

/**
 * The presenter's own endpoint. No account, no password — the token in their
 * link is the credential, which is why it is long and compared in constant time.
 *
 *   GET  /api/agreement?t=…   what the form needs to render
 *   POST /api/agreement?t=…   submit the completed agreement
 */
export default async (req) => {
  const url = new URL(req.url);
  const tok = url.searchParams.get("t");
  if (!tok) return fail("This link is missing its code.", 400);

  const found = await resolveToken(tok);
  if (!found) return fail("This link isn't valid. Check it came from ONGIA, or ask us for a new one.", 404);

  const { event, presenter } = found;
  if (req.method === "GET") return showForm(event, presenter);
  if (req.method === "POST") return submit(req, event, presenter);
  return fail("Method not allowed.", 405);
};

async function showForm(event, presenter) {
  // Opening the link is itself a signal — it separates "never looked" from
  // "started and stopped", which the chase-ups treat differently.
  if (!presenter.openedAt && presenter.status === "invited") {
    presenter.openedAt = new Date().toISOString();
    await putPresenter(presenter);
  }

  return json({
    event: {
      title: event.title,
      city: event.city,
      venue: event.venue,
      dayOne: formatDate(event.dayOne),
      lastDay: formatDate(event.lastDay),
      sessionMinutes: event.sessionMinutes,
      deadlines: {
        agreement: formatDate(event.deadlines.agreement),
        draft: formatDate(event.deadlines.draft),
        final: formatDate(event.deadlines.final),
      },
      contact: event.contact,
      materialsUploadUrl: event.materialsUploadUrl,
    },
    presenter: {
      first: presenter.first,
      last: presenter.last,
      email: presenter.email,
      organization: presenter.organization,
      reference: presenter.reference,
      status: presenter.status,
      submittedAt: presenter.submittedAt,
      approvedAt: presenter.approvedAt,
      headshot: presenter.headshot ?? null,
      // Set when a board member sent it back; the form shows it at the top.
      returnNote: presenter.status === "returned" ? presenter.review?.returnNote : null,
    },
    // What they typed last time, so a half-finished form isn't lost.
    draft: presenter.submission ?? null,
  });
}

async function submit(req, event, presenter) {
  if (presenter.status === "approved") {
    return fail("This agreement has already been approved. Contact ONGIA if something needs changing.", 409);
  }

  const body = await req.json().catch(() => null);
  if (!body) return fail("Expected a JSON body.");

  const problems = [];
  const need = (value, message) => {
    if (!value) problems.push(message);
    return value;
  };

  const first = need(text(body.first, 80), "Your first name is missing.");
  const last = need(text(body.last, 80), "Your last name is missing.");
  const email = text(body.email, 200);
  if (!isEmail(email)) problems.push("That email address doesn't look right.");

  const talk = need(text(body.talk, 300), "Your presentation title is missing.");
  const bio = need(text(body.bio, 6000), "Your biography is missing.");
  const outline = need(text(body.outline, 6000), "Your presentation outline is missing.");

  const travel = need(yesNo(body.travel), "Tell us whether you need travel arranged.");
  const hotel = need(yesNo(body.hotel), "Tell us whether you need hotel accommodation.");

  const expenses = {
    transport: yesNo(body?.expenses?.transport),
    hotel: hotel === "yes" ? yesNo(body?.expenses?.hotel) : "n/a",
    meals: yesNo(body?.expenses?.meals),
    other: yesNo(body?.expenses?.other),
    otherText: text(body?.expenses?.otherText, 200),
  };
  if (!expenses.transport) problems.push("Tell us whether your agency covers transportation.");
  if (hotel === "yes" && !expenses.hotel) problems.push("Tell us whether your agency covers accommodation.");
  if (!expenses.meals) problems.push("Tell us whether your agency covers meals.");
  if (!expenses.other) problems.push("Tell us whether your agency covers any other cost.");

  if (body.copyright !== true) problems.push("Please confirm the copyright statement.");

  // Six choices, each required. Loose checkboxes are how the paper form came
  // back half-answered; here nothing submits until all six are set.
  const media = {};
  for (const row of ["photo", "materials", "summary"]) {
    for (const surface of ["internal", "public"]) {
      const value = yesNo(body?.media?.[row]?.[surface]);
      if (!value) problems.push("Please answer every media-sharing line.");
      media[row] = { ...(media[row] ?? {}), [surface]: value };
    }
  }

  const signature = text(body.signature, 160);
  if (!signature) problems.push("Please type your name to sign.");
  if (body.agreed !== true) problems.push("Please confirm your electronic signature.");

  if (problems.length) return json({ problems: [...new Set(problems)] }, 422);

  const now = new Date();
  presenter.first = first;
  presenter.last = last;
  presenter.email = email;
  presenter.organization = text(body.organization, 200);
  presenter.status = "submitted";
  presenter.submittedAt = now.toISOString();
  presenter.submission = {
    phone: text(body.phone, 60),
    talk,
    bio,
    outline,
    headshotName: text(body.headshotName, 200),
    travel,
    travelFrom: text(body.travelFrom, 10),
    travelTo: text(body.travelTo, 10),
    hotel,
    hotelFrom: text(body.hotelFrom, 10),
    hotelTo: text(body.hotelTo, 10),
    expenses,
    copyright: true,
    media,
    signature,
    signedAt: now.toISOString(),
  };

  await putPresenter(presenter);

  // Tell the board someone needs to review — best effort, never blocks the presenter.
  const recipients = [...new Set([...(event.notify ?? []), event.contact?.email].filter(Boolean))];
  if (recipients.length) {
    const origin = process.env.URL || new URL(req.url).origin;
    const adminUrl = `${origin}/admin.html#review/${encodeURIComponent(event.id)}/${encodeURIComponent(presenter.id)}`;
    const mail = reviewNeededMail({ event: describeEvent(event), presenter, adminUrl });
    presenter.reviewNotice = await sendMail({ to: recipients, ...mail })
      .then((r) => ({ ok: !r.skipped, ...r, at: now.toISOString() }))
      .catch((e) => ({ ok: false, error: e.message, at: now.toISOString() }));
    await putPresenter(presenter);
  }

  return json({
    ok: true,
    reference: presenter.reference,
    // Submission is not the end of the line — a board member still has to set
    // what ONGIA covers and sign before anything is final.
    next: {
      review: "An ONGIA board member reviews it and confirms which costs ONGIA will cover.",
      finalCopy: "You'll be emailed the signed final copy once they approve.",
      draftMaterials: formatDate(event.deadlines.draft),
    },
  });
}
