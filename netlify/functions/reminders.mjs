import { json, fail, requireAdmin } from "./lib/http.mjs";
import { siteUrl } from "./lib/site.mjs";
import { runReminders } from "./lib/reminders.mjs";

/**
 * The reminder job, on demand (the scheduled one can't be called by URL).
 *   GET /api/reminders?dry=1      what today's run would send, sending nothing
 *   GET /api/reminders?run=1      run it now
 *   GET /api/reminders?digest=1   include the weekly summary whatever the weekday (combine with dry=1 to preview)
 *   POST /api/reminders?digest=1&event=<id>&to=lead|board   send a one-event summary now, to that event's lead or to
 *                                                             the president/VP list — for testing the email
 */
export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const url = new URL(req.url);
  const eventId = url.searchParams.get("event");
  let digestRecipients = null;
  if (eventId && url.searchParams.get("to") === "lead") {
    const { getEvent } = await import("./lib/store.mjs");
    const event = await getEvent(eventId);
    if (!event) return fail("No such event.", 404);
    if (!event.reviewer?.email) return fail("This event has no lead board member — pick one on Edit event.", 409);
    digestRecipients = [event.reviewer.email];
  }
  const out = await runReminders({
    dry: url.searchParams.has("dry"),
    forceDigest: url.searchParams.has("digest"),
    origin: siteUrl(req),
    onlyEvent: eventId,
    digestRecipients,
    digestOnly: Boolean(eventId),
  });
  return json(out);
};
