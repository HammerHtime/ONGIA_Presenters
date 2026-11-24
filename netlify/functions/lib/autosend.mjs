/**
 * Which emails go automatically, one switch each (Andrew 24 Nov 2026: "a toggle (on and off) for each of the auto emails
 * … when it's set to off, then a send now button appears"). It replaces the one "Automatic emails" switch, which turned on
 * the welcome letter along with the survey he wanted.
 *
 *   welcome  the welcome letter (and its catch-up for late registrants)
 *   reply    the food-allergy questions' late-registrant catch-up and reminders (the first send is always pressed)
 *   hotel    the hotel cut-off reminders
 *   survey   the survey and its reminders
 *   certs    the certificates, emailed to everyone checked in
 *   thanks   the presenter thank-you (kept where it always was: event.presenterThanks.off)
 *
 * An event that never had its switches set follows the old switch (event.attendeeMail), so nothing changes for it until
 * someone flips one; certificates were never automatic, so they start off. "Nothing automatic" (event.quiet) beats them all.
 * Sending by hand (Send now) never needs a switch on.
 */
export const AUTO_KINDS = ["welcome", "reply", "hotel", "survey", "certs", "thanks"];

export function autoOn(event, kind) {
  if (!event || event.quiet === true || event.project) return false;
  if (kind === "thanks") return event.presenterThanks?.off !== true;
  const set = event.auto?.[kind];
  if (typeof set === "boolean") return set;
  if (kind === "certs") return false;
  return event.attendeeMail === true;
}

/** Every switch as it stands, for the desk. */
export const autoState = (event) => Object.fromEntries(AUTO_KINDS.map((k) => [k, autoOn(event, k)]));

/**
 * Flip one. The first flip writes every switch down as it stood, so the others stop following the old switch.
 * Returns the event, changed in place.
 */
export function setAuto(event, kind, on) {
  if (!AUTO_KINDS.includes(kind)) throw new Error("Which email?");
  if (kind === "thanks") {
    event.presenterThanks = { ...(event.presenterThanks ?? {}) };
    if (on) delete event.presenterThanks.off; else event.presenterThanks.off = true;
    return event;
  }
  const now = autoState(event);
  delete now.thanks;
  event.auto = { ...now, ...(event.auto ?? {}), [kind]: on === true };
  // Kept in step for anything still reading the old switch: on while any attendee email is on.
  event.attendeeMail = ["welcome", "reply", "hotel", "survey", "certs"].some((k) => event.auto[k] === true);
  return event;
}

/** A new event: every switch off, so nothing goes until it's turned on (Andrew 24 Nov 2026). */
export function autoAllOff(event) {
  event.auto = { welcome: false, reply: false, hotel: false, survey: false, certs: false };
  event.attendeeMail = false;
  event.presenterThanks = { ...(event.presenterThanks ?? {}), off: true };
  return event;
}
