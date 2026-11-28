import { getImage } from "./lib/newsroom.mjs";

/**
 * A Newsroom post image, at a public address Buffer can fetch: /api/newsimg?id=<story id>. The id is long and random
 * (the night plus ten random characters), and the image is the public post itself, so nothing private is behind it.
 */
export default async (req) => {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^\d{8}-[0-9a-f]{10}$/.test(id)) return new Response("Not found.", { status: 404 });
  const bytes = await getImage(id);
  if (!bytes) return new Response("Not found.", { status: 404 });
  return new Response(bytes, { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
};
