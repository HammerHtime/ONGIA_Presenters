import { getStore } from "@netlify/blobs";
import { todayIso } from "./deadlines.mjs";

/**
 * Storage sits on Netlify Blobs rather than a database: this is a few hundred
 * records a year, and it means no extra account, no connection string and no
 * credential to rotate.
 *
 * Keys are flat and prefixed so a listing can be scoped:
 *   event:<id>                  the event record
 *   presenter:<eventId>:<id>    one presenter on that event
 *   token:<token>               pointer to { eventId, presenterId }
 *   volunteer:<eventId>:<id>    one volunteer on that event (their own agreement, no review)
 *   vtoken:<token>              pointer to { eventId, volunteerId }
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

const SNAP = "__asRead";
/** Remember how a record looked when it was read (out of sight: not saved, not copied by a spread). */
const remember = (obj, json = JSON.stringify(obj)) => {
  if (obj && typeof obj === "object") Object.defineProperty(obj, SNAP, { value: json, enumerable: false, configurable: true, writable: true });
  return obj;
};
const read = async (key) => remember((await store().get(key, { type: "json" })) ?? null);
const write = (key, value) => store().setJSON(key, value);

/**
 * Saving a record that someone else (a person, or the morning run) changed after it was read: rather than writing the
 * whole stale copy over theirs, only the fields this writer changed are laid onto the latest version (audit F04,
 * 20 Oct 2026). So the morning reminder run noting an email cannot undo an approval made while it was sending, and
 * two people editing different parts of an event both keep their changes. A record read without the snapshot (a copy
 * made with a spread, or a new record) is simply written, as before.
 */
export async function writeMerged(key, value) {
  const asRead = value?.[SNAP];
  if (!asRead) { await write(key, value); return remember(value); }
  const current = await store().get(key, { type: "json" });
  if (!current || JSON.stringify(current) === asRead) { await write(key, value); return remember(value); }
  const before = JSON.parse(asRead);
  const merged = { ...current };
  for (const k of new Set([...Object.keys(before), ...Object.keys(value)])) {
    if (JSON.stringify(before[k]) === JSON.stringify(value[k])) continue;      // not changed by this writer: keep theirs
    if (value[k] === undefined) delete merged[k]; else merged[k] = value[k];
  }
  await write(key, merged);
  for (const k of Object.keys(value)) if (!(k in merged)) delete value[k];
  Object.assign(value, merged);           // the caller carries on with the record as it now stands
  return remember(value);
}

export async function putEvent(event) {
  await writeMerged(`event:${event.id}`, event);
  return event;
}

export const getEvent = async (id) => {
  const event = await read(`event:${id}`);
  if (!event) return event;
  // The lead's contact is reconciled into a copy; it keeps the snapshot of the record as read.
  return remember(withLead(event, (await getRoster()) ?? []), event[SNAP]);
};

export async function listEvents() {
  const { blobs } = await store().list({ prefix: "event:" });
  const events = await Promise.all(blobs.map((b) => read(b.key)));
  const roster = (await getRoster()) ?? [];
  const today = todayIso();
  // Soonest first. An event that has finished drops below the upcoming ones,
  // most recent first, rather than sitting at the top of the list for ever.
  const over = (e) => String(e.lastDay || e.dayOne) < today;
  return events
    .filter(Boolean)
    .map((e) => remember(withLead(e, roster), e[SNAP]))
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
  await writeMerged(`presenter:${presenter.eventId}:${presenter.id}`, presenter);
  if (presenter.token) {
    await write(`token:${presenter.token}`, {
      eventId: presenter.eventId,
      presenterId: presenter.id,
    });
  }
  return presenter;
}

export const getPresenter = (eventId, id) => read(`presenter:${eventId}:${id}`);

/* -------------------------------------------------------------- volunteers */
// A volunteer signs the ONGIA Volunteer Terms and that is the end of it: no cost
// review, no materials, so they are kept apart from presenters and none of the
// presenter counts, reminders or rooming rows can pick one up by accident.

export async function putVolunteer(volunteer) {
  await writeMerged(`volunteer:${volunteer.eventId}:${volunteer.id}`, volunteer);
  if (volunteer.token) await write(`vtoken:${volunteer.token}`, { eventId: volunteer.eventId, volunteerId: volunteer.id });
  return volunteer;
}

export const getVolunteer = (eventId, id) => read(`volunteer:${eventId}:${id}`);

export async function listVolunteers(eventId) {
  const { blobs } = await store().list({ prefix: `volunteer:${eventId}:` });
  const people = await Promise.all(blobs.map((b) => read(b.key)));
  return people.filter(Boolean).sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
}

/** Resolve a volunteer's link token to the volunteer and their event. */
export async function resolveVolunteerToken(tok) {
  if (!tok) return null;
  const pointer = await read(`vtoken:${tok}`);
  if (!pointer) return null;
  const [event, volunteer] = await Promise.all([getEvent(pointer.eventId), getVolunteer(pointer.eventId, pointer.volunteerId)]);
  return event && volunteer ? { event, volunteer } : null;
}

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

export async function putLogo(sponsorId, bytes, meta) {
  await store().set(`logo:${sponsorId}`, bytes, { metadata: meta });
}

export async function getLogo(sponsorId) {
  const got = await store().getWithMetadata(`logo:${sponsorId}`, { type: "arrayBuffer" });
  if (!got) return null;
  return { bytes: got.data, type: got.metadata?.type ?? "image/png", name: got.metadata?.name ?? "logo.png" };
}

/**
 * The hotel contract for an event, as uploaded, and what Claude made of it.
 * The file is kept so it can be opened again and re-read; the reading is its
 * own small record so the screen can ask "done yet?" without the PDF.
 */
export async function putContract(eventId, bytes, meta) {
  await store().set(`contract:${eventId}`, bytes, { metadata: meta });
}

export async function getContract(eventId) {
  const got = await store().getWithMetadata(`contract:${eventId}`, { type: "arrayBuffer" });
  if (!got) return null;
  return { bytes: got.data, name: got.metadata?.name ?? "hotel-contract.pdf", size: got.metadata?.size ?? got.data.byteLength, uploadedAt: got.metadata?.uploadedAt ?? null };
}

export async function contractInfo(eventId) {
  const got = await store().getMetadata(`contract:${eventId}`);
  return got ? { name: got.metadata?.name ?? "hotel-contract.pdf", size: got.metadata?.size ?? null, uploadedAt: got.metadata?.uploadedAt ?? null } : null;
}

export const getContractRead = (eventId) => read(`contractread:${eventId}`);
export const putContractRead = (eventId, value) => write(`contractread:${eventId}`, value);

/**
 * An event's agenda, as uploaded: kept so it can be attached to the welcome
 * letter and read again. Claude's reading of it is its own small record, the
 * same as a contract's.
 */
// `which` = "group": the second agenda, for the people from the event's second Wix event (the Summit's community
// partners come for two of its four days, with their own agenda: Andrew 27 Oct 2026).
const agendaKey = (eventId, which = "") => `agenda:${eventId}${which === "group" ? ":group" : ""}`;
export async function putAgenda(eventId, bytes, meta, which = "") {
  await store().set(agendaKey(eventId, which), bytes, { metadata: meta });
}

export async function getAgenda(eventId, which = "") {
  const got = await store().getWithMetadata(agendaKey(eventId, which), { type: "arrayBuffer" });
  if (!got) return null;
  return { bytes: got.data, name: got.metadata?.name ?? "agenda.pdf", size: got.metadata?.size ?? got.data.byteLength, uploadedAt: got.metadata?.uploadedAt ?? null };
}

/**
 * PDFs Andrew attaches to an event's welcome letter (Andrew 27 Oct 2026: "upload attachments to the welcome email …
 * check boxes, attached to community partner and attached to justice partners"). The bytes are kept here; the list,
 * with which version each goes with, is on the event (event.welcomeFiles).
 */
export const putWelcomeFile = (eventId, id, bytes, meta) => store().set(`wfile:${eventId}:${id}`, bytes, { metadata: meta });
export async function getWelcomeFile(eventId, id) {
  const got = await store().getWithMetadata(`wfile:${eventId}:${id}`, { type: "arrayBuffer" });
  return got ? { bytes: got.data, name: got.metadata?.name ?? "attachment.pdf" } : null;
}
export const deleteWelcomeFile = (eventId, id) => store().delete(`wfile:${eventId}:${id}`);
export const getAgendaRead = (eventId) => read(`agendaread:${eventId}`);
// What the night's email read filed against an event (or `_unfiled`): short notes and links only.
export const getInbox = (eventId) => read(`inbox:${eventId}`);
export const putInbox = (eventId, value) => write(`inbox:${eventId}`, value);
/** The logistics sheet as it was uploaded (see sheetcheck.mjs): the frozen baseline presenters are compared with. */
/** An RBH event's statement of work and invoice (see sow.mjs). Its own record, so nothing else can read the money. */
export const getSow = (eventId) => read(`sow:${eventId}`);
export const putSow = (eventId, value) => write(`sow:${eventId}`, value);
export const getSheetBaseline = (eventId) => read(`sheet:${eventId}`);
export const putSheetBaseline = (eventId, value) => write(`sheet:${eventId}`, value);
/**
 * Receipts for an RBH event (see receipts.mjs). The list is one small record; each photo or PDF is its own
 * blob, and what Claude read off a not-yet-confirmed one is its own record too, so the background reader never
 * writes over a list a person is editing.
 */
export const getReceipts = async (eventId) => (await read(`receipts:${eventId}`)) ?? { items: [], drafts: [] };
export const putReceipts = (eventId, value) => write(`receipts:${eventId}`, value);
export async function putReceiptFile(eventId, id, bytes, meta) {
  await store().set(`receiptfile:${eventId}:${id}`, bytes, { metadata: meta });
}
export async function getReceiptFile(eventId, id) {
  const got = await store().getWithMetadata(`receiptfile:${eventId}:${id}`, { type: "arrayBuffer" });
  if (!got) return null;
  return { bytes: got.data, type: got.metadata?.type ?? "application/octet-stream", name: got.metadata?.name ?? "receipt" };
}
export const deleteReceiptFile = (eventId, id) => store().delete(`receiptfile:${eventId}:${id}`);
export const getReceiptRead = (eventId, id) => read(`receiptread:${eventId}:${id}`);
export const putReceiptRead = (eventId, id, value) => write(`receiptread:${eventId}:${id}`, value);
export const deleteReceiptRead = (eventId, id) => store().delete(`receiptread:${eventId}:${id}`);
export const putAgendaRead = (eventId, value) => write(`agendaread:${eventId}`, value);

/** Remove a key outright — used when an event or presenter is deleted. */
export const deleteKey = (key) => store().delete(key);

/** Small desk-wide facts, e.g. when the weekly summary last went out. */
export const getMeta = (key) => read(`meta:${key}`);
export const putMeta = (key, value) => write(`meta:${key}`, value);

/** Board roster — one list for the whole desk. */
/**
 * The people coming to an event. Kept in their own blob rather than on the
 * event, because a popular training can carry hundreds of them and the event
 * record is read on every screen in the desk.
 */
export const getAttendees = (eventId) => read(`attendees:${eventId}`);
/**
 * Answers to an event's housekeeping questions (food allergies, socials), one record each under
 * reply:<eventId>:<id>, so two people answering at the same moment never write over each other.
 */
export async function getReplies(eventId) {
  const { blobs } = await store().list({ prefix: `reply:${eventId}:` });
  const answers = (await Promise.all(blobs.map((b) => read(b.key)))).filter(Boolean);
  return { answers: answers.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? "")) };
}
export const getReply = (eventId, id) => read(`reply:${eventId}:${id}`);
export const putReply = (eventId, answer) => write(`reply:${eventId}:${answer.id}`, answer);
export const deleteReply = (eventId, id) => store().delete(`reply:${eventId}:${id}`);

/**
 * An event's survey answers (survey.mjs). Each submitted part is its own record with no name or address on it; who
 * has answered which part is kept apart, by the anonymous id in their link, only so nobody is asked twice.
 */
export async function getSurveyResponses(eventId) {
  const { blobs } = await store().list({ prefix: `surveyresp:${eventId}:` });
  return (await Promise.all(blobs.map((b) => read(b.key)))).filter(Boolean).sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
}
export const putSurveyResponse = (eventId, r) => write(`surveyresp:${eventId}:${r.id}`, r);
export const deleteSurveyResponse = (eventId, id) => store().delete(`surveyresp:${eventId}:${id}`);
export const getSurveyDone = (eventId, pid) => read(`surveydone:${eventId}:${pid}`);
export const putSurveyDone = (eventId, pid, done) => write(`surveydone:${eventId}:${pid}`, done);
export async function listSurveyDone(eventId) {
  const { blobs } = await store().list({ prefix: `surveydone:${eventId}:` });
  return (await Promise.all(blobs.map(async (b) => ({ pid: b.key.split(":").pop(), ...(await read(b.key)) })))).filter(Boolean);
}
export async function countSurveyResponses(eventId) {
  const { blobs } = await store().list({ prefix: `surveyresp:${eventId}:` });
  return blobs.length;
}
/**
 * What one board member has already seen on an event, tab by tab (Andrew 28 Oct 2026: "a badge number when there are
 * new responses … if I were to get 10 new survey replies, a small badge 10 shows beside the survey tab"). Counts as they
 * were when that tab was last opened; the badge is what has come in since.
 */
const seenKey = (who, eventId) => `seen:${String(who || "desk").toLowerCase()}:${eventId}`;
export const getSeen = (who, eventId) => read(seenKey(who, eventId));
export const putSeen = (who, eventId, value) => write(seenKey(who, eventId), value);
/** People who said they would like to present: kept apart from the answers so the answers stay anonymous. */
export async function getSurveyContacts(eventId) {
  const { blobs } = await store().list({ prefix: `surveycontact:${eventId}:` });
  return (await Promise.all(blobs.map((b) => read(b.key)))).filter(Boolean);
}
export const putSurveyContact = (eventId, c) => write(`surveycontact:${eventId}:${c.id}`, c);
/** Every survey record of an event (answers, who has answered, would-be presenters), for when the event is deleted. */
export async function deleteSurveyData(eventId) {
  const keys = (await Promise.all(["surveyresp", "surveydone", "surveycontact"].map((k) => store().list({ prefix: `${k}:${eventId}:` })))).flatMap((r) => r.blobs.map((b) => b.key));
  for (const key of keys) await store().delete(key);
  return keys.length;
}
export const putAttendees = (eventId, value) => write(`attendees:${eventId}`, value);

/** Letters Andrew writes once and points events at — welcome, survey. */
export const getLetter = (id) => read(`letter:${id}`);
export const putLetter = (letter) => write(`letter:${letter.id}`, letter);
export async function listLetters() {
  const { blobs } = await store().list({ prefix: "letter:" });
  const rows = await Promise.all(blobs.map((b) => read(b.key)));
  return rows.filter(Boolean).sort((a, b) => (a.kind ?? "").localeCompare(b.kind ?? "") || (a.name ?? "").localeCompare(b.name ?? ""));
}

export const getRoster = () => read("roster:board");
/** The standard names of agencies, and the spellings people use for them (agencies.mjs). Shared by every event. */
export const getAgencyList = () => read("agencies:directory");
export const putAgencyList = (list) => write("agencies:directory", list);
export const putRoster = (members) => write("roster:board", members);

/**
 * Everything in the store, for the nightly backup (see backup.mjs). `readRaw` gives a blob's bytes and its metadata
 * whatever it holds (JSON, a PDF, a photo); `writeRaw` puts one back exactly as it was, for a restore.
 */
export async function allBlobKeys() {
  const { blobs } = await store().list({ prefix: "" });
  return blobs.map((b) => b.key).sort();
}
export async function readRaw(key) {
  const got = await store().getWithMetadata(key, { type: "arrayBuffer" });
  return got ? { bytes: Buffer.from(got.data), metadata: got.metadata ?? {} } : null;
}
export const writeRaw = (key, bytes, metadata = {}) => store().set(key, bytes, { metadata });
