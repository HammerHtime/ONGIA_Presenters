import { fail, requireAdmin } from "./lib/http.mjs";
import { getPdf, resolveToken, getEvent, getPresenter, getHeadshot } from "./lib/store.mjs";
import { safeFileName } from "./lib/ids.mjs";
import { buildAgreementPdf } from "./lib/pdf.mjs";

/**
 * The final PDF.
 *   GET /api/download?t=<presenter token>           the presenter's own copy (only once approved)
 *   GET /api/download?event=…&presenter=…           admin, with the x-admin-key header
 *   GET /api/download?event=…&presenter=…&preview=1 admin, a draft built on the spot from the
 *                                                   record — nothing is stored, emailed or filed
 */
export default async (req) => {
  const url = new URL(req.url);
  let event, presenter;

  const tok = url.searchParams.get("t");
  if (tok) {
    const found = await resolveToken(tok);
    if (!found) return fail("This link isn't valid.", 404);
    ({ event, presenter } = found);
  } else {
    const denied = requireAdmin(req);
    if (denied) return fail(denied, 401);
    event = await getEvent(url.searchParams.get("event"));
    presenter = event && (await getPresenter(event.id, url.searchParams.get("presenter")));
    if (!presenter) return fail("No such presenter.", 404);
  }

  // A preview lets the board see the document — photo and all — before signing it.
  // It is built fresh each time and deliberately never stored: only approval issues a copy.
  const preview = !tok && url.searchParams.get("preview");
  let pdf;
  if (preview) {
    if (!presenter.submission) return fail("The presenter hasn't submitted yet, so there is nothing to preview.", 409);
    const approval = { name: "", role: "", approvedAt: null };
    const shot = await getHeadshot(event.id, presenter.id).catch(() => null);
    pdf = await buildAgreementPdf({ event, presenter, approval, headshot: shot, preview: true });
  } else {
    if (presenter.status !== "approved") return fail("There is no final copy yet — it is issued when a board member approves.", 409);
    pdf = await getPdf(`${event.id}:${presenter.id}`);
    if (!pdf) return fail("The final PDF is missing from storage.", 500);
  }

  const name = `${safeFileName(presenter.last, "Presenter")}_Presenter Agreement${preview ? " (DRAFT)" : ""}.pdf`;
  return new Response(pdf, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${url.searchParams.get("inline") ? "inline" : "attachment"}; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
};
