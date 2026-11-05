import { json, fail, requireAdmin, editGuard, adminWho } from "./lib/http.mjs";
import { getEvent, getMeta, putEvent } from "./lib/store.mjs";
import { primeRoster } from "./lib/signature.mjs";
import { mailPeople, sendOne, KINDS } from "./lib/attmail.mjs";
import { emailSchedule } from "./lib/schedule.mjs";

/**
 * Who has had an email to attendees, person by person, and Send again (Andrew 5 Nov 2026).
 *
 *   GET  /api/attmail?event=…&kind=welcome|reply              everyone registered and where that email stands for them
 *   POST /api/attmail?event=…&kind=welcome|reply&to=<email>   send it to that one address now (their own version)
 *   GET  /api/attmail?event=…&kind=schedule                   every email that will go on its own from today, and to how many
 *   POST /api/attmail?event=…&kind=now&type=welcome&key=…     Send now from Coming up: that welcome version to all still owed it
 *   POST /api/attmail?event=…&kind=now&type=hotel&days=…      or that hotel reminder (both on the server, in the background)
 */
export default async (req) => {
  await primeRoster();
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const url = new URL(req.url);
  const event = await getEvent(url.searchParams.get("event"));
  if (!event) return fail("No such event.", 404);
  const kind = url.searchParams.get("kind");
  if (req.method === "GET" && kind === "schedule") return json({ emails: await emailSchedule(event), sending: event.sendNow ?? null, replySending: event.replySending ?? null });
  if (req.method === "POST" && kind === "now") {
    const viewOnly = editGuard(req, event); if (viewOnly) return viewOnly;
    return startNow(event, url, adminWho(req));
  }
  if (!KINDS.includes(kind)) return fail("Which email?");
  if (req.method === "GET") {
    const people = await mailPeople(event, kind);
    const b = (await getMeta("attmail:bounces")) ?? null;
    return json({ people, bounceCheck: b ? { at: b.at, error: b.error ?? null } : null });
  }
  if (req.method !== "POST") return fail("Not allowed.", 405);
  const viewOnly = editGuard(req, event); if (viewOnly) return viewOnly;
  const out = await sendOne(event, kind, url.searchParams.get("to"));
  if (out.problem) return fail(out.problem, 409);
  console.log(`attmail: ${kind} sent again to one attendee on ${event.id} by ${adminWho(req)?.email ?? "admin"}`);
  return json(out);
};

/** Start a Send now on the server; one at a time per event. */
async function startNow(event, url, who) {
  const type = url.searchParams.get("type");
  const key = url.searchParams.get("key") ?? "";
  const days = Number(url.searchParams.get("days"));
  if (!["welcome", "hotel"].includes(type)) return fail("Which email?");
  if (type === "hotel" && ![30, 15, 7].includes(days)) return fail("Which hotel reminder?");
  if (type === "hotel" && event.attendeeMail !== true) return fail("Emails to attendees are off for this event, so the hotel reminder can't go. Turn them on first.", 409);
  if (event.sendNow && Date.now() - Date.parse(event.sendNow.at) < 20 * 60 * 1000) return json({ started: true, already: true });
  event.sendNow = { at: new Date().toISOString(), type, key, days: days || null, by: who?.name || who?.email || "the desk key", hop: 0 };
  await putEvent(event);
  try {
    const r = await fetch(`${url.origin}/api/attmail-send-background?event=${encodeURIComponent(event.id)}&type=${type}&key=${encodeURIComponent(key)}&days=${days || ""}`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "" } });
    if (r.status >= 400) throw new Error(`the server run answered ${r.status}`);
    console.log(`attmail: send now ${type} ${key || days} on ${event.id} by ${who?.email ?? "admin"}`);
    return json({ started: true });
  } catch (e) {
    delete event.sendNow; await putEvent(event);
    return fail(`It didn't start: ${e.message}. Nothing was sent; try again in a minute.`, 503);
  }
}
