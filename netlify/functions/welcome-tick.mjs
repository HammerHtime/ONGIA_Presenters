import { getMeta, putMeta } from "./lib/store.mjs";
import { welcomeEvents, held, NIGHT_LOCK, CATCHUP_LOCK } from "./lib/welcomecatchup.mjs";
import { siteOrigin } from "./lib/nightly.mjs";

/**
 * Every 15 minutes, while a welcome letter is going out: hand the catch-up (pull from Wix, send to whoever is owed it) to
 * welcome-catchup-background, which has the time a pull and a few sends need; this check has 30 seconds. Quiet when no
 * event's welcome letter is due, which is most of the year. One at a time, and never during the morning run.
 * At 7, 22, 37 and 52 past the hour, so it is clear of the morning run's start on the hour.
 */
export default async () => {
  if (!(await welcomeEvents()).length) return new Response("ok");
  if (held(await getMeta(NIGHT_LOCK))) return new Response("the morning run is sending");
  if (held(await getMeta(CATCHUP_LOCK))) return new Response("already catching up");
  await putMeta(CATCHUP_LOCK, { at: new Date().toISOString() });
  try {
    const origin = siteOrigin();
    if (!origin) throw new Error("the site address is not known (APP_URL / URL)");
    const r = await fetch(`${origin}/api/welcome-catchup-background`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "" } });
    if (r.status >= 400) throw new Error(`the background run answered ${r.status}`);
    return new Response("started");
  } catch (e) {
    console.log(`welcome catch-up not started: ${e.message}`);
    await putMeta(CATCHUP_LOCK, { at: null });
    return new Response("not started");
  }
};

export const config = { schedule: "7,22,37,52 * * * *" };
