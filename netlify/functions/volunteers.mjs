import { json, fail, requireAdmin, adminWho, text, isEmail, editGuard } from "./lib/http.mjs";
import { signerOf } from "./lib/auth.mjs";
import { siteUrl } from "./lib/site.mjs";
import { getEvent, putEvent, listVolunteers, getVolunteer, putVolunteer, getPdf, deleteKey, getRoster } from "./lib/store.mjs";
import { volunteerContact } from "./lib/mail.mjs";
import { safeFileName } from "./lib/ids.mjs";
import { formatDate } from "./lib/deadlines.mjs";
import { cleanRows, newVolunteer, inviteVolunteer, deliverVolunteer, completeAgreement, buildAndStore, pdfKey, volunteerCounts, VOLUNTEER_MAX } from "./lib/volunteers.mjs";
import { guestWindow } from "./lib/rooming.mjs";

/**
 * The desk's side of volunteers (the volunteer's own side is volunteer.mjs).
 *
 *   GET    /api/volunteers?event=…                         { volunteers, counts, lead, contact }
 *   GET    /api/volunteers?event=…&id=…&pdf=1              the signed PDF
 *   POST   /api/volunteers?event=…                         body { volunteers: [{ first, last, email, organization }], invite? }
 *   POST   /api/volunteers?event=…&action=invite           body { ids? } email the link (a reminder if it was sent before)
 *   POST   /api/volunteers?event=…&id=…&action=approve     body { approverName, hotel: { need: "yes"|"no", from, to, pays } } make it final
 *   POST   /api/volunteers?event=…&id=…&action=redeliver   body { all?, only?, rebuild? } retry filing / emails
 *   PUT    /api/volunteers?event=…&id=…                    correct name, email, agency
 *   PUT    /api/volunteers?event=…&lead=1                  body { email } who manages the volunteers ('' = the event lead)
 *   DELETE /api/volunteers?event=…&id=…[&final=1]          body { reason }
 */
export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);

  const url = new URL(req.url);
  const event = await getEvent(url.searchParams.get("event"));
  if (!event) return fail("No such event.", 404);
  if (req.method !== "GET") { const viewOnly = editGuard(req, event); if (viewOnly) return viewOnly; }
  const id = url.searchParams.get("id");
  const origin = siteUrl(req);

  if (req.method === "GET") {
    if (id && url.searchParams.get("pdf")) return download(event, id);
    const volunteers = await listVolunteers(event.id);
    return json({ volunteers, counts: volunteerCounts(volunteers), lead: event.volunteerLead ?? null, contact: volunteerContact(event) });
  }

  const body = (await req.json().catch(() => null)) ?? {};
  if (req.method === "POST") {
    const action = url.searchParams.get("action");
    if (action === "invite") return sendLinks(event, body, origin);
    if (action === "approve") return approve(event, id, body, adminWho(req));
    if (action === "redeliver") return redeliver(event, id, body);
    return add(event, body, origin);
  }
  if (req.method === "PUT") return url.searchParams.get("lead") ? setLead(event, body) : update(event, id, body);
  if (req.method === "DELETE") return remove(event, id, url.searchParams.get("final") === "1", text(body.reason, 600));
  return fail("Method not allowed.", 405);
};

/**
 * Who manages the volunteers on this event, when that is not the event's lead. Picked from the
 * board (the event's own board, or the roster); blank puts the event's lead back.
 */
async function setLead(event, body) {
  const email = text(body.email, 200).toLowerCase();
  if (!email) {
    delete event.volunteerLead;
  } else {
    const roster = (await getRoster()) ?? [];
    const pick = [...(event.board ?? []), ...roster].find((m) => String(m.email).toLowerCase() === email);
    if (!pick) return fail("Pick someone from the board list.");
    const phone = roster.find((m) => String(m.email).toLowerCase() === email)?.phone || pick.phone || "";
    event.volunteerLead = { name: pick.name || pick.email, email: pick.email, phone };
  }
  await putEvent(event);
  return json({ ok: true, lead: event.volunteerLead ?? null, contact: volunteerContact(event) });
}

async function add(event, body, origin) {
  const have = await listVolunteers(event.id);
  const { ok, rejected } = cleanRows(body?.volunteers, have);
  if (!ok.length && !rejected.length) return fail("No volunteers supplied.");
  if (have.length + ok.length > VOLUNTEER_MAX) return fail(`That would be more than ${VOLUNTEER_MAX} volunteers on one event.`, 409);

  const added = [];
  for (const row of ok) {
    const v = newVolunteer(event, row);
    await putVolunteer(v);
    added.push(v);
  }
  if (added.length) await putEvent(event);   // carries the running reference number

  // Adding someone is the moment the coordinator means "send them the agreement".
  const notSent = [];
  if (body?.invite !== false) {
    for (const v of added) {
      const out = await inviteVolunteer(event, v, origin);
      if (!out.ok) notSent.push({ id: v.id, name: `${v.first} ${v.last}`, why: out.why });
    }
  }
  const sent = added.filter((v) => v.mail?.length).length;
  return json({
    added: added.map((v) => ({ id: v.id, name: `${v.first} ${v.last}`, email: v.email, link: `/v/${v.token}`, reference: v.reference, invited: !!v.mail?.length })),
    rejected, notSent, sent,
  }, 201);
}

/** Email the link to the named volunteers, or to everyone who hasn't signed. A second send is a reminder. */
async function sendLinks(event, body, origin) {
  const wanted = Array.isArray(body?.ids) ? new Set(body.ids) : null;
  const people = (await listVolunteers(event.id)).filter((v) => (wanted ? wanted.has(v.id) : v.status === "invited"));
  const sent = [], failed = [];
  for (const v of people) {
    if (v.status !== "invited") continue;     // signed, or with a board member for their hotel nights
    const out = await inviteVolunteer(event, v, origin, { remind: !!v.mail?.length });
    (out.ok ? sent : failed).push({ id: v.id, name: `${v.first} ${v.last}`, ...(out.ok ? {} : { why: out.why }) });
  }
  return json({ sent, failed });
}

async function update(event, id, body) {
  const v = id ? await getVolunteer(event.id, id) : null;
  if (!v) return fail("No such volunteer.", 404);
  const first = text(body.first, 80), last = text(body.last, 80), email = text(body.email, 200);
  if (!first || !last) return fail("A volunteer needs a first and last name.");
  if (!isEmail(email)) return fail(`"${email}" is not an email address.`);
  const others = (await listVolunteers(event.id)).filter((x) => x.id !== v.id);
  if (others.some((x) => String(x.email).toLowerCase() === email.toLowerCase())) return fail(`${email} is already a volunteer on this event.`, 409);

  const emailChanged = v.email !== email;
  Object.assign(v, { first, last, email, organization: text(body.organization, 200), updatedAt: new Date().toISOString() });
  // A corrected address clears the bounce, so the row stops shouting about a send that went elsewhere.
  if (emailChanged) delete v.lastSendError;
  await putVolunteer(v);
  // A signed copy carries the details as they were at signing.
  return json({ ok: true, volunteer: v, emailChanged, filed: v.status === "signed" });
}

async function remove(event, id, finalToo, reason) {
  const v = id ? await getVolunteer(event.id, id) : null;
  if (!v) return fail("No such volunteer.", 404);
  if (v.status === "signed" && !finalToo) return fail("This agreement is signed and filed. Confirm that you want to remove it anyway.", 409);
  // The event keeps a line saying who was removed and when, so nobody simply vanishes.
  event.removedPresenters = [...(event.removedPresenters ?? []), {
    role: "volunteer", name: `${v.first} ${v.last}`.trim() || v.email, email: v.email ?? "",
    status: v.status, at: new Date().toISOString(), filedTo: v.delivery?.filing?.folderUrl ?? null, reason,
  }].slice(-50);
  await putEvent(event);
  await Promise.all([deleteKey(`volunteer:${event.id}:${v.id}`), v.token ? deleteKey(`vtoken:${v.token}`) : null, deleteKey(`pdf:${pdfKey(event.id, v.id)}`)]);
  return json({ ok: true });
}

/**
 * The board member's step for a volunteer who asked for a hotel room. Nothing is final until it runs,
 * and it will not run without an answer: hotel nights inside the event's window, or an explicit
 * "no room needed". Then the PDF is built, filed, emailed back to the volunteer, and the nights
 * appear on the hotel list.
 */
async function approve(event, id, body, who) {
  const v = id ? await getVolunteer(event.id, id) : null;
  if (!v) return fail("No such volunteer.", 404);
  if (v.status !== "submitted") return fail(v.status === "signed" ? "Already final. Use redeliver to resend or refile it." : "They haven't signed yet, so there is nothing to approve.", 409);
  // The signature is the signed-in person, not a name typed in a box.
  const signer = signerOf(who, body.approverName);
  if (!signer) return fail("The approving board member's name is required — it is the signature.");
  const approverName = signer.name;

  const need = body?.hotel?.need;
  if (need !== "yes" && need !== "no") return fail("Choose their hotel nights, or say that no room is needed. It can't be made final until you do.");
  let hotel = null;
  if (need === "yes") {
    const isDate = (x) => /^\d{4}-\d{2}-\d{2}$/.test(x);
    const from = text(body.hotel.from, 10), to = text(body.hotel.to, 10), win = guestWindow(event);
    if (!isDate(from) || !isDate(to)) return fail("Pick both a check-in and a check-out date.");
    if (to <= from) return fail("Check-out has to be after check-in.");
    if (win && (from < win.from || to > win.to)) return fail(`Rooms can be booked from ${formatDate(win.from)} to ${formatDate(win.to)}, three days either side of the training.`);
    hotel = { from, to, nights: Math.round((Date.parse(to) - Date.parse(from)) / 86400000), pays: body.hotel.pays === "Guest" ? "Guest" : "ONGIA" };
  }
  v.review = { hotel, approver: { name: approverName, email: signer.email, via: signer.via }, approvedAt: new Date().toISOString() };
  v.status = "signed";
  // The decision is saved before any network call: an email hiccup must never lose a board member's answer.
  await putVolunteer(v);
  await completeAgreement(event, v);
  return json({ ok: true, volunteer: v, delivery: v.delivery });
}

async function redeliver(event, id, body) {
  const v = id ? await getVolunteer(event.id, id) : null;
  if (!v) return fail("No such volunteer.", 404);
  if (v.status !== "signed") return fail("Only a signed agreement can be redelivered.", 409);
  // `rebuild` regenerates the document from the record, so a change to the template can be picked up without a re-signing.
  let pdf = body.rebuild === true ? null : await getPdf(pdfKey(event.id, v.id)).then((b) => (b ? Buffer.from(b) : null));
  if (!pdf) pdf = await buildAndStore(event, v);

  const d = v.delivery ?? {};
  const which = body.all === true
    ? { filing: true, volunteerEmail: true, boardEmail: true }
    : { filing: !d.filing?.ok, volunteerEmail: !d.volunteerEmail?.ok, boardEmail: !d.boardEmail?.ok };
  if (body.only) which[body.only] = true;
  if (body.rebuild === true) which.filing = true;
  await deliverVolunteer(event, v, pdf, which);
  await putVolunteer(v);
  return json({ ok: true, delivery: v.delivery, retried: which });
}

async function download(event, id) {
  const v = await getVolunteer(event.id, id);
  if (!v) return fail("No such volunteer.", 404);
  if (v.status !== "signed") return fail("There is no signed copy yet.", 404);
  let pdf = await getPdf(pdfKey(event.id, v.id)).then((b) => (b ? Buffer.from(b) : null));
  if (!pdf) pdf = await buildAndStore(event, v);
  const name = `${safeFileName(v.last, "Volunteer")}_Volunteer Agreement.pdf`;
  return new Response(pdf, { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
}
