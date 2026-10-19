import { requireAdmin } from "./lib/http.mjs";
import { getEvent, getSow, getReceiptFile, putReceiptRead } from "./lib/store.mjs";
import { readReceipt, whyItFailed } from "./lib/receipts.mjs";

/**
 * Background reader for one receipt (started by /api/receipts). Reading a photo takes seconds, but a phone on a
 * bad connection should not have to hold the request open. The result lands in receiptread:<event>:<id>.
 */
export default async (req) => {
  if (requireAdmin(req)) return new Response("Not authorized.", { status: 401 });
  const params = new URL(req.url).searchParams;
  const eventId = params.get("event"), id = params.get("id");
  if (!eventId || !/^[a-z0-9]{6,40}$/i.test(id ?? "")) return new Response("Bad request.", { status: 400 });
  const [event, file] = await Promise.all([getEvent(eventId), getReceiptFile(eventId, id)]);
  if (!event || !file) return new Response("Nothing to read.", { status: 404 });
  try {
    const sow = await getSow(eventId);
    const found = await readReceipt(file.bytes, file.type, (sow?.lines ?? []).map((l) => l.name));
    await putReceiptRead(eventId, id, { state: "done", at: new Date().toISOString(), found });
  } catch (e) {
    console.error("receipt read failed", eventId, id, e?.status ?? "", e?.message);
    await putReceiptRead(eventId, id, { state: "failed", at: new Date().toISOString(), why: whyItFailed(e) });
  }
  return new Response(null, { status: 202 });
};
