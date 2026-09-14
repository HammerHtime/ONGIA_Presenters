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
  if (!event || event.contact?.phone) return event;
  return withLeadPhone(event, (await getRoster()) ?? []);
};

export async function listEvents() {
  const { blobs } = await store().list({ prefix: "event:" });
  const events = await Promise.all(blobs.map((b) => read(b.key)));
  const roster = (await getRoster()) ?? [];
  return events
    .filter(Boolean)
    .map((e) => withLeadPhone(e, roster))
    .sort((a, b) => String(b.dayOne).localeCompare(String(a.dayOne)));
}

/**
 * Events saved before board members carried phone numbers have none on their
 * contact block, which left the agreement's ONGIA contact number blank. Fill it
 * from the board list on read, so an old event needs no re-saving.
 */
function withLeadPhone(event, roster) {
  if (!event || event.contact?.phone) return event;
  const email = event.contact?.email || event.reviewer?.email;
  if (!email) return event;
  const phone = (roster ?? []).find((m) => String(m.email).toLowerCase() === email.toLowerCase())?.phone;
  if (!phone) return event;
  return { ...event, contact: { ...(event.contact ?? {}), phone } };
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
