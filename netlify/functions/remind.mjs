import { runReminders } from "./lib/reminders.mjs";
import { sweepWix } from "./wix.mjs";
import { runHotelReminders } from "./lib/hotel.mjs";
import { runLetterRounds } from "./lib/sendletters.mjs";
import { listEvents } from "./lib/store.mjs";

/** Daily at 14:00 UTC (morning across Canada). Netlify invokes this; it has no URL. */
export const config = { schedule: "0 14 * * *" };

export default async () => {
  // The guest list first, so anything sent below goes to today's list rather
  // than yesterday's. A Wix outage must not stop the presenter reminders, so
  // the sweep is allowed to fail on its own.
  const wix = await sweepWix().catch((e) => ({ error: e.message }));
  if (wix.error) console.log(`wix sweep failed: ${wix.error}`);
  else if (wix.skipped) console.log(`wix sweep skipped: ${wix.reason}`);
  else console.log(`wix sweep: ${wix.events.length} event(s), ${wix.events.filter((e) => e.error).length} failed`);

  const out = await runReminders({ origin: process.env.APP_URL || process.env.URL || "" });
  console.log(`reminders: ${out.count} planned, ${out.results.filter((r) => r.sent).length} sent`);

  // Room-block reminders, after the sweep so a person who registered yesterday
  // is on today's list, and after the presenter run so a Wix problem cannot
  // cost an agreement chase.
  const hotel = await runHotelReminders(await listEvents()).catch((e) => [{ error: e.message }]);
  for (const r of hotel) console.log(`hotel ${r.days ?? "?"}-day for ${r.title ?? r.event}: ${r.error ?? `${r.sent} sent, ${r.failed ?? 0} failed`}`);

  // Welcome letters and surveys. A letter with a problem in it is held back
  // and the reason logged, rather than sent with a blank or a note left in.
  const letters = await runLetterRounds(await listEvents()).catch((e) => [{ error: e.message }]);
  for (const r of letters.filter((x) => !x.skipped || x.blocked)) {
    console.log(`${r.kind ?? "letter"} for ${r.title ?? r.event}: ${r.error ?? (r.blocked ? `held back — ${r.blocked[0]}` : `${r.sent} sent, ${r.failed ?? 0} failed`)}`);
  }

  return new Response(JSON.stringify({ ...out, wix, hotel, letters }), { headers: { "content-type": "application/json" } });
};
