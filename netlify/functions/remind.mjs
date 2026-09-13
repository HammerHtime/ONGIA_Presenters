import { json, fail, requireAdmin } from "./lib/http.mjs";
import { listEvents, listPresenters, putPresenter } from "./lib/store.mjs";
import { describeEvent, formatDate } from "./lib/deadlines.mjs";
import { sendMail, invitationMail, layout } from "./lib/mail.mjs";

/**
 * Daily chase-ups. Runs every morning (14:00 UTC ≈ 7–10am across Canada) and
 * decides, per presenter, whether today is a day to nudge. Nothing here sends
 * twice on the same day, and nothing goes to someone who has submitted.
 *
 * Default cadence (days relative to the agreement due date; negative = before):
 *   presenters:  -14, -7, -1, 0, then every 7 days overdue
 *   board:       a digest on +3 and every 7 days after while anyone is overdue
 * Nobody is chased before they have been sent their link at least once.
 *
 *   GET /api/remind?dry=1   (admin) show what today's run would send, send nothing
 *   GET /api/remind?run=1   (admin) run it now
 */
export const config = { schedule: "0 14 * * *" };

const PRESENTER_DAYS = [-14, -7, -1, 0];
const OVERDUE_EVERY = 7;
const BOARD_FIRST = 3;

export default async (req) => {
  const url = new URL(req.url);
  const manual = url.searchParams.has("dry") || url.searchParams.has("run");
  if (manual) {
    const denied = requireAdmin(req);
    if (denied) return fail(denied, 401);
  }
  const dry = url.searchParams.has("dry");
  const today = todayIso();
  const origin = process.env.URL || url.origin;

  const plan = [];
  for (const event of await listEvents()) {
    if (event.lastDay < today) continue; // past events are history, not work
    const ev = describeEvent(event);
    const due = event.deadlines.agreement;
    const dayOffset = daysBetween(due, today); // negative before the due date
    const people = await listPresenters(event.id);
    const outstanding = people.filter((p) => p.status !== "submitted" && p.status !== "approved");

    for (const p of outstanding) {
      if (!p.mail?.length) continue; // never invited: that's the coordinator's call, not a reminder
      if (alreadyToday(p, today)) continue;
      const shouldNudge = PRESENTER_DAYS.includes(dayOffset) || (dayOffset > 0 && dayOffset % OVERDUE_EVERY === 0);
      if (!shouldNudge) continue;
      plan.push({
        kind: "presenter",
        event: event.title,
        to: p.email,
        name: `${p.first} ${p.last}`,
        why: dayOffset < 0 ? `${-dayOffset} days before due` : dayOffset === 0 ? "due today" : `${dayOffset} days overdue`,
        send: async () => {
          const mail = invitationMail({ event: ev, presenter: p, link: `${origin}/a/${p.token}`, remind: true });
          const out = await sendMail({ to: p.email, replyTo: event.contact?.email, ...mail });
          if (out.skipped) throw new Error(out.reason);
          p.mail.push({ type: "reminder-auto", at: new Date().toISOString(), id: out.id });
          await putPresenter(p);
        },
      });
    }

    const overdue = outstanding.filter((p) => p.mail?.length);
    const boardDay = dayOffset >= BOARD_FIRST && (dayOffset - BOARD_FIRST) % OVERDUE_EVERY === 0;
    const recipients = [...new Set([...(event.notify ?? []), event.contact?.email].filter(Boolean))];
    if (boardDay && overdue.length && recipients.length && event.lastBoardDigest !== today) {
      plan.push({
        kind: "board",
        event: event.title,
        to: recipients.join(", "),
        name: `${overdue.length} outstanding`,
        why: `${dayOffset} days past the agreement deadline`,
        send: async () => {
          const heading = `${overdue.length} presenter agreement${overdue.length === 1 ? "" : "s"} still outstanding — ${event.title}`;
          const lines = [
            `The agreement deadline for <b>${esc(event.title)}</b> was ${esc(formatDate(due))}. Still not submitted:`,
            `<ul>${overdue.map((p) => `<li>${esc(p.first)} ${esc(p.last)}${p.organization ? ` — ${esc(p.organization)}` : ""} (${p.openedAt ? "opened, not finished" : "never opened"}; emailed ${p.mail.length}×)</li>`).join("")}</ul>`,
            `Each has been reminded automatically. A phone call from someone they know usually works better than a fourth email.`,
          ];
          const out = await sendMail({ to: recipients, subject: heading, html: layout({ heading, lines, button: { label: "Open the event", href: `${origin}/admin.html` } }), text: heading });
          if (out.skipped) throw new Error(out.reason);
          const { putEvent } = await import("./lib/store.mjs");
          event.lastBoardDigest = today;
          await putEvent(event);
        },
      });
    }
  }

  const results = [];
  for (const item of plan) {
    const { send, ...summary } = item;
    if (dry) { results.push({ ...summary, sent: false }); continue; }
    try { await send(); results.push({ ...summary, sent: true }); }
    catch (e) { results.push({ ...summary, sent: false, error: e.message }); }
  }
  return json({ today, dry, count: results.length, results });
};

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const todayIso = () => new Date().toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
const alreadyToday = (p, today) => (p.mail ?? []).some((m) => m.at?.startsWith(today));
