import { isDocx } from "./lib/contract.mjs";
import { json, fail, requireAdmin, adminWho, fileName, editGuard } from "./lib/http.mjs";
import { mayCost } from "./lib/auth.mjs";
import { getEvent, putEvent, putContract, getContract, contractInfo, getContractRead, putContractRead, deleteKey, getSignedContract, getContractSign, putContractSign } from "./lib/store.mjs";
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
    // The contract has the rates and the terms. On an RBH event only the president and the VP touch it.
    if (event.kind === "rbh" && !mayCost(adminWho(req))) return fail("The hotel contract on an RBH event is for the president and the VP of operations.", 403);
    if (req.method !== "GET") { const viewOnly = editGuard(req, event); if (viewOnly) return viewOnly; }
  }
  const ask = draft ? `draft=${encodeURIComponent(draft)}` : `event=${encodeURIComponent(eventId)}`;

  if (req.method === "GET") {
    if (url.searchParams.get("signed")) {
      const doc = await getSignedContract(eventId);
      if (!doc) return fail("It hasn't been filled in and signed yet.", 404);
      return new Response(doc.bytes, { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${doc.name.replace(/[^\w.\- ]+/g, "_")}"`, "cache-control": "no-store" } });
    }
    if (url.searchParams.get("file")) {
      const doc = await getContract(eventId);
      if (!doc) return fail("No contract has been uploaded for this event.", 404);
      return new Response(doc.bytes, { headers: {
        "content-type": isDocx(new Uint8Array(doc.bytes)) ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf",
        "content-disposition": `inline; filename="${doc.name.replace(/[^\w.\- ]+/g, "_")}"`,
        "cache-control": "no-store",
      } });
    }
    return json(await status(eventId, event));
  }

  if (req.method === "POST") {
    // Fill in and sign (Andrew 17 Nov 2026: "when I want to sign and add bonvoy, claude does it"). His signature is his:
    // only his own sign-in, or the desk's key, may put it on a contract.
    if (url.searchParams.get("sign")) {
      const who = adminWho(req);
      if (!(who?.key === true || String(who?.email ?? "").toLowerCase() === "president@ongia.ca")) return fail("Only the President can sign a contract with his signature.", 403);
      const doc = await contractInfo(eventId);
      if (!doc) return fail("Upload the contract first.", 404);
      if (!/\.pdf$/i.test(doc.name)) return fail("Only a PDF can be filled in and signed here. Ask the hotel for the PDF.", 409);
      const body = await req.json().catch(() => ({}));
      const payment = ["cash", "card", "cheque"].includes(body.payment) ? body.payment : "";
      const now = await getContractSign(eventId);
      if (now?.state === "signing" && Date.now() - Date.parse(now.startedAt) < STALE_MS) return fail("It's being filled in now.", 409);
      await putContractSign(eventId, { state: "signing", startedAt: new Date().toISOString(), payment, bonvoy: body.bonvoy !== false, by: who?.email || "desk" });
      try {
        const r = await fetch(`${url.origin}/api/contract-sign-background?${ask}`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "" } });
        if (r.status >= 400) throw new Error(`the signer answered ${r.status}`);
      } catch (e) { await putContractSign(eventId, { state: "failed", at: new Date().toISOString(), why: `It couldn't be started (${e.message}). Try again.` }); }
      return json(await status(eventId, event), 202);
    }
    if (url.searchParams.get("again")) {
      if (!(await contractInfo(eventId))) return fail("There is no contract on file to read again. Upload it first.", 404);
      return start(eventId, ask, url.origin, (await contractInfo(eventId)).name);
    }
    // Netlify Blobs takes an ArrayBuffer; the byte view is only for the checks.
    const buffer = await req.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (!bytes.length) return fail("That file was empty.");
    if (bytes.length > MAX_BYTES) return fail("That file is over 5 MB. Save a smaller copy of the PDF (without scanned images if you can) and try again.", 413);
    const word = isDocx(bytes);
    if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-" && !word) {
      return fail(/\.doc$/i.test(req.headers.get("x-file-name") ?? "") || (bytes[0] === 0xd0 && bytes[1] === 0xcf)
        ? "That's an older Word file (.doc). In Word, use File, Save As, and save it as a Word document (.docx) or a PDF, then upload that."
        : "That isn't a PDF or a Word document. Save the contract as a PDF or .docx and upload that.", 415);
    }
    const name = fileName(req.headers.get("x-file-name"), word ? "hotel-contract.docx" : "hotel-contract.pdf");
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
  const [file, read, signRaw] = await Promise.all([contractInfo(eventId), getContractRead(eventId), getContractSign(eventId)]);
  let sign = signRaw ?? null;
  if (sign?.state === "signing" && Date.now() - Date.parse(sign.startedAt) > STALE_MS) sign = { state: "failed", why: "Filling it in took too long and was stopped. Try again." };
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
  // A signed copy made from an earlier upload is out of date once a different contract is uploaded.
  if (sign?.state === "done" && file?.uploadedAt && sign.from && sign.from !== file.uploadedAt) sign = { ...sign, stale: true };
  return { file, read: r, sign };
}
