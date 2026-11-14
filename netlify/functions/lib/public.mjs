/** Who and what of an event's presenters may go on a public website. Shared by the presenter export and the website button. */

export const slugOf = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const yes = (v) => v === "yes";

/**
 * Whether a presenter goes on a public website, and what of theirs. The one place the rule lives: the zip export and the
 * "Update website" button both ask this. Andrew 14 Nov 2026 (Melissa Tarsitano, Victoria: biography yes, summary no, left
 * off entirely): "a signed presenter goes on the website if they said Yes publicly to either their Biography or their
 * Summary."
 *  - in: signed (submitted or approved; not invited, opened, or sent back for changes) and yes, on public platforms, to
 *    their biography or to their presentation summary;
 *  - bio: "yes" when they said yes to their biography: name, job title, organization and bio; "no" when they said no:
 *    listed without a bio; "legacy" when they signed before the biography line was asked (22 Oct 2026) and said yes to
 *    the summary, which covered it then;
 *  - summary: yes to their summary: their talk title and description from the agreement go on too; no: neither does;
 *  - photo, materials: their answers, for the export. The CFAOC site never shows photos.
 */
export function publicConsent(p) {
  const signed = p.status === "submitted" || p.status === "approved";
  const media = p.submission?.media ?? {};
  const bioAnswer = media.bio?.public;
  const legacy = bioAnswer === undefined || bioAnswer === null;
  const summary = yes(media.summary?.public), bioYes = yes(bioAnswer);
  if (!signed || !(summary || bioYes)) return { in: false, signed, summary: false };
  return { in: true, signed, summary, photo: yes(media.photo?.public), materials: yes(media.materials?.public),
    bio: bioYes ? "yes" : legacy && summary ? "legacy" : "no" };
}

/** Signed presenters in the order a website lists them: by last name, then first. */
export const byLastName = (list) => [...list].sort((a, b) => `${a.last} ${a.first}`.localeCompare(`${b.last} ${b.first}`));
