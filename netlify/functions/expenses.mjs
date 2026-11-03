import { createHash } from "node:crypto";
import { json, fail, text, fileName } from "./lib/http.mjs";
import { signinConfig, verifyIdToken } from "./lib/auth.mjs";
import { token } from "./lib/ids.mjs";
import { anthropicKey } from "./lib/contract.mjs";
import { todayIso } from "./lib/deadlines.mjs";
import {
  getRoster, putRoster, listEvents, getClaim, putClaim, listClaimLines, getClaimLine, putClaimLine, deleteClaimLine,
  getClaimRead, putClaimRead, putClaimFile, getClaimFile, markMine, listMineIds,
} from "./lib/store.mjs";
import {
  CATEGORIES, KINDS, MAX_BYTES, TYPES, SHOT_TYPES, ROLE_TITLE, mileageRate, roleOf, approversFor, mayClaim, rosterName, whoKey,
  issueExpenseSession, expenseWho, cleanLine, viewLine, claimSums, monthLabel, eventChoices, sniff,
} from "./lib/expenses.mjs";

/**
 * ONGIA Expenses: a board member's expense claims (see lib/expenses.mjs). Signed in with the member's own ONGIA
 * Microsoft account; the session travels in x-expense-key. Opens expense claims and nothing else on the desk.
 *
 *   POST   /api/expenses?signin=1                        { idToken, nonce } from Microsoft → { session, me }
 *   GET    /api/expenses                                 me, my claim being built (with its lines), my other claims
 *   GET    /api/expenses?claim=<id>                      one claim
 *   GET    /api/expenses?claim=<id>&file=<line>[&kind=thumb|shot]   the receipt, its small picture, or the card statement
 *   POST   /api/expenses?add=receipt[&claim=<id>]        body = the photo or PDF; Claude starts reading it
 *   POST   /api/expenses?add=mileage|noreceipt[&claim=]  { date, km, from, to, … } → a line typed in
 *   PUT    /api/expenses?claim=<id>&line=<line>          what the person checked or typed
 *   DELETE /api/expenses?claim=<id>&line=<line>
 *   POST   /api/expenses?claim=<id>&thumb=<line>         body = a small JPEG of the receipt, for the list
 *   POST   /api/expenses?claim=<id>&shot=<line>          body = the card statement screenshot
 *   POST   /api/expenses?claim=<id>&again=<line>         read the receipt again
 */
const STALE_MS = 5 * 60 * 1000;
const MAX_LINES = 60;
const EDITABLE = ["draft", "rejected"];

export default async (req) => {
  const url = new URL(req.url);
  const q = (k) => url.searchParams.get(k);

  if (req.method === "POST" && q("signin")) return signIn(req);

  const who = expenseWho(req);
  if (!who) return fail("Please sign in again.", 401);
  const roster = (await getRoster()) ?? [];
  if (!mayClaim(who.email, roster)) return fail(`${who.email} isn't on ONGIA's board list, so it can't make expense claims. Ask the President to add you under Board members.`, 403);
  const me = { email: who.email, name: rosterName(who.email, roster, who.name), role: roleOf(who.email) };
  me.title = ROLE_TITLE[me.role];

  // A claim named in the request, or the one being built.
  const named = q("claim");
  const loadNamed = async () => {
    const c = named && /^[a-z0-9-]{4,40}$/.test(named) ? await getClaim(named) : null;
    if (!c) return { problem: fail("That claim isn't on record.", 404) };
    if (c.owner?.email !== me.email && !(roleOf(me.email) !== "member" && c.status !== "draft")) return { problem: fail("That claim isn't yours.", 403) };
    return { claim: c };
  };
  const editable = (c) => (c.owner?.email !== me.email ? "Only the person claiming can change a claim." : !EDITABLE.includes(c.status) ? "This claim has been sent, so it can't be changed now." : null);

  if (req.method === "GET" && named && q("file")) {
    const { claim, problem } = await loadNamed();
    if (problem) return problem;
    const kind = ["thumb", "shot"].includes(q("kind")) ? q("kind") : "file";
    const f = await getClaimFile(kind, claim.id, q("file"));
    if (!f) return fail("That file isn't on record.", 404);
    return new Response(f.bytes, { headers: { "content-type": f.type, "content-disposition": `inline; filename="${String(f.name).replace(/[^\w.\- ]+/g, "_")}"`, "cache-control": "no-store" } });
  }

  if (req.method === "GET" && named) {
    const { claim, problem } = await loadNamed();
    if (problem) return problem;
    return json({ claim: await claimView(claim, me) });
  }

  if (req.method === "GET") return json(await home(me));

  if (req.method === "POST" && q("add")) {
    const kind = q("add");
    if (!KINDS.includes(kind)) return fail("Add a receipt, mileage, or a line with no receipt.");
    let claim;
    if (named) { const got = await loadNamed(); if (got.problem) return got.problem; claim = got.claim; }
    else claim = await currentDraft(me);
    const no = editable(claim);
    if (no) return fail(no, 409);
    if ((await listClaimLines(claim.id)).length >= MAX_LINES) return fail(`A claim holds up to ${MAX_LINES} lines. Send this one, then start the next.`, 409);
    const line = { id: lineId(), kind, addedAt: new Date().toISOString() };
    // A photo kept on the phone through a dropped signal is sent again with the same upload id: it is the same line,
    // so a receipt is never claimed twice because the first answer didn't reach the phone.
    const upload = req.headers.get("x-upload-id") ?? "";
    if (kind === "receipt" && /^[A-Za-z0-9-]{8,64}$/.test(upload)) {
      line.id = createHash("sha256").update(`${me.email}:${upload}`).digest("hex").slice(0, 14);
      if (await getClaimLine(claim.id, line.id)) return json({ claim: await claimView(claim, me), line: line.id, again: true });
    }
    if (kind === "receipt") {
      const got = await bytesOf(req, TYPES, "a photo of the receipt (JPEG or PNG) or a PDF");
      if (got.problem) return got.problem;
      line.file = { name: fileName(req.headers.get("x-file-name"), `receipt.${TYPES[got.type]}`), type: got.type, size: got.bytes.byteLength };
      Object.assign(line, cleanLine(kind, {}, {}));
      await putClaimFile("file", claim.id, line.id, got.bytes, { name: line.file.name, type: got.type });
      await putClaimLine(claim.id, line);
      await touch(claim);
      await startRead(url.origin, claim.id, line.id);
    } else {
      const body = await req.json().catch(() => ({}));
      Object.assign(line, cleanLine(kind, body, { events: await choices() }));
      if (kind === "mileage") line.paidTo = me.name;
      await putClaimLine(claim.id, line);
      await touch(claim);
    }
    return json({ claim: await claimView(await getClaim(claim.id), me), line: line.id }, kind === "receipt" ? 202 : 201);
  }

  if (!named) return fail("Which claim?");
  const { claim, problem } = await loadNamed();
  if (problem) return problem;
  const lid = q("line") || q("thumb") || q("shot") || q("again");
  const line = lid && /^[a-z0-9]{6,40}$/.test(lid) ? await getClaimLine(claim.id, lid) : null;
  if (!line) return fail("That line isn't on this claim any more. Reload and look again.", 404);
  const no = editable(claim);
  if (no) return fail(no, 409);

  if (req.method === "PUT") {
    const body = await req.json().catch(() => null);
    if (!body) return fail("Nothing to save.");
    const clean = cleanLine(line.kind, body, { events: await choices(), rate: line.rate });
    if (line.kind === "mileage") clean.paidTo = me.name;
    Object.assign(line, clean, { editedAt: new Date().toISOString() });
    await putClaimLine(claim.id, line);
    await touch(claim);
    return json({ claim: await claimView(await getClaim(claim.id), me) });
  }

  if (req.method === "DELETE") {
    await deleteClaimLine(claim.id, line.id);
    await touch(claim);
    return json({ claim: await claimView(await getClaim(claim.id), me) });
  }

  if (req.method === "POST" && q("thumb")) {
    const got = await bytesOf(req, { "image/jpeg": "jpg" }, "a small JPEG", 200 * 1024);
    if (got.problem) return got.problem;
    await putClaimFile("thumb", claim.id, line.id, got.bytes, { name: "thumb.jpg", type: got.type });
    return json({ ok: true });
  }

  if (req.method === "POST" && q("shot")) {
    if (line.kind !== "noreceipt") return fail("A card statement goes with a line that has no receipt.");
    const got = await bytesOf(req, SHOT_TYPES, "a screenshot (JPEG or PNG) or a PDF of the statement");
    if (got.problem) return got.problem;
    await putClaimFile("shot", claim.id, line.id, got.bytes, { name: fileName(req.headers.get("x-file-name"), `statement.${SHOT_TYPES[got.type]}`), type: got.type });
    line.shot = { name: fileName(req.headers.get("x-file-name"), `statement.${SHOT_TYPES[got.type]}`), type: got.type, size: got.bytes.byteLength, at: new Date().toISOString() };
    await putClaimLine(claim.id, line);
    await touch(claim);
    return json({ claim: await claimView(await getClaim(claim.id), me) });
  }

  if (req.method === "POST" && q("again")) {
    if (line.kind !== "receipt" || !line.file) return fail("There is no receipt on that line to read.");
    await startRead(url.origin, claim.id, line.id);
    return json({ claim: await claimView(await getClaim(claim.id), me) }, 202);
  }

  return fail("Method not allowed.", 405);
};

async function signIn(req) {
  if (!signinConfig()) return fail("Microsoft sign-in isn't set up on this site yet.", 503);
  if (!process.env.ADMIN_KEY) return fail("The site isn't set up for signing in yet.", 503);
  const body = await req.json().catch(() => null);
  let person;
  try { person = await verifyIdToken(text(body?.idToken, 20000), text(body?.nonce, 200)); }
  catch (e) { return fail(e.message, 401); }
  const roster = (await getRoster()) ?? [];
  if (!mayClaim(person.email, roster)) return fail(`${person.email} isn't on ONGIA's board list. Ask the President to add you under Board members.`, 403);
  const member = roster.find((m) => String(m.email).toLowerCase() === person.email);
  // Remembered on the roster, beside the desk's own sign-in, so the President can see who uses it.
  if (member) { member.lastExpenseSignIn = new Date().toISOString(); await putRoster(roster); }
  const name = member?.name || person.name;
  const role = roleOf(person.email);
  return json({ session: issueExpenseSession({ email: person.email, name }), me: { email: person.email, name, role, title: ROLE_TITLE[role] } });
}

const lineId = () => token(16).replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 14).padEnd(8, "0");

async function choices() { return eventChoices(await listEvents()); }

/** Read the request body as one of `types`, checked by its first bytes. */
async function bytesOf(req, types, what, max = MAX_BYTES) {
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length) return { problem: fail("That file was empty.") };
  if (bytes.length > max) return { problem: fail(max === MAX_BYTES ? "That file is over 5 MB. Take the photo again, or save a smaller PDF." : "That file is too big.", 413) };
  const type = sniff(bytes);
  if (!type || !types[type]) return { problem: fail(`That kind of file can't be used here. Use ${what}.`, 415) };
  return { bytes, type };
}

/**
 * The claim this person is building: their draft, or a new one. A new claim's id comes from the person and how many
 * claims they have had, so two receipts sent at the same moment land on the same new claim rather than two.
 */
async function currentDraft(me) {
  const who = whoKey(me.email);
  const ids = await listMineIds(who);
  const claims = (await Promise.all(ids.map(getClaim))).filter(Boolean);
  const draft = claims.filter((c) => c.status === "draft").sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  if (draft) return draft;
  for (let n = ids.length + 1; n < ids.length + 50; n++) {
    const id = `${who.slice(0, 10)}-${n}`;
    const had = await getClaim(id);
    if (had && (had.owner?.email !== me.email || had.status !== "draft")) continue;
    if (had) { await markMine(who, id); return had; }
    const claim = { id, owner: { email: me.email, name: me.name, role: me.role }, status: "draft", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), history: [] };
    await putClaim(claim);
    await markMine(who, id);
    return claim;
  }
  throw new Error("Couldn't start a new claim.");
}

async function touch(claim) {
  claim.updatedAt = new Date().toISOString();
  await putClaim(claim);
}

async function startRead(origin, claimId, id) {
  if (!anthropicKey()) {
    await putClaimRead(claimId, id, { state: "failed", at: new Date().toISOString(), why: "Claude isn't set up on this site, so type the details in yourself." });
    return;
  }
  await putClaimRead(claimId, id, { state: "reading", startedAt: new Date().toISOString() });
  try {
    const r = await fetch(`${origin}/api/expense-read-background?claim=${encodeURIComponent(claimId)}&line=${encodeURIComponent(id)}`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "" } });
    if (r.status >= 400) throw new Error(`the reader answered ${r.status}`);
  } catch (e) {
    console.error("expense read did not start", claimId, id, e?.message);
    await putClaimRead(claimId, id, { state: "failed", at: new Date().toISOString(), why: "Claude couldn't start reading it. Type the details in, or press Read it again." });
  }
}

/** A claim as the app shows it: every line with what Claude read folded in, the total, and what is still missing. */
export async function claimView(claim, me) {
  const lines = await listClaimLines(claim.id);
  const reads = await Promise.all(lines.map((l) => (l.kind === "receipt" && l.file ? getClaimRead(claim.id, l.id) : null)));
  const shown = lines.map((l, i) => {
    let r = reads[i];
    if (r?.state === "reading" && Date.now() - Date.parse(r.startedAt) > STALE_MS) r = { state: "failed", why: "Reading took too long. Press Read it again, or type the details in." };
    return { ...viewLine(l, r), read: r ? { state: r.state, why: r.why ?? "", ...(r.state === "done" ? { found: r.found } : {}) } : null };
  });
  // Newest receipt first; a line with no date yet (one still being read) at the top.
  shown.sort((a, b) => (!a.date && b.date ? -1 : a.date && !b.date ? 1 : String(b.date).localeCompare(String(a.date))) || String(b.addedAt).localeCompare(String(a.addedAt)));
  const sums = claimSums(shown);
  const missing = shown.filter((l) => l.problems.length).length;
  return {
    id: claim.id, status: claim.status, owner: claim.owner, createdAt: claim.createdAt, updatedAt: claim.updatedAt,
    month: monthLabel(claim.submittedAt ? todayIso(new Date(claim.submittedAt)) : todayIso()),
    sums, lines: shown, missing,
    approvers: approversFor(claim.owner?.email).map((r) => ROLE_TITLE[r]),
    canEdit: claim.owner?.email === me.email && EDITABLE.includes(claim.status),
    reading: shown.some((l) => l.check?.state === "reading"),
  };
}

async function home(me) {
  const ids = await listMineIds(whoKey(me.email));
  const claims = (await Promise.all(ids.map(getClaim))).filter(Boolean);
  const draft = claims.filter((c) => c.status === "draft").sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] ?? null;
  const past = claims.filter((c) => c !== draft && c.status !== "draft").sort((a, b) => String(b.submittedAt ?? b.createdAt).localeCompare(String(a.submittedAt ?? a.createdAt)));
  return {
    me, rate: mileageRate(),
    categories: CATEGORIES.map(([n, name]) => ({ n, name })),
    events: await choices(),
    current: draft ? await claimView(draft, me) : null,
    month: monthLabel(todayIso()),
    approvers: approversFor(me.email).map((r) => ROLE_TITLE[r]),
    past: past.map((c) => ({ id: c.id, status: c.status, submittedAt: c.submittedAt ?? null, total: c.total ?? null, month: c.month ?? "" })),
    officer: me.role !== "member",
  };
}
