import { json, fail, requireAdmin, text, isEmail } from "./lib/http.mjs";
import { putEvent, getEvent, listEvents, putPresenter, listPresenters, getPresenter, deleteKey } from "./lib/store.mjs";
import { eventId, token, reference, safeFileName } from "./lib/ids.mjs";
import { deadlinesFor, formatDate } from "./lib/deadlines.mjs";
import { ensureEventFolder, normaliseFolder } from "./lib/graph.mjs";

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
 */
export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);

  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (req.method === "GET") return id ? showEvent(id) : showList();
  if (req.method === "POST") {
    if (url.searchParams.get("folder")) return createFolder(id);
    const body = await req.json().catch(() => null);
    if (!body) return fail("Expected a JSON body.");
    return url.searchParams.get("add") ? addPresenters(id, body) : createEvent(body);
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
function applyDetails(event, body, { creating = false } = {}) {
  const title = text(body.title, 200);
  const city = text(body.city, 120);
  const dayOne = text(body.dayOne, 10);
  if (!title) return "The event needs a title.";
  if (!city) return "The event needs a city.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayOne)) return "Day one must be a date, as YYYY-MM-DD.";
  const lastDay = /^\d{4}-\d{2}-\d{2}$/.test(text(body.lastDay, 10)) ? text(body.lastDay, 10) : dayOne;
  if (lastDay < dayOne) return "The event cannot end before it starts.";

  Object.assign(event, {
    title,
    city,
    venue: text(body.venue, 200),
    dayOne,
    lastDay,
    sessionMinutes: Number(body.sessionMinutes) || event.sessionMinutes || 70,
    // Derived, never typed. Change a training date and all three move with it.
    deadlines: deadlinesFor(dayOne),
    contact: {
      name: text(body.contactName, 120),
      email: text(body.contactEmail, 200),
      phone: text(body.contactPhone, 60),
    },
    reviewer: {
      name: text(body.reviewerName, 120),
      email: isEmail(text(body.reviewerEmail, 200)) ? text(body.reviewerEmail, 200) : "",
    },
    notify: (Array.isArray(body.notify) ? body.notify : []).map((e) => text(e, 200)).filter(isEmail).slice(0, 20),
    sharePointFolder: normaliseFolder(text(body.sharePointFolder, 500)) || conventionalFolder(dayOne, city),
    materialsUploadUrl: text(body.materialsUploadUrl, 800),
    updatedAt: new Date().toISOString(),
  });
  if (creating) event.createdAt = event.updatedAt;
  return null;
}

async function updateEvent(id, body) {
  if (!id) return fail("Which event? Pass ?id=…");
  const event = await getEvent(id);
  if (!event) return fail("No such event.", 404);
  const problem = applyDetails(event, body);
  if (problem) return fail(problem);
  await putEvent(event);
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
      return { ...event, counts: countStatuses(people), presenterCount: people.length };
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
  const counts = { total: presenters.length, invited: 0, opened: 0, submitted: 0, approved: 0 };
  for (const p of presenters) {
    if (p.status === "approved") counts.approved++;
    else if (p.status === "submitted") counts.submitted++;
    else if (p.openedAt) counts.opened++;
    else counts.invited++;
  }
  return counts;
}

async function createEvent(body) {
  const event = { id: null, nextSequence: 1 };
  const problem = applyDetails(event, body, { creating: true });
  if (problem) return fail(problem);
  event.id = eventId(event.dayOne.slice(0, 4), event.city);

  await putEvent(event);
  return json({ event, deadlinesReadable: readableDeadlines(event) }, 201);
}

async function addPresenters(id, body) {
  if (!id) return fail("Which event? Pass ?id=…");
  const event = await getEvent(id);
  if (!event) return fail("No such event.", 404);

  const rows = Array.isArray(body.presenters) ? body.presenters : [];
  if (!rows.length) return fail("No presenters supplied.");

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

  return json({
    added: added.map((p) => ({
      id: p.id,
      name: `${p.first} ${p.last}`,
      email: p.email,
      link: `/a/${p.token}`,
      reference: p.reference,
    })),
    rejected,
  }, 201);
}

function readableDeadlines(event) {
  return {
    agreement: formatDate(event.deadlines.agreement),
    draft: formatDate(event.deadlines.draft),
    final: formatDate(event.deadlines.final),
  };
}
