import { runReminders } from "./reminders.mjs";
import { sweepWix } from "../wix.mjs";
import { runHotelReminders } from "./hotel.mjs";
import { runLetterRounds } from "./sendletters.mjs";
import { listEvents, putMeta } from "./store.mjs";
import { pacer } from "./bulk.mjs";
import { runInbox } from "./inbox.mjs";

/** The site's own address, for links in emails and for starting background runs. */
export const siteOrigin = (fallback = "") => process.env.APP_URL || process.env.URL || fallback;

/**
 * Everything the desk does each morning, in order:
 *  1. the Wix guest lists, so anything sent goes to today's list
 *  2. presenter chase-ups, the board digests and the Monday summary
 *  2b. Andrew's email of the day, filed on the event it is about
 *  3. room-block reminders to attendees
 *  4. welcome letters and surveys
 * Steps 3 and 4 can be hundreds of emails, sent at the pace the mailbox
 * allows; past `deadline` no new send starts and the rest are reported as
 * `left`. With `sendsOnly` (a follow-up run the same day) 1 and 2 are skipped.
 */
export async function runNight({ origin = siteOrigin(), deadline = null, sendsOnly = false, pace = pacer() } = {}) {
  const out = { at: new Date().toISOString(), sendsOnly };

  if (!sendsOnly) {
    // A Wix outage must not stop the presenter reminders.
    const wix = await sweepWix().catch((e) => ({ error: e.message }));
    out.wix = wix.error ? { error: wix.error } : wix.skipped ? { skipped: wix.reason } : { events: wix.events.length, failed: wix.events.filter((e) => e.error).length };
    console.log(`wix sweep: ${JSON.stringify(out.wix)}`);

    const rem = await runReminders({ origin }).catch((e) => ({ error: e.message, results: [] }));
    out.reminders = rem.error ? { error: rem.error } : { planned: rem.count, sent: rem.results.filter((r) => r.sent).length, failed: rem.results.filter((r) => r.error).length };
    console.log(`reminders: ${JSON.stringify(out.reminders)}`);

    // Andrew's email, filed on its event. Capped at five minutes so the sends
    // after it keep most of the run; whatever is left is read tomorrow.
    const five = Date.now() + 5 * 60 * 1000;
    const inbox = await runInbox({ deadline: deadline ? Math.min(deadline, five) : five }).catch((e) => ({ error: e.message }));
    out.inbox = inbox.error ? { error: inbox.error } : inbox.skipped ? { skipped: inbox.reason } : { read: inbox.read, added: inbox.added, replied: inbox.replied, errors: inbox.errors };
    console.log(`inbox: ${JSON.stringify(out.inbox)}`);
  }

  const hotel = await runHotelReminders(await listEvents(), { deadline, pace }).catch((e) => [{ error: e.message }]);
  for (const r of hotel) console.log(`hotel ${r.days ?? "?"}-day for ${r.title ?? r.event}: ${r.error ?? `${r.sent} sent, ${r.failed ?? 0} failed, ${r.left ?? 0} left`}`);

  // A letter with a problem in it is held back and the reason logged, rather
  // than sent with a blank or a note left in.
  const letters = await runLetterRounds(await listEvents(), { deadline, pace }).catch((e) => [{ error: e.message }]);
  for (const r of letters.filter((x) => !x.skipped || x.blocked)) {
    console.log(`${r.kind ?? "letter"} for ${r.title ?? r.event}: ${r.error ?? (r.blocked ? `held back — ${r.blocked[0]}` : `${r.sent} sent, ${r.failed ?? 0} failed, ${r.left ?? 0} left`)}`);
  }

  const total = (rows, k) => rows.reduce((n, r) => n + (r[k] ?? 0), 0);
  out.hotel = { sent: total(hotel, "sent"), failed: total(hotel, "failed"), errors: hotel.filter((r) => r.error).length };
  out.letters = { sent: total(letters, "sent"), failed: total(letters, "failed"), blocked: letters.filter((r) => r.blocked).length, errors: letters.filter((r) => r.error).length };
  out.left = total(hotel, "left") + total(letters, "left");
  out.detail = { hotel, letters };
  return out;
}

/** What the health check shows about the last run — counts only, no names or addresses. */
export async function noteNight(out, extra = {}) {
  const { detail, ...summary } = out;
  await putMeta("nightly", { ...summary, ...extra, finishedAt: new Date().toISOString() });
}
