import { getStore } from "@netlify/blobs";

/**
 * Storage sits on Netlify Blobs rather than a database: this is a few hundred
 * records a year, and it means no extra account, no connection string and no
 * credential to rotate.
 *
 * Keys are flat and prefixed so a listing can be scoped:
 *   event:<id>                  the event record
 *   presenter:<eventId>:<id>    one presenter on that event
 *   token:<token>               pointer to { eventId, presenterId }
 *   sponsor:<id>                one sponsor, with the events they attend
 *   sponsortoken:<token>        pointer to { sponsorId }
 *
 * A sponsor is deliberately NOT stored under an event. One company signs one
 * agreement and one logo, once, and then appears on several events' lists, so
 * the record is top-level and each event it attends is an entry inside it.
 *
 * Requirements are held once on the sponsor and inherited by every event. An
 * event entry only carries its own set when the sponsor has said something
 * changed for that one — so `events[id].requirements ?? sponsor.requirements`
 * is what the venue gets.
 */
const store = () => getStore({ name: "ongia-agreements", consistency: "strong" });

const read = async (key) => (await store().get(key, { type: "json" })) ?? null;
const write = (key, value) => store().setJSON(key, value);

export async function putEvent(event) {
  await write(`event:${event.id}`, event);
  return event;
}

export const getEvent = async (id) => {
  const event = await read(`event:${id}`);
  if (!event) return event;
  return withLead(event, (await getRoster()) ?? []);
};

export async function listEvents() {
  const { blobs } = await store().list({ prefix: "event:" });
  const events = await Promise.all(blobs.map((b) => read(b.key)));
  const roster = (await getRoster()) ?? [];
  const today = new Date().toISOString().slice(0, 10);
  // Soonest first. An event that has finished drops below the upcoming ones,
  // most recent first, rather than sitting at the top of the list for ever.
  const over = (e) => String(e.lastDay || e.dayOne) < today;
  return events
    .filter(Boolean)
    .map((e) => withLead(e, roster))
    .sort((a, b) => {
      if (over(a) !== over(b)) return over(a) ? 1 : -1;
      const cmp = String(a.dayOne).localeCompare(String(b.dayOne));
      return over(a) ? -cmp : cmp;
    });
}

/**
 * The lead board member IS the ONGIA contact — the name, address and number on
 * the agreement, and where replies go. Records saved before that rule, or saved
 * when someone else was lead, kept a stale contact block: the Quebec City event
 * still named the previous lead and carried their phone number after the lead
 * changed. Reconcile on read, so no event needs re-saving to be right, and a
 * number belonging to somebody else is never printed as the lead's.
 */
function withLead(event, roster) {
  const lead = event?.reviewer;
  if (!lead?.email) return event;
  const was = event.contact ?? {};
  const fromRoster = (roster ?? []).find((m) => String(m.email).toLowerCase() === String(lead.email).toLowerCase())?.phone;
  const contact = {
    name: lead.name || was.name || "",
    email: lead.email,
    // The number is this person's, from the board list. A number left behind by a
    // previous lead is dropped rather than printed under the new lead's name.
    phone: lead.phone || fromRoster || "",
  };
  if (contact.name === was.name && contact.email === was.email && contact.phone === (was.phone ?? "")) return event;
  return { ...event, contact };
}

export async function putPresenter(presenter) {
  await write(`presenter:${presenter.eventId}:${presenter.id}`, presenter);
  if (presenter.token) {
    await write(`token:${presenter.token}`, {
      eventId: presenter.eventId,
      presenterId: presenter.id,
    });
  }
  return presenter;
}

export const getPresenter = (eventId, id) => read(`presenter:${eventId}:${id}`);

/* ---------------------------------------------------------------- sponsors */

export async function putSponsor(sponsor) {
  await write(`sponsor:${sponsor.id}`, sponsor);
  if (sponsor.token) await write(`sponsortoken:${sponsor.token}`, { sponsorId: sponsor.id });
  return sponsor;
}

export const getSponsor = (id) => read(`sponsor:${id}`);

export async function listSponsors() {
  const { blobs } = await store().list({ prefix: "sponsor:" });
  const rows = await Promise.all(blobs.map((b) => read(b.key)));
  return rows.filter(Boolean).sort((a, b) => (a.company ?? "").localeCompare(b.company ?? ""));
}

/** The sponsors coming to one event, in company order. */
export async function listEventSponsors(eventId) {
  const all = await listSponsors();
  return all.filter((s) => s.events?.[eventId]);
}

/** Resolve a sponsor's link token to the sponsor. */
export async function resolveSponsorToken(tok) {
  if (!tok) return null;
  const pointer = await read(`sponsortoken:${tok}`);
  if (!pointer) return null;
  const sponsor = await getSponsor(pointer.sponsorId);
  return sponsor ? { sponsor } : null;
}

/** Whoever the board has put in charge of sponsorship, for all of ONGIA. */
export async function sponsorLead() {
  const roster = (await getRoster()) ?? [];
  const lead = roster.find((m) => m.sponsorLead);
  return lead ? { name: lead.name, email: lead.email, phone: lead.phone ?? "" } : null;
}

export async function listPresenters(eventId) {
  const { blobs } = await store().list({ prefix: `presenter:${eventId}:` });
  const people = await Promise.all(blobs.map((b) => read(b.key)));
  return people.filter(Boolean).sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
}

/** Resolve a presenter link token to the presenter and their event. */
export async function resolveToken(tok) {
  if (!tok) return null;
  const pointer = await read(`token:${tok}`);
  if (!pointer) return null;
  const [event, presenter] = await Promise.all([
    getEvent(pointer.eventId),
    getPresenter(pointer.eventId, pointer.presenterId),
  ]);
  if (!event || !presenter) return null;
  return { event, presenter };
}

/** Store a generated PDF so it can be re-downloaded without regenerating. */
export async function putPdf(key, bytes) {
  await store().set(`pdf:${key}`, bytes, { metadata: { contentType: "application/pdf" } });
}

export const getPdf = (key) => store().get(`pdf:${key}`, { type: "arrayBuffer" });

/** Presenter headshots — raw bytes plus what they were. */
export async function putHeadshot(eventId, presenterId, bytes, meta) {
  await store().set(`headshot:${eventId}:${presenterId}`, bytes, { metadata: meta });
}

export async function getHeadshot(eventId, presenterId) {
  const got = await store().getWithMetadata(`headshot:${eventId}:${presenterId}`, { type: "arrayBuffer" });
  if (!got) return null;
  return { bytes: got.data, type: got.metadata?.type ?? "image/jpeg", name: got.metadata?.name ?? "headshot.jpg" };
}

/** Remove a key outright — used when an event or presenter is deleted. */
export const deleteKey = (key) => store().delete(key);

/** Small desk-wide facts, e.g. when the weekly summary last went out. */
export const getMeta = (key) => read(`meta:${key}`);
export const putMeta = (key, value) => write(`meta:${key}`, value);

/** Board roster — one list for the whole desk. */
export const getRoster = () => read("roster:board");
export const putRoster = (members) => write("roster:board", members);
