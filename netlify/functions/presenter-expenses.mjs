import { json, fail, text } from "./lib/http.mjs";
import { requireAdmin } from "./lib/http.mjs";
import { getEvent, listPresenters, getClaim, putClaim, listClaimLines, getClaimLine, putClaimLine, getMeta, putMeta } from "./lib/store.mjs";
import { issueExpenseSession, mileageRate, TRAVEL } from "./lib/expenses.mjs";
import { getPerDiem } from "./lib/expenseview.mjs";
import { todayIso } from "./lib/deadlines.mjs";
import { sendExpenseMail } from "./lib/mail.mjs";
import { selfKeyOk, selfLink, selfOwnerEmail, selfDeadline, mealsProvidedOf, perDiemBlurb, selfLinkMail, SELF_DAYS } from "./lib/presenterexpense.mjs";
import expenses from "./expenses.mjs";

/**
 * A presenter's own expense claim, by their link (Andrew 19 Nov 2026). No Microsoft sign-in: the link is the credential.
 * Everything a claim does (keeping the receipt, Claude reading it, the per diem check, sending it to the President and
 * the VP, the emails) is the Expenses app's own, run here on the presenter's behalf for their one claim and nothing else.
 *
 *   For the presenter (e, p, k from their link):
 *   GET    /api/presenter-expenses?e=&p=&k=                 the page: event, per diem, their claim
 *   POST   …&add=receipt | mileage                          a receipt (the photo or PDF) or kilometres driven
 *   PUT    …&line=<id>                                      what they checked or typed
 *   DELETE …&line=<id>                                      take a line off
 *   POST   …&again=<id>                                     read the receipt again
 *   GET    …&file=<id>[&kind=thumb]                         their own receipt back
 *   POST   …&thumb=<id>                                     the small picture of a receipt
 *   POST   …&submit=1                                       send it for approval
 *   For the desk (admin key):
 *   GET    /api/presenter-expenses?event=<id>&links=1       each presenter's link, whether it was emailed, and their claim
 *   POST   /api/presenter-expenses?event=<id>&send=1[&presenter=<id>]   email the link (to one, or to all not yet sent)
 */
const SENT = (eventId) => `presenter-expenses:sent:${eventId}`;
const nameOf = (p) => `${p.first ?? ""} ${p.last ?? ""}`.trim() || "Presenter";
const hasEmail = (p) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p?.email ?? "");

export default async (req) => {
  const url = new URL(req.url);
  const q = (k) => url.searchParams.get(k);
  if (q("event")) return desk(req, url, q);

  const eventId = text(q("e"), 80), presenterId = text(q("p"), 80);
  if (!eventId || !presenterId || !selfKeyOk(eventId, presenterId, q("k"))) return fail("This link isn't valid. Use the link in the email ONGIA sent you.", 403);
  const event = await getEvent(eventId);
  const presenter = event ? (await listPresenters(eventId)).find((x) => x.id === presenterId && x.status !== "withdrawn") : null;
  if (!presenter) return fail("This link is no longer in use. Please contact ONGIA.", 404);
  if (!hasEmail(presenter)) return fail("ONGIA doesn't have an email address for you, so it can't pay you by e-transfer. Please contact ONGIA.", 409);

  const today = todayIso(), deadline = selfDeadline(event);
  const owner = { email: selfOwnerEmail(eventId, presenterId), name: nameOf(presenter) };
  const session = issueExpenseSession(owner);
  const link = selfLink(eventId, presenterId, req);
  // One call into the Expenses app, as this presenter and for their claim only.
  const app = async (path, { method = "GET", body, headers = {}, claim = "" } = {}) => {
    const res = await expenses(new Request(`${url.origin}/api/expenses${path}`, { method, body, headers: { "x-expense-key": session, ...(claim ? { "x-working-claim": claim } : {}), ...headers } }));
    return res;
  };
  const asJson = async (res) => ({ status: res.status, body: await res.json().catch(() => ({})) });

  // Their claim: the one being built or sent back, else the latest one sent; made on the first visit.
  const home = (await asJson(await app(""))).body;
  let claimId = home.current?.id ?? home.past?.[0]?.id ?? "";
  const lang = presenter.language === "fr" ? "fr" : "en";
  const perDiem = await getPerDiem();
  const open = !deadline || today <= deadline;
  const page = async () => {
    const c = claimId ? (await asJson(await app(`?claim=${claimId}`))).body.claim : null;
    return {
      presenter: { name: owner.name, email: String(presenter.email).toLowerCase(), language: lang },
      event: { title: event.title, city: event.city ?? "", dayOne: event.dayOne ?? "", lastDay: event.lastDay ?? event.dayOne ?? "" },
      perDiem: { breakfast: perDiem.breakfast, lunch: perDiem.lunch, dinner: perDiem.dinner }, provided: mealsProvidedOf(event),
      blurb: { en: perDiemBlurb(perDiem, event, "en"), fr: perDiemBlurb(perDiem, event, "fr") },
      rate: mileageRate(), deadline, days: SELF_DAYS, open: open || c?.status === "rejected",
      claim: c ? { id: c.id, status: c.status, words: c.words, sums: c.sums, lines: c.lines, canEdit: c.canEdit && (open || c.status === "rejected"), rejected: c.rejected ? { comment: c.rejected.comment, by: c.rejected.by?.name ?? "" } : null,
        paid: c.paid ? { date: c.paid.date, ref: c.paid.ref } : null, sentAt: c.sentAt ?? null, reading: !!c.reading } : null,
    };
  };

  if (req.method === "GET" && q("file")) {
    if (!claimId) return fail("That file isn't on record.", 404);
    return app(`?claim=${claimId}&file=${encodeURIComponent(q("file"))}${q("kind") === "thumb" ? "&kind=thumb" : ""}`, { claim: claimId });
  }
  if (req.method === "GET") return json(await page());

  // From here on something changes: only while the link is open (or the claim was sent back to them to fix).
  const current = claimId ? await getClaim(claimId) : null;
  if (!open && current?.status !== "rejected") return fail(`This link took claims until ${deadline}. Please contact ONGIA.`, 410);
  if (current && !["draft", "rejected"].includes(current.status)) return fail("Your claim has been sent, so it can't be changed now.", 409);
  if (!current) {
    const made = await asJson(await app("?new=1", { method: "POST" }));
    claimId = made.body.working ?? "";
    if (!claimId) return fail(made.body.error ?? "Couldn't start your claim. Please try again.", made.status >= 400 ? made.status : 500);
    const forWho = await asJson(await app(`?claim=${claimId}&for=1`, { method: "PUT", body: JSON.stringify({ event: eventId, presenter: presenterId }), headers: { "content-type": "application/json" }, claim: claimId }));
    if (forWho.status >= 400) return fail(forWho.body.error ?? "Couldn't start your claim.", forWho.status);
    const c = await getClaim(claimId);
    // Marked as the presenter's own, with their link: its emails go to them and open this page, not the board's app.
    c.self = { link, event: eventId, presenter: presenterId };
    c.history = [...(c.history ?? []), { at: new Date().toISOString(), what: "started by the presenter, from their link", by: owner.name }];
    await putClaim(c);
  }
  const done = async (res) => { const out = await asJson(res); return out.status >= 400 ? json({ error: out.body.error ?? "That didn't work. Please try again.", problems: out.body.problems ?? undefined }, out.status) : json({ ...(await page()), line: out.body.line ?? undefined }, out.status === 202 ? 202 : 200); };
  const lineId = (v) => (/^[a-z0-9]{6,40}$/.test(String(v ?? "")) ? String(v) : "");
  // What a presenter types, and nothing else: no event (their claim already names it), no statement-of-work line.
  const typed = async () => { const b = await req.json().catch(() => ({})); return JSON.stringify({ paidTo: b.paidTo, date: b.date, amount: b.amount, km: b.km, from: b.from, to: b.to, purpose: b.purpose, comment: b.comment, meal: b.meal, category: TRAVEL }); };
  const J = { "content-type": "application/json" };

  if (req.method === "POST" && q("add") === "receipt") {
    const pass = {}; for (const h of ["content-type", "x-file-name", "x-upload-id"]) if (req.headers.get(h)) pass[h] = req.headers.get(h);
    return done(await app(`?add=receipt&claim=${claimId}`, { method: "POST", body: await req.arrayBuffer(), headers: pass, claim: claimId }));
  }
  if (req.method === "POST" && q("add") === "mileage") return done(await app(`?add=mileage&claim=${claimId}`, { method: "POST", body: await typed(), headers: J, claim: claimId }));
  if (req.method === "POST" && q("thumb")) return app(`?claim=${claimId}&thumb=${lineId(q("thumb"))}`, { method: "POST", body: await req.arrayBuffer(), headers: { "content-type": req.headers.get("content-type") ?? "image/jpeg" }, claim: claimId });
  if (req.method === "POST" && q("again")) return done(await app(`?claim=${claimId}&again=${lineId(q("again"))}`, { method: "POST", claim: claimId }));
  if (req.method === "PUT" && q("line")) return done(await app(`?claim=${claimId}&line=${lineId(q("line"))}`, { method: "PUT", body: await typed(), headers: J, claim: claimId }));
  if (req.method === "DELETE" && q("line")) return done(await app(`?claim=${claimId}&line=${lineId(q("line"))}`, { method: "DELETE", claim: claimId }));
  if (req.method === "POST" && q("submit")) {
    // A presenter isn't asked for a category or a purpose: travel for an event, unless the receipt said otherwise.
    const view = (await asJson(await app(`?claim=${claimId}`))).body.claim;
    for (const l of view?.lines ?? []) {
      if (l.category && (l.purpose || l.eventId)) continue;
      const line = await getClaimLine(claimId, l.id); if (!line) continue;
      if (!l.category) line.category = TRAVEL;
      if (!l.purpose && !l.eventId) line.purpose = l.kind === "mileage" ? "Drive to present" : l.meal && l.meal !== "none" ? "Meal while presenting" : "Presenter expense";
      await putClaimLine(claimId, line);
    }
    return done(await app(`?submit=${claimId}`, { method: "POST", body: "{}", headers: J, claim: claimId }));
  }
  return fail("Method not allowed.", 405);
};

/** The desk's side: each presenter's link to copy, and Send. */
async function desk(req, url, q) {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const event = await getEvent(text(q("event"), 80));
  if (!event) return fail("No such event.", 404);
  const presenters = (await listPresenters(event.id)).filter((p) => p.status !== "withdrawn").sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const sent = (await getMeta(SENT(event.id))) ?? {};
  const deadline = selfDeadline(event);
  const rows = async () => Promise.all(presenters.map(async (p) => {
    // Their claim, if they've started one: found the way the Expenses app finds a person's claims.
    const res = await expenses(new Request(`${url.origin}/api/expenses`, { headers: { "x-expense-key": issueExpenseSession({ email: selfOwnerEmail(event.id, p.id), name: nameOf(p) }) } }));
    const home = await res.json().catch(() => ({}));
    const c = home.current ?? home.past?.[0] ?? null;
    const n = c ? (c.lines?.length ?? (await listClaimLines(c.id)).length) : 0;
    return { id: p.id, name: nameOf(p), email: hasEmail(p) ? String(p.email).toLowerCase() : "", link: selfLink(event.id, p.id, req), sentAt: sent[p.id]?.at ?? null, failed: sent[p.id]?.ok === false ? sent[p.id].why ?? "It didn't send." : "",
      claim: c && n ? { status: c.status, words: c.words ?? "", total: c.sums?.total ?? c.total ?? null } : null };
  }));
  if (req.method === "GET") return json({ event: { id: event.id, title: event.title }, deadline, provided: mealsProvidedOf(event), presenters: await rows() });
  if (req.method === "POST" && q("send")) {
    const only = text(q("presenter"), 80);
    const to = presenters.filter((p) => hasEmail(p) && (only ? p.id === only : !sent[p.id]?.ok));
    if (only && !to.length) return fail("That presenter has no email address on their agreement.", 409);
    const perDiem = await getPerDiem();
    let ok = 0; const failed = [];
    for (const p of to) {
      let out;
      try { const r = await sendExpenseMail({ to: p.email, ...selfLinkMail({ presenter: p, event, link: selfLink(event.id, p.id, req), perDiem, deadline }) }); out = r?.skipped ? { ok: false, why: r.reason } : { ok: true }; }
      catch (e) { console.error("presenter expense link failed", p.email, e?.message); out = { ok: false, why: e?.message ?? "It didn't send." }; }
      sent[p.id] = { ...out, at: new Date().toISOString() };
      if (out.ok) ok++; else failed.push({ name: nameOf(p), why: out.why });
    }
    await putMeta(SENT(event.id), sent);
    return json({ sent: ok, failed, presenters: await rows() });
  }
  return fail("Method not allowed.", 405);
}
