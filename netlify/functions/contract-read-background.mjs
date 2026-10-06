import { requireAdmin } from "./lib/http.mjs";
import { getEvent, getContract, putContractRead } from "./lib/store.mjs";
import { readContract, whyItFailed } from "./lib/contract.mjs";

/**
 * Background reader for a hotel contract (Netlify gives a "-background"
 * function up to 15 minutes and answers its caller 202 at once). Started by
 * /api/contract; the result lands in contractread:<event> for the screen.
 */
export default async (req) => {
  if (requireAdmin(req)) return new Response("Not authorized.", { status: 401 });
  const eventId = new URL(req.url).searchParams.get("event");
  const [event, doc] = await Promise.all([getEvent(eventId), getContract(eventId)]);
  if (!event || !doc) return new Response("Nothing to read.", { status: 404 });
  try {
    const found = await readContract(doc.bytes, event);
    await putContractRead(eventId, { state: "done", at: new Date().toISOString(), name: doc.name, found });
  } catch (e) {
    console.error("contract read failed", eventId, e?.status ?? "", e?.message);
    await putContractRead(eventId, { state: "failed", at: new Date().toISOString(), name: doc.name, why: whyItFailed(e) });
  }
  return new Response(null, { status: 202 });
};
