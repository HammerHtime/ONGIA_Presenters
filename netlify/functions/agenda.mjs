import { json, fail, requireAdmin, fileName, text } from "./lib/http.mjs";
import { getEvent, putEvent, putAgenda, getAgenda, getAgendaRead, putAgendaRead, deleteKey } from "./lib/store.mjs";
import { anthropicKey } from "./lib/contract.mjs";
import { cleanSchedule, trainingDays } from "./lib/agenda.mjs";

/**
 * An event's agenda and its day-by-day times.
 *
 *   GET    /api/agenda?event=…            the file on record, what Claude found, the saved times
 *   GET    /api/agenda?event=…&file=1     the PDF itself
 *   POST   /api/agenda?event=…            upload a PDF (body = the file) and have it read
 *   POST   /api/agenda?event=…&again=1    read the stored one again
 *   PUT    /api/agenda?event=…            save the times ({ schedule: [...], venue? })
 *   DELETE /api/agenda?event=…            take the file off (the saved times stay)
 *
 * The file goes out attached to a letter set to carry it, so it has to fit in
 * an email: Microsoft's mail service takes about 4 MB a message, and a PDF
 * grows by a third on the way, so 3 MB is the most an agenda can be.
 */
const MAX_BYTES = 3 * 1024 * 1024;
const STALE_MS = 16 * 60 * 1000;

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const url = new URL(req.url);
  const eventId = url.searchParams.get("event");
  if (!eventId) return fail("Which event?");
  const event = await getEvent(eventId);
  if (!event) return fail("No such event.", 404);

  if (req.method === "GET") {
    if (url.searchParams.get("file")) {
      const doc = await getAgenda(eventId);
      if (!doc) return fail("No agenda has been uploaded for this event.", 404);
      return new Response(doc.bytes, { headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${doc.name.replace(/[^\w.\- ]+/g, "_")}"`,
        "cache-control": "no-store",
      } });
    }
    return json(await status(event));
  }

  if (req.method === "POST") {
    if (url.searchParams.get("again")) {
      if (!event.agendaFile) return fail("There is no agenda on file to read again. Upload it first.", 404);
      return start(event, url.origin);
    }
    const buffer = await req.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (!bytes.length) return fail("That file was empty.");
    if (bytes.length > MAX_BYTES) {
      return fail(`That file is ${(bytes.length / 1048576).toFixed(1)} MB, and an agenda goes out attached to an email, which takes up to 3 MB. Save a smaller PDF (in Word: File, Save As, PDF, "Minimum size") and upload that.`, 413);
    }
    if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") return fail("That is not a PDF. Save the agenda as a PDF and upload that.", 415);
    const name = fileName(req.headers.get("x-file-name"), "agenda.pdf");
    const meta = { name, size: bytes.length, uploadedAt: new Date().toISOString() };
    await putAgenda(eventId, buffer, meta);
    // The event carries the fact of it, so a letter can tell whether there is one to attach.
    event.agendaFile = meta;
    await putEvent(event);
    return start(event, url.origin);
  }

  if (req.method === "PUT") {
    const body = await req.json().catch(() => null);
    if (!body) return fail("Expected a JSON body.");
    const { schedule, problem } = cleanSchedule(body.schedule, event);
    if (problem) return fail(problem);
    event.schedule = schedule;
    // The agenda can name the venue; only filled in when the event has none, and only when asked.
    // "TBD" is a venue nobody has chosen yet, so it counts as none.
    const venue = text(body.venue, 200);
    if (venue && (!event.venue || /^(tbd|tba|to be (determined|announced))$/i.test(event.venue.trim()))) event.venue = venue;
    await putEvent(event);
    return json({ ok: true, ...(await status(event)) });
  }

  if (req.method === "DELETE") {
    await Promise.all([deleteKey(`agenda:${eventId}`), deleteKey(`agendaread:${eventId}`)]);
    delete event.agendaFile;
    await putEvent(event);
    return json({ ok: true, ...(await status(event)) });
  }
  return fail("Method not allowed.", 405);
};

/** Mark it as being read and hand it to the background reader. */
async function start(event, origin) {
  const name = event.agendaFile?.name ?? "agenda.pdf";
  if (!anthropicKey()) {
    await putAgendaRead(event.id, { state: "failed", why: "The agenda is saved, but the desk has no Anthropic API key, so it cannot read it. Type the times in by hand.", at: new Date().toISOString(), name });
    return json(await status(event), 202);
  }
  await putAgendaRead(event.id, { state: "reading", startedAt: new Date().toISOString(), name });
  try {
    const r = await fetch(`${origin}/api/agenda-read-background?event=${encodeURIComponent(event.id)}`, {
      method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "" },
    });
    if (r.status >= 400) throw new Error(`the reader answered ${r.status}`);
  } catch (e) {
    await putAgendaRead(event.id, { state: "failed", why: `The agenda is saved, but the reader could not be started (${e.message}). Press Read it again.`, at: new Date().toISOString(), name });
  }
  return json(await status(event), 202);
}

async function status(event) {
  let read = (await getAgendaRead(event.id)) ?? null;
  if (read?.state === "reading" && Date.now() - Date.parse(read.startedAt) > STALE_MS) {
    read = { state: "failed", why: "Reading the agenda took too long and was stopped. Press Read it again.", name: read.name };
  }
  return { file: event.agendaFile ?? null, read, schedule: event.schedule ?? [], days: trainingDays(event), venue: event.venue ?? "" };
}
