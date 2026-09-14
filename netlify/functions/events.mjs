import { json, fail, requireAdmin, text, isEmail } from "./lib/http.mjs";
import { formatPhone } from "./lib/phone.mjs";
import { putEvent, getEvent, listEvents, putPresenter, listPresenters, getPresenter, deleteKey, getRoster } from "./lib/store.mjs";
import { eventId, token, reference, safeFileName } from "./lib/ids.mjs";
import { deadlinesFor, formatDate } from "./lib/deadlines.mjs";
import { ensureEventFolder, resolveFolderInput, inspectSharingLink, createUploadLink, graphConfigured } from "./lib/graph.mjs";
import { sendMail, invitationMail, coordinatorOf } from "./lib/mail.mjs";
import { describeEvent } from "./lib/deadlines.mjs";
import { siteUrl } from "./lib/site.mjs";
import { materialsStatus } from "./lib/materials.mjs";

/**
 * Events and their presenters.
 *
 *   GET    /api/events                      list events with progress counts
 *   GET    /api/events?id=…                 one event plus its presenters
 *   POST   /api/events                      create an event
 *   PUT    /api/events?id=…                 update an event's details (deadlines re-derive)
 *   DELETE /api/events?id=…                 delete an event and everything under it
 *   POST   /api/events?id=…&add=1           add presenters to an event
 *   DELETE /api/events?id=…&presenter=…     remove one presenter (not once approved)
 *   POST   /api/events?id=…&folder=1        create the event's SharePoint folder by convention
 *   POST   /api/events?id=…&uploadlink=1    create the folder if needed and mint an upload-only link on it
 */
export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);

  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (req.method === "GET") return id ? showEvent(id) : showList();
  if (req.method === "POST") {
    if (url.searchParams.get("folder")) return createFolder(id);
    if (url.searchParams.get("uploadlink")) return createUpload(id);
    const body = await req.json().catch(() => null);
    if (!body) return fail("Expected a JSON body.");
    const origin = siteUrl(req);
    return url.searchParams.get("add") ? addPresenters(id, body, origin) : createEvent(body, origin);
  }
  if (req.method === "PUT") {
    const body = await req.json().catch(() => null);
    if (!body) return fail("Expected a JSON body.");
    return updateEvent(id, body);
  }
  if (req.method === "DELETE") {
    const presenterId = url.searchParams.get("presenter");
    return presenterId ? removePresenter(id, presenterId) : deleteEvent(id);
  }
  return fail("Method not allowed.", 405);
};

/** ONGIA's filing convention: the training library, then year, then "year City". */
export function conventionalFolder(dayOne, city) {
  const year = String(dayOne ?? "").slice(0, 4);
  const town = safeFileName(String(city ?? "").split(",")[0].trim(), "Event");
  return year && town ? `ONGIA Board/ONGIA Training/${year}/${year} ${town}` : "";
}

/** The fields a coordinator may change after creation; ids and counters stay. */
async function applyDetails(event, body, { creating = false } = {}) {
  const title = text(body.title, 200);
  const city = text(body.city, 120);
  const dayOne = text(body.dayOne, 10);
  if (!title) return "The event needs a title.";
  if (!city) return "The event needs a city.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayOne)) return "Day one must be a date, as YYYY-MM-DD.";
  const lastDay = /^\d{4}-\d{2}-\d{2}$/.test(text(body.lastDay, 10)) ? text(body.lastDay, 10) : dayOne;
  if (lastDay < dayOne) return "The event cannot end before it starts.";
  const before = { folder: event.sharePointFolder ?? "", link: event.materialsUploadUrl ?? "", appMade: !!event.materialsLinkCheck?.createdByApp };

  Object.assign(event, {
    title,
    city,
    venue: text(body.venue, 200),
    dayOne,
    lastDay,
    sessionMinutes: Number(body.sessionMinutes) || event.sessionMinutes || 70,
    // Derived, never typed. Change a training date and all three move with it.
    deadlines: deadlinesFor(dayOne),
    contact: { name: "", email: "", phone: "" },
    materialsUploadUrl: text(body.materialsUploadUrl, 800),
    updatedAt: new Date().toISOString(),
  });

  // Board members on this event: any number, exactly one lead. The lead
  // reviews and signs; everyone picked is notified. Older clients that still
  // send reviewerName/notify are folded into the same shape.
  const board = (Array.isArray(body.board) ? body.board : [])
    .map((m) => ({ name: text(m.name, 120), email: text(m.email, 200), phone: formatPhone(text(m.phone, 60)), lead: m.lead === true }))
    .filter((m) => m.name && isEmail(m.email))
    .slice(0, 20);
  if (!board.length && text(body.reviewerName, 120)) {
    board.push({ name: text(body.reviewerName, 120), email: text(body.reviewerEmail, 200), lead: true });
    for (const e of Array.isArray(body.notify) ? body.notify : []) if (isEmail(text(e, 200))) board.push({ name: "", email: text(e, 200), lead: false });
  }
  if (board.length && !board.some((m) => m.lead)) board[0].lead = true;
  if (board.filter((m) => m.lead).length > 1) return "Only one board member can be the lead.";
  const lead = board.find((m) => m.lead);
  // Every event needs someone presenters can reach; the PDF and every email depend on it.
  if (!lead) return "Pick the board members for this event and mark one as the lead. Presenters reply to the lead, and their name goes on the agreement.";
  // A phone typed on the roster fills in by itself; one typed on the form wins.
  if (!lead.phone) {
    const roster = (await getRoster()) ?? [];
    lead.phone = roster.find((m) => m.email.toLowerCase() === lead.email.toLowerCase())?.phone ?? "";
  }
  event.board = board;
  event.reviewer = { name: lead.name, email: lead.email, phone: lead.phone };
  // The lead IS the ONGIA contact: the name, address and number on the agreement,
  // and where replies go. The number comes from that person's entry on the board
  // list and nowhere else, so it cannot be typed against the wrong person — which
  // is how one event ended up printing a previous lead's number under a new lead.
  event.contact = { name: lead.name, email: lead.email, phone: lead.phone };
  event.notify = board.filter((m) => !m.lead).map((m) => m.email);

  // The materials link is the one thing presenters receive that points at
  // SharePoint. Refuse anything that would let them browse the folder; note
  // when the app couldn't tell so the event page can warn.
  if (event.materialsUploadUrl) {
    const check = await inspectSharingLink(event.materialsUploadUrl);
    if (check.verdict === "exposes-folder") {
      return `That materials link would let presenters open the folder (it is a "${check.type}" link${check.scope ? `, ${check.scope}` : ""}). In SharePoint, right-click the folder → Request files, and paste that link instead.`;
    }
    event.materialsLinkCheck = {
      verdict: check.verdict, type: check.type ?? null, reason: check.reason ?? null, at: new Date().toISOString(),
      createdByApp: before.appMade && event.materialsUploadUrl === before.link,
    };
  } else {
    event.materialsLinkCheck = null;
  }

  // Where Request-files uploads land, if not the event folder itself.
  try {
    const mf = await resolveFolderInput(text(body.materialsFolder, 800));
    event.materialsFolderPath = mf.path || "";
  } catch (e) {
    return `Materials folder: ${e.message}`;
  }

  // The folder may arrive as a path, a folder URL, or a sharing link.
  try {
    const folder = await resolveFolderInput(text(body.sharePointFolder, 800));
    event.sharePointFolder = folder.path || conventionalFolder(dayOne, city);
    if (folder.url) event.sharePointFolderUrl = folder.url;
    else if (!folder.path) event.sharePointFolderUrl = "";
  } catch (e) {
    return e.message;
  }

  // An upload link the app made belongs to the folder it was made on. If the folder
  // moved, drop it so a fresh one is made for the new folder.
  if (event.materialsLinkCheck?.createdByApp && event.sharePointFolder !== before.folder) {
    event.materialsUploadUrl = "";
    event.materialsLinkCheck = null;
  }
  if (creating) event.createdAt = event.updatedAt;
  return null;
}

async function updateEvent(id, body) {
  if (!id) return fail("Which event? Pass ?id=…");
  const event = await getEvent(id);
  if (!event) return fail("No such event.", 404);
  const problem = await applyDetails(event, body);
  if (problem) return fail(problem);
  await putEvent(event);
  // Same as on create: no link means the app makes the folder and an upload-only link.
  if (!event.materialsUploadUrl && graphConfigured()) {
    try {
      await provisionUpload(event);
    } catch (e) {
      event.provisioningError = e.message;
    }
    await putEvent(event);
  }
  return json({ event, deadlinesReadable: readableDeadlines(event) });
}

async function deleteEvent(id) {
  if (!id) return fail("Which event? Pass ?id=…");
  const event = await getEvent(id);
  if (!event) return fail("No such event.", 404);
  const people = await listPresenters(id);
  for (const p of people) {
    await Promise.all([
      deleteKey(`presenter:${id}:${p.id}`),
      p.token ? deleteKey(`token:${p.token}`) : null,
      deleteKey(`pdf:${id}:${p.id}`),
      deleteKey(`headshot:${id}:${p.id}`),
    ]);
  }
  await deleteKey(`event:${id}`);
  // Filed PDFs in SharePoint are deliberately left alone — they are the record.
  return json({ ok: true, removedPresenters: people.length });
}

async function removePresenter(id, presenterId) {
  const presenter = await getPresenter(id, presenterId);
  if (!presenter) return fail("No such presenter.", 404);
  if (presenter.status === "approved") return fail("This agreement is final and filed; it can't be removed from the desk.", 409);
  await Promise.all([
    deleteKey(`presenter:${id}:${presenterId}`),
    presenter.token ? deleteKey(`token:${presenter.token}`) : null,
    deleteKey(`headshot:${id}:${presenterId}`),
  ]);
  return json({ ok: true });
}

/** Folder by convention (if missing) plus a Request-files link on it. */
async function provisionUpload(event) {
  const path = event.sharePointFolder || conventionalFolder(event.dayOne, event.city);
  const folder = await ensureEventFolder(path);
  event.sharePointFolder = folder.path;
  event.sharePointFolderUrl = folder.url;
  const link = await createUploadLink(folder.path);
  event.materialsUploadUrl = link.url;
  event.materialsLinkCheck = { verdict: "upload-only", type: "createOnly", reason: null, at: new Date().toISOString(), createdByApp: true };
  event.provisioningError = null;
  return link;
}

async function createUpload(id) {
  if (!id) return fail("Which event? Pass ?id=…");
  const event = await getEvent(id);
  if (!event) return fail("No such event.", 404);
  if (event.materialsUploadUrl && event.materialsLinkCheck?.verdict === "upload-only") {
    return fail("This event already has a verified upload-only link. Remove it on the edit form first if you want a new one.", 409);
  }
  try {
    const link = await provisionUpload(event);
    await putEvent(event);
    return json({ ok: true, link: link.url, event });
  } catch (e) {
    return fail(e.message, 502);
  }
}

async function createFolder(id) {
  if (!id) return fail("Which event? Pass ?id=…");
  const event = await getEvent(id);
  if (!event) return fail("No such event.", 404);
  const path = event.sharePointFolder || conventionalFolder(event.dayOne, event.city);
  try {
    const out = await ensureEventFolder(path);
    event.sharePointFolder = out.path;
    event.sharePointFolderUrl = out.url;
    await putEvent(event);
    return json({ ok: true, folder: out, event });
  } catch (e) {
    return fail(e.message, 502);
  }
}

async function showList() {
  const events = await listEvents();
  const withCounts = await Promise.all(
    events.map(async (event) => {
      const people = await listPresenters(event.id);
      const mats = people.map((p) => materialsStatus(p, event.materialsScan ?? null));
      const who = (f) => people.filter(f).map((p) => ({ id: p.id, name: `${p.first} ${p.last}` }));
      return {
        ...event,
        counts: countStatuses(people),
        presenterCount: people.length,
        materials: { draft: mats.filter((m) => m.draft).length, final: mats.filter((m) => m.final).length },
        // Enough to name a problem on the dashboard without opening the event.
        attention: {
          review: who((p) => p.status === "submitted"),
          uninvited: who((p) => p.status !== "approved" && p.status !== "submitted" && !p.mail?.length),
          failed: who((p) => p.status === "approved" && p.delivery?.filing && p.delivery.filing.ok === false),
          sendFailed: who((p) => !!p.lastSendError),
          outstanding: who((p) => p.status !== "approved" && p.status !== "submitted"),
        },
      };
    })
  );
  return json({ events: withCounts });
}

async function showEvent(id) {
  const event = await getEvent(id);
  if (!event) return fail("No such event.", 404);
  const presenters = await listPresenters(id);
  return json({ event, presenters, counts: countStatuses(presenters) });
}

export function countStatuses(presenters) {
  const counts = { total: presenters.length, invited: 0, opened: 0, submitted: 0, approved: 0, uninvited: 0, failed: 0 };
  for (const p of presenters) {
    if (p.status === "approved") counts.approved++;
    else if (p.status === "submitted") counts.submitted++;
    else if (p.openedAt) counts.opened++;
    else counts.invited++;
    // Nobody has ever sent this person their link, so no reminder will ever chase
    // them: only a person can fix it.
    if (p.status !== "approved" && p.status !== "submitted" && !p.mail?.length) counts.uninvited++;
    // Signed and approved, but the copy never reached SharePoint.
    if (p.status === "approved" && p.delivery && p.delivery.filing && p.delivery.filing.ok === false) counts.failed++;
  }
  return counts;
}

async function createEvent(body, origin) {
  const event = { id: null, nextSequence: 1 };
  const problem = await applyDetails(event, body, { creating: true });
  if (problem) return fail(problem);
  event.id = eventId(event.dayOne.slice(0, 4), event.city);
  await putEvent(event);

  // With Microsoft connected, a new event gets its folder and upload link
  // made for it — the coordinator pastes nothing.
  if (!event.materialsUploadUrl && graphConfigured()) {
    try {
      await provisionUpload(event);
      await putEvent(event);
    } catch (e) {
      event.provisioningError = e.message;
      await putEvent(event);
    }
  }

  // Presenters pasted into the same form become invitations straight away.
  const people = Array.isArray(body.presenters) && body.presenters.length
    ? await addPeople(event, body.presenters, { invite: body.invite !== false, origin })
    : { added: [], rejected: [] };
  return json({ event, deadlinesReadable: readableDeadlines(event), ...people }, 201);
}

async function addPresenters(id, body, origin) {
  if (!id) return fail("Which event? Pass ?id=…");
  const event = await getEvent(id);
  if (!event) return fail("No such event.", 404);

  const rows = Array.isArray(body.presenters) ? body.presenters : [];
  if (!rows.length) return fail("No presenters supplied.");
  return json(await addPeople(event, rows, { invite: body.invite !== false, origin }), 201);
}

/**
 * Create presenters and, unless told not to, email each their link straight
 * away — adding someone to an event is the moment the coordinator means
 * "send them the agreement", not a staging step.
 */
async function addPeople(event, rows, { invite = true, origin = "" } = {}) {
  const added = [];
  const rejected = [];
  let seq = event.nextSequence ?? 1;

  for (const row of rows.slice(0, 100)) {
    const first = text(row.first, 80);
    const last = text(row.last, 80);
    const email = text(row.email, 200);
    if (!first || !last) {
      rejected.push({ row, why: "Needs a first and last name." });
      continue;
    }
    if (!isEmail(email)) {
      rejected.push({ row, why: `"${email}" is not an email address.` });
      continue;
    }
    const presenter = {
      id: token(10),
      eventId: event.id,
      first,
      last,
      email,
      organization: text(row.organization, 200),
      token: token(24),
      reference: reference(event.id, seq++),
      status: "invited",
      createdAt: new Date().toISOString(),
      openedAt: null,
      submittedAt: null,
      approvedAt: null,
      submission: null,
      review: null,
    };
    await putPresenter(presenter);
    added.push(presenter);
  }

  event.nextSequence = seq;
  await putEvent(event);

  const invited = [];
  const notSent = [];
  if (invite && origin) {
    const ev = describeEvent(event);
    for (const p of added) {
      const mail = invitationMail({ event: ev, presenter: p, link: `${origin}/a/${p.token}`, remind: false });
      try {
        const out = await sendMail({ to: p.email, replyTo: coordinatorOf(event).email || undefined, ...mail });
        if (out.skipped) { notSent.push({ id: p.id, name: `${p.first} ${p.last}`, why: out.reason }); continue; }
        p.mail = [{ type: "invitation", at: new Date().toISOString(), id: out.id }];
        p.invitedAt = p.mail[0].at;
        await putPresenter(p);
        invited.push(p.id);
      } catch (e) {
        notSent.push({ id: p.id, name: `${p.first} ${p.last}`, why: e.message });
      }
    }
  }

  return {
    added: added.map((p) => ({
      id: p.id,
      name: `${p.first} ${p.last}`,
      email: p.email,
      link: `/a/${p.token}`,
      reference: p.reference,
      invited: invited.includes(p.id),
    })),
    rejected,
    notSent,
  };
}

function readableDeadlines(event) {
  return {
    agreement: formatDate(event.deadlines.agreement),
    draft: formatDate(event.deadlines.draft),
    final: formatDate(event.deadlines.final),
  };
}
