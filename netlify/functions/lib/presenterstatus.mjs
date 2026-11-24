/*
 * Where each presenter stands, for the events list, the event page and the reminders (moved here from events.mjs, audit
 * 24 Nov 2026, so the reminders library no longer loads the whole events endpoint to count them).
 */
/** Who on an event needs someone: to review, never sent a link, not filed, an email that bounced, not signed yet. */
export function attentionOf(people) {
  const who = (f) => people.filter(f).map((p) => ({ id: p.id, name: `${p.first} ${p.last}` }));
  return {
    review: who((p) => p.status === "submitted"),
    uninvited: who((p) => !HAS_AGREEMENT(p) && !p.mail?.length && !!p.email),
    noEmail: who((p) => !HAS_AGREEMENT(p) && !p.email),
    failed: who((p) => p.status === "approved" && p.delivery?.filing && p.delivery.filing.ok === false),
    sendFailed: who((p) => !!p.lastSendError),
    outstanding: who((p) => !HAS_AGREEMENT(p)),
  };
}

/**
 * Whether this presenter is settled: their agreement signed here (submitted or approved), or finalized without one
 * (arranged directly, Andrew 3 Nov 2026). An arranged one is not chased, not counted as never sent, and not in
 * "email everyone".
 */
export const HAS_AGREEMENT = (p) => p.status === "approved" || p.status === "submitted" || p.status === "arranged";

export function countStatuses(presenters) {
  const counts = { total: presenters.length, invited: 0, opened: 0, submitted: 0, approved: 0, arranged: 0, uninvited: 0, failed: 0 };
  for (const p of presenters) {
    if (p.status === "approved") counts.approved++;
    else if (p.status === "arranged") counts.arranged++;
    else if (p.status === "submitted") counts.submitted++;
    else if (p.openedAt) counts.opened++;
    else counts.invited++;
    // Nobody has ever sent this person their link, so no reminder will ever chase
    // them: only a person can fix it.
    if (!HAS_AGREEMENT(p) && !p.mail?.length && p.email) counts.uninvited++;
    // Signed and approved, but the copy never reached SharePoint.
    if (p.status === "approved" && p.delivery && p.delivery.filing && p.delivery.filing.ok === false) counts.failed++;
  }
  return counts;
}

