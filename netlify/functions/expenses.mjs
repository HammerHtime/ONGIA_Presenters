import { createHash } from "node:crypto";
import { json, fail, text, fileName } from "./lib/http.mjs";
import { signinConfig, verifyIdToken } from "./lib/auth.mjs";
import { token } from "./lib/ids.mjs";
import { anthropicKey } from "./lib/contract.mjs";
import { todayIso } from "./lib/deadlines.mjs";
import { sendMail } from "./lib/mail.mjs";
import {
  getRoster, putRoster, listEvents, getClaim, putClaim, listClaimLines, getClaimLine, putClaimLine, deleteClaimLine,
  getClaimRead, putClaimRead, putClaimFile, getClaimFile, markMine, listMineIds, markWaiting, listWaitingIds, listClaimIds,
  deleteClaimAll, getAway, putAway, deleteAway,
} from "./lib/store.mjs";
import {
  CATEGORIES, KINDS, MAX_BYTES, TYPES, SHOT_TYPES, ROLE_TITLE, OFFICER_ROLES, PAYER, mileageRate, roleOf, approversFor, mayClaim,
  rosterName, whoKey, issueExpenseSession, expenseWho, cleanLine, viewLine, claimSums, monthLabel, eventChoices, sniff,
  executives, inForce, cleanAway, holders, payerOf, awayPreview, submitProblems, claimChecks, statusWords, officers,
} from "./lib/expenses.mjs";
import { needsApprovalMail, sentBackMail, approvedMail, toPayMail, paidMail, unlockedMail, handoffMail } from "./lib/expensemail.mjs";

/**
 * ONGIA Expenses: a board member's expense claims (see lib/expenses.mjs). Signed in with the member's own ONGIA
 * Microsoft account; the session travels in x-expense-key. Opens expense claims and nothing else on the desk.
 *
 * A claim's life: draft → submitted (two sign-offs) → approved → paid (locked). Either person approving can send it
 * back with a reason (rejected), and the member fixes it and sends it again. The VP records the e-transfer, which
 * locks it; the President or the VP can unlock it, with a reason. An officer who is away hands their sign-offs (and
 * the VP her payments) to another executive.
 *
 *   POST   /api/expenses?signin=1                        { idToken, nonce } from Microsoft → { session, me }
 *   GET    /api/expenses[?test=1]                        home: my claim being built, my others, what waits on me
 *   GET    /api/expenses?claim=<id>                      one claim, with Claude's check and who signs off
 *   GET    /api/expenses?claim=<id>&file=<line>[&kind=thumb|shot]   a receipt, its small picture, or the card statement
 *   POST   /api/expenses?add=receipt[&claim=<id>][&test=1]   body = the photo or PDF; Claude starts reading it
 *   POST   /api/expenses?add=mileage|noreceipt[&claim=]  { date, km, from, to, … }
 *   PUT    /api/expenses?claim=<id>&line=<line>          what the person checked or typed
 *   DELETE /api/expenses?claim=<id>&line=<line>          a line;   DELETE ?claim=<id>   the whole claim
 *   POST   /api/expenses?claim=<id>&thumb=|shot=|again=<line>
 *   POST   /api/expenses?submit=<id>                     send it for approval
 *   POST   /api/expenses?decide=<id>                     { decision: approve | reject, comment }
 *   POST   /api/expenses?sendback=<id>                   { comment }: the President or VP, on an approved claim
 *   POST   /api/expenses?pay=<id>                        { ref, date }: the VP (or her stand-in); locks it
 *   POST   /api/expenses?unlock=<id>                     { reason }: the President or the VP
 *   POST   /api/expenses?marktest=<id>                   { on }: the President
 *   POST   /api/expenses?purge=tests                     the President: every test claim, gone
 *   GET    /api/expenses?awaypreview=<role>&to=&backup=  who would take what
 *   PUT    /api/expenses?away=<role>                     { to, backup, from, until };   DELETE ?away=<role>
 */
const STALE_MS = 5 * 60 * 1000;
const MAX_LINES = 60;
const EDITABLE = ["draft", "rejected"];
const now = () => new Date().toISOString();

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
  const names = (e) => rosterName(e, roster, e);
  const today = todayIso();
  const aways = await loadAways();
  const ctx = { me, names, today, aways, roster };
  const test = q("test") === "1";

  if (req.method === "GET" && q("awaypreview")) {
    const role = q("awaypreview");
    if (!mayHandOff(me, role)) return fail("Only that officer, or the President, can hand off their approvals.", 403);
    const c = cleanAway(role, { to: q("to"), backup: q("backup"), from: q("from") || today, until: q("until") || today }, today);
    if (c.problem) return fail(c.problem);
    return json({ rows: awayPreview(role, c.ok, aways, today, names).map((r) => ({ ...r, name: names(r.email) })) });
  }

  if (q("away")) {
    const role = q("away");
    if (!mayHandOff(me, role)) return fail("Only that officer, or the President, can hand off their approvals.", 403);
    // Answered from the hand-offs as they now stand, not as they were read when the request came in.
    if (req.method === "DELETE") { await deleteAway(role); return json(await home({ ...ctx, aways: { ...aways, [role]: null } }, test)); }
    if (req.method !== "PUT") return fail("Method not allowed.", 405);
    const c = cleanAway(role, await req.json().catch(() => ({})), today);
    if (c.problem) return fail(c.problem);
    const d = { ...c.ok, by: { email: me.email, name: me.name }, at: now() };
    // Who is told: the stand-in, with how many are waiting for them now, and the second person.
    const after = { ...aways, [role]: d };
    const waiting = inForce(d, today) ? (await waitingClaims()).filter((cl) => cl.status === "submitted" && holders(cl.owner?.email, after, today, decidedOf(cl)).some((s) => !s.done && s.role === role && s.email === d.to)).length : 0;
    d.mail = [];
    d.mail.push(await tell(d.to, handoffMail({ from: names(officers()[role]), title: ROLE_TITLE[role], d, waiting, pays: role === PAYER })));
    if (d.backup) d.mail.push(await tell(d.backup, handoffMail({ from: names(officers()[role]), title: ROLE_TITLE[role], d, isBackup: true, standIn: names(d.to) })));
    await putAway(role, d);
    return json(await home({ ...ctx, aways: after }, test));
  }

  if (req.method === "POST" && q("purge")) {
    if (me.role !== "president") return fail("Only the President can delete the test claims.", 403);
    let claims = 0, lines = 0;
    for (const id of await listClaimIds()) {
      const c = await getClaim(id);
      if (c?.test) { lines += await deleteClaimAll(id, whoKey(c.owner?.email)); claims++; }
    }
    return json({ ...(await home(ctx, test)), purged: { claims, lines } });
  }

  // A claim named in the request, or the one being built.
  const named = q("claim") || q("submit") || q("decide") || q("sendback") || q("pay") || q("unlock") || q("marktest");
  const loadNamed = async () => {
    const c = named && /^[a-z0-9-]{4,40}$/.test(named) ? await getClaim(named) : null;
    if (!c) return { problem: fail("That claim isn't on record. It may have been deleted.", 404) };
    if (!mayOpen(c, ctx)) return { problem: fail("That claim isn't yours, and isn't waiting on you.", 403) };
    return { claim: c };
  };
  const editable = (c) => (c.owner?.email !== me.email ? "Only the person claiming can change a claim." : !EDITABLE.includes(c.status) ? "This claim has been sent, so it can't be changed now." : null);

  if (req.method === "GET" && named && q("file")) {
    const { claim, problem } = await loadNamed();
    if (problem) return problem;
    const kind = ["thumb", "shot"].includes(q("kind")) ? q("kind") : "file";
    const f = await getClaimFile(kind, claim.id, q("file"));
    if (!f) return fail("That file isn't on record.", 404);
    // Never kept in the browser's cache: a receipt can show card digits, and the cache doesn't know who is signed in.
    return new Response(f.bytes, { headers: { "content-type": f.type, "content-disposition": `inline; filename="${String(f.name).replace(/[^\w.\- ]+/g, "_")}"`, "cache-control": "no-store" } });
  }

  if (req.method === "GET" && named) {
    const { claim, problem } = await loadNamed();
    if (problem) return problem;
    return json({ claim: await claimView(claim, ctx) });
  }

  if (req.method === "GET") return json(await home(ctx, test));

  if (req.method === "POST" && q("add")) {
    const kind = q("add");
    if (!KINDS.includes(kind)) return fail("Add a receipt, mileage, or a line with no receipt.");
    let claim;
    if (named) { const got = await loadNamed(); if (got.problem) return got.problem; claim = got.claim; }
    else claim = await currentDraft(me, test);
    const no = editable(claim);
    if (no) return fail(no, 409);
    if ((await listClaimLines(claim.id)).length >= MAX_LINES) return fail(`A claim holds up to ${MAX_LINES} lines. Send this one, then start the next.`, 409);
    const line = { id: lineId(), kind, addedAt: now() };
    // A photo kept on the phone through a dropped signal is sent again with the same upload id: it is the same line,
    // so a receipt is never claimed twice because the first answer didn't reach the phone.
    const upload = req.headers.get("x-upload-id") ?? "";
    if (kind === "receipt" && /^[A-Za-z0-9-]{8,64}$/.test(upload)) {
      line.id = createHash("sha256").update(`${me.email}:${upload}`).digest("hex").slice(0, 14);
      if (await getClaimLine(claim.id, line.id)) return json({ claim: await claimView(claim, ctx), line: line.id, again: true });
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
    return json({ claim: await claimView(await getClaim(claim.id), ctx), line: line.id }, kind === "receipt" ? 202 : 201);
  }

  if (!named) return fail("Which claim?");
  const { claim, problem } = await loadNamed();
  if (problem) return problem;

  /* ---- the whole claim ---- */
  if (req.method === "DELETE" && !q("line")) {
    const mineToDelete = claim.owner?.email === me.email && EDITABLE.includes(claim.status);
    if (!mineToDelete && !(me.role === "president" && claim.test)) return fail(claim.test ? "Only the person claiming, or the President, can delete a test claim." : "You can delete a claim of yours that hasn't been approved. Once it's sent, ask the person approving to send it back first.", 403);
    await deleteClaimAll(claim.id, whoKey(claim.owner?.email));
    return json({ ...(await home(ctx, test)), deleted: claim.id });
  }

  if (req.method === "POST" && q("marktest")) {
    if (me.role !== "president") return fail("Only the President can mark a claim as a test.", 403);
    const body = await req.json().catch(() => ({}));
    claim.test = body.on !== false;
    claim.history = [...(claim.history ?? []), { at: now(), what: claim.test ? "marked as a test" : "no longer a test", by: me.name }];
    await putClaim(claim);
    return json({ claim: await claimView(claim, ctx) });
  }

  if (req.method === "POST" && q("submit")) {
    const no = editable(claim);
    if (no) return fail(no, 409);
    const view = await claimView(claim, ctx);
    const problems = submitProblems(view.lines, today);
    if (problems.length) return json({ error: problems.length === 1 ? problems[0] : `${problems.length} things to sort out first.`, problems }, 409);
    // What Claude read becomes what was claimed: the people approving see exactly what is sent, and it can't drift.
    for (const l of view.lines) {
      if (!l.fromRead?.length) continue;
      const line = await getClaimLine(claim.id, l.id);
      for (const k of l.fromRead) line[k] = l[k];
      await putClaimLine(claim.id, line);
    }
    const again = claim.status === "rejected";
    for (const r of OFFICER_ROLES) delete claim[`signed_${r}`];
    delete claim.rejected;
    Object.assign(claim, {
      status: "submitted", sentAt: now(), submittedAt: claim.submittedAt ?? now(), month: claim.month || monthLabel(today),
      total: view.sums.total, sums: view.sums, round: (claim.round ?? 0) + 1,
      history: [...(claim.history ?? []), { at: now(), what: again ? "sent again" : "sent", by: me.name }],
    });
    await putClaim(claim);
    await markWaiting(claim.id, true);
    await askApprovers(claim, ctx);
    return json({ claim: await claimView(await getClaim(claim.id), ctx) });
  }

  if (req.method === "POST" && q("decide")) {
    const body = await req.json().catch(() => ({}));
    const decision = body.decision;
    if (!["approve", "reject"].includes(decision)) return fail("Approve it, or send it back.");
    if (claim.status !== "submitted") return fail(claim.status === "rejected" ? "This claim has already been sent back." : claim.status === "draft" ? "This claim hasn't been sent." : "This claim has already been approved.", 409);
    const slots = holders(claim.owner?.email, aways, today, decidedOf(claim));
    const slot = slots.find((s) => !s.done && s.email === me.email);
    if (!slot) return fail(slots.some((s) => s.done && s.email === me.email) ? "You've already approved this one." : "This claim isn't waiting on you.", 403);
    if (decision === "reject") return sendBack(claim, ctx, slot.role, slot.for, body.comment);
    claim[`signed_${slot.role}`] = { email: me.email, name: me.name, ...(slot.for ? { for: ROLE_TITLE[slot.role] } : {}), at: now() };
    claim.history = [...(claim.history ?? []), { at: now(), what: "approved", by: me.name, as: slot.for ? `for the ${ROLE_TITLE[slot.role]}` : ROLE_TITLE[slot.role] }];
    await putClaim(claim);
    // Both sign-offs: approved, and the VP is asked to pay. Read again first, so two approvals at the same moment both count.
    const fresh = await getClaim(claim.id);
    const after = holders(fresh.owner?.email, aways, today, decidedOf(fresh));
    if (fresh.status === "submitted" && after.every((s) => s.done)) {
      fresh.status = "approved"; fresh.approvedAt = now();
      await putClaim(fresh);
      const approvers = after.map((s) => signedName(fresh[`signed_${s.role}`]));
      const payer = payerOf(fresh.owner?.email, aways, today);
      await note(fresh, "approved", await tell(fresh.owner?.email, approvedMail({ claim: fresh, approvers, payer: names(payer.email) })));
      await note(fresh, "to pay", await tell(payer.email, toPayMail({ claim: fresh, approvers, acting: payer.for ? ROLE_TITLE[PAYER] : "" })));
    }
    return json({ claim: await claimView(await getClaim(claim.id), ctx) });
  }

  if (req.method === "POST" && q("sendback")) {
    if (claim.status !== "approved") return fail("Only an approved claim that isn't paid can be sent back this way.", 409);
    if (!["president", "vp"].includes(me.role)) return fail("Only the President or the VP can send back an approved claim.", 403);
    const body = await req.json().catch(() => ({}));
    return sendBack(claim, ctx, me.role, false, body.comment);
  }

  if (req.method === "POST" && q("pay")) {
    if (claim.status !== "approved") return fail(claim.status === "paid" ? "This claim is already paid." : "This claim isn't approved yet.", 409);
    const payer = payerOf(claim.owner?.email, aways, today);
    if (payer.email !== me.email) return fail(`${names(payer.email)} records the payments${payer.for ? `, standing in for the ${ROLE_TITLE[PAYER]}` : ""}.`, 403);
    const body = await req.json().catch(() => ({}));
    const ref = String(body.ref ?? "").trim().replace(/\s+/g, "");
    if (!/^[A-Za-z0-9-]{4,40}$/.test(ref)) return fail("Type the e-transfer's reference number, as the bank shows it.");
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date ?? "")) ? body.date : today;
    // A day's grace past Toronto's date: late in the evening it is already tomorrow further east.
    if (date > new Date(Date.parse(`${today}T12:00:00Z`) + 86400e3).toISOString().slice(0, 10)) return fail("The payment date can't be in the future.");
    claim.status = "paid";
    claim.paid = { ref, date, by: { email: me.email, name: me.name }, ...(payer.for ? { for: ROLE_TITLE[PAYER] } : {}), at: now() };
    claim.history = [...(claim.history ?? []), { at: now(), what: "paid and locked", by: me.name, ref }];
    await putClaim(claim);
    await markWaiting(claim.id, false);
    await note(claim, "paid", await tell(claim.owner?.email, paidMail({ claim, payer: me.name, paid: claim.paid })));
    return json({ claim: await claimView(await getClaim(claim.id), ctx) });
  }

  if (req.method === "POST" && q("unlock")) {
    if (claim.status !== "paid") return fail("Only a paid claim is locked.", 409);
    if (!["president", "vp"].includes(me.role)) return fail("Only the President or the VP can unlock a paid claim.", 403);
    const body = await req.json().catch(() => ({}));
    const reason = String(body.reason ?? "").trim().slice(0, 1000);
    if (reason.length < 5) return fail("Say why it's being unlocked.");
    claim.history = [...(claim.history ?? []), { at: now(), what: "unlocked", by: me.name, reason, paid: claim.paid }];
    delete claim.paid;
    claim.status = "approved";
    await putClaim(claim);
    await markWaiting(claim.id, true);
    const tellTo = [...new Set([payerOf(claim.owner?.email, aways, today).email, officers().president].filter((e) => e !== me.email))];
    for (const e of tellTo) await note(claim, "unlocked", await tell(e, unlockedMail({ claim, by: me.name, reason })));
    return json({ claim: await claimView(await getClaim(claim.id), ctx) });
  }

  /* ---- one line ---- */
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
    Object.assign(line, clean, { editedAt: now() });
    await putClaimLine(claim.id, line);
    await touch(claim);
    return json({ claim: await claimView(await getClaim(claim.id), ctx) });
  }

  if (req.method === "DELETE") {
    await deleteClaimLine(claim.id, line.id);
    await touch(claim);
    return json({ claim: await claimView(await getClaim(claim.id), ctx) });
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
    const name = fileName(req.headers.get("x-file-name"), `statement.${SHOT_TYPES[got.type]}`);
    await putClaimFile("shot", claim.id, line.id, got.bytes, { name, type: got.type });
    line.shot = { name, type: got.type, size: got.bytes.byteLength, at: now() };
    await putClaimLine(claim.id, line);
    await touch(claim);
    return json({ claim: await claimView(await getClaim(claim.id), ctx) });
  }

  if (req.method === "POST" && q("again")) {
    if (line.kind !== "receipt" || !line.file) return fail("There is no receipt on that line to read.");
    await startRead(url.origin, claim.id, line.id);
    return json({ claim: await claimView(await getClaim(claim.id), ctx) }, 202);
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
  if (member) { member.lastExpenseSignIn = now(); await putRoster(roster); }
  const name = member?.name || person.name;
  const role = roleOf(person.email);
  return json({ session: issueExpenseSession({ email: person.email, name }), me: { email: person.email, name, role, title: ROLE_TITLE[role] } });
}

const lineId = () => token(16).replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 14).padEnd(8, "0");
async function choices() { return eventChoices(await listEvents()); }
async function loadAways() {
  const out = {};
  for (const r of OFFICER_ROLES) out[r] = await getAway(r);
  return out;
}
/** That officer themselves, or the President for any of them (if someone forgets before leaving). */
const mayHandOff = (me, role) => OFFICER_ROLES.includes(role) && (me.role === role || me.role === "president");
const decidedOf = (c) => Object.fromEntries(OFFICER_ROLES.filter((r) => c[`signed_${r}`]).map((r) => [r, c[`signed_${r}`]]));
/** "J. Taylor", or "J. Taylor for the President". */
const signedName = (s) => (s ? `${s.name}${s.for ? ` for the ${s.for}` : ""}` : "");

/**
 * Who may open a claim: the person claiming; the President, the VP and the Treasurer once it's sent (the VP sees every
 * claim, Andrew 3 Nov 2026); and anyone who signs it off or pays it, a stand-in included, while it's theirs to do.
 */
function mayOpen(c, { me, aways, today }) {
  if (c.owner?.email === me.email) return true;
  if (c.status === "draft") return false;
  if (OFFICER_ROLES.includes(me.role)) return true;
  if (OFFICER_ROLES.some((r) => c[`signed_${r}`]?.email === me.email) || c.paid?.by?.email === me.email) return true;
  if (c.status === "submitted" && holders(c.owner?.email, aways, today, decidedOf(c)).some((s) => s.email === me.email)) return true;
  if (c.status === "approved" && payerOf(c.owner?.email, aways, today).email === me.email) return true;
  return false;
}

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
 * The claim this person is building: their draft (or, in test mode, their test draft), or a new one. A new claim's id
 * comes from the person and how many claims they have had, so two receipts sent at the same moment land on the same
 * new claim rather than two.
 */
async function currentDraft(me, test = false) {
  const who = whoKey(me.email);
  const ids = await listMineIds(who);
  const claims = (await Promise.all(ids.map(getClaim))).filter(Boolean);
  const draft = claims.filter((c) => c.status === "draft" && !!c.test === test).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  if (draft) return draft;
  for (let n = ids.length + 1; n < ids.length + 50; n++) {
    const id = `${who.slice(0, 10)}-${test ? "t" : ""}${n}`;
    const had = await getClaim(id);
    if (had && (had.owner?.email !== me.email || had.status !== "draft" || !!had.test !== test)) continue;
    if (had) { await markMine(who, id); return had; }
    const claim = { id, owner: { email: me.email, name: me.name, role: me.role }, status: "draft", createdAt: now(), updatedAt: now(), history: [], ...(test ? { test: true } : {}) };
    await putClaim(claim);
    await markMine(who, id);
    return claim;
  }
  throw new Error("Couldn't start a new claim.");
}

async function touch(claim) {
  claim.updatedAt = now();
  await putClaim(claim);
}

async function startRead(origin, claimId, id) {
  if (!anthropicKey()) {
    await putClaimRead(claimId, id, { state: "failed", at: now(), why: "Claude isn't set up on this site, so type the details in yourself." });
    return;
  }
  await putClaimRead(claimId, id, { state: "reading", startedAt: now() });
  try {
    const r = await fetch(`${origin}/api/expense-read-background?claim=${encodeURIComponent(claimId)}&line=${encodeURIComponent(id)}`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "" } });
    if (r.status >= 400) throw new Error(`the reader answered ${r.status}`);
  } catch (e) {
    console.error("expense read did not start", claimId, id, e?.message);
    await putClaimRead(claimId, id, { state: "failed", at: now(), why: "Claude couldn't start reading it. Type the details in, or press Read it again." });
  }
}

/** Send one email and say what happened; a failure is kept, never thrown. */
async function tell(to, message) {
  if (!to) return { to: "", ok: false, why: "Nobody to send it to." };
  try {
    const out = await sendMail({ to, ...message });
    if (out?.skipped) return { to, ok: false, why: out.reason, at: now() };
    return { to, ok: true, at: now() };
  } catch (e) {
    console.error("expense email failed", to, e?.message);
    return { to, ok: false, why: e?.message ?? "It didn't send.", at: now() };
  }
}
/** Keep what an email did on the claim, so a send that failed shows on the claim, not only in a log. */
async function note(claim, what, outcome) {
  const c = await getClaim(claim.id);
  if (!c) return;
  c.mail = [...(c.mail ?? []), { what, ...outcome }].slice(-40);
  await putClaim(c);
  claim.mail = c.mail;
}

async function askApprovers(claim, { aways, today, names }) {
  const view = { ...claim, lines: await listClaimLines(claim.id) };
  const checks = await checksFor(claim, view.lines);
  const slots = holders(claim.owner?.email, aways, today, decidedOf(claim));
  for (const s of slots.filter((x) => !x.done)) {
    const other = slots.find((x) => x !== s);
    const d = s.for ? aways[s.role] : null;
    await note(claim, "to approve", await tell(s.email, needsApprovalMail({ claim, checks, acting: s.for ? ROLE_TITLE[s.role] : "", until: d?.until ?? "", others: other ? `${names(other.email)}` : "" })));
  }
}

async function sendBack(claim, { me, aways, today, names }, role, acting, comment) {
  const why = String(comment ?? "").trim().slice(0, 1500);
  if (why.length < 3) return fail("Say why you're sending it back, so they know what to change.");
  for (const r of OFFICER_ROLES) delete claim[`signed_${r}`];
  claim.status = "rejected";
  claim.rejected = { by: { email: me.email, name: me.name }, role, ...(acting ? { for: ROLE_TITLE[role] } : {}), comment: why, at: now() };
  claim.history = [...(claim.history ?? []), { at: now(), what: "sent back", by: me.name, comment: why }];
  await putClaim(claim);
  await markWaiting(claim.id, false);
  const by = acting ? `${me.name}, standing in for the ${ROLE_TITLE[role]},` : `${me.name} (${ROLE_TITLE[role] ?? "approving"})`;
  await note(claim, "sent back", await tell(claim.owner?.email, sentBackMail({ claim, by, comment: why })));
  return json({ claim: await claimView(await getClaim(claim.id), { me, aways, today, names }) });
}

/** Claude's check, with the person's other sent claims to look for the same thing claimed twice. */
async function checksFor(claim, lines) {
  const earlier = [];
  for (const id of await listMineIds(whoKey(claim.owner?.email))) {
    if (id === claim.id) continue;
    const c = await getClaim(id);
    // The last 13 months is enough to catch a receipt sent twice; older claims are paid and filed.
    if (c && c.status !== "draft" && !c.test && Date.now() - Date.parse(c.sentAt ?? c.createdAt) < 400 * 86400e3) earlier.push(...(await listClaimLines(id)));
  }
  return claimChecks(lines, { month: claim.month || monthLabel(todayIso()), earlier });
}

async function waitingClaims() {
  return (await Promise.all((await listWaitingIds()).map(getClaim))).filter(Boolean);
}

/** A claim as the app shows it: every line with what Claude read folded in, the total, what's missing, who signs off. */
export async function claimView(claim, { me, aways, today, names }) {
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
  const mine = claim.owner?.email === me.email;
  const sent = claim.status !== "draft";
  const slots = holders(claim.owner?.email, aways, today, decidedOf(claim)).map((s) => {
    const signed = claim[`signed_${s.role}`];
    return { role: s.role, title: ROLE_TITLE[s.role], email: s.email, name: names(s.email), for: s.for ? ROLE_TITLE[s.role] : "", done: !!s.done, at: signed?.at ?? null, stuck: !!s.stuck, me: s.email === me.email };
  });
  const payer = payerOf(claim.owner?.email, aways, today);
  const myslot = claim.status === "submitted" ? slots.find((s) => !s.done && s.me) : null;
  const editableNow = mine && EDITABLE.includes(claim.status);
  return {
    id: claim.id, status: claim.status, words: statusWords(claim), owner: claim.owner, createdAt: claim.createdAt, updatedAt: claim.updatedAt,
    sentAt: claim.sentAt ?? null, test: !!claim.test,
    month: claim.month || monthLabel(todayIso()),
    sums, lines: shown, missing: shown.filter((l) => l.problems.length).length,
    approvers: approversFor(claim.owner?.email).map((r) => ROLE_TITLE[r]),
    slots, payer: { email: payer.email, name: names(payer.email), for: payer.for ? ROLE_TITLE[PAYER] : "" },
    rejected: claim.rejected ?? null, paid: claim.paid ?? null,
    history: claim.history ?? [],
    // A send that failed shows to the people running the claim, not only in a log.
    mailFailed: OFFICER_ROLES.includes(me.role) ? (claim.mail ?? []).filter((m) => !m.ok).map((m) => ({ what: m.what, to: names(m.to), why: m.why, at: m.at })) : [],
    checks: sent || editableNow ? await checksFor(claim, shown) : null,
    canEdit: editableNow,
    reading: shown.some((l) => l.check?.state === "reading"),
    can: {
      submit: editableNow && shown.length > 0,
      decide: myslot ? { role: myslot.role, title: myslot.title, for: myslot.for } : null,
      pay: claim.status === "approved" && payer.email === me.email,
      sendBack: claim.status === "approved" && ["president", "vp"].includes(me.role),
      unlock: claim.status === "paid" && ["president", "vp"].includes(me.role),
      del: (editableNow) || (me.role === "president" && !!claim.test),
      markTest: me.role === "president",
    },
  };
}

const summary = (c, names, extra = {}) => ({ id: c.id, owner: { name: c.owner?.name, email: c.owner?.email }, status: c.status, words: statusWords(c), month: c.month ?? "", total: c.total ?? null, sentAt: c.sentAt ?? null, test: !!c.test, ...extra });

async function home(ctx, test = false) {
  const { me, aways, today, names } = ctx;
  const ids = await listMineIds(whoKey(me.email));
  const claims = (await Promise.all(ids.map(getClaim))).filter(Boolean);
  const newest = (a, b) => String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt));
  // The one in front of the person: a claim sent back to them first (it needs them), else the one they are building.
  const open = claims.filter((c) => EDITABLE.includes(c.status) && !!c.test === test).sort((a, b) => (a.status === "rejected" ? -1 : 0) - (b.status === "rejected" ? -1 : 0) || newest(a, b));
  const current = open[0] ?? null;
  const past = claims.filter((c) => !EDITABLE.includes(c.status)).sort((a, b) => String(b.sentAt ?? b.createdAt).localeCompare(String(a.sentAt ?? a.createdAt)));
  // What waits on this person: sign-offs they hold today, and payments to record.
  const toApprove = [], toPay = [];
  for (const c of await waitingClaims()) {
    if (c.status === "submitted") {
      const s = holders(c.owner?.email, aways, today, decidedOf(c)).find((x) => !x.done && x.email === me.email);
      if (s) toApprove.push(summary(c, names, { as: s.for ? `for the ${ROLE_TITLE[s.role]}` : ROLE_TITLE[s.role] }));
    } else if (c.status === "approved" && payerOf(c.owner?.email, aways, today).email === me.email) toPay.push(summary(c, names));
  }
  const officer = OFFICER_ROLES.includes(me.role);
  let all = null;
  if (officer) {
    all = (await Promise.all((await listClaimIds()).map(getClaim))).filter((c) => c && c.status !== "draft")
      .sort((a, b) => String(b.sentAt ?? "").localeCompare(String(a.sentAt ?? ""))).map((c) => summary(c, names));
  }
  const standingIn = OFFICER_ROLES.filter((r) => inForce(aways[r], today) && (aways[r].to === me.email || aways[r].backup === me.email))
    .map((r) => ({ role: r, title: ROLE_TITLE[r], name: names(officers()[r]), until: aways[r].until, backup: aways[r].backup === me.email }));
  const awayView = (r) => (aways[r] ? { ...aways[r], toName: names(aways[r].to), backupName: aways[r].backup ? names(aways[r].backup) : "", inForce: !!inForce(aways[r], today), mail: (aways[r].mail ?? []).map((m) => ({ ...m, to: names(m.to) })) } : null);
  return {
    me: { ...me, officer }, rate: mileageRate(), test,
    categories: CATEGORIES.map(([n, name]) => ({ n, name })),
    events: await choices(),
    current: current ? await claimView(current, ctx) : null,
    others: open.slice(1).map((c) => summary(c, names)),
    month: monthLabel(today),
    approvers: approversFor(me.email).map((r) => ROLE_TITLE[r]),
    past: past.map((c) => summary(c, names)),
    toApprove, toPay, all, standingIn,
    // Hand-offs: an officer sees their own; the President sees all three (to set one for someone who forgot).
    away: officer ? Object.fromEntries(OFFICER_ROLES.filter((r) => r === me.role || me.role === "president").map((r) => [r, awayView(r)])) : null,
    executives: executives().map((x) => ({ ...x, name: names(x.email) })),
    tabs: ["claim", "past", ...(officer || toApprove.length || toPay.length || standingIn.length ? ["approve"] : []), ...(officer ? ["all"] : [])],
  };
}
