import { fail, requireAdmin, adminWho } from "./lib/http.mjs";
import { mayCost } from "./lib/auth.mjs";
import { getEvent, listPresenters, getHeadshot } from "./lib/store.mjs";
import { makeZip } from "./lib/zip.mjs";
import { slugOf, publicConsent, byLastName } from "./lib/public.mjs";

export { slugOf, publicConsent, byLastName };

/**
 * The presenters of one event, for the event's own website (Andrew 22 Oct 2026).
 *   GET /api/export?event=…    a zip: presenter-desk-export.json and photos/
 *
 * Only what each presenter agreed to make public goes in, because a website (and the repository behind it) is public:
 *  - a presenter is in it only if they signed and said yes to their presentation summary on "social media and public
 *    platforms"; then their name, organization, bio, talk title and description go in;
 *  - their photo goes in only if they also said yes to photographs on public platforms;
 *  - never their email, phone, travel, costs, or the "not for community partners" answer.
 * The president and the VP only, like the money: it is one person deciding what leaves the desk.
 */
export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  if (!mayCost(adminWho(req))) return fail("Only the president and the VP of operations can export presenters for a website.", 403);
  if (req.method !== "GET") return fail("Method not allowed.", 405);
  const event = await getEvent(new URL(req.url).searchParams.get("event"));
  if (!event) return fail("No such event.", 404);
  const { json, photos } = await websiteExport(event, await listPresenters(event.id), getHeadshot);
  const zip = makeZip([
    { name: "presenter-desk-export.json", data: Buffer.from(JSON.stringify(json, null, 2) + "\n") },
    ...photos.map((p) => ({ name: `photos/${p.file}`, data: Buffer.from(p.bytes) })),
  ]);
  const slug = slugOf(event.title) || "event";
  return new Response(zip, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${slug}-presenters.zip"`, "cache-control": "no-store" } });
};

/** What goes on a public website, decided per presenter from their own consent answers. `headshotOf` is for tests. */
export async function websiteExport(event, presenters, headshotOf) {
  const signed = presenters.filter((p) => publicConsent(p).signed);
  const out = [], photos = [], used = new Set();
  let noConsent = 0;
  for (const p of byLastName(signed)) {
    const s = p.submission ?? {};
    const c = publicConsent(p);
    if (!c.in) { noConsent++; continue; }
    let photo = null;
    if (c.photo && s.headshotName) {
      const shot = await headshotOf(event.id, p.id).catch(() => null);
      if (shot?.bytes?.byteLength) {
        let file = `${slugOf(`${p.first} ${p.last}`) || p.id}.${shot.type === "image/png" ? "png" : "jpg"}`;
        if (used.has(file)) file = file.replace(/\.(\w+)$/, `-${p.id.slice(0, 6)}.$1`);
        used.add(file);
        photos.push({ file, bytes: shot.bytes });
        photo = `photos/${file}`;
      }
    }
    out.push({
      name: `${p.first} ${p.last}`.trim(),
      first: p.first, last: p.last,
      title: null,                       // the agreement does not ask for a job title
      organization: p.organization || null,
      bio: c.bio === "no" ? null : s.bio || null, // empty when they said no to it, said ONGIA already has it, or the event keeps bios on file
      photo,
      presentation: { title: s.talk || null, description: s.outline || null },
      session: null,                     // the desk keeps the event's daily times, not each talk's slot
      consent: {
        publicSummary: true,
        publicPhoto: c.photo,
        publicMaterials: c.materials,
        publicBio: c.bio,                // "yes", "no", or "legacy": signed before the biography line was asked
      },
      agreement: p.status === "approved" ? "signed and approved" : "signed, waiting for board approval",
    });
  }
  return {
    json: {
      event: { title: event.title, city: event.city || null, venue: event.venue || null, firstDay: event.dayOne || null, lastDay: event.lastDay || event.dayOne || null },
      exportedAt: new Date().toISOString(),
      source: "ONGIA Briefing Room",
      rules: "Only presenters who signed their agreement and agreed to their presentation summary being shared on public platforms. A photo only where they also agreed to photographs on public platforms. No contact details.",
      count: out.length,
      leftOut: { signedWithoutPublicConsent: noConsent, notSignedYet: presenters.length - signed.length },
      presenters: out,
    },
    photos,
  };
}
