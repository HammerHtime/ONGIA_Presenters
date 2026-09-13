import { listEvents, listPresenters, putPresenter, putEvent } from "./store.mjs";
import { describeEvent, formatDate } from "./deadlines.mjs";
import { sendMail, invitationMail, layout } from "./mail.mjs";
import { scanMaterials, materialsStatus } from "./materials.mjs";
import { weeklyDigestMail } from "./mail.mjs";
import { countStatuses } from "../events.mjs";
import { formatDateIn } from "./deadlines.mjs";

/**
 * Daily chase-ups. Runs every morning (14:00 UTC ≈ 7–10am across Canada) and
 * decides, per presenter, whether today is a day to nudge. Nothing here sends
 * twice on the same day, and nothing goes to someone who has submitted.
 *
 * Cadence (days relative to the due date; negative = before). Reminders
 * tighten as the date nears:
 *   agreements:  -28, -14, -7, -4, -2, -1, 0, then every 3 days for two weeks
 *                overdue, weekly after
 *   materials:   -14, -7, -3, -1, 0, then the same overdue pattern
 *   board:       an overdue digest on +3 and weekly after while anyone is late
 *   lead:        a weekly summary of the numbers every Monday, with a link
 *                into the event on the admin page
 * Nobody is chased before they have been sent their link at least once.
 *
 * Materials: presenters whose agreement is in (submitted or final) but whose
 * draft or final materials haven't arrived are nudged 7 days before and on
 * each materials deadline, then weekly. The request folder is scanned first,
 * so a presenter who has uploaded is left alone.
 *
 * Invoked by netlify/functions/remind.mjs (scheduled daily) and by
 * netlify/functions/reminders.mjs (admin: ?dry=1 preview, ?run=1 now, ?digest=1
 * to include the lead's summary whatever the weekday).
 */

const PRESENTER_DAYS = [-28, -14, -7, -4, -2, -1, 0];
const MATERIALS_DAYS = [-14, -7, -3, -1, 0];
const OVERDUE_EVERY = 7;
const BOARD_FIRST = 3;
// Overdue: every 3 days for the first two weeks, then weekly.
const overdueDay = (off) => off > 0 && (off <= 14 ? off % 3 === 0 : off % 7 === 0);

/**
 * Work out today's chase-ups and, unless dry, send them.
 * Returns { today, dry, count, results } — one row per message planned.
 */
export async function runReminders({ dry = false, forceDigest = false, origin = "" } = {}) {
  const today = todayIso();
  const isMonday = new Date().getUTCDay() === 1;

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
      const shouldNudge = PRESENTER_DAYS.includes(dayOffset) || overdueDay(dayOffset);
      if (!shouldNudge) continue;
      plan.push({
        kind: "presenter",
        event: event.title,
        to: p.email,
        name: `${p.first} ${p.last}`,
        why: dayOffset < 0 ? `${-dayOffset} days before due` : dayOffset === 0 ? "due today" : `${dayOffset} days overdue`,
        send: async () => {
          const mail = invitationMail({ event: ev, presenter: p, link: `${origin}/a/${p.token}`, remind: true, daysLeft: -dayOffset });
          const out = await sendMail({ to: p.email, replyTo: event.contact?.email, ...mail });
          if (out.skipped) throw new Error(out.reason);
          p.mail.push({ type: "reminder-auto", at: new Date().toISOString(), id: out.id });
          await putPresenter(p);
        },
      });
    }

    // Materials chase-ups for everyone whose agreement is in.
    const withAgreement = people.filter((p) => p.status === "submitted" || p.status === "approved");
    if (withAgreement.length && event.materialsUploadUrl) {
      if (!dry) {
        try { const scan = await scanMaterials(event, people); if (!scan.skipped) { event.materialsScan = scan; await putEvent(event); } } catch { /* keep the last scan */ }
      }
      for (const [key, label, labelFr] of [["draft", "Draft materials", "Version préliminaire du matériel"], ["final", "Final materials", "Version finale du matériel"]]) {
        const dueIso = event.deadlines[key];
        const off = daysBetween(dueIso, today);
        const isDay = MATERIALS_DAYS.includes(off) || overdueDay(off);
        if (!isDay) continue;
        for (const p of withAgreement) {
          const st = materialsStatus(p, event.materialsScan ?? null);
          if (st[key]) continue;
          if (alreadyToday(p, today)) continue;
          const fr = p.language === "fr";
          plan.push({
            kind: "materials",
            event: event.title,
            to: p.email,
            name: `${p.first} ${p.last}`,
            why: `${label.toLowerCase()} ${off < 0 ? `${-off} days before due` : off === 0 ? "due today" : `${off} days overdue`}`,
            send: async () => {
              const due = formatDateIn(dueIso, fr ? "fr" : "en");
              const heading = fr ? `${labelFr} — attendue le ${due}` : `${label} due ${due} — ${event.title}`;
              const lines = fr
                ? [`Bonjour ${esc(p.first)},`, `Un rappel amical : votre ${labelFr.toLowerCase()} pour <b>${esc(event.title)}</b> est attendue le <b>${due}</b>${off > 0 ? " et nous ne l'avons pas encore reçue" : ""}.`, `Le bouton ci-dessous ouvre le dossier de dépôt d'ONGIA — déposez-y vos fichiers, rien d'autre à faire.`]
                : [`Hello ${esc(p.first)},`, `A friendly reminder: your ${label.toLowerCase()} for <b>${esc(event.title)}</b> ${off > 0 ? "were due" : "are due"} <b>${due}</b>${off > 0 ? " and haven't arrived yet" : ""}.`, `The button below opens ONGIA's drop folder for this event — add your files there and you're done.`];
              const out = await sendMail({ to: p.email, replyTo: event.contact?.email, subject: heading, text: heading,
                html: layout({ heading, lines, buttons: [{ href: event.materialsUploadUrl, label: fr ? "Téléverser le matériel" : "Upload Material" }] }) });
              if (out.skipped) throw new Error(out.reason);
              p.mail = [...(p.mail ?? []), { type: `materials-${key}`, at: new Date().toISOString(), id: out.id }];
              await putPresenter(p);
            },
          });
        }
      }
    }

    // Monday summary to the lead board member.
    const lead = event.reviewer?.email;
    const recentDigest = event.lastWeeklyDigest && daysBetween(event.lastWeeklyDigest, today) < 6;
    if (lead && (forceDigest || (isMonday && !recentDigest))) {
      const counts = countStatuses(people);
      const mats = people.map((p) => materialsStatus(p, event.materialsScan ?? null));
      const materialsSummary = { draft: mats.filter((m) => m.draft).length, final: mats.filter((m) => m.final).length };
      const items = [
        ["Agreements", event.deadlines.agreement, people.filter((p) => p.status !== "submitted" && p.status !== "approved")],
        ["Draft materials", event.deadlines.draft, people.filter((p, i) => !mats[i].draft)],
        ["Final materials", event.deadlines.final, people.filter((p, i) => !mats[i].final)],
      ].map(([label, due, missing]) => ({ label, due: formatDate(due), days: daysBetween(due, today), names: missing.map((p) => `${p.first} ${p.last}`) }));
      const overdueItems = items.filter((x) => x.days > 0 && x.names.length);
      const nextItem = [...items.map((x) => ({ label: `${x.label} due`, due: x.due, days: -x.days })), { label: "Training starts", due: formatDate(event.dayOne), days: -daysBetween(event.dayOne, today) }]
        .filter((x) => x.days >= 0).sort((a, b) => a.days - b.days)[0] ?? null;
      plan.push({
        kind: "weekly-summary",
        event: event.title,
        to: lead,
        name: event.reviewer?.name || lead,
        why: forceDigest ? "requested now" : "Monday summary",
        send: async () => {
          const mail = weeklyDigestMail({
            event: ev, counts, materials: materialsSummary, overdue: overdueItems, next: nextItem,
            rows: people.map((p) => ({ name: `${p.first} ${p.last}`, status: p.status })),
            adminUrl: `${origin}/admin.html#event/${encodeURIComponent(event.id)}`,
          });
          const out = await sendMail({ to: lead, replyTo: event.contact?.email, ...mail });
          if (out.skipped) throw new Error(out.reason);
          event.lastWeeklyDigest = today;
          await putEvent(event);
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
  return { today, dry, count: results.length, results };
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const todayIso = () => new Date().toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
const alreadyToday = (p, today) => (p.mail ?? []).some((m) => m.at?.startsWith(today));
