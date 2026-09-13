import { fail, requireAdmin } from "./lib/http.mjs";
import { getPdf, resolveToken, getEvent, getPresenter } from "./lib/store.mjs";
import { safeFileName } from "./lib/ids.mjs";

/**
 * The final PDF.
 *   GET /api/download?t=<presenter token>           the presenter's own copy (only once approved)
 *   GET /api/download?event=…&presenter=…           admin, with the x-admin-key header
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

  if (presenter.status !== "approved") return fail("There is no final copy yet — it is issued when a board member approves.", 409);
  const pdf = await getPdf(`${event.id}:${presenter.id}`);
  if (!pdf) return fail("The final PDF is missing from storage.", 500);

  const name = `${safeFileName(presenter.last, "Presenter")}_Presenter Agreement.pdf`;
  return new Response(pdf, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${url.searchParams.get("inline") ? "inline" : "attachment"}; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
};
