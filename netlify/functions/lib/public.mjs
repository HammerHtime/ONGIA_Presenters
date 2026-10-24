/** Who and what of an event's presenters may go on a public website. Shared by the presenter export and the website button. */

export const slugOf = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const yes = (v) => v === "yes";

/**
 * Whether a presenter goes on a public website, and what of theirs. The one place the rule lives: the zip export and the
 * "Update website" button both ask this.
 *  - in: signed (submitted or approved; not invited, opened, or sent back for changes) and yes to their presentation summary
 *    on public platforms;
 *  - photo: also yes to photographs on public platforms;
 *  - bio: "yes" when they said yes to their biography on public platforms (asked since 22 Oct 2026), "legacy" when they
 *    signed before that line existed (the public summary covers it, as before, and the record is marked to ask again),
 *    "no" when they said no: they are listed without a bio.
 */
export function publicConsent(p) {
  const signed = p.status === "submitted" || p.status === "approved";
  const media = p.submission?.media ?? {};
  if (!signed || !yes(media.summary?.public)) return { in: false, signed };
  const bioAnswer = media.bio?.public;
  return { in: true, signed, photo: yes(media.photo?.public), materials: yes(media.materials?.public), bio: bioAnswer === undefined || bioAnswer === null ? "legacy" : yes(bioAnswer) ? "yes" : "no" };
}

/** Signed presenters in the order a website lists them: by last name, then first. */
export const byLastName = (list) => [...list].sort((a, b) => `${a.last} ${a.first}`.localeCompare(`${b.last} ${b.first}`));
