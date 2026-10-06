/**
 * Reading ONGIA's Wix site: the events, and who has registered for them.
 *
 * Authenticated with a long-lived API key rather than OAuth, because this runs
 * server to server with no user session. Wix wants the key raw in the
 * Authorization header — no "Bearer" — plus the site it applies to:
 *
 *   Authorization: <key>
 *   wix-site-id:   <site id>
 *
 * The key needs two scopes, both read-only:
 *   SCOPE.DC-EVENTS.READ-EVENTS        query the events
 *   SCOPE.DC-EVENTS.READ-GUEST-LIST    query who registered
 *
 * Only an account owner or co-owner can mint one, in the Wix dashboard's API
 * Key Manager. It lives in WIX_API_KEY and never in this repository.
 *
 * Docs:
 *   https://dev.wix.com/docs/rest/business-solutions/events/events-v3/introduction
 *   https://dev.wix.com/docs/rest/business-solutions/events/event-guests/introduction
 */
const API = "https://www.wixapis.com";
const PAGE = 100;          // guests per request; Wix allows up to 1000
const MAX_PAGES = 50;      // a stop, so a bad cursor cannot loop for ever

export function wixConfigured() {
  return Boolean(process.env.WIX_API_KEY && process.env.WIX_SITE_ID);
}

/**
 * The WIX_* variable names this function can actually see. Names only, never
 * values — a secret must not be readable from a diagnostic. It catches the two
 * failures that look identical from outside: a typo in the name, and a Netlify
 * variable whose scope excludes Functions.
 */
export function wixEnvNames() {
  return Object.keys(process.env).filter((k) => /^WIX/i.test(k)).sort();
}

/** Which half of the connection is absent — naming both is no help at all. */
export function wixMissing() {
  const gone = [];
  if (!process.env.WIX_API_KEY) gone.push("WIX_API_KEY");
  if (!process.env.WIX_SITE_ID) gone.push("WIX_SITE_ID");
  return gone;
}

/**
 * A site id is a UUID. A key pasted into the wrong box is the likeliest
 * mistake here, and it is worth saying so before Wix answers with a 403 that
 * sounds like a permissions problem.
 */
export function wixSiteIdLooksWrong() {
  const id = process.env.WIX_SITE_ID ?? "";
  if (!id) return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim())) return null;
  if (id.startsWith("IST.") || id.length > 60) return "WIX_SITE_ID looks like an API key, not a site id. The site id is the UUID from the dashboard URL.";
  return `WIX_SITE_ID is not a UUID (got ${id.length} characters). It should look like 8a3f91c2-4d7e-4b16-9f02-1e5c7a9d3b84.`;
}

async function wix(path, body) {
  if (!wixConfigured()) throw new Error("Wix is not connected on this site — set WIX_API_KEY and WIX_SITE_ID.");
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      authorization: process.env.WIX_API_KEY,
      "wix-site-id": process.env.WIX_SITE_ID,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Wix answers with { message } or { details: { applicationError } }.
    const why = json.message || json.details?.applicationError?.description || `HTTP ${res.status}`;
    const err = new Error(res.status === 401 || res.status === 403
      ? `Wix refused the key (${why}). Check it has Read Events and Read Guest List, and that it was made on the account that owns the site.`
      : `Wix: ${why}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

/** One Wix event, cut down to what the desk needs to match and display. */
function tidyEvent(e) {
  const start = e.dateAndTimeSettings?.startDate ?? null;
  const end = e.dateAndTimeSettings?.endDate ?? null;
  const day = (iso) => (typeof iso === "string" && iso.length >= 10 ? iso.slice(0, 10) : null);
  return {
    id: e.id,
    title: e.title ?? "",
    status: e.status ?? "",
    dayOne: day(start),
    lastDay: day(end) ?? day(start),
    venue: e.location?.name ?? "",
    city: e.location?.address?.city ?? "",
    url: e.eventPageUrl?.url ?? e.eventPageUrl ?? "",
    registered: e.summaries?.rsvps?.totalCount ?? null,
  };
}

/**
 * The site's events, newest first. Drafts are left out — an event nobody can
 * register for is not one the desk should offer to link to.
 */
export async function listWixEvents({ limit = 100 } = {}) {
  const out = await wix("/events/v3/events/query", {
    fields: ["URLS", "DASHBOARD"],
    query: {
      filter: { status: { $in: ["UPCOMING", "STARTED", "ENDED"] } },
      // Wix defaults paging.limit to 0, which returns nothing at all.
      paging: { limit: Math.min(limit, 100), offset: 0 },
      sort: [{ fieldName: "dateAndTimeSettings.startDate", order: "DESC" }],
    },
  });
  return (out.events ?? []).map(tidyEvent);
}

/** One guest, reduced to a person the desk can write to. */
function tidyGuest(g) {
  const d = g.guestDetails ?? {};
  return {
    id: g.id,
    // Every guest names its own event, which is what lets one sweep across the
    // whole site be fanned out to the right desk events.
    eventId: g.eventId ?? "",
    contactId: g.contactId ?? "",
    first: (d.firstName ?? "").trim(),
    last: (d.lastName ?? "").trim(),
    email: (d.email ?? "").trim().toLowerCase(),
    phone: (d.phone ?? "").trim(),
    // Wix carries the RSVP's own yes/no/waitlist as well as a rolled-up
    // attendance status. The rolled-up one is what the desk acts on.
    status: g.attendanceStatus ?? "",
    rsvp: g.additionalDetails?.rsvpStatus ?? "",
    checkedIn: d.checkedIn === true,
    totalGuests: g.totalGuests ?? 1,
    updatedAt: g.updatedDate ?? g.createdDate ?? null,
  };
}

/**
 * Registered guests, paged through to the end.
 *
 * The guest query covers the whole site, so leaving eventId off returns
 * everyone across every event — each guest names its own event, which lets one
 * nightly sweep feed every desk event rather than one call per event. Pass
 * eventId to narrow it to a single event, which is what Sync now does.
 *
 * guestDetails has to be asked for by name — without that fieldset Wix returns
 * identifiers and no names or emails at all, which looks like an empty result
 * rather than the refusal it is.
 */
export async function listWixGuests({ eventId = null, type = "RSVP", since = null } = {}) {
  const filter = {};
  if (eventId) filter.eventId = eventId;
  if (type) filter.guestType = type;
  // Only what has moved since the last sweep, when we know when that was.
  if (since) filter.updatedDate = { $gte: since };

  const guests = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = cursor
      ? { cursorPaging: { limit: PAGE, cursor } }
      : { filter, cursorPaging: { limit: PAGE } };
    const out = await wix("/events/v2/guests/query", { fields: ["GUEST_DETAILS"], query });
    guests.push(...(out.guests ?? []).map(tidyGuest));
    cursor = out.pagingMetadata?.cursors?.next || null;
    if (!cursor || !(out.guests ?? []).length) break;
  }
  return guests;
}

/** The whole site's guests, grouped by the Wix event they belong to. */
export async function wixGuestsByEvent(opts = {}) {
  const byEvent = new Map();
  for (const g of await listWixGuests(opts)) {
    if (!g.eventId) continue;
    if (!byEvent.has(g.eventId)) byEvent.set(g.eventId, []);
    byEvent.get(g.eventId).push(g);
  }
  return byEvent;
}

/** Enough of a check to tell Andrew whether the key works, without side effects. */
export async function wixHealth() {
  const gone = wixMissing();
  if (gone.length === 2) {
    return { ok: false, missing: gone, reason: "Not connected — neither WIX_API_KEY nor WIX_SITE_ID is set on this site." };
  }
  if (gone.length === 1) {
    const here = gone[0] === "WIX_API_KEY" ? "WIX_SITE_ID" : "WIX_API_KEY";
    const seen = wixEnvNames();
    const near = seen.filter((k) => k !== here);
    return { ok: false, missing: gone, seen,
      reason: `Not connected — ${here} is set but ${gone[0]} is missing.`
        + (near.length ? ` This function can see ${near.join(", ")}, so check the spelling.` : "")
        + ` If you have just added it: Netlify only reads a new variable on a new deploy, and the variable's scope must include Functions.` };
  }
  const shape = wixSiteIdLooksWrong();
  if (shape) return { ok: false, reason: shape };
  try {
    const events = await listWixEvents({ limit: 1 });
    return { ok: true, events: events.length, sample: events[0]?.title ?? "" };
  } catch (e) {
    return { ok: false, reason: e.message, status: e.status ?? null };
  }
}
