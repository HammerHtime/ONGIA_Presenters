import { requireAdmin } from "./lib/http.mjs";
import { getEvent, getContract, getRoster, putSignedContract, getContractSign, putContractSign } from "./lib/store.mjs";
import { pdfLines, locateFields, fillContract } from "./lib/contractsign.mjs";
import { signatureImage } from "./lib/thanks.mjs";
import { todayIso, formatLong } from "./lib/deadlines.mjs";

/**
 * Fills in and signs an event's hotel contract in the background (Andrew 17 Nov 2026), started by
 * POST /api/contract?event=…&sign=1. Claude says which line is which blank; the desk writes his name, title, the date,
 * his initials, his Bonvoy name and number (from the board roster in Settings), ticks the form of payment he chose and
 * the electronic-signature box, and puts his handwritten signature on the signature line. The original stays as it
 * was; the copy is kept beside it for him to look over and send to the hotel himself. Nothing is emailed.
 */
const PRESIDENT = "president@ongia.ca";
export default async (req) => {
  if (requireAdmin(req)) return new Response("Not authorized.", { status: 401 });
  const params = new URL(req.url).searchParams;
  const eventId = params.get("event");
  const [event, doc, asked] = await Promise.all([getEvent(eventId), getContract(eventId), getContractSign(eventId)]);
  if (!event || !doc || asked?.state !== "signing") return new Response("Nothing to sign.", { status: 404 });
  try {
    const me = ((await getRoster()) ?? []).find((m) => String(m.email ?? "").toLowerCase() === PRESIDENT) ?? {};
    const name = me.name || "Andrew Hammond";
    const values = {
      name, title: "President", date: formatLong(todayIso(), "en", { weekday: false }),
      initials: name.split(/\s+/).map((w) => w[0]).join("").toUpperCase(),
      number: asked.bonvoy !== false ? String(me.bonvoy ?? "") : "", email: asked.bonvoy !== false ? PRESIDENT : "",
      payment: asked.payment || "",
    };
    const bytes = new Uint8Array(doc.bytes);
    const lines = await pdfLines(bytes);
    if (lines.length < 20) throw new Error("This PDF has no text Claude can read (it may be a scan). Ask the hotel for the original PDF.");
    const placed = await locateFields(lines);
    const sig = await signatureImage();
    const out = await fillContract(bytes, lines, placed, values, sig);
    const base = doc.name.replace(/\.pdf$/i, "");
    await putSignedContract(eventId, out.bytes, { name: `${base} - signed ${todayIso()}.pdf`, at: new Date().toISOString() });
    // What it couldn't find, said plainly, so he knows what to do by hand.
    const missing = [];
    if (!placed.signature && !placed.esignBox) missing.push("a signature line");
    if (!placed.signName) missing.push("a name line");
    if (!placed.signDate) missing.push("a date line");
    if (values.number && !placed.bonvoyNumber) missing.push("a Bonvoy number line");
    if (!values.number && placed.bonvoyNumber) missing.push("your Bonvoy number (none is saved in Settings)");
    if (values.payment && !placed.paymentOptions.some((o) => o.kind === values.payment)) missing.push("a box for that form of payment");
    if (!values.payment && placed.paymentOptions.length) missing.push("a form of payment (none was chosen)");
    await putContractSign(eventId, { state: "done", at: new Date().toISOString(), from: doc.uploadedAt, filled: out.filled, missing, notes: placed.notes, payment: values.payment, by: asked.by });
  } catch (e) {
    console.error("contract sign failed", eventId, e?.message);
    await putContractSign(eventId, { state: "failed", at: new Date().toISOString(), why: e?.message || "It couldn't be filled in." });
  }
  return new Response(null, { status: 202 });
};
