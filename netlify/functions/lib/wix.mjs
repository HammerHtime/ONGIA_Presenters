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
 * The Wix sites the desk reads. The first is ONGIA's own (WIX_API_KEY, WIX_SITE_ID). A second (Andrew 26 Oct 2026: the
 * National Gang Summit's community partners register on a separate Wix site) is WIX_SITE_ID_2, with WIX_API_KEY_2
 * when that site is on another Wix account (a key from the same account reaches every site on it), and
 * WIX_SITE_2_NAME for how the desk names it.
 */
export function wixSites() {
  const out = [{ n: "1", key: process.env.WIX_API_KEY, id: process.env.WIX_SITE_ID, name: "ONGIA's website" }];
  if (process.env.WIX_SITE_ID_2) out.push({ n: "2", key: process.env.WIX_API_KEY_2 || process.env.WIX_API_KEY, id: process.env.WIX_SITE_ID_2.trim(), name: process.env.WIX_SITE_2_NAME || "the community partners' website" });
  return out.filter((s) => s.key && s.id);
}
const siteOf = (n = "1") => wixSites().find((s) => s.n === String(n || "1"));

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

async function wix(path, body, site = "1") {
  if (!wixConfigured()) throw new Error("Wix is not connected on this site — set WIX_API_KEY and WIX_SITE_ID.");
  const s = siteOf(site);
  if (!s) throw new Error("The desk is not connected to that Wix site — set WIX_SITE_ID_2 (and WIX_API_KEY_2 if it is on another Wix account).");
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      authorization: s.key,
      "wix-site-id": s.id,
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
    // Wix's DASHBOARD summary reported 0 for an event with 420 registrations,
    // so whatever that field is, it is not this. The true number comes from
    // the guest query, and a confidently wrong count is worse than no count.
    registered: null,
  };
}

/**
 * The site's events, newest first. Drafts are left out — an event nobody can
 * register for is not one the desk should offer to link to.
 */
export async function listWixEvents({ limit = 100, site = "1" } = {}) {
  const out = await wix("/events/v3/events/query", {
    fields: ["URLS", "DASHBOARD"],
    query: {
      filter: { status: { $in: ["UPCOMING", "STARTED", "ENDED"] } },
      // Wix defaults paging.limit to 0, which returns nothing at all.
      paging: { limit: Math.min(limit, 100), offset: 0 },
      sort: [{ fieldName: "dateAndTimeSettings.startDate", order: "DESC" }],
    },
  }, site);
  const name = siteOf(site)?.name ?? "";
  return (out.events ?? []).map((e) => ({ ...tidyEvent(e), site: String(site), siteName: name }));
}

/** Every site's events together; one site that will not answer does not hide the others. */
export async function listAllWixEvents() {
  const out = [];
  for (const s of wixSites()) {
    try { out.push(...(await listWixEvents({ site: s.n }))); }
    catch (e) { if (s.n === "1") throw e; }
  }
  return out;
}

/** The names of an RSVP's extra guests, from wherever Wix put them on the form; none is fine. */
function guestNamesOf(g) {
  const d = g.guestDetails ?? {};
  const direct = d.additionalGuestDetails?.guestNames ?? g.additionalGuestDetails?.guestNames ?? [];
  const fromForm = (d.formResponse?.inputValues ?? [])
    .filter((v) => /guest/i.test(v.inputName ?? "") && Array.isArray(v.values))
    .flatMap((v) => v.values);
  return [...direct, ...fromForm].map((x) => String(x ?? "").trim()).filter((x) => x && !/^\d+$/.test(x));
}

/**
 * The agency someone gave on the Wix registration form, when the form asks for one (Andrew 26 Oct 2026: so the
 * housekeeping form can fill it in for them). Wix names each field on the form; any field whose name reads like
 * agency, organization, company, employer or service counts. Empty when the form does not ask.
 */
export function organizationOf(g) {
  const d = g.guestDetails ?? {};
  const fields = [...(d.formResponse?.inputValues ?? []), ...(g.formResponse?.inputValues ?? [])];
  const hit = fields.find((v) => /agenc|organi[sz]ation|company|employer|service|department|affiliation|^org$/i.test(`${v.inputName ?? ""} ${v.label ?? ""}`)
    && !/guest|e-?mail|phone/i.test(v.inputName ?? ""));
  const value = hit ? (hit.value ?? (Array.isArray(hit.values) ? hit.values[0] : "")) : "";
  return String(value ?? "").trim().slice(0, 200);
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
    organization: organizationOf(g),
    // Wix carries the RSVP's own yes/no/waitlist as well as a rolled-up
    // attendance status. The rolled-up one is what the desk acts on.
    status: g.attendanceStatus ?? "",
    rsvp: g.additionalDetails?.rsvpStatus ?? "",
    guestType: g.guestType ?? "",
    // Ties a ticket holder to the buyer who paid for the order.
    orderNumber: g.orderNumber ?? "",
    // A ticket holder's own ticket; a buyer lists every ticket in the order (the order's real head count).
    ticketNumber: g.ticketNumber ?? "",
    tickets: (g.tickets ?? []).map((t) => t?.number).filter(Boolean),
    checkedIn: d.checkedIn === true,
    totalGuests: g.totalGuests ?? 1,
    // The names an RSVP gave for the people they are bringing, when the form asked for them.
    guestNames: guestNamesOf(g),
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
export async function listWixGuests({ eventId = null, type = "RSVP", since = null, site = "1" } = {}) {
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
    const out = await wix("/events/v2/guests/query", { fields: ["GUEST_DETAILS"], query }, site);
    guests.push(...(out.guests ?? []).map(tidyGuest));
    cursor = out.pagingMetadata?.cursors?.next || null;
    if (!cursor || !(out.guests ?? []).length) break;
  }
  return guests;
}

/**
 * The people actually coming, out of every guest record Wix has for an event: one row for every registration, the way
 * Wix counts them (Andrew, 21 Oct 2026: Wix showed 45 and the desk 26, because the desk kept one row per email address
 * and ignored an RSVP's "+ guests").
 *
 * A free event has one RSVP per registration, which may bring more people ("totalGuests"): each extra person is a row of
 * their own, named if the form asked for names, else "guest of" the person who registered them. A ticketed event has a
 * BUYER per order, listing the order's tickets, and a TICKET_HOLDER per ticket when Wix asked for each holder's details:
 * every ticket is a row, and a ticket with no email of its own uses the buyer's, so the letters still reach someone who
 * can pass them on. Letters go once per email address however many rows share it.
 */
export function attendeesOf(guests) {
  const name = (g) => `${g.first} ${g.last}`.trim() || g.email;
  const split = (whole) => { const p = String(whole ?? "").trim().split(/\s+/).filter(Boolean); return p.length > 1 ? { first: p.slice(0, -1).join(" "), last: p.at(-1) } : { first: p[0] ?? "", last: "" }; };
  const rsvp = guests.filter((g) => g.guestType === "RSVP" || !g.guestType);
  const holders = guests.filter((g) => g.guestType === "TICKET_HOLDER");
  const buyers = guests.filter((g) => g.guestType === "BUYER");
  const buyerOf = new Map(buyers.filter((b) => b.orderNumber).map((b) => [b.orderNumber, b]));
  const out = [];
  for (const g of rsvp) {
    out.push({ ...g, key: `wix:${g.id}` });
    const extra = Math.max(0, Math.min(50, (Number(g.totalGuests) || 1) - 1));
    for (let n = 1; n <= extra; n++) {
      const given = split(g.guestNames?.[n - 1]);
      out.push({ ...g, key: `wix:${g.id}:${n + 1}`, first: given.first, last: given.last, phone: "", guestOf: name(g) });
    }
  }
  for (const h of holders) {
    const b = h.orderNumber ? buyerOf.get(h.orderNumber) : null;
    out.push({ ...h, key: `wix:${h.id}`, email: h.email || b?.email || "", ...(!h.first && !h.last && b ? { guestOf: name(b) } : {}) });
  }
  // Wix often keeps only the buyer's record for an order, with every ticket listed on it (Andrew 21 Oct 2026: 43 orders,
  // 65 tickets). Every ticket counts: one with no holder of its own is a row "guest of" the buyer, and when the order
  // has no holders at all the buyer is the first ticket.
  for (const b of buyers) {
    const hs = holders.filter((h) => b.orderNumber && h.orderNumber === b.orderNumber);
    const covered = new Set(hs.map((h) => h.ticketNumber).filter(Boolean));
    const count = b.tickets?.length || Math.max(1, Number(b.totalGuests) || 1);
    let left = b.tickets?.length ? b.tickets.filter((n) => !covered.has(n)) : Array.from({ length: Math.max(0, count - hs.length) }, (_, i) => String(i + 1));
    if (b.tickets?.length && hs.length && !hs.some((h) => h.ticketNumber)) left = left.slice(hs.length);   // holders with no ticket number still use up tickets
    if (!hs.length) { out.push({ ...b, key: `wix:${b.id}` }); left = left.slice(1); }
    for (const n of left) out.push({ ...b, key: `wix:${b.id}:t${n}`, first: "", last: "", phone: "", guestOf: name(b) });
  }
  return out;
}

/** The whole site's guests, grouped by the Wix event they belong to. */
export async function wixGuestsByEvent(opts = {}) {
  const byEvent = new Map();
  const all = [];
  for (const s of wixSites()) all.push(...(await listWixGuests({ ...opts, site: s.n })));
  for (const g of all) {
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
