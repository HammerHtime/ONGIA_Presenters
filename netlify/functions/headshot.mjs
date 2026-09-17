import { json, fail, text, requireAdmin } from "./lib/http.mjs";
import { resolveToken, putPresenter, putHeadshot, getHeadshot, getEvent, getPresenter } from "./lib/store.mjs";

/**
 * The presenter's headshot, sent as the raw image body after the form itself.
 *   POST /api/headshot?t=…                     headers: content-type image/jpeg|png, x-file-name
 *   GET  /api/headshot?event=…&presenter=…     the image itself, for the board's review screen
 */
const MAX = 5 * 1024 * 1024;

export default async (req) => {
  const url = new URL(req.url);

  // The board member reviewing an agreement should see the photo before they
  // sign it, not only after the PDF exists.
  if (req.method === "GET") {
    const denied = requireAdmin(req);
    if (denied) return fail(denied, 401);
    const event = await getEvent(url.searchParams.get("event"));
    const presenter = event && (await getPresenter(event.id, url.searchParams.get("presenter")));
    if (!presenter) return fail("No such presenter.", 404);
    const shot = await getHeadshot(event.id, presenter.id).catch(() => null);
    if (!shot?.bytes?.byteLength) return fail("No headshot on this agreement.", 404);
    return new Response(shot.bytes, {
      headers: { "content-type": shot.type || "image/jpeg", "cache-control": "no-store" },
    });
  }

  if (req.method !== "POST") return fail("Method not allowed.", 405);
  const found = await resolveToken(url.searchParams.get("t"));
  if (!found) return fail("This link isn't valid.", 404);
  const { event, presenter } = found;
  if (presenter.status === "approved") return fail("This agreement is final; contact ONGIA to change the photo.", 409);

  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!["image/jpeg", "image/png"].includes(type)) return fail("Please send a .png or .jpeg image.", 415);

  const bytes = await req.arrayBuffer();
  if (!bytes.byteLength) return fail("The image was empty.");
  if (bytes.byteLength > MAX) return fail("That image is over 5 MB. Please choose a smaller one.", 413);

  const name = text(decodeURIComponent(req.headers.get("x-file-name") ?? ""), 200) || (type === "image/png" ? "headshot.png" : "headshot.jpg");
  await putHeadshot(event.id, presenter.id, bytes, { type, name });

  presenter.headshot = { name, type, size: bytes.byteLength, at: new Date().toISOString() };
  if (presenter.submission) presenter.submission.headshotName = name;
  await putPresenter(presenter);
  return json({ ok: true, headshot: presenter.headshot });
};
