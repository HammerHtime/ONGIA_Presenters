import { json, fail, text } from "./lib/http.mjs";
import { resolveToken, putPresenter, putHeadshot } from "./lib/store.mjs";

/**
 * The presenter's headshot, sent as the raw image body after the form itself.
 *   POST /api/headshot?t=…   headers: content-type image/jpeg|png, x-file-name
 */
const MAX = 5 * 1024 * 1024;

export default async (req) => {
  if (req.method !== "POST") return fail("Method not allowed.", 405);
  const url = new URL(req.url);
  const found = await resolveToken(url.searchParams.get("t"));
  if (!found) return fail("This link isn't valid.", 404);
  const { event, presenter } = found;
  if (presenter.status === "approved") return fail("This agreement is final; contact ONGIA to change the photo.", 409);

  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!["image/jpeg", "image/png"].includes(type)) return fail("Please send a .jpg or .png image.", 415);

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
