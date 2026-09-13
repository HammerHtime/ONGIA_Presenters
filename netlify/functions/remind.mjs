import { runReminders } from "./lib/reminders.mjs";

/** Daily at 14:00 UTC (morning across Canada). Netlify invokes this; it has no URL. */
export const config = { schedule: "0 14 * * *" };

export default async () => {
  const out = await runReminders({ origin: process.env.APP_URL || process.env.URL || "" });
  console.log(`reminders: ${out.count} planned, ${out.results.filter((r) => r.sent).length} sent`);
  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
};
