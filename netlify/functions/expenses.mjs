import { createHash } from "node:crypto";
import { json, fail, text, fileName } from "./lib/http.mjs";
import { signinConfig, verifyIdToken } from "./lib/auth.mjs";
import { token } from "./lib/ids.mjs";
import { anthropicKey } from "./lib/contract.mjs";
import { todayIso } from "./lib/deadlines.mjs";
import { sendExpenseMail } from "./lib/mail.mjs";
import {
  getRoster, putRoster, listEvents, getClaim, putClaim, listClaimLines, getClaimLine, putClaimLine, deleteClaimLine,
  getClaimRead, putClaimRead, putClaimFile, getClaimFile, markMine, listMineIds, markWaiting, listWaitingIds, listClaimIds,
  deleteClaimAll, getAway, putAway, deleteAway, getMeta, putMeta, getSow,
} from "./lib/store.mjs";
import { syncClaimToSow } from "./lib/sowexpense.mjs";
import {
  CATEGORIES, KINDS, MAX_BYTES, TYPES, SHOT_TYPES, ROLE_TITLE, OFFICER_ROLES, APPROVER_ROLES, PAYER, mileageRate, roleOf, approversFor, mayClaim,
  rosterName, whoKey, issueExpenseSession, expenseWho, cleanLine, viewLine, claimSums, monthLabel, eventChoices, sniff,
  executives, inForce, cleanAway, holders, payerOf, awayPreview, submitProblems, claimChecks, statusWords, officers, sowLinesFor,
} from "./lib/expenses.mjs";
import { shownLines, checksFor } from "./lib/expenseview.mjs";
import { hashOf, dupesFor, indexClaim, whereWords } from "./lib/expensedupes.mjs";
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
 *   POST   /api/expenses?claim=<id>&toreal=1[&line=<line>]   a test claim being built: its lines (or that one) onto my real claim, receipts and all
 *   POST   /api/expenses?purge=tests                     the President: every test claim, gone
 *   POST   /api/expenses?boardtest=1                     { on }: the President. While on, every claim sent is a board test
 *   GET    /api/expenses?clearpreview=<YYYY-MM-DD>        the President: what Clear would delete, made up to that day
 *   POST   /api/expenses?clear=1                         { date }: the President: every claim made up to that day, gone
 *   GET    /api/expenses?awaypreview=<role>&to=&backup=  who would take what
 *   PUT    /api/expenses?away=<role>                     { to, backup, from, until };   DELETE ?away=<role>
 */
const STALE_MS = 5 * 60 * 1000;
const MAX_LINES = 60;
const EDITABLE = ["draft", "rejected"];
/** How many claims one person can be building at once. */
const MAX_DRAFTS = 6;
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
  // The claim being worked on, when the person has more than one open (Andrew 14 Nov 2026: "I want to have that ability
  // to have more than one I am working on"). The app says which with every request.
  const working = /^[a-z0-9-]{4,40}$/.test(req.headers.get("x-working-claim") ?? "") ? req.headers.get("x-working-claim") : "";
  const ctx = { me, names, today, aways, roster, working };
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
    const waiting = inForce(d, today) ? (await waitingClaims()).filter((cl) => cl.status === "submitted" && slotsOf(cl, after, today).some((s) => !s.done && s.role === role && s.email === d.to)).length : 0;
    d.mail = [];
    d.mail.push(await tell(d.to, handoffMail({ from: names(officers()[role]), title: ROLE_TITLE[role], d, waiting, pays: role === PAYER }), me.email));
    if (d.backup) d.mail.push(await tell(d.backup, handoffMail({ from: names(officers()[role]), title: ROLE_TITLE[role], d, isBackup: true, standIn: names(d.to) }), me.email));
    await putAway(role, d);
    return json(await home({ ...ctx, aways: after }, test));
  }

  if (req.method === "POST" && q("purge")) {
    if (me.role !== "president") return fail("Only the President can delete the test claims.", 403);
    let claims = 0, lines = 0;
    const filed = [];
    for (const id of await listClaimIds()) {
      const c = await getClaim(id);
      if (c?.test) { if (c.filed?.folder) filed.push(c.filed); lines += await deleteClaimAll(id, whoKey(c.owner?.email)); claims++; }
    }
    await dropFiled(url.origin, filed);
    return json({ ...(await home(ctx, test)), purged: { claims, lines } });
  }

  /*
   * The board's test of the app (Andrew 3 Nov 2026: "test this with a bunch of the other board members ... then clear all
   * the data and all the receipts ... until the day I tell you"). While the switch is on, every claim sent is marked BOARD
   * TEST, in the app and in its emails, so nobody pays one for real; its copies go in the Test claims folder. When the
   * test is over, Clear deletes every claim made up to the day he picks, from everyone, with its receipts and its copies.
   */
  if (req.method === "POST" && q("boardtest")) {
    if (me.role !== "president") return fail("Only the President can turn the board test on or off.", 403);
    const body = await req.json().catch(() => ({}));
    const was = (await getMeta(BOARD_TEST)) ?? {};
    await putMeta(BOARD_TEST, body.on ? { on: true, since: now(), by: me.name } : { on: false, since: was.since ?? null, ended: now(), by: me.name });
    return json(await home(ctx, test));
  }
  if (q("clearpreview") || (req.method === "POST" && q("clear"))) {
    if (me.role !== "president") return fail("Only the President can clear the test claims.", 403);
    const date = req.method === "POST" ? String((await req.json().catch(() => ({}))).date ?? "") : q("clearpreview");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return fail("Pick the last day to clear.");
    if (date > today) return fail("Pick today or a day before it.");
    const gone = await madeBy(date);
    const people = [...new Set(gone.map((c) => names(c.owner?.email)))];
    const real = gone.filter((c) => !c.test && !c.trial).length;
    if (req.method !== "POST") return json({ date, claims: gone.length, people, real, paid: gone.filter((c) => c.status === "paid").length });
    let lines = 0;
    const filed = [];
    for (const c of gone) { if (c.filed?.folder) filed.push(c.filed); lines += await deleteClaimAll(c.id, whoKey(c.owner?.email)); }
    await dropFiled(url.origin, filed);
    console.log(`expenses cleared by ${me.name}: ${gone.length} claims made up to ${date}, ${lines} lines`);
    return json({ ...(await home(ctx, test)), cleared: { claims: gone.length, lines, date } });
  }

  // A claim named in the request, or the one being built.
  const named = q("claim") || q("submit") || q("decide") || q("sendback") || q("pay") || q("unlock") || q("marktest") || q("refile");
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

  // Start another claim beside the one(s) being built. An empty one already open is used rather than making a second.
  if (req.method === "POST" && q("new")) {
    const claim = await currentDraft(me, test, { fresh: true, keep: working });
    if (claim.problem) return fail(claim.problem, 409);
    return json({ ...(await home({ ...ctx, working: claim.id }, test)), working: claim.id });
  }

  if (req.method === "POST" && q("add")) {
    const kind = q("add");
    if (!KINDS.includes(kind)) return fail("Add a receipt, mileage, or a line with no receipt.");
    let claim;
    if (named) { const got = await loadNamed(); if (got.problem) return got.problem; claim = got.claim; }
    else claim = await currentDraft(me, test, { working });
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
      line.file = { name: fileName(req.headers.get("x-file-name"), `receipt.${TYPES[got.type]}`), type: got.type, size: got.bytes.byteLength, hash: hashOf(got.bytes) };
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

  /*
   * Off testing, without uploading again (Andrew 6 Nov 2026: "Is there any way to get them off testing without uploading
   * again"): every line of a test claim still being built moves onto the person's real claim, with its receipt, its card
   * statement, what Claude read and what they typed. The emptied test claim is deleted.
   */
  if (req.method === "POST" && q("toreal")) {
    if (claim.owner?.email !== me.email) return fail("Only the person claiming can move their lines.", 403);
    if (!claim.test || claim.status !== "draft") return fail("Only a test claim that hasn't been sent can be moved.", 409);
    // One line (its "Test data" box unticked, Andrew 6 Nov 2026), or all of them.
    const all = await listClaimLines(claim.id);
    const lines = q("line") ? all.filter((l) => l.id === q("line")) : all;
    if (!lines.length) return fail(q("line") ? "That line isn't on this claim." : "There's nothing on it to move.", 409);
    const real = await currentDraft(me, false);
    const there = await listClaimLines(real.id);
    if (there.length + lines.length > MAX_LINES) return fail(`Your real claim can hold ${MAX_LINES - there.length} more lines. Send it first, then move these.`, 409);
    let moved = 0;
    for (const l of lines) {
      const id = there.some((x) => x.id === l.id) ? lineId() : l.id;
      for (const kind of ["file", "thumb", "shot"]) {
        const f = await getClaimFile(kind, claim.id, l.id);
        if (f) await putClaimFile(kind, real.id, id, f.bytes, { name: f.name, type: f.type });
      }
      const read = await getClaimRead(claim.id, l.id);
      if (read) await putClaimRead(real.id, id, read);
      await putClaimLine(real.id, { ...l, id, movedFromTest: now() });
      if (lines.length < all.length) await deleteClaimLine(claim.id, l.id);
      moved++;
    }
    real.history = [...(real.history ?? []), { at: now(), what: `${moved} line${moved === 1 ? "" : "s"} moved from a test claim`, by: me.name }];
    await touch(real);
    const emptied = lines.length === all.length;
    if (emptied) await deleteClaimAll(claim.id, whoKey(me.email)); else await touch(claim);
    console.log(`expenses: ${me.name} moved ${moved} lines from test claim ${claim.id} to ${real.id}`);
    // Lines left on the test claim: still in test mode, looking at them. None left: off test, on the real claim.
    return json({ ...(await home(ctx, !emptied)), moved, to: real.id, emptied });
  }

  /* ---- the whole claim ---- */
  if (req.method === "DELETE" && !q("line")) {
    const mineToDelete = claim.owner?.email === me.email && EDITABLE.includes(claim.status);
    if (!mineToDelete && !(me.role === "president" && claim.test)) return fail(claim.test ? "Only the person claiming, or the President, can delete a test claim." : "You can delete a claim of yours that hasn't been approved. Once it's sent, ask the person approving to send it back first.", 403);
    await deleteClaimAll(claim.id, whoKey(claim.owner?.email));
    if (claim.filed?.folder) await dropFiled(url.origin, [claim.filed]);
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

  if (req.method === "POST" && q("refile")) {
    if (!OFFICER_ROLES.includes(me.role)) return fail("The President, the VP or the Treasurer can file a claim again.", 403);
    if (claim.status === "draft") return fail("A claim is filed once it's sent.", 409);
    await startFiling(url.origin, claim.id);
    return json({ claim: await claimView(await getClaim(claim.id), ctx) }, 202);
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
    if (!claim.test && await boardTestOn()) claim.trial = true;
    for (const r of OFFICER_ROLES) delete claim[`signed_${r}`];
    delete claim.rejected;
    Object.assign(claim, {
      status: "submitted", sentAt: now(), submittedAt: claim.submittedAt ?? now(), month: claim.month || monthLabel(today),
      total: view.sums.total, sums: view.sums, round: (claim.round ?? 0) + 1,
      history: [...(claim.history ?? []), { at: now(), what: again ? "sent again" : "sent", by: me.name }],
    });
    await putClaim(claim);
    // Into the index of sent receipts, so the next claim is checked against this one.
    await indexClaim(claim, view.lines).catch((e) => console.error("expense dupes index", e));
    await markWaiting(claim.id, true);
    await askApprovers(claim, ctx);
    await startFiling(url.origin, claim.id);
    return json({ claim: await claimView(await getClaim(claim.id), ctx) });
  }

  if (req.method === "POST" && q("decide")) {
    const body = await req.json().catch(() => ({}));
    const decision = body.decision;
    if (!["approve", "reject"].includes(decision)) return fail("Approve it, or send it back.");
    if (claim.status !== "submitted") return fail(claim.status === "rejected" ? "This claim has already been sent back." : claim.status === "draft" ? "This claim hasn't been sent." : "This claim has already been approved.", 409);
    const slots = slotsOf(claim, aways, today);
    const slot = slots.find((s) => !s.done && s.email === me.email);
    if (!slot) return fail(slots.some((s) => s.done && s.email === me.email) ? "You've already approved this one." : "This claim isn't waiting on you.", 403);
    if (decision === "reject") return sendBack(claim, ctx, slot.role, slot.for, body.comment);
    claim[`signed_${slot.role}`] = { email: me.email, name: me.name, ...(slot.for ? { for: ROLE_TITLE[slot.role] } : {}), at: now() };
    claim.history = [...(claim.history ?? []), { at: now(), what: "approved", by: me.name, as: slot.practice ? `${ROLE_TITLE[slot.role]}, for practice` : slot.for ? `for the ${ROLE_TITLE[slot.role]}` : ROLE_TITLE[slot.role] }];
    await putClaim(claim);
    // Both sign-offs: approved, and the VP is asked to pay. Read again first, so two approvals at the same moment both count.
    const fresh = await getClaim(claim.id);
    const after = slotsOf(fresh, aways, today);
    if (fresh.status === "submitted" && after.every((s) => s.done)) {
      fresh.status = "approved"; fresh.approvedAt = now();
      await putClaim(fresh);
      const practice = !!fresh.test;
      // "Approved by the President and the VP of Operations"; a stand-in is named.
      const approvedBy = after.map((s) => { const g = fresh[`signed_${s.role}`]; return g?.for && !practice ? `${g.name} for the ${g.for}` : `the ${ROLE_TITLE[s.role]}`; });
      const payer = payerFor(fresh, aways, today);
      await note(fresh, "approved", await tell(fresh.owner?.email, approvedMail({ claim: fresh, approvedBy, payer: names(payer.email), practice }), payer.email));
      await note(fresh, "to pay", await tell(payer.email, toPayMail({ claim: fresh, approvedBy, acting: payer.for ? ROLE_TITLE[PAYER] : "", practice }), fresh.owner?.email));
      await startFiling(url.origin, claim.id);
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
    const payer = payerFor(claim, aways, today);
    if (payer.email !== me.email) return fail(`${names(payer.email)} records the payments${payer.for ? `, standing in for the ${ROLE_TITLE[PAYER]}` : ""}.`, 403);
    const body = await req.json().catch(() => ({}));
    const ref = String(body.ref ?? "").trim().replace(/\s+/g, "");
    if (!/^[A-Za-z0-9-]{4,40}$/.test(ref)) return fail("Type the e-transfer's transaction number, as the bank shows it.");
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date ?? "")) ? body.date : today;
    // A day's grace past Toronto's date: late in the evening it is already tomorrow further east.
    if (date > new Date(Date.parse(`${today}T12:00:00Z`) + 86400e3).toISOString().slice(0, 10)) return fail("The payment date can't be in the future.");
    claim.status = "paid";
    claim.paid = { ref, date, by: { email: me.email, name: me.name }, ...(payer.for ? { for: ROLE_TITLE[PAYER] } : {}), at: now() };
    claim.history = [...(claim.history ?? []), { at: now(), what: "paid and locked", by: me.name, ref }];
    await putClaim(claim);
    await markWaiting(claim.id, false);
    await note(claim, "paid", await tell(claim.owner?.email, paidMail({ claim, payer: me.name, paid: claim.paid }), me.email));
    await startFiling(url.origin, claim.id);
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
    const tellTo = [...new Set([payerFor(claim, aways, today).email, officers().president].filter((e) => e !== me.email))];
    for (const e of tellTo) await note(claim, "unlocked", await tell(e, unlockedMail({ claim, by: me.name, reason }), me.email));
    await startFiling(url.origin, claim.id);
    return json({ claim: await claimView(await getClaim(claim.id), ctx) });
  }

  /* ---- one line ---- */
  const lid = q("line") || q("thumb") || q("shot") || q("again");
  const line = lid && /^[a-z0-9]{6,40}$/.test(lid) ? await getClaimLine(claim.id, lid) : null;
  if (!line) return fail("That line isn't on this claim any more. Reload and look again.", 404);
  // The President or the VP moves an expense to another line of the event's statement of work, at any time (Andrew 4 Nov
  // 2026: "I should be able to just go and change the line item"). Only where it's counted: what was claimed stays.
  if (req.method === "POST" && q("sowline")) {
    if (!["president", "vp"].includes(me.role)) return fail("Only the President or the VP can move an expense to another line of the statement of work.", 403);
    const body = await req.json().catch(() => ({}));
    const ev = (await choices()).find((e) => e.id === line.eventId);
    const to = ev?.sowLines?.find((l) => l.id === String(body.sowLineId ?? ""));
    if (!to) return fail("Pick a line of the event's statement of work.");
    const from = line.sowLineName || "none";
    Object.assign(line, { sowLineId: to.id, sowLineName: to.name, sowSuggested: false, sowMovedBy: me.name, sowMovedAt: now() });
    await putClaimLine(claim.id, line);
    claim.history = [...(claim.history ?? []), { at: now(), what: `moved ${line.paidTo || "an expense"} from ${from} to ${to.name} on the statement of work`, by: me.name }];
    await putClaim(claim);
    await syncSow(claim);
    return json({ claim: await claimView(await getClaim(claim.id), ctx) });
  }
  const no = editable(claim);
  if (no) return fail(no, 409);

  if (req.method === "PUT") {
    const body = await req.json().catch(() => null);
    if (!body) return fail("Nothing to save.");
    const clean = cleanLine(line.kind, body, { events: await choices(), rate: line.rate, had: line });
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
    line.shot = { name, type: got.type, size: got.bytes.byteLength, at: now(), hash: hashOf(got.bytes) };
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
// Each event a line can name, and for an RBH event with a statement of work, the lines an expense can go under.
async function choices() {
  return Promise.all(eventChoices(await listEvents()).map(async (e) => (e.kind === "rbh" ? { ...e, sowLines: sowLinesFor(e, await getSow(e.id)) } : e)));
}
async function loadAways() {
  const out = {};
  for (const r of OFFICER_ROLES) out[r] = await getAway(r);
  return out;
}
/** That officer themselves, or the President for any of them (if someone forgets before leaving). */
const mayHandOff = (me, role) => APPROVER_ROLES.includes(role) && (me.role === role || me.role === "president");
const decidedOf = (c) => Object.fromEntries(OFFICER_ROLES.filter((r) => c[`signed_${r}`]).map((r) => [r, c[`signed_${r}`]]));
// Who signs and who pays a claim: a test claim is practice, and every step goes back to the person who made it.
const slotsOf = (c, aways, today) => holders(c.owner?.email, aways, today, decidedOf(c), { practice: !!c.test });
const payerFor = (c, aways, today) => payerOf(c.owner?.email, aways, today, { practice: !!c.test });

/**
 * Who may open a claim: the person claiming; the President, the VP and the Treasurer once it's sent (the VP sees every
 * claim, Andrew 3 Nov 2026); and anyone who signs it off or pays it, a stand-in included, while it's theirs to do.
 */
function mayOpen(c, { me, aways, today }) {
  if (c.owner?.email === me.email) return true;
  if (c.status === "draft") return false;
  if (OFFICER_ROLES.includes(me.role)) return true;
  if (OFFICER_ROLES.some((r) => c[`signed_${r}`]?.email === me.email) || c.paid?.by?.email === me.email) return true;
  if (c.status === "submitted" && slotsOf(c, aways, today).some((s) => s.email === me.email)) return true;
  if (c.status === "approved" && payerFor(c, aways, today).email === me.email) return true;
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
async function currentDraft(me, test = false, { working = "", fresh = false, keep = "" } = {}) {
  const who = whoKey(me.email);
  const ids = await listMineIds(who);
  const claims = (await Promise.all(ids.map(getClaim))).filter(Boolean);
  const drafts = claims.filter((c) => c.status === "draft" && !!c.test === test).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (fresh) {
    // Another claim: an empty one already open (not the one on screen) does, else a new one, up to MAX_DRAFTS at once.
    for (const d of drafts) if (d.id !== keep && !(await listClaimLines(d.id)).length) return d;
    if (drafts.length >= MAX_DRAFTS) return { problem: `You have ${drafts.length} claims open. Send or delete one before starting another.` };
  } else {
    const draft = drafts.find((c) => c.id === working) ?? drafts[0];
    if (draft) return draft;
  }
  for (let n = ids.length + 1; n < ids.length + 50; n++) {
    const id = `${who.slice(0, 10)}-${test ? "t" : ""}${n}`;
    const had = await getClaim(id);
    if (had && (had.owner?.email !== me.email || had.status !== "draft" || !!had.test !== test)) continue;
    if (had && fresh && drafts.some((d) => d.id === had.id)) continue;
    if (had) { await markMine(who, id); return had; }
    const claim = { id, owner: { email: me.email, name: me.name, role: me.role }, status: "draft", createdAt: now(), updatedAt: now(), history: [], ...(test ? { test: true } : (await boardTestOn()) ? { trial: true } : {}) };
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

/**
 * Start filing the claim in the Treasurer's folders (expense-file-background). A start that fails is kept on the
 * claim, in words, for the officers to see and retry.
 */
/** Bring the events' statements of work in line with this claim (lib/sowexpense.mjs), and remember which it touched. */
async function syncSow(claim) {
  try {
    const out = await syncClaimToSow(claim, await listClaimLines(claim.id));
    const fresh = await getClaim(claim.id);
    if (fresh && JSON.stringify(fresh.sowEvents ?? []) !== JSON.stringify(out.events)) { fresh.sowEvents = out.events; await putClaim(fresh); }
  } catch (e) { console.error("expense to statement of work failed", claim.id, e?.message); }
}

async function startFiling(origin, claimId) {
  try {
    const r = await fetch(`${origin}/api/expense-file-background?claim=${encodeURIComponent(claimId)}`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "" } });
    if (r.status >= 400) throw new Error(`the filing job answered ${r.status}`);
  } catch (e) {
    console.error("expense filing did not start", claimId, e?.message);
    const c = await getClaim(claimId);
    if (c) { c.filed = { ...(c.filed ?? {}), problem: "Filing to SharePoint didn't start. Press File it again.", failedAt: now() }; await putClaim(c); }
  }
}
const BOARD_TEST = "expenses-board-test";
const boardTestNow = async () => { const b = await getMeta(BOARD_TEST); return b?.on ? { on: true, since: b.since ?? null } : null; };
const boardTestOn = async () => !!(await boardTestNow());
/** Every claim made up to and including a day (Toronto), from everyone, whatever it's at. */
async function madeBy(date) {
  const all = (await Promise.all((await listClaimIds()).map(getClaim))).filter(Boolean);
  return all.filter((c) => todayIso(new Date(c.createdAt ?? c.updatedAt ?? 0)) <= date);
}
/** Take filed copies out of SharePoint (deleted test claims, a withdrawn claim): only files the desk put there. */
async function dropFiled(origin, records) {
  if (!records.length) return;
  try {
    await fetch(`${origin}/api/expense-file-background?drop=1`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "", "content-type": "application/json" }, body: JSON.stringify(records) });
  } catch (e) { console.error("expense unfiling did not start", e?.message); }
}

/** Send one email and say what happened; a failure is kept, never thrown. A reply goes to `replyTo`, a person. */
async function tell(to, message, replyTo = "") {
  if (!to) return { to: "", ok: false, why: "Nobody to send it to." };
  try {
    const out = await sendExpenseMail({ to, ...message, ...(replyTo && replyTo !== to ? { replyTo } : {}) });
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
  // The lines as the app shows them, each with its receipt check: the email marks each amount with it.
  const view = { ...claim, lines: await shownLines(claim) };
  const checks = await checksFor(claim, view.lines);
  const open = slotsOf(claim, aways, today).filter((x) => !x.done);
  // "Waiting on approval from President Andrew Hammond and Treasurer Raj Jaswal" (Andrew, 3 Nov 2026).
  const waitingOn = open.map((s) => s.practice ? `the ${ROLE_TITLE[s.role]}` : s.for ? `${names(s.email)} for the ${ROLE_TITLE[s.role]}` : `${ROLE_TITLE[s.role]} ${names(s.email)}`);
  // One email each: a test claim's two sign-offs are the same person, who gets one.
  for (const email of [...new Set(open.map((s) => s.email))]) {
    const s = open.find((x) => x.email === email);
    const d = s.for ? aways[s.role] : null;
    await note(claim, "to approve", await tell(email, needsApprovalMail({ claim, lines: view.lines, checks, waitingOn, acting: s.for ? ROLE_TITLE[s.role] : "", until: d?.until ?? "", practice: !!s.practice }), claim.owner?.email));
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
  // No longer approved: its receipts come off the events' statements of work until it is approved again.
  await syncSow(claim);
  const by = acting ? `${me.name}, standing in for the ${ROLE_TITLE[role]},` : `${me.name} (${ROLE_TITLE[role] ?? "approving"})`;
  await note(claim, "sent back", await tell(claim.owner?.email, sentBackMail({ claim, by, comment: why }), me.email));
  return json({ claim: await claimView(await getClaim(claim.id), { me, aways, today, names }) });
}

async function waitingClaims() {
  return (await Promise.all((await listWaitingIds()).map(getClaim))).filter(Boolean);
}

/** A claim as the app shows it: every line with what Claude read folded in, the total, what's missing, who signs off. */
export async function claimView(claim, { me, aways, today, names }) {
  const shown = await shownLines(claim);
  // Newest receipt first; a line with no date yet (one still being read) at the top.
  shown.sort((a, b) => (!a.date && b.date ? -1 : a.date && !b.date ? 1 : String(b.date).localeCompare(String(a.date))) || String(b.addedAt).localeCompare(String(a.addedAt)));
  const sums = claimSums(shown);
  const mine = claim.owner?.email === me.email;
  const sent = claim.status !== "draft";
  // The same receipt already claimed, by anyone (Andrew 9 Nov 2026): marked on the line, for the person and the approvers.
  if (shown.length && (sent || (mine && EDITABLE.includes(claim.status)))) {
    const dupes = await dupesFor(claim, shown).catch(() => ({}));
    for (const l of shown) { const d = dupes[l.id]; if (d) l.dupe = { level: d.level, why: d.why, where: whereWords(d.on, me.email) }; }
  }
  const slots = slotsOf(claim, aways, today).map((s) => {
    const signed = claim[`signed_${s.role}`];
    return { role: s.role, title: ROLE_TITLE[s.role], email: s.email, name: names(s.email), for: s.for ? ROLE_TITLE[s.role] : "", done: !!s.done, at: signed?.at ?? null, stuck: !!s.stuck, me: s.email === me.email, practice: !!s.practice };
  });
  const payer = payerFor(claim, aways, today);
  const myslot = claim.status === "submitted" ? slots.find((s) => !s.done && s.me) : null;
  const editableNow = mine && EDITABLE.includes(claim.status);
  return {
    id: claim.id, status: claim.status, words: statusWords(claim), owner: claim.owner, createdAt: claim.createdAt, updatedAt: claim.updatedAt,
    sentAt: claim.sentAt ?? null, test: !!claim.test, trial: !!claim.trial,
    month: claim.month || monthLabel(todayIso()),
    sums, lines: shown, missing: shown.filter((l) => l.problems.length).length,
    approvers: approversFor(claim.owner?.email).map((r) => ROLE_TITLE[r]),
    slots, payer: { email: payer.email, name: names(payer.email), for: payer.for ? ROLE_TITLE[PAYER] : "", practice: !!payer.practice },
    rejected: claim.rejected ?? null, paid: claim.paid ?? null,
    // Where it is filed on SharePoint, or why it isn't. Ids and the receipt list stay on the server.
    filed: claim.filed ? { at: claim.filed.at ?? null, folderUrl: claim.filed.folderUrl ?? "", folder: claim.filed.folder ?? "", status: claim.filed.status ?? "", problem: claim.filed.problem ?? "", failedAt: claim.filed.failedAt ?? null, skipped: !!claim.filed.skipped, reason: claim.filed.reason ?? "" } : null,
    history: claim.history ?? [],
    // A send that failed shows to the people running the claim, not only in a log.
    mailFailed: OFFICER_ROLES.includes(me.role) ? (claim.mail ?? []).filter((m) => !m.ok).map((m) => ({ what: m.what, to: names(m.to), why: m.why, at: m.at })) : [],
    checks: sent || editableNow ? await checksFor(claim, shown) : null,
    canEdit: editableNow,
    reading: shown.some((l) => l.check?.state === "reading"),
    can: {
      submit: editableNow && shown.length > 0,
      decide: myslot ? { role: myslot.role, title: myslot.title, for: myslot.for, practice: myslot.practice } : null,
      pay: claim.status === "approved" && payer.email === me.email,
      sendBack: claim.status === "approved" && ["president", "vp"].includes(me.role),
      unlock: claim.status === "paid" && ["president", "vp"].includes(me.role),
      del: (editableNow) || (me.role === "president" && !!claim.test),
      markTest: me.role === "president",
      refile: OFFICER_ROLES.includes(me.role) && claim.status !== "draft",
    },
  };
}

// A claim in a list. Paid claims carry the day they were paid and what is on them (Andrew 3 Nov 2026: "the date and the
// amount obviously will show the day it was paid out"); an approved one, the day it was approved.
const summary = (c, names, extra = {}) => ({ id: c.id, owner: { name: c.owner?.name, email: c.owner?.email }, status: c.status, words: statusWords(c), month: c.month ?? "", total: c.total ?? null, sentAt: c.sentAt ?? null, test: !!c.test, trial: !!c.trial,
  approvedAt: c.approvedAt ?? null, paidOn: c.paid?.date ?? null, sums: c.sums ? { receipts: c.sums.receipts ?? 0, mileage: c.sums.mileage ?? 0, noreceipt: c.sums.noreceipt ?? 0 } : null, ...extra });

async function home(ctx, test = false) {
  const { me, aways, today, names } = ctx;
  const ids = await listMineIds(whoKey(me.email));
  const claims = (await Promise.all(ids.map(getClaim))).filter(Boolean);
  const newest = (a, b) => String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt));
  // The one in front of the person: a claim sent back to them first (it needs them), else the one they are building.
  const open = claims.filter((c) => EDITABLE.includes(c.status) && !!c.test === test).sort((a, b) => (a.status === "rejected" ? -1 : 0) - (b.status === "rejected" ? -1 : 0) || newest(a, b));
  // Unless the app says which one is being worked on.
  const current = open.find((c) => c.id === ctx.working) ?? open[0] ?? null;
  const past = claims.filter((c) => !EDITABLE.includes(c.status)).sort((a, b) => String(b.sentAt ?? b.createdAt).localeCompare(String(a.sentAt ?? a.createdAt)));
  // What waits on this person: sign-offs they hold today, and payments to record.
  const toApprove = [], toPay = [];
  for (const c of await waitingClaims()) {
    if (c.status === "submitted") {
      const s = slotsOf(c, aways, today).find((x) => !x.done && x.email === me.email);
      if (s) toApprove.push(summary(c, names, { as: s.for ? `for the ${ROLE_TITLE[s.role]}` : ROLE_TITLE[s.role] }));
    } else if (c.status === "approved" && payerFor(c, aways, today).email === me.email) toPay.push(summary(c, names));
  }
  const officer = OFFICER_ROLES.includes(me.role);
  let all = null;
  if (officer) {
    all = (await Promise.all((await listClaimIds()).map(getClaim))).filter((c) => c && c.status !== "draft")
      .sort((a, b) => String(b.sentAt ?? "").localeCompare(String(a.sentAt ?? ""))).map((c) => summary(c, names));
  }
  const standingIn = APPROVER_ROLES.filter((r) => inForce(aways[r], today) && (aways[r].to === me.email || aways[r].backup === me.email))
    .map((r) => ({ role: r, title: ROLE_TITLE[r], name: names(officers()[r]), until: aways[r].until, backup: aways[r].backup === me.email }));
  const awayView = (r) => (aways[r] ? { ...aways[r], toName: names(aways[r].to), backupName: aways[r].backup ? names(aways[r].backup) : "", inForce: !!inForce(aways[r], today), mail: (aways[r].mail ?? []).map((m) => ({ ...m, to: names(m.to) })) } : null);
  return {
    me: { ...me, officer }, rate: mileageRate(), test,
    boardTest: await boardTestNow(),
    categories: CATEGORIES.map(([n, name]) => ({ n, name })),
    events: await choices(),
    current: current ? await claimView(current, ctx) : null,
    // The other open claims, to switch to: how many lines, the total, and what they're for.
    others: await Promise.all(open.filter((c) => c !== current).map(async (c) => {
      const ls = await listClaimLines(c.id);
      const evs = [...new Set(ls.map((l) => l.eventTitle).filter(Boolean))];
      return summary(c, names, { lines: ls.length, sum: Math.round(ls.reduce((t, l) => t + (Number(l.amount) || 0), 0) * 100) / 100, about: evs[0] ?? "", createdAt: c.createdAt ?? null });
    })),
    month: monthLabel(today),
    approvers: approversFor(me.email).map((r) => ROLE_TITLE[r]),
    past: past.map((c) => summary(c, names)),
    toApprove, toPay, all, standingIn,
    // Hand-offs: an approver sees their own; the President sees both (to set one for the VP if she forgets).
    away: APPROVER_ROLES.includes(me.role) ? Object.fromEntries(APPROVER_ROLES.filter((r) => r === me.role || me.role === "president").map((r) => [r, awayView(r)])) : null,
    executives: executives().map((x) => ({ ...x, name: names(x.email) })),
    tabs: ["claim", "past", ...(officer || toApprove.length || toPay.length || standingIn.length ? ["approve"] : []), ...(officer ? ["all"] : [])],
  };
}
