import { json, fail, requireAdmin, isEmail, text } from "./lib/http.mjs";
import { getEvent, putEvent, listPresenters } from "./lib/store.mjs";
import { roomingRows, roomingMail, changesSince, snapshot, cleanGuest, guestWindow, readRoomsCsv } from "./lib/rooming.mjs";
import { coordinatorOf, sendMail } from "./lib/mail.mjs";
import { token } from "./lib/ids.mjs";

/**
 * The hotel rooming list for an event.
 *
 *   GET  /api/rooming?event=…                 the list, who has not answered, what changed since it was sent
 *   GET  /api/rooming?event=…&csv=1[&keys=…]  the same as a spreadsheet
 *   PUT  /api/rooming?event=…                 the guests added by hand ({ guests: [...] })
 *   POST /api/rooming?event=…&upload=1        read a spreadsheet of rooms, nothing saved ({ csv })
 *   POST /api/rooming?event=…&upload=1&save=1 add the good rows from it ({ csv })
 *   POST /api/rooming?event=…&preview=1       the email, not sent ({ keys })
 *   POST /api/rooming?event=…&send=1          email it to the hotel ({ keys, to })
 *
 * Nothing goes to the hotel unless Andrew presses Send. `keys` picks the rows;
 * without it, every confirmed row goes and the not-yet-approved ones do not.
 */
// NGS-sized events book 30-plus rooms; this leaves room for the biggest.
const MAX_GUESTS = 200;

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const url = new URL(req.url);
  const event = await getEvent(url.searchParams.get("event"));
  if (!event) return fail("No such event.", 404);
  const body = ["POST", "PUT"].includes(req.method) ? await req.json().catch(() => ({})) : null;
  const { rows, waiting } = roomingRows(event, await listPresenters(event.id));
  const pick = (keys) => (Array.isArray(keys) ? rows.filter((r) => keys.includes(r.key)) : rows.filter((r) => r.confirmed));

  if (req.method === "GET") {
    if (url.searchParams.get("csv")) {
      const keys = url.searchParams.get("keys");
      const mail = roomingMail({ event, rows: pick(keys ? keys.split(",") : undefined) });
      const name = `rooming-list-${event.title.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}.csv`;
      return new Response(mail.csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
    }
    return json(state(event, rows, waiting));
  }

  if (req.method === "PUT") {
    const out = [];
    const win = guestWindow(event);
    const had = new Map((event.roomingGuests ?? []).map((g) => [g.id, g]));
    for (const g of (Array.isArray(body?.guests) ? body.guests : []).slice(0, MAX_GUESTS)) {
      const { guest, problem } = cleanGuest(g, () => token(10), win, had.get(g?.id));
      if (problem) return fail(problem);
      out.push(guest);
    }
    event.roomingGuests = out;
    await putEvent(event);
    const again = roomingRows(event, await listPresenters(event.id));
    return json(state(event, again.rows, again.waiting));
  }

  if (req.method === "POST" && url.searchParams.get("upload")) {
    const read = readRoomsCsv(String(body?.csv ?? ""), { win: guestWindow(event), onList: rows.map((r) => r.name) });
    if (read.problem) return fail(read.problem);
    if (!url.searchParams.get("save")) return json({ ...read, window: guestWindow(event) });
    const room = MAX_GUESTS - (event.roomingGuests ?? []).length;
    if (read.add.length > room) return fail(`That would be more than ${MAX_GUESTS} people added by hand on one event.`, 409);
    const fresh = [];
    for (const g of read.add) {
      const { guest, problem } = cleanGuest(g, () => token(10), guestWindow(event));
      if (problem) return fail(problem);                  // cannot happen after readRoomsCsv; refuse rather than half-save
      fresh.push(guest);
    }
    event.roomingGuests = [...(event.roomingGuests ?? []), ...fresh];
    await putEvent(event);
    const again = roomingRows(event, await listPresenters(event.id));
    return json({ ok: true, added: fresh.length, problems: read.problems, skipped: read.skipped, ...state(event, again.rows, again.waiting) });
  }

  if (req.method === "POST") {
    const chosen = pick(body?.keys);
    if (!chosen.length) return fail("Nobody is ticked to send.");
    const sent = event.roomingSent ?? null;
    const changes = sent ? changesSince(sent.rows, chosen) : null;
    const mail = roomingMail({ event, rows: chosen, changes, sentBefore: sent?.at ?? null });
    const lead = coordinatorOf(event);
    if (url.searchParams.get("preview")) {
      return json({ subject: mail.subject, html: mail.html, rows: chosen.length, cc: lead?.email ?? null, to: event.hotel?.contact || sent?.to || "" });
    }
    if (url.searchParams.get("send")) {
      const to = text(body?.to, 200);
      if (!isEmail(to)) return fail("Which address at the hotel should it go to?");
      const out = await sendMail({
        to, cc: lead?.email && lead.email !== to ? [lead.email] : [], replyTo: lead?.email || undefined,
        subject: mail.subject, html: mail.html, text: mail.text,
        attachments: [{ filename: "rooming-list.csv", content: Buffer.from(mail.csv, "utf8"), contentType: "text/csv" }],
      });
      if (out.skipped) return fail(`It could not be sent: ${out.reason}`, 503);
      const now = new Date().toISOString();
      event.roomingSent = { at: now, to, rows: snapshot(chosen) };
      event.hotel = { ...(event.hotel ?? {}), contact: event.hotel?.contact || to };   // remembered for next time
      // The checklist job for this, whatever Andrew has called it, ticks itself.
      const job = (event.tasks ?? []).find((t) => !t.done && !t.na && /hotel/i.test(t.what) && /name|rooming/i.test(t.what));
      if (job) { job.done = true; job.doneAt = now; job.doneBy = "rooming list emailed"; }
      await putEvent(event);
      return json({ ok: true, to, rows: chosen.length, ticked: job?.what ?? null, ...state(event, rows, waiting) });
    }
  }
  return fail("Method not allowed.", 405);
};

function state(event, rows, waiting) {
  const sent = event.roomingSent ?? null;
  return {
    rows, waiting,
    guests: event.roomingGuests ?? [],
    // The only dates the desk offers for a guest's check-in and check-out.
    window: guestWindow(event),
    hotel: { name: event.hotel?.name ?? "", contact: event.hotel?.contact ?? "" },
    sent: sent ? { at: sent.at, to: sent.to, count: sent.rows.length } : null,
    changes: sent ? changesSince(sent.rows, rows.filter((r) => r.confirmed)) : null,
  };
}
