import { json, fail, requireAdmin, editGuard, adminWho, text } from "./lib/http.mjs";
import { getEvent } from "./lib/store.mjs";
import { KINDS, reportsOf, putReports, standingOf, putStanding, versionPdf, fileNameOf, factsFor, halfBack, fileReport } from "./lib/reports.mjs";
import { randomBytes } from "node:crypto";

/**
 * The survey's reports on an RBH event (Andrew 30 Oct 2026): the Executive Summary and the infographic, in English and
 * French, filed to OneDrive and listed on the Survey tab, and changed by asking Claude ("I could just type it right in
 * that window … and then it could regenerate it").
 *
 *   GET  /api/reports?event=…                               both reports: versions, requests, the chat, where they're filed
 *   GET  /api/reports?event=…&kind=exec|info&lang=en|fr&pdf=1[&v=n]   the PDF
 *   POST /api/reports?event=…&kind=…&build=1                 make it now, with every answer so far
 *   POST /api/reports?event=…&kind=…&ask=1                   { text, lang: both|en|fr, always } a change, kept and applied on every rebuild
 *   POST /api/reports?event=…&kind=…&remove=<id>             stop applying one of those changes
 *   POST /api/reports?event=…&kind=…&revert=<n>              go back to version n
 *   POST /api/reports?event=…&kind=…&final=1                 { final } stop (or restart) the nightly updates
 *   GET  /api/reports?standing=1                             the requests kept for every RBH report
 *   POST /api/reports?standing=1&kind=…&remove=<id>
 * Making a report takes Claude a minute or two, so it runs in reports-build-background and the page watches for it.
 */
export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return fail(denied, 401);
  const url = new URL(req.url);
  const q = (k) => url.searchParams.get(k);
  if (q("standing")) return standing(req, q);
  const event = await getEvent(q("event"));
  if (!event) return fail("No such event.", 404);
  if (event.kind !== "rbh") return fail("Executive summaries are made for RBH events.", 409);
  const kind = q("kind");
  if (req.method === "GET" && q("pdf")) {
    if (!KINDS[kind]) return fail("Which report?");
    const lang = q("lang") === "fr" ? "fr" : "en";
    const bytes = await versionPdf(event, kind, lang, q("v") ? Number(q("v")) : null);
    if (!bytes) return fail("That report hasn't been made yet.", 404);
    return new Response(bytes, { headers: { "content-type": "application/pdf", "cache-control": "no-store",
      "content-disposition": `inline; filename="${encodeURIComponent(fileNameOf(kind, lang))}"; filename*=UTF-8''${encodeURIComponent(fileNameOf(kind, lang))}` } });
  }
  if (req.method === "GET") return json(await state(event));
  if (req.method !== "POST" || !KINDS[kind]) return fail("Which report?");
  const viewOnly = editGuard(req, event);
  if (viewOnly) return viewOnly;
  const body = await req.json().catch(() => ({}));
  const all = await reportsOf(event.id);
  const r = { versions: [], current: 0, requests: [], chat: [], final: false, ...(all[kind] ?? {}) };
  const save = (next) => putReports(event.id, { ...all, [kind]: next });
  const who = adminWho(req).email || "desk";
  const start = async (job) => {
    await save({ ...r, building: { at: new Date().toISOString(), why: job.reason }, error: null, ...(job.patch ?? {}) });
    await kick(req, { event: event.id, kind, ...job, patch: undefined });
  };
  if (q("build")) {
    if (r.building && Date.now() - Date.parse(r.building.at) < 6 * 60000) return fail("It is being made now.", 409);
    await start({ reason: "asked" });
  } else if (q("ask")) {
    const said = text(body.text, 1500);
    if (!said) return fail("Say what to change.");
    if (!r.versions.length) return fail("Make the report first; then ask for changes.", 409);
    const lang = ["en", "fr"].includes(body.lang) ? body.lang : "both";
    const id = randomBytes(4).toString("hex");
    if (body.always) await putStanding(kind, [...(await standingOf(kind)), { id, text: said, at: new Date().toISOString(), by: who, from: event.title }]);
    await start({ reason: "asked-change", ask: said, lang, patch: { requests: body.always ? r.requests : [...r.requests, { id, text: said, lang, at: new Date().toISOString(), by: who }],
      chat: [...r.chat, { who: "me", text: said, lang, always: !!body.always, at: new Date().toISOString() }].slice(-80), final: false } });
  } else if (q("remove")) {
    if (!r.requests.some((x) => x.id === q("remove"))) return fail("No such change.", 404);
    await start({ reason: "asked-change", lang: "both", patch: { requests: r.requests.filter((x) => x.id !== q("remove")), final: false } });
  } else if (q("revert")) {
    const n = Number(q("revert"));
    if (!r.versions.some((v) => v.n === n)) return fail("No such version.", 404);
    await save({ ...r, current: n, chat: [...r.chat, { who: "claude", text: `Back to version ${n}.`, at: new Date().toISOString(), version: n }] });
    await fileReport(event, kind).catch(() => {});
  } else if (q("final")) {
    await save({ ...r, final: !!body.final, finalAt: body.final ? new Date().toISOString() : null });
  } else return fail("Expected build, ask, remove, revert or final.");
  return json(await state(event));
};

/** Start the background maker. Locally (tests) the dev server answers it the same way Netlify does. */
async function kick(req, job) {
  const origin = new URL(req.url).origin;
  await fetch(`${origin}/api/reports-build-background`, { method: "POST", headers: { "x-admin-key": req.headers.get("x-admin-key") ?? "", "content-type": "application/json" }, body: JSON.stringify(job) }).catch(() => {});
}

async function state(event) {
  const [all, f] = await Promise.all([reportsOf(event.id), factsFor(event)]);
  const one = (kind) => {
    const r = all[kind] ?? {};
    const cur = r.versions?.find((v) => v.n === r.current);
    return { name: KINDS[kind], made: !!cur, current: r.current ?? 0, final: !!r.final, finalAt: r.finalAt ?? null, building: r.building ?? null, error: r.error ?? null,
      version: cur ? { n: cur.n, at: cur.at, reason: cur.reason, answered: cur.answered, invited: cur.invited } : null,
      versions: (r.versions ?? []).map((v) => ({ n: v.n, at: v.at, reason: v.reason, answered: v.answered })), requests: r.requests ?? [], chat: r.chat ?? [], filed: r.filed ?? null,
      newSince: cur ? Math.max(0, f.answered - cur.answered) : 0 };
  };
  return { answered: f.answered, invited: f.invited, half: halfBack(f), open: !!event.survey?.open, folder: !!event.sharePointFolder,
    reports: Object.fromEntries(Object.keys(KINDS).map((k) => [k, one(k)])) };
}

async function standing(req, q) {
  if (req.method === "GET") return json({ exec: await standingOf("exec"), info: await standingOf("info") });
  const kind = q("kind");
  if (req.method !== "POST" || !KINDS[kind] || !q("remove")) return fail("Which request?");
  await putStanding(kind, (await standingOf(kind)).filter((x) => x.id !== q("remove")));
  return json({ exec: await standingOf("exec"), info: await standingOf("info") });
}
