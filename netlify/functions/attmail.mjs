import { json, fail, requireAdmin, editGuard, adminWho } from "./lib/http.mjs";
import { getEvent, getMeta } from "./lib/store.mjs";
import { primeRoster } from "./lib/signature.mjs";
import { mailPeople, sendOne, KINDS } from "./lib/attmail.mjs";
import { emailSchedule } from "./lib/schedule.mjs";

/**
 * Who has had an email to attendees, person by person, and Send again (Andrew 5 Nov 2026).
 *
 *   GET  /api/attmail?event=…&kind=welcome|reply              everyone registered and where that email stands for them
 *   POST /api/attmail?event=…&kind=welcome|reply&to=<email>   send it to that one address now (their own version)
 *   GET  /api/attmail?event=…&kind=schedule                   every email that will go on its own from today, and to how many
 */
export default async (req) => {
  await primeRoster();
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const url = new URL(req.url);
  const event = await getEvent(url.searchParams.get("event"));
  if (!event) return fail("No such event.", 404);
  const kind = url.searchParams.get("kind");
  if (req.method === "GET" && kind === "schedule") return json({ emails: await emailSchedule(event) });
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
