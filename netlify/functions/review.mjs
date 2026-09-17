import { json, fail, requireAdmin, text } from "./lib/http.mjs";
import { siteUrl } from "./lib/site.mjs";
import { getEvent, getPresenter, putPresenter, putPdf, getPdf, getHeadshot } from "./lib/store.mjs";
import { buildAgreementPdf } from "./lib/pdf.mjs";
import { describeEvent, travelWindow, rangeProblem, formatDate } from "./lib/deadlines.mjs";
import { sendMail, finalCopyMail, approvedNoticeMail, returnedMail, coordinatorOf } from "./lib/mail.mjs";
import { fileAgreement } from "./lib/graph.mjs";
import { safeFileName } from "./lib/ids.mjs";

/**
 * The board member's step. Nothing is final until this runs.
 *
 *   GET  /api/review?event=…&presenter=…                    everything needed to review
 *   POST /api/review?event=…&presenter=…&action=approve     set what ONGIA covers, sign, issue the final PDF
 *   POST /api/review?event=…&presenter=…&action=return      send it back to the presenter with a note
 *   POST /api/review?event=…&presenter=…&action=redeliver   retry email / SharePoint filing for an approved one
 */
export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);

  const url = new URL(req.url);
  const eventId = url.searchParams.get("event");
  const presenterId = url.searchParams.get("presenter");
  if (!eventId || !presenterId) return fail("Pass ?event=…&presenter=…");

  const [event, presenter] = await Promise.all([getEvent(eventId), getPresenter(eventId, presenterId)]);
  if (!event || !presenter) return fail("No such presenter on that event.", 404);

  if (req.method === "GET") return show(event, presenter);
  if (req.method !== "POST") return fail("Method not allowed.", 405);

  const body = (await req.json().catch(() => null)) ?? {};
  const origin = siteUrl(req);
  switch (url.searchParams.get("action")) {
    case "approve": return approve(event, presenter, body, origin);
    case "return": return sendBack(event, presenter, body, origin);
    case "redeliver": return redeliver(event, presenter, body, origin);
    default: return fail("action must be approve, return or redeliver.");
  }
};

async function show(event, presenter) {
  const headshot = await getHeadshot(event.id, presenter.id);
  return json({
    event: describeEvent(event),
    presenter,
    headshot: headshot ? { name: headshot.name, type: headshot.type, size: headshot.bytes.byteLength } : null,
    pdfReady: presenter.status === "approved",
  });
}

const COST_KEYS = ["transport", "hotel", "meals", "other"];
const COST_LABELS = { transport: "transportation", hotel: "accommodation", meals: "meals", other: "other costs" };

async function approve(event, presenter, body, origin) {
  if (presenter.status !== "submitted" && presenter.status !== "returned") {
    return fail(
      presenter.status === "approved"
        ? "Already approved. Use redeliver to resend or refile the final copy."
        : "The presenter hasn't submitted yet, so there is nothing to approve.",
      409
    );
  }
  const approverName = text(body.approverName, 120);
  const approverRole = text(body.approverRole, 120);
  if (!approverName) return fail("The approving board member's name is required — it is the signature.");
  if (body.attest !== true) return fail("Please confirm the electronic signature.");

  const ongiaCovers = {};
  for (const k of COST_KEYS) ongiaCovers[k] = body?.covers?.[k] === true;

  // Travel and hotel dates are the board member's to confirm. Default to what
  // the presenter asked for; whatever is approved must sit inside the window.
  const s = presenter.submission ?? {};
  const window = travelWindow(event);
  const dates = {};
  for (const [key, label, fromKey, toKey] of [["travel", "Travel", "travelFrom", "travelTo"], ["hotel", "Hotel", "hotelFrom", "hotelTo"]]) {
    if (s[key] !== "yes") { dates[key] = null; continue; }
    const from = text(body?.[key]?.from, 10) || s[fromKey];
    const to = text(body?.[key]?.to, 10) || s[toKey];
    const problem = rangeProblem(from, to, window, label);
    if (problem) return fail(problem);
    dates[key] = { from, to, changed: from !== s[fromKey] || to !== s[toKey] };
  }
  const now = new Date().toISOString();

  presenter.review = {
    ongiaCovers,
    travel: dates.travel,
    hotel: dates.hotel,
    otherText: text(body.otherText, 200),
    note: text(body.note, 2000),
    approver: { name: approverName, role: approverRole },
    approvedAt: now,
  };
  presenter.status = "approved";
  presenter.approvedAt = now;
  // Save the decision before any network call — an email hiccup must never
  // lose a board member's signature.
  await putPresenter(presenter);

  const approval = { name: approverName, role: approverRole, approvedAt: now };
  const shot = await getHeadshot(event.id, presenter.id).catch(() => null);
  const pdf = await buildAgreementPdf({ event, presenter, approval, headshot: shot });
  await putPdf(`${event.id}:${presenter.id}`, pdf);

  presenter.delivery = {};
  await deliver(event, presenter, pdf, origin, { presenterEmail: true, filing: true, boardEmail: true });
  await putPresenter(presenter);

  return json({ ok: true, presenter, delivery: presenter.delivery });
}

async function sendBack(event, presenter, body, origin) {
  if (presenter.status === "approved") return fail("Already approved; it can't be returned.", 409);
  if (presenter.status !== "submitted" && presenter.status !== "returned") {
    return fail("The presenter hasn't submitted yet, so there is nothing to send back.", 409);
  }
  const note = text(body.note, 2000);
  if (!note) return fail("Tell the presenter what needs changing.");

  presenter.status = "returned";
  presenter.review = {
    ...(presenter.review ?? {}),
    returnNote: note,
    returnedBy: text(body.approverName, 120),
    returnedAt: new Date().toISOString(),
  };
  const link = `${origin}/a/${presenter.token}`;
  const mail = returnedMail({ event, presenter, link, note });
  presenter.delivery = { returnEmail: await attempt(() => sendMail({ to: presenter.email, replyTo: coordinatorOf(event).email || undefined, ...mail })) };
  await putPresenter(presenter);
  return json({ ok: true, presenter });
}

async function redeliver(event, presenter, body, origin) {
  if (presenter.status !== "approved") return fail("Only an approved agreement can be redelivered.", 409);
  // The decision is saved before the PDF is built, so a failure in between
  // leaves an approved presenter with no file. Everything needed to rebuild
  // it is on the record, so rebuild rather than refuse.
  let pdf = await getPdf(`${event.id}:${presenter.id}`).then((b) => (b ? Buffer.from(b) : null));
  if (!pdf) {
    const approval = { ...(presenter.review?.approver ?? { name: "ONGIA", role: "" }), approvedAt: presenter.review?.approvedAt ?? presenter.approvedAt };
    const shot = await getHeadshot(event.id, presenter.id).catch(() => null);
    pdf = await buildAgreementPdf({ event, presenter, approval, headshot: shot });
    await putPdf(`${event.id}:${presenter.id}`, pdf);
  }

  const d = presenter.delivery ?? {};
  // Retry only the parts that didn't land, unless asked for everything.
  const which = body.all === true
    ? { presenterEmail: true, filing: true, boardEmail: true }
    : { presenterEmail: !d.presenterEmail?.ok, filing: !d.filing?.ok, boardEmail: !d.boardEmail?.ok };
  if (body.only) which[body.only] = true;

  await deliver(event, presenter, pdf, origin, which);
  await putPresenter(presenter);
  return json({ ok: true, delivery: presenter.delivery, retried: which });
}

/** Email the presenter, file to SharePoint, tell the board — each recorded separately. */
async function deliver(event, presenter, pdf, origin, which) {
  const ev = describeEvent(event);
  const approval = presenter.review.approver
    ? { ...presenter.review.approver, approvedAt: presenter.review.approvedAt }
    : { name: "ONGIA", role: "", approvedAt: presenter.approvedAt };
  const coverage = COST_KEYS.filter((k) => presenter.review.ongiaCovers?.[k]).map((k) => COST_LABELS[k]);
  const filename = `${safeFileName(presenter.last, "Presenter")}_Presenter Agreement.pdf`;
  presenter.delivery ??= {};

  if (which.filing) {
    const headshot = await getHeadshot(event.id, presenter.id).catch(() => null);
    presenter.delivery.filing = await attempt(() => fileAgreement({ event, presenter, pdf, headshot }));
  }

  if (which.presenterEmail) {
    const mail = finalCopyMail({ event: ev, presenter, approval, coverage });
    presenter.delivery.presenterEmail = await attempt(() =>
      sendMail({ to: presenter.email, replyTo: coordinatorOf(event).email || undefined, attachments: [{ filename, content: pdf }], ...mail })
    );
  }

  if (which.boardEmail) {
    const recipients = [...new Set([event.reviewer?.email, ...(event.notify ?? []), event.contact?.email].filter(Boolean))];
    if (recipients.length) {
      const filing = presenter.delivery.filing?.result ?? presenter.delivery.filing;
      const mail = approvedNoticeMail({ event: ev, presenter, approval, coverage, filing });
      const attachments = filing?.folderUrl ? [] : [{ filename, content: pdf }];
      presenter.delivery.boardEmail = await attempt(() => sendMail({ to: recipients, replyTo: coordinatorOf(event).email || undefined, attachments, ...mail }));
    } else {
      presenter.delivery.boardEmail = { ok: true, skipped: true, reason: "No board emails on this event." };
    }
  }
}

/** Run a side effect and record how it went rather than throwing. */
async function attempt(fn) {
  const at = new Date().toISOString();
  try {
    const result = await fn();
    if (result?.skipped) return { ok: false, skipped: true, reason: result.reason, at };
    return { ok: true, at, ...flatten(result) };
  } catch (e) {
    return { ok: false, error: e.message, at };
  }
}
const flatten = (r) => (r && typeof r === "object" ? r : {});
