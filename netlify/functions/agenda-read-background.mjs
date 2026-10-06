import { requireAdmin } from "./lib/http.mjs";
import { getEvent, getAgenda, putAgendaRead } from "./lib/store.mjs";
import { readAgenda } from "./lib/agenda.mjs";
import { whyItFailed } from "./lib/contract.mjs";

/**
 * Background reader for an event's agenda (up to 15 minutes; the caller gets
 * 202 at once). Started by /api/agenda; the result lands in agendaread:<event>.
 * It never touches the event itself: the times are Andrew's to save.
 */
export default async (req) => {
  if (requireAdmin(req)) return new Response("Not authorized.", { status: 401 });
  const eventId = new URL(req.url).searchParams.get("event");
  const [event, doc] = await Promise.all([getEvent(eventId), getAgenda(eventId)]);
  if (!event || !doc) return new Response("Nothing to read.", { status: 404 });
  try {
    const found = await readAgenda(doc.bytes, event);
    await putAgendaRead(eventId, { state: "done", at: new Date().toISOString(), name: doc.name, found });
  } catch (e) {
    console.error("agenda read failed", eventId, e?.status ?? "", e?.message);
    await putAgendaRead(eventId, { state: "failed", at: new Date().toISOString(), name: doc.name, why: whyItFailed(e) });
  }
  return new Response(null, { status: 202 });
};
