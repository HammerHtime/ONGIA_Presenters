import { json, fail, requireAdmin, adminWho, text } from "./lib/http.mjs";
import { mayCost } from "./lib/auth.mjs";
import { getEvent, putEvent, listPresenters, getPresenter, putPresenter, getHeadshot } from "./lib/store.mjs";
import { publicConsent, byLastName } from "./lib/public.mjs";
import { isWebsiteEvent, cleanWebsite, cleanPresenterWeb, buildDeskFile, github, githubToken, readSite, planChanges, commitChanges,
  draftFrench, GitHubError, REPO, BRANCH } from "./lib/website.mjs";

/**
 * An event's page on the CFAOC symposium website, kept from the desk (Andrew 22 Oct 2026).
 *
 *   GET  /api/website?event=…                       the website fields, and who of its presenters would be shown
 *   PUT  /api/website?event=…                       save the website fields
 *   PUT  /api/website?event=…&presenter=…           save one presenter's job title and French
 *   POST /api/website?event=…&french=<presenter>    draft one presenter's French with Claude
 *   POST /api/website?event=…&fill=1                one time: fill empty fields from what the website shows today
 *   POST /api/website?event=…&preview=1             what "Update website" would change, in plain words
 *   POST /api/website?event=…&publish=1             make that change: one commit on the website's main branch
 *
 * Only for events whose title starts "Canadian Forum Against Organized Crime", and only for the president and the
 * VP, like the presenter export: it is one person deciding what goes on a public site.
 */
export default async (req, { fetchImpl, client } = {}) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const who = adminWho(req);
  if (!mayCost(who)) return fail("Only the president and the VP of operations can change the website.", 403);
  const url = new URL(req.url);
  const event = await getEvent(url.searchParams.get("event"));
  if (!event) return fail("No such event.", 404);
  if (!isWebsiteEvent(event)) return fail("Only the Canadian Forum Against Organized Crime events have a website on the desk.", 409);
  const q = (k) => url.searchParams.get(k);
  try {
    if (req.method === "GET") return show(event);
    if (req.method === "PUT") {
      const body = await req.json().catch(() => null);
      if (!body) return fail("Expected a JSON body.");
      return q("presenter") ? savePresenter(event, q("presenter"), body) : saveEvent(event, body);
    }
    if (req.method === "POST") {
      if (q("french")) return french(event, q("french"), client);
      if (q("fill")) return fill(event, fetchImpl);
      if (q("preview")) return preview(event, fetchImpl);
      if (q("publish")) return publish(event, who, fetchImpl);
    }
  } catch (e) {
    if (e instanceof GitHubError) return fail(e.message, 502);
    throw e;
  }
  return fail("Method not allowed.", 405);
};

async function show(event) {
  const presenters = byLastName(await listPresenters(event.id));
  return json({
    website: cleanWebsite({}, event.website ?? {}),
    connected: !!githubToken(),
    repo: REPO(), branch: BRANCH(),
    wixUrl: event.wix?.url ?? "",
    presenters: presenters.map((p) => {
      const c = publicConsent(p);
      return { id: p.id, name: `${p.first} ${p.last}`.trim(), organization: p.organization || "", status: p.status,
        shown: c.in, photo: !!(c.photo && p.submission?.headshotName), bioConsent: c.bio ?? null,
        talk: p.submission?.talk || "", bio: c.bio === "no" ? "" : p.submission?.bio || "", outline: p.submission?.outline || "",
        web: cleanPresenterWeb({}, p.web ?? {}) };
    }),
  });
}

async function saveEvent(event, body) {
  const w = cleanWebsite(body, event.website ?? {});
  if (body.page !== undefined && !w.page) return fail("Give the website page a name, such as victoria.");
  event.website = w;
  event.updatedAt = new Date().toISOString();
  await putEvent(event);
  return json({ ok: true, website: w });
}

async function savePresenter(event, id, body) {
  const p = await getPresenter(event.id, text(id, 40));
  if (!p) return fail("No such presenter.", 404);
  p.web = cleanPresenterWeb(body, p.web ?? {});
  await putPresenter(p);
  return json({ ok: true, web: p.web });
}

async function french(event, id, client) {
  const p = await getPresenter(event.id, text(id, 40));
  if (!p) return fail("No such presenter.", 404);
  const c = publicConsent(p);
  if (!c.in) return fail("This presenter is not shown on the website, so there is nothing to translate.", 409);
  const s = p.submission ?? {};
  const web = cleanPresenterWeb({}, p.web ?? {});
  let fr;
  try { fr = await draftFrench({ title: web.title, talk: s.talk || "", bio: c.bio === "no" ? "" : s.bio || "", outline: s.outline || "" }, { client }); }
  catch (e) { return fail(e.message, 502); }
  // A fresh draft has not been read by anyone yet.
  p.web = { ...web, ...fr, frReviewed: false, frDraftedAt: new Date().toISOString() };
  await putPresenter(p);
  return json({ ok: true, web: p.web });
}

const needsKey = () => fail("The website key is not set up yet: put it in Netlify as CFAOC_GITHUB_TOKEN, then try again.", 409);
const needsPage = () => fail("Say which page of the website this event fills first (Website page), then save.", 409);

/** The first time: carry what the website file says today into the desk's empty boxes, so nothing typed there is lost. */
async function fill(event, fetchImpl) {
  if (!githubToken()) return needsKey();
  const w = cleanWebsite({}, event.website ?? {});
  if (!w.page) return needsPage();
  const site = await readSite(github({ fetchImpl }), w.page);
  const ev = (site.events?.events ?? []).find((e) => e.slug === w.page);
  if (!ev) return fail(`The website has no page called ${w.page} yet, so there is nothing to bring over. It will be added the first time you update the website.`, 404);
  const fr = site.events?.i18n?.fr?.events?.[w.page] ?? {};
  const filled = [];
  const take = (k, v, label) => { if (!w[k] && v) { w[k] = v; filled.push(label); } };
  take("regionLabel", ev.regionLabel, "region");
  take("blurb", ev.blurb, "short description");
  take("blurbFr", fr.blurb, "short description in French");
  take("startTime", ev.startTime, "start time");
  take("endTime", ev.endTime, "end time");
  take("registerUrl", ev.registerUrl, "registration link");
  take("street", ev.venue?.street, "venue street");
  take("postalCode", ev.venue?.postalCode, "venue postal code");
  take("hotelRate", ev.hotel?.rate, "hotel rate");
  if (!w.agenda.length && ev.agenda?.length) {
    w.agenda = cleanWebsite({ agenda: ev.agenda.map((r, i) => ({ ...r, titleFr: fr.agenda?.[i]?.title, detailFr: fr.agenda?.[i]?.detail, abstractFr: fr.agenda?.[i]?.abstract })) }).agenda;
    filled.push(`the program (${w.agenda.length} ${w.agenda.length === 1 ? "line" : "lines"})`);
  }
  event.website = w;
  // The desk does not hold everything the website file does. Say what stays there.
  const notMoved = [!event.hotel?.link && ev.hotel?.bookingUrl ? "hotel booking link (put it on Edit event, Hotel)" : "", !event.hotel?.name && ev.hotel?.name ? "hotel name (Edit event, Hotel)" : ""].filter(Boolean);
  // Job titles, matched by name: the agreement does not ask for one.
  const people = await listPresenters(event.id);
  const titled = [];
  for (const sp of ev.speakers ?? []) {
    const key = (s) => String(s ?? "").toLowerCase().replace(/^(cpl|cst|sgt|insp|supt|det|s\/sgt|d\/cst)\.?\s+/i, "").replace(/[^a-z]/g, "");
    const p = people.find((x) => key(`${x.first} ${x.last}`) === key(sp.name));
    if (!p || !sp.title || p.web?.title) continue;
    p.web = cleanPresenterWeb({ title: sp.title }, p.web ?? {});
    await putPresenter(p);
    titled.push(`${p.first} ${p.last}`);
  }
  if (titled.length) filled.push(`job titles for ${titled.join(", ")}`);
  event.updatedAt = new Date().toISOString();
  await putEvent(event);
  return json({ ok: true, website: w, filled, notMoved });
}

async function plan(event, fetchImpl) {
  const w = cleanWebsite({}, event.website ?? {});
  if (!w.page) return { error: needsPage() };
  if (!githubToken()) return { error: needsKey() };
  const gh = github({ fetchImpl });
  const built = await buildDeskFile(event, await listPresenters(event.id), getHeadshot);
  const site = await readSite(gh, w.page);
  if (!site.events) return { error: fail("The website has no events.json, so the desk cannot tell what it would change. Nothing was sent.", 409) };
  return { gh, built, site, changes: planChanges(site, built) };
}

async function preview(event, fetchImpl) {
  const p = await plan(event, fetchImpl);
  if (p.error) return p.error;
  return json({ page: p.built.page, unchanged: p.changes.unchanged, lines: p.changes.summary.lines, notes: p.changes.summary.notes, shown: p.built.people.length });
}

async function publish(event, who, fetchImpl) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = await plan(event, fetchImpl);
    if (p.error) return p.error;
    if (p.changes.unchanged) return json({ ok: true, unchanged: true, lines: [], notes: p.changes.summary.notes });
    const by = who?.name || who?.email || "the desk key";
    const message = `Website update from the desk: ${event.title}\n\nPage: ${p.built.page}. Pressed by ${by}.\n\n${p.changes.summary.lines.map((l) => `- ${l}`).join("\n")}\n\nTo undo, revert this commit.`;
    try {
      const done = await commitChanges(p.gh, p.site, p.changes, message);
      const fresh = await getEvent(event.id);
      fresh.website = { ...cleanWebsite({}, fresh.website ?? {}), lastPublished: { at: new Date().toISOString(), by, commit: done.sha, url: done.url, lines: p.changes.summary.lines } };
      await putEvent(fresh);
      return json({ ok: true, commit: done.sha, url: done.url, lines: p.changes.summary.lines, notes: p.changes.summary.notes });
    } catch (e) {
      // Someone else changed the website in between: read it again and go once more.
      if (e instanceof GitHubError && e.status === 422 && attempt === 0) continue;
      throw e;
    }
  }
  return fail("The website kept changing while the desk was updating it. Nothing was published; try again in a minute.", 409);
}
