import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { anthropicKey } from "./contract.mjs";
import { text } from "./http.mjs";
import { PROVINCES, guessProvince } from "./sow.mjs";
import { publicConsent, byLastName, slugOf } from "./public.mjs";

/**
 * The CFAOC symposium website, fed from the desk (Andrew 22 Oct 2026; spec: HammerHtime/general,
 * chief-of-staff/cfaoc-website-sync-spec.md).
 *
 * The website (HammerHtime/cfaoc-symposium) is a static site built from events.json. The desk never rewrites that
 * file: it owns one file per event, desk/<page>.json, which the site's build lays over the event of the same page
 * name (or adds as a new city when there is none), and the presenters' photos under static/assets/speakers/<page>/.
 * One press of "Update website" is one commit, so undoing it is reverting that commit.
 *
 * Only events whose title starts "Canadian Forum Against Organized Crime" have a website, for now.
 * The repository is public: only what each presenter agreed to make public goes in (publicConsent, shared with
 * the presenter export). Never an email, phone, travel, cost or the community-partners answer.
 */

export const isWebsiteEvent = (event) => /^\s*canadian forum against organi[sz]ed crime\b/i.test(event?.title ?? "");

export const REPO = () => process.env.CFAOC_REPO || "HammerHtime/cfaoc-symposium";
export const BRANCH = () => process.env.CFAOC_BRANCH || "main";
export const githubToken = () => process.env.CFAOC_GITHUB_TOKEN || "";

// Where each province's clock is, for the page's times and its calendar file.
const ZONES = {
  BC: ["America/Vancouver", "PT"], YT: ["America/Whitehorse", "MT"], AB: ["America/Edmonton", "MT"], NT: ["America/Yellowknife", "MT"],
  SK: ["America/Regina", "CST"], MB: ["America/Winnipeg", "CT"], ON: ["America/Toronto", "ET"], QC: ["America/Toronto", "ET"], NU: ["America/Iqaluit", "ET"],
  NB: ["America/Halifax", "AT"], NS: ["America/Halifax", "AT"], PE: ["America/Halifax", "AT"], NL: ["America/St_Johns", "NT"],
};

const hhmm = (v) => {
  const m = String(v ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  return m && +m[1] < 24 && +m[2] < 60 ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
};
const link = (v) => { const s = text(v, 800); return /^https:\/\//i.test(s) ? s : ""; };
const pageName = (v) => slugOf(v).slice(0, 40);

/** The website fields an event keeps, as typed on the Settings tab. Anything not given stays as it was. */
export function cleanWebsite(given, had = {}) {
  const pick = (k, clean) => (given?.[k] === undefined ? had[k] ?? clean(undefined) : clean(given[k]));
  const agenda = given?.agenda === undefined ? had.agenda ?? [] : (Array.isArray(given.agenda) ? given.agenda : []).slice(0, 40).map((r) => ({
    time: hhmm(r?.time), end: hhmm(r?.end),
    presenter: text(r?.presenter, 40),
    title: text(r?.title, 200), titleFr: text(r?.titleFr, 200),
    detail: text(r?.detail, 300), detailFr: text(r?.detailFr, 300),
    abstract: text(r?.abstract, 2000), abstractFr: text(r?.abstractFr, 2000),
  })).filter((r) => r.time || r.title || r.presenter);
  return {
    page: pick("page", (v) => pageName(v)),
    regionLabel: pick("regionLabel", (v) => text(v, 60)),
    blurb: pick("blurb", (v) => text(v, 600)),
    blurbFr: pick("blurbFr", (v) => text(v, 600)),
    startTime: pick("startTime", hhmm),
    endTime: pick("endTime", hhmm),
    registerUrl: pick("registerUrl", link),
    street: pick("street", (v) => text(v, 200)),
    postalCode: pick("postalCode", (v) => text(v, 12).toUpperCase()),
    hotelRate: pick("hotelRate", (v) => text(v, 40)),
    groupCode: pick("groupCode", (v) => text(v, 60)),
    agenda,
    lastPublished: had.lastPublished ?? null,
  };
}

/** A presenter's website extras, kept on the presenter: job title and the French, typed or drafted, and whether someone read the French. */
export function cleanPresenterWeb(given, had = {}) {
  const pick = (k, n) => (given?.[k] === undefined ? had[k] ?? "" : text(given[k], n));
  const out = {
    title: pick("title", 160), titleFr: pick("titleFr", 160), orgFr: pick("orgFr", 200),
    talkFr: pick("talkFr", 300), bioFr: pick("bioFr", 6000), outlineFr: pick("outlineFr", 6000),
    frReviewed: given?.frReviewed === undefined ? had.frReviewed === true : given.frReviewed === true,
    frDraftedAt: had.frDraftedAt ?? null,
  };
  return out;
}

const paras = (s) => String(s ?? "").split(/\n\s*\n|\r\n\s*\r\n/).map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);

/**
 * The event's desk file for the website, and the photos that go with it. Nothing in it changes from one press to the
 * next unless the event or a presenter did: no dates of building, so pressing twice changes nothing.
 * `headshotOf(eventId, presenterId)` gives { bytes, type } or null.
 */
export async function buildDeskFile(event, presenters, headshotOf) {
  const w = cleanWebsite({}, event.website ?? {});
  const page = w.page;
  const province = event.province || guessProvince(event.city) || "";
  const [timezone, timezoneLabel] = ZONES[province] ?? ["", ""];
  const city = String(event.city ?? "").split(",")[0].trim();

  const people = [], photos = [], used = new Set(), frSpeakers = [], report = [];
  for (const p of byLastName(presenters)) {
    const c = publicConsent(p);
    if (!c.in) continue;
    const s = p.submission ?? {};
    const web = cleanPresenterWeb({}, p.web ?? {});
    const name = `${p.first} ${p.last}`.trim();
    let photo = "";
    if (c.photo && s.headshotName) {
      const shot = await headshotOf(event.id, p.id).catch(() => null);
      if (shot?.bytes?.byteLength) {
        let file = `${slugOf(name) || p.id}.${shot.type === "image/png" ? "png" : "jpg"}`;
        if (used.has(file)) file = file.replace(/\.(\w+)$/, `-${p.id.slice(0, 6)}.$1`);
        used.add(file);
        photos.push({ path: `static/assets/speakers/${page}/${file}`, bytes: new Uint8Array(shot.bytes) });
        photo = `/assets/speakers/${page}/${file}`;
      }
    }
    const bio = c.bio === "no" ? [] : paras(s.bio);
    const sp = { name, ...(web.title ? { title: web.title } : {}), ...(p.organization ? { org: p.organization } : {}), ...(bio.length ? { bio } : {}), ...(photo ? { photo } : {}) };
    people.push(sp);
    // The French page shows the French where there is some, and the English where there is not yet.
    const bioFr = c.bio === "no" ? [] : paras(web.bioFr);
    frSpeakers.push({ ...sp, ...(web.titleFr ? { title: web.titleFr } : {}), ...(web.orgFr ? { org: web.orgFr } : {}), ...(bioFr.length ? { bio: bioFr } : {}) });
    report.push({ id: p.id, name, bioConsent: c.bio, photo: !!photo, talk: s.talk || "", outline: s.outline || "",
      frMissing: !!(bio.length && !bioFr.length), frReviewed: web.frReviewed });
  }

  const byId = new Map(report.map((r) => [r.id, r]));
  const pres = new Map(presenters.map((p) => [p.id, p]));
  const agenda = [], agendaFr = [];
  for (const r of w.agenda) {
    // A session tied to a presenter takes its words from their agreement, but only when they agreed to be public.
    const who = r.presenter && byId.get(r.presenter);
    const p = who ? pres.get(r.presenter) : null;
    const web = p ? cleanPresenterWeb({}, p.web ?? {}) : {};
    const title = r.title || who?.talk || "";
    const detail = r.detail || (who ? [who.name, p.organization].filter(Boolean).join(", ") : "");
    const abstract = r.abstract || who?.outline || "";
    const row = { time: r.time, ...(r.end ? { end: r.end } : {}), title, ...(detail ? { detail } : {}), ...(abstract ? { abstract: paras(abstract).join(" ") } : {}) };
    agenda.push(row);
    const titleFr = r.titleFr || (who && !r.title ? web.talkFr : "");
    const abstractFr = r.abstractFr || (who && !r.abstract ? web.outlineFr : "");
    agendaFr.push({ ...row, ...(titleFr ? { title: titleFr } : {}), ...(r.detailFr ? { detail: r.detailFr } : {}), ...(abstractFr ? { abstract: paras(abstractFr).join(" ") } : {}) });
  }

  const venue = { ...(event.venue ? { name: event.venue } : {}), ...(w.street ? { street: w.street } : {}), ...(city ? { city } : {}),
    ...(province ? { region: province } : {}), ...(w.postalCode ? { postalCode: w.postalCode } : {}), country: "Canada" };
  const h = event.hotel ?? {};
  const hotel = { ...(h.name ? { name: h.name } : {}), ...(w.hotelRate ? { rate: w.hotelRate } : {}), ...(h.link ? { bookingUrl: h.link } : {}),
    ...(w.groupCode ? { groupCode: w.groupCode } : {}), ...(h.cutoff ? { bookBy: h.cutoff } : {}) };
  const ev = {
    // Publishing from the desk opens the page: a city still marked "to be announced" gets its page.
    slug: page, status: "open", city, ...(province ? { province, provinceName: PROVINCES[province]?.name ?? "" } : {}),
    ...(timezone ? { timezone, timezoneLabel } : {}),
    ...(w.regionLabel ? { regionLabel: w.regionLabel } : {}),
    date: event.dayOne,
    ...(w.startTime ? { startTime: w.startTime } : {}), ...(w.endTime ? { endTime: w.endTime } : {}),
    ...((w.registerUrl || event.wix?.url) ? { registerUrl: w.registerUrl || event.wix.url } : {}),
    ...(w.blurb ? { blurb: w.blurb } : {}),
    venue, ...(Object.keys(hotel).length ? { hotel } : {}),
    speakers: people,
    ...(agenda.length ? { agenda } : {}),
  };
  const fr = { speakers: frSpeakers, ...(agendaFr.length ? { agenda: agendaFr } : {}), ...(w.blurbFr ? { blurb: w.blurbFr } : {}) };
  const file = { _comment: `Written by the ONGIA events desk for ${event.title}. Change it in the desk (Settings, Website), not here: the next update from the desk replaces this file.`, event: ev, fr };
  return { page, file, text: JSON.stringify(file, null, 2) + "\n", photos, people: report };
}

/** How the site's build combines events.json with a desk file: the desk's fields over the hand-written ones. Kept in step with build.js. */
export const deepMerge = (base, over) => {
  if (over === undefined || over === null) return base;
  if (Array.isArray(base) || Array.isArray(over) || typeof over !== "object") return over;
  const src = base && typeof base === "object" && !Array.isArray(base) ? base : {};
  const out = { ...src };
  for (const k of Object.keys(over)) out[k] = deepMerge(src[k], over[k]);
  return out;
};

/** The page name the site's build gives an event: its slug, or its region for a city whose page is not open yet. As in build.js. */
export const pageKey = (ev) => ev?.slug || String(ev?.regionLabel ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** What the website shows for a page: events.json's event with the desk file over it. */
export function shownEvent(eventsJson, page, deskFile) {
  const base = (eventsJson?.events ?? []).find((e) => pageKey(e) === page) ?? null;
  const frBase = eventsJson?.i18n?.fr?.events?.[page] ?? null;
  return { en: deepMerge(base, deskFile?.event) ?? null, fr: deepMerge(frBase, deskFile?.fr) ?? null, existed: !!base };
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const day = (iso) => { const d = new Date(`${iso}T12:00:00Z`); return Number.isNaN(+d) ? String(iso ?? "") : d.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); };
const list = (names) => names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/**
 * The change summary shown before anything is published, in plain words: what the website shows now against what it
 * would show after. `photoChanges` are the photo files that would be added, replaced or taken down.
 */
export function summarize({ before, after, beforeFr, afterFr, people, photoChanges = { added: [], replaced: [], removed: [] }, firstTime = false, newPage = false }) {
  const lines = [];
  if (newPage) lines.push("A new section of the website for this event.");
  else if (firstTime) lines.push("The first update from the desk for this page: from now on the desk, not the website file, is where its details are kept.");
  const b = before ?? {}, a = after ?? {};
  const was = new Map((b.speakers ?? []).map((s) => [s.name, s]));
  const now = new Map((a.speakers ?? []).map((s) => [s.name, s]));
  const added = [...now.keys()].filter((n) => !was.has(n));
  const gone = [...was.keys()].filter((n) => !now.has(n));
  if (added.length) lines.push(`${plural(added.length, "new presenter")}: ${list(added)}.`);
  if (gone.length) lines.push(`${plural(gone.length, "presenter")} taken off the website: ${list(gone)}. They have not signed in the desk with a yes to public use, or are not on this event in the desk.`);
  const bios = [...now.keys()].filter((n) => was.has(n) && !same(was.get(n).bio, now.get(n).bio));
  if (bios.length) lines.push(`${plural(bios.length, "bio")} updated: ${list(bios)}.`);
  const ids = [...now.keys()].filter((n) => was.has(n) && (!same(was.get(n).title, now.get(n).title) || !same(was.get(n).org, now.get(n).org)));
  if (ids.length) lines.push(`Job title or organization changed: ${list(ids)}.`);
  const pa = photoChanges.added.length, pr = photoChanges.replaced.length, pd = photoChanges.removed.length;
  if (pa || pr || pd) lines.push(`Photos: ${[pa ? `${pa} added` : "", pr ? `${pr} replaced` : "", pd ? `${pd} taken down` : ""].filter(Boolean).join(", ")}.`);

  const field = (label, x, y, show = (v) => v) => { if (!same(x, y) && (x || y)) lines.push(x ? (y ? `${label} changed: ${show(x)} → ${show(y)}.` : `${label} removed.`) : `${label} added: ${show(y)}.`); };
  field("Date", b.date, a.date, day);
  field("Start time", b.startTime, a.startTime);
  field("End time", b.endTime, a.endTime);
  const linkLine = (label, x, y) => { if (!same(x, y)) lines.push(!y ? `${label} removed.` : x ? `${label} changed.` : `${label} added.`); };
  linkLine("Registration link", b.registerUrl, a.registerUrl);
  field("Venue", b.venue?.name, a.venue?.name);
  linkLine("Venue address", [b.venue?.street, b.venue?.postalCode].filter(Boolean).join(" ") || "", [a.venue?.street, a.venue?.postalCode].filter(Boolean).join(" ") || "");
  field("Hotel", b.hotel?.name, a.hotel?.name);
  field("Hotel rate", b.hotel?.rate, a.hotel?.rate);
  linkLine("Hotel booking link", b.hotel?.bookingUrl, a.hotel?.bookingUrl);
  field("Hotel group code", b.hotel?.groupCode, a.hotel?.groupCode);
  field("Hotel booking deadline", b.hotel?.bookBy, a.hotel?.bookBy, day);
  linkLine("The event's short description", b.blurb, a.blurb);
  const ag0 = b.agenda ?? [], ag1 = a.agenda ?? [];
  if (!same(ag0, ag1)) {
    const changed = ag1.filter((r, i) => !same(r, ag0[i])).length;
    lines.push(ag0.length === ag1.length ? `Program: ${plural(changed, "line")} changed.` : `Program: was ${plural(ag0.length, "line")}, now ${ag1.length}${changed ? `; ${changed} new or changed` : ""}.`);
  }
  const fw = new Map((beforeFr?.speakers ?? []).map((s) => [s.name, s]));
  const frChanged = (afterFr?.speakers ?? []).filter((s) => fw.has(s.name) && (!same(fw.get(s.name).bio, s.bio) || !same(fw.get(s.name).title, s.title))).map((s) => s.name);
  if (frChanged.length) lines.push(`French updated for ${list(frChanged)}.`);
  if (!same(beforeFr?.agenda, afterFr?.agenda) && same(ag0, ag1) && (beforeFr?.agenda || afterFr?.agenda)) lines.push("Program in French changed.");
  const frTodo = people.filter((p) => p.frMissing).map((p) => p.name);
  const frUnread = people.filter((p) => !p.frMissing && !p.frReviewed).map((p) => p.name);
  const agFr = afterFr?.agenda ?? [];
  const noFrLines = ag1.filter((r, i) => r.title && agFr[i]?.title === r.title && !/^\d/.test(r.title)).length;
  const legacy = people.filter((p) => p.bioConsent === "legacy").map((p) => p.name);
  const notes = [];
  if (frTodo.length) notes.push(`No French yet for ${list(frTodo)}: the French page shows their English until there is.`);
  if (frUnread.length) notes.push(`French not marked as reviewed for ${list(frUnread)}.`);
  if (noFrLines) notes.push(`${plural(noFrLines, "program line")} with no French: the French page shows the English.`);
  if (legacy.length) notes.push(`${list(legacy)} signed before the biography question; their yes to a public summary covers the bio, as before.`);
  return { lines, notes };
}

/* ------------------------------------------------------------------ GitHub */

/** The id git gives a file's contents, so the desk can tell an unchanged photo without sending it. */
export const gitBlobSha = (bytes) => createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${bytes.byteLength}\0`), Buffer.from(bytes)])).digest("hex");

export class GitHubError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

/** A small GitHub client for one repository. `fetchImpl` is for tests. */
export function github({ token = githubToken(), repo = REPO(), fetchImpl = fetch } = {}) {
  const call = async (method, path, body) => {
    const res = await fetchImpl(`${process.env.CFAOC_GITHUB_API || "https://api.github.com"}/repos/${repo}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "ongia-events-desk", ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 401) throw new GitHubError("GitHub did not accept the website key. It may have expired: make a new one and put it in Netlify as CFAOC_GITHUB_TOKEN.", 401);
    if (res.status === 403) throw new GitHubError("The website key is not allowed to change the website. It needs Contents: Read and write on cfaoc-symposium.", 403);
    if (res.status === 404) throw new GitHubError(`GitHub could not find ${repo}, or the key cannot see it.`, 404);
    if (!res.ok) throw new GitHubError(`GitHub said ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
    return res.json();
  };
  return { call, repo };
}

/** The website as it stands on the branch: its head commit, every file's id, events.json and this page's desk file. */
export async function readSite(gh, page, branch = BRANCH()) {
  const ref = await gh.call("GET", `/git/ref/heads/${encodeURIComponent(branch)}`);
  const head = ref.object.sha;
  const commit = await gh.call("GET", `/git/commits/${head}`);
  const tree = await gh.call("GET", `/git/trees/${commit.tree.sha}?recursive=1`);
  const files = new Map(tree.tree.filter((e) => e.type === "blob").map((e) => [e.path, e.sha]));
  const blob = async (path) => {
    if (!files.has(path)) return null;
    const b = await gh.call("GET", `/git/blobs/${files.get(path)}`);
    return Buffer.from(b.content, "base64").toString("utf8");
  };
  const eventsText = await blob("events.json");
  const deskText = await blob(`desk/${page}.json`);
  return { head, treeSha: commit.tree.sha, files, events: eventsText ? JSON.parse(eventsText) : null, deskText, desk: deskText ? JSON.parse(deskText) : null };
}

/** What would change on the website for this page: the files to write and remove, and the summary. */
export function planChanges(site, built) {
  const deskPath = `desk/${built.page}.json`;
  const writes = [];
  if (site.deskText !== built.text) writes.push({ path: deskPath, bytes: Buffer.from(built.text) });
  const prefix = `static/assets/speakers/${built.page}/`;
  const photoChanges = { added: [], replaced: [], removed: [] };
  const keep = new Set();
  for (const ph of built.photos) {
    keep.add(ph.path);
    const had = site.files.get(ph.path);
    if (had === gitBlobSha(ph.bytes)) continue;
    writes.push({ path: ph.path, bytes: ph.bytes });
    (had ? photoChanges.replaced : photoChanges.added).push(ph.path);
  }
  // A photo whose presenter is no longer public (or no longer agreed to photos) comes down.
  const removes = [...site.files.keys()].filter((p) => p.startsWith(prefix) && !keep.has(p));
  photoChanges.removed.push(...removes);
  const before = shownEvent(site.events, built.page, site.desk);
  const after = shownEvent(site.events, built.page, built.file);
  const summary = summarize({ before: before.en, after: after.en, beforeFr: before.fr, afterFr: after.fr, people: built.people, photoChanges, firstTime: !site.desk, newPage: !before.existed && !site.desk });
  return { writes, removes, summary, unchanged: !writes.length && !removes.length };
}

/**
 * One commit on the branch with the writes and removals, and nothing else. If someone else pushed in the meantime the
 * branch moves under us; the caller reads the site again and retries.
 */
export async function commitChanges(gh, site, { writes, removes }, message, branch = BRANCH()) {
  const tree = [];
  for (const w of writes) {
    const blob = await gh.call("POST", "/git/blobs", { content: Buffer.from(w.bytes).toString("base64"), encoding: "base64" });
    tree.push({ path: w.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  for (const path of removes) tree.push({ path, mode: "100644", type: "blob", sha: null });
  const newTree = await gh.call("POST", "/git/trees", { base_tree: site.treeSha, tree });
  const commit = await gh.call("POST", "/git/commits", { message, tree: newTree.sha, parents: [site.head] });
  await gh.call("PATCH", `/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.sha, force: false });
  return { sha: commit.sha, url: `https://github.com/${gh.repo}/commit/${commit.sha}` };
}

/* ------------------------------------------------------------------ French */

const FR_SYSTEM = `You translate short texts for a Canadian bilingual event website from English into Canadian French (français canadien), for professionals in law enforcement, corrections, border services and community safety.

Keep names of people, organizations, units and places as they are, except where an organization has an official French name you are sure of (for example "Royal Canadian Mounted Police" is "Gendarmerie royale du Canada"; "Canada Border Services Agency" is "Agence des services frontaliers du Canada"). Keep rank abbreviations in their usual French form (Cpl. becomes Cap., Cst. becomes Gend., Sgt. becomes Sgt). Keep the meaning, the tone and the paragraph breaks; do not add or drop facts. Use the typographic conventions of Quebec French, with a non-breaking space before : ; ? ! only where Canadian French uses them. Give an empty string for any text that is empty.`;

const FR_SCHEMA = {
  type: "object", additionalProperties: false, required: ["title", "talk", "bio", "outline"],
  properties: { title: { type: "string" }, talk: { type: "string" }, bio: { type: "string" }, outline: { type: "string" } },
};

/** A French draft of one presenter's public words. Throws with a reason staff can act on. `client` is for tests. */
export async function draftFrench({ title = "", talk = "", bio = "", outline = "" }, { client = null } = {}) {
  if (!client && !anthropicKey()) throw new Error("The desk has no Claude key, so it cannot draft French. Type the French in by hand.");
  const api = client ?? new Anthropic({ apiKey: anthropicKey() });
  const stream = api.beta.messages.stream({
    model: "claude-opus-5-5",
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: FR_SCHEMA } },
    system: FR_SYSTEM,
    messages: [{ role: "user", content: `Translate each of these into Canadian French. Paragraphs are separated by blank lines; keep them.\n\n${JSON.stringify({ title, talk, bio, outline }, null, 2)}` }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("Claude declined to translate this. Type the French in by hand.");
  if (message.stop_reason === "max_tokens") throw new Error("The text was too long to translate in one go. Type the French in by hand.");
  let raw;
  try { raw = JSON.parse(message.content.filter((b) => b.type === "text").map((b) => b.text).join("")); }
  catch { throw new Error("Claude's French could not be read. Try again."); }
  return { titleFr: text(raw.title, 160), talkFr: text(raw.talk, 300), bioFr: text(raw.bio, 6000), outlineFr: text(raw.outline, 6000) };
}
