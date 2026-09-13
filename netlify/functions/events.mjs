import { json, fail, requireAdmin, text, isEmail } from "./lib/http.mjs";
import { putEvent, getEvent, listEvents, putPresenter, listPresenters } from "./lib/store.mjs";
import { eventId, token, reference } from "./lib/ids.mjs";
import { deadlinesFor, formatDate } from "./lib/deadlines.mjs";

/**
 * Events and their presenters.
 *
 *   GET  /api/events              list events with progress counts
 *   GET  /api/events?id=…         one event plus its presenters
 *   POST /api/events              create an event
 *   POST /api/events?id=…&add=1   add presenters to an event
 */
export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);

  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (req.method === "GET") return id ? showEvent(id) : showList();
  if (req.method === "POST") {
    const body = await req.json().catch(() => null);
    if (!body) return fail("Expected a JSON body.");
    return url.searchParams.get("add") ? addPresenters(id, body) : createEvent(body);
  }
  return fail("Method not allowed.", 405);
};

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
  const title = text(body.title, 200);
  const city = text(body.city, 120);
  const dayOne = text(body.dayOne, 10);
  if (!title) return fail("The event needs a title.");
  if (!city) return fail("The event needs a city.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayOne)) return fail("Day one must be a date, as YYYY-MM-DD.");

  const lastDay = /^\d{4}-\d{2}-\d{2}$/.test(text(body.lastDay, 10)) ? text(body.lastDay, 10) : dayOne;
  if (lastDay < dayOne) return fail("The event cannot end before it starts.");

  const year = dayOne.slice(0, 4);
  const event = {
    id: eventId(year, city),
    title,
    city,
    venue: text(body.venue, 200),
    dayOne,
    lastDay,
    sessionMinutes: Number(body.sessionMinutes) || 70,
    // Derived, never typed. Change a training date and all three move with it.
    deadlines: deadlinesFor(dayOne),
    contact: {
      name: text(body.contactName, 120),
      email: text(body.contactEmail, 200),
      phone: text(body.contactPhone, 60),
    },
    notify: (Array.isArray(body.notify) ? body.notify : [])
      .map((e) => text(e, 200))
      .filter(isEmail)
      .slice(0, 20),
    sharePointFolder: text(body.sharePointFolder, 500),
    materialsUploadUrl: text(body.materialsUploadUrl, 800),
    createdAt: new Date().toISOString(),
    nextSequence: 1,
  };

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
