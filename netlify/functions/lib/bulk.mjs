import { mailTransport } from "./mail.mjs";

/**
 * Sending to a whole guest list.
 *
 * Microsoft 365 lets one mailbox send about 30 messages a minute, so attendee
 * mail through it goes no faster than one every 2.1 seconds (Resend allows
 * about two a second). One pace is shared by every round in a night, so two
 * events due on the same day cannot add up past the limit.
 */
export const defaultGap = () => (mailTransport()?.kind === "microsoft" ? 2100 : 550);

export function pacer(gapMs = defaultGap()) {
  let last = 0;
  return async () => {
    const wait = last + gapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
  };
}

/** Whether a run still has time to start another send. No deadline, no limit. */
export const timeLeft = (deadline) => !deadline || Date.now() < deadline;
