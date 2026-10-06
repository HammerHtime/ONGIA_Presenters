import { runNight, noteNight, siteOrigin } from "./lib/nightly.mjs";

/**
 * Daily at 14:00 UTC (morning across Canada). Netlify gives a scheduled
 * function 30 seconds, too short for a big guest list, so this only starts the
 * real run in the background (nightly-background.mjs) and returns.
 *
 * If the background run cannot be started, the work is done here instead, with
 * a 22-second budget: whatever does not fit is still owed and goes tomorrow,
 * and because each person is saved the moment their email goes, nobody is ever
 * sent anything twice.
 */
export const config = { schedule: "0 14 * * *" };

export default async () => {
  const origin = siteOrigin();
  try {
    if (!origin) throw new Error("the site address is not known (APP_URL / URL)");
    const r = await fetch(`${origin}/api/nightly-background`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "" } });
    if (r.status !== 202) throw new Error(`the background run answered ${r.status}`);
    console.log("morning run started in the background");
    return new Response(null, { status: 202 });
  } catch (e) {
    console.log(`could not start the background run (${e.message}); running here instead`);
    const out = await runNight({ origin, deadline: Date.now() + 22_000 });
    await noteNight(out, { ran: "inline", why: e.message });
    const { detail, ...summary } = out;
    return new Response(JSON.stringify(summary), { headers: { "content-type": "application/json" } });
  }
};
