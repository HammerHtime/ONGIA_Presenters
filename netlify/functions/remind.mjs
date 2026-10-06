import { runReminders } from "./lib/reminders.mjs";
import { sweepWix } from "./wix.mjs";

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
  return new Response(JSON.stringify({ ...out, wix }), { headers: { "content-type": "application/json" } });
};
