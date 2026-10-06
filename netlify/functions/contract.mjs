import { json, fail, requireAdmin, fileName } from "./lib/http.mjs";
import { getEvent, putEvent, putContract, getContract, contractInfo, getContractRead, putContractRead, deleteKey } from "./lib/store.mjs";
import { anthropicKey } from "./lib/contract.mjs";

/**
 * The hotel contract for an event.
 *
 *   GET  /api/contract?event=…            the file on record, and what Claude found in it
 *   GET  /api/contract?event=…&file=1     the PDF itself
 *   POST /api/contract?event=…            upload a PDF (body = the file) and have it read
 *   POST /api/contract?event=…&again=1    read the stored one again
 *
 * Before an event exists — the New event screen, where the contract is what
 * fills the form in — `draft=<id>` stands in for `event=…`. The draft is moved
 * onto the event when it is created (events.mjs, `contractDraft`).
 *
 * Reading takes Claude anywhere from a few seconds to a minute or two — longer
 * than a web request may run — so the reading happens in a background function
 * and the screen asks back until it is done. Nothing here changes the event:
 * what Claude finds is a suggestion until Andrew puts it in the form and saves.
 */
const MAX_BYTES = 5 * 1024 * 1024;   // a function's request body tops out at 6 MB
const STALE_MS = 16 * 60 * 1000;     // a background function is stopped at 15 minutes
export const DRAFT = /^[a-z0-9]{16,40}$/i;

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const url = new URL(req.url);
  const draft = url.searchParams.get("draft");
  let eventId, event = null;
  if (draft) {
    if (!DRAFT.test(draft)) return fail("That draft is not one the desk made.");
    eventId = `draft-${draft}`;
  } else {
    eventId = url.searchParams.get("event");
    if (!eventId) return fail("Which event?");
    event = await getEvent(eventId);
    if (!event) return fail("No such event.", 404);
  }
  const ask = draft ? `draft=${encodeURIComponent(draft)}` : `event=${encodeURIComponent(eventId)}`;

  if (req.method === "GET") {
    if (url.searchParams.get("file")) {
      const doc = await getContract(eventId);
      if (!doc) return fail("No contract has been uploaded for this event.", 404);
      return new Response(doc.bytes, { headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${doc.name.replace(/[^\w.\- ]+/g, "_")}"`,
        "cache-control": "no-store",
      } });
    }
    return json(await status(eventId, event));
  }

  if (req.method === "POST") {
    if (url.searchParams.get("again")) {
      if (!(await contractInfo(eventId))) return fail("There is no contract on file to read again. Upload it first.", 404);
      return start(eventId, ask, url.origin, (await contractInfo(eventId)).name);
    }
    // Netlify Blobs takes an ArrayBuffer; the byte view is only for the checks.
    const buffer = await req.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (!bytes.length) return fail("That file was empty.");
    if (bytes.length > MAX_BYTES) return fail("That file is over 5 MB. Save a smaller copy of the PDF (without scanned images if you can) and try again.", 413);
    if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") return fail("That is not a PDF. Save the contract as a PDF and upload that.", 415);
    const name = fileName(req.headers.get("x-file-name"), "hotel-contract.pdf");
    await putContract(eventId, buffer, { name, size: bytes.length, uploadedAt: new Date().toISOString() });
    return start(eventId, ask, url.origin, name);
  }
  return fail("Method not allowed.", 405);
};

/** Mark it as being read and hand it to the background reader. */
async function start(eventId, ask, origin, name) {
  if (!anthropicKey()) {
    const out = { state: "failed", why: "The contract is saved, but the desk has no Anthropic API key, so it cannot read it. Add ANTHROPIC_API_KEY in Netlify and redeploy, then press Read it again.", at: new Date().toISOString(), name };
    await putContractRead(eventId, out);
    return json(await status(eventId), 202);
  }
  await putContractRead(eventId, { state: "reading", startedAt: new Date().toISOString(), name });
  try {
    // Returns 202 straight away on Netlify; the reading carries on without us.
    const r = await fetch(`${origin}/api/contract-read-background?${ask}`, {
      method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "" },
    });
    if (r.status >= 400) throw new Error(`the reader answered ${r.status}`);
  } catch (e) {
    await putContractRead(eventId, { state: "failed", why: `The contract is saved, but the reader could not be started (${e.message}). Press Read it again.`, at: new Date().toISOString(), name });
  }
  return json(await status(eventId), 202);
}

async function status(eventId, event = null) {
  const [file, read] = await Promise.all([contractInfo(eventId), getContractRead(eventId)]);
  let r = read ?? null;
  // Created while Claude was still reading the draft: the answer lands on the
  // draft, so carry it over the first time anyone looks.
  if (r?.state === "reading" && event?.contractDraft) {
    const late = await getContractRead(`draft-${event.contractDraft}`);
    if (late && late.state !== "reading") {
      r = late;
      await putContractRead(eventId, late);
      await deleteKey(`contractread:draft-${event.contractDraft}`);
      delete event.contractDraft;
      await putEvent(event);
    }
  }
  // A reader that died without a word (Netlify stops it at 15 minutes) must
  // not leave the screen saying "reading" for ever.
  if (r?.state === "reading" && Date.now() - Date.parse(r.startedAt) > STALE_MS) {
    r = { state: "failed", why: "Reading the contract took too long and was stopped. Press Read it again.", name: r.name };
  }
  return { file, read: r };
}
