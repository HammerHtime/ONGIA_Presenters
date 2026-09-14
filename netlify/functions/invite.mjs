import { json, fail, requireAdmin } from "./lib/http.mjs";
import { siteUrl } from "./lib/site.mjs";
import { getEvent, listPresenters, putPresenter } from "./lib/store.mjs";
import { describeEvent } from "./lib/deadlines.mjs";
import { sendMail, invitationMail, coordinatorOf } from "./lib/mail.mjs";

/**
 * Email presenters their personal link.
 *
 *   POST /api/invite?id=<event>          body { presenterIds?: [...], remind?: true }
 *   POST /api/invite?id=<event>&called=1 body { presenterIds: [...] }
 *
 * With no presenterIds, everyone who hasn't submitted gets one. `remind`
 * switches the wording to a chase-up. Every send is logged on the presenter
 * so the dashboard can show "invited 3 times, last on …".
 *
 * `called=1` logs a phone call instead of sending anything. After four emails a
 * call is what actually works, and recording it stands the automatic reminders
 * down for a week so the desk stops nagging someone who has already been reached.
 */
export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  if (req.method !== "POST") return fail("Method not allowed.", 405);

  const url = new URL(req.url);
  const event = await getEvent(url.searchParams.get("id"));
  if (!event) return fail("No such event.", 404);

  const body = (await req.json().catch(() => null)) ?? {};
  const wanted = Array.isArray(body.presenterIds) ? new Set(body.presenterIds) : null;
  const remind = body.remind === true;

  if (url.searchParams.get("called") === "1") {
    if (!wanted?.size) return fail("Which presenter did you call? Pass presenterIds.");
    const called = [];
    for (const p of (await listPresenters(event.id)).filter((x) => wanted.has(x.id))) {
      p.mail = [...(p.mail ?? []), { type: "called", at: new Date().toISOString() }];
      await putPresenter(p);
      called.push({ id: p.id, name: `${p.first} ${p.last}` });
    }
    return json({ called });
  }
  const origin = siteUrl(req);
  const ev = describeEvent(event);

  const people = (await listPresenters(event.id)).filter((p) =>
    wanted ? wanted.has(p.id) : p.status !== "submitted" && p.status !== "approved"
  );

  const sent = [];
  const failed = [];
  for (const p of people) {
    const link = `${origin}/a/${p.token}`;
    const mail = invitationMail({ event: ev, presenter: p, link, remind });
    try {
      const out = await sendMail({ to: p.email, replyTo: coordinatorOf(event).email || undefined, ...mail });
      if (out.skipped) {
        failed.push({ id: p.id, name: `${p.first} ${p.last}`, why: out.reason });
        p.lastSendError = { why: out.reason, at: new Date().toISOString() };
        await putPresenter(p);
        continue;
      }
      p.mail = [...(p.mail ?? []), { type: remind ? "reminder" : "invitation", at: new Date().toISOString(), id: out.id }];
      p.invitedAt ??= p.mail.at(-1).at;
      // A send that worked clears the last failure, so the desk stops reporting it.
      p.lastSendError = null;
      await putPresenter(p);
      sent.push({ id: p.id, name: `${p.first} ${p.last}`, email: p.email });
    } catch (e) {
      failed.push({ id: p.id, name: `${p.first} ${p.last}`, why: e.message });
      // Kept on the record: a toast that vanishes in three seconds is not a report.
      p.lastSendError = { why: e.message, at: new Date().toISOString() };
      await putPresenter(p);
    }
  }
  return json({ sent, failed, remind });
};
