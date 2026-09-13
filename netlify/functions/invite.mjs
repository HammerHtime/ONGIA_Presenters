import { json, fail, requireAdmin } from "./lib/http.mjs";
import { siteUrl } from "./lib/site.mjs";
import { getEvent, listPresenters, putPresenter } from "./lib/store.mjs";
import { describeEvent } from "./lib/deadlines.mjs";
import { sendMail, invitationMail } from "./lib/mail.mjs";

/**
 * Email presenters their personal link.
 *
 *   POST /api/invite?id=<event>   body { presenterIds?: [...], remind?: true }
 *
 * With no presenterIds, everyone who hasn't submitted gets one. `remind`
 * switches the wording to a chase-up. Every send is logged on the presenter
 * so the dashboard can show "invited 3 times, last on …".
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
      const out = await sendMail({ to: p.email, replyTo: event.contact?.email, ...mail });
      if (out.skipped) { failed.push({ id: p.id, name: `${p.first} ${p.last}`, why: out.reason }); continue; }
      p.mail = [...(p.mail ?? []), { type: remind ? "reminder" : "invitation", at: new Date().toISOString(), id: out.id }];
      p.invitedAt ??= p.mail.at(-1).at;
      await putPresenter(p);
      sent.push({ id: p.id, name: `${p.first} ${p.last}`, email: p.email });
    } catch (e) {
      failed.push({ id: p.id, name: `${p.first} ${p.last}`, why: e.message });
    }
  }
  return json({ sent, failed, remind });
};
