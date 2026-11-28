import { getMeta, putMeta } from "./lib/store.mjs";
import { settings, torontoHour } from "./lib/newsroom.mjs";
import { siteOrigin } from "./lib/site.mjs";

/**
 * The Newsroom's night, about 2 a.m. Toronto (spec). Netlify's schedules are in UTC and 2 a.m. in Toronto is 07:00
 * UTC in winter and 06:00 in summer, so this wakes at both and goes on only when it is really 2 a.m. there. It does
 * nothing at all until Andrew switches the Newsroom on in the Control room.
 */
export const config = { schedule: "0 6,7 * * *" };

export default async () => {
  if (torontoHour() !== 2) return new Response("not 2 a.m. in Toronto", { status: 200 });
  const set = await settings();
  if (!set.on) return new Response("the Newsroom is switched off", { status: 200 });
  const busy = await getMeta("newsroom:running");
  if (busy?.at && Date.now() - Date.parse(busy.at) < 20 * 60 * 1000) return new Response("already running", { status: 200 });
  await putMeta("newsroom:running", { at: new Date().toISOString(), by: "the nightly run", mode: "live" });
  const r = await fetch(`${siteOrigin()}/api/newsroom-run-background`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "", "content-type": "application/json" }, body: JSON.stringify({ mode: "live", by: "the nightly run" }) }).catch((e) => ({ status: 0, e }));
  if (r.status !== 202) { await putMeta("newsroom:running", null); console.log(`could not start the Newsroom run (${r.status})`); }
  return new Response(null, { status: 202 });
};
