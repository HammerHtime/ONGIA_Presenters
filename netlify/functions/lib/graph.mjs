import { safeFileName } from "./ids.mjs";

/**
 * Files the final agreement into the event's SharePoint folder as the app's
 * own identity (Entra app registration, Sites.Selected, client credentials).
 *
 * Layout inside the folder the coordinator nominates on the event:
 *   <event folder>/<First Last>/<Last>_Presenter Agreement.pdf
 *   <event folder>/<First Last>/<Last>_Headshot.<ext>
 *
 * The event folder itself must already exist — it is Andrew's convention
 * (year, then city) and the app should never invent one. Missing credentials
 * skip the filing rather than fail the approval; the dashboard shows it.
 */
const SITE_URL = process.env.MS_SITE_URL || "https://ongia.sharepoint.com/sites/ONGIABoardMembersFiles";
// The Graph site id for the URL above; resolving by path needs no extra rights,
// but a known id avoids one round trip and one more place to be denied.
const SITE_ID = process.env.MS_SITE_ID || "ongia.sharepoint.com,79a316dc-241e-4031-b1c1-a878fbe2fdfe,98028b36-6484-490d-9264-800106bb3616";
const GRAPH = "https://graph.microsoft.com/v1.0";

export function graphConfigured() {
  return Boolean(process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);
}

export const graphAccessToken = () => accessToken();
export const graphGet = (token, path) => graph(token, path);
export const driveIdFor = (token) => driveId(token);

async function accessToken() {
  const body = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    client_secret: process.env.MS_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(`https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Microsoft sign-in failed: ${json.error_description ?? json.error ?? res.status}`);
  return json.access_token;
}

/** The app roles Microsoft put in the token — empty means admin consent was never granted. */
export function tokenRoles(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return payload.roles ?? [];
  } catch {
    return [];
  }
}

async function graph(token, path, init = {}) {
  const res = await fetch(`${GRAPH}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (res.status === 204) return {};
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`${json.error?.code ?? res.status}: ${json.error?.message ?? "Graph request failed"} [HTTP ${res.status} ${path.split("?")[0]}]`);
    err.code = json.error?.code;
    err.status = res.status;
    throw err;
  }
  return json;
}

/** The default document library ("Shared Documents") of the configured site. */
async function driveId(token) {
  if (process.env.MS_DRIVE_ID) return process.env.MS_DRIVE_ID;
  let siteId = SITE_ID;
  if (!siteId) {
    const u = new URL(SITE_URL);
    siteId = (await graph(token, `/sites/${u.hostname}:${u.pathname}`)).id;
  }
  const drive = await graph(token, `/sites/${siteId}/drive?$select=id`);
  return drive.id;
}

/**
 * Paths are typed by people, so accept the forms they naturally use:
 * "Shared Documents/ONGIA Board/…", "Documents/ONGIA Board/…", "/ONGIA Board/…".
 * All mean the same place in the default library.
 */
export function normaliseFolder(path) {
  let p = String(path ?? "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  p = p.replace(/^(Shared Documents|Documents)\//i, "");
  return p.split("/").map((seg) => seg.trim()).filter(Boolean).join("/");
}

const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

/**
 * Create a Request-files link on a folder: anyone with it can add files and
 * see nothing. Returns { url, id }. The folder must already exist.
 */
export async function createUploadLink(folderPath) {
  if (!graphConfigured()) throw new Error("Microsoft credentials are not set on this site.");
  const path = normaliseFolder(folderPath);
  if (!path) throw new Error("No folder to create the link on.");
  const token = await accessToken();
  const drive = await driveId(token);
  const perm = await graph(token, `/drives/${drive}/root:/${encodePath(path)}:/createLink`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "createOnly", scope: "anonymous" }),
  });
  if (perm.link?.type !== "createOnly") throw new Error(`SharePoint returned a "${perm.link?.type}" link instead of an upload-only one; not using it.`);
  return { url: perm.link.webUrl, id: perm.id };
}

/**
 * What kind of sharing link is this? Presenters only ever receive the
 * materials link, so it must be a SharePoint "Request files" link — Graph
 * reports those as type "createOnly": upload allowed, nothing visible.
 * Anything else would let a presenter browse the folder.
 *
 * Returns { verdict: "upload-only" | "exposes-folder" | "unverified", type, reason }.
 */
export async function inspectSharingLink(url) {
  const raw = String(url ?? "").trim();
  if (!raw) return { verdict: "none" };
  let u;
  try { u = new URL(raw); } catch { return { verdict: "unverified", reason: "Not a valid web address." }; }
  if (!/sharepoint\.com$/i.test(u.hostname) && !/1drv\.ms$/i.test(u.hostname)) {
    return { verdict: "unverified", reason: "Not a SharePoint/OneDrive link, so the app can't tell what it exposes." };
  }
  if (!graphConfigured()) return { verdict: "unverified", reason: "Microsoft credentials are not set, so the link couldn't be checked." };
  try {
    const token = await accessToken();
    const encoded = "u!" + Buffer.from(raw).toString("base64url");
    const perm = await graph(token, `/shares/${encoded}/permission?$select=id,roles,link`);
    const type = perm.link?.type ?? "";
    if (type === "createOnly") return { verdict: "upload-only", type };
    return { verdict: "exposes-folder", type, roles: perm.roles ?? [], scope: perm.link?.scope };
  } catch (e) {
    // A OneDrive-personal or another-site link is outside the app's grant; say so rather than guess.
    return { verdict: "unverified", reason: `Couldn't read the link's permissions (${e.code ?? e.status ?? e.message}).` };
  }
}

/**
 * Coordinators paste what SharePoint gives them: a plain path, the address bar
 * URL of a folder, or a "Copy link" sharing URL (…/:f:/s/…). Turn any of them
 * into the library-relative path the filing code needs.
 */
export async function resolveFolderInput(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return { path: "", url: "" };
  if (!/^https?:\/\//i.test(raw)) return { path: normaliseFolder(raw), url: "" };

  const u = new URL(raw);
  // Address-bar style: /sites/<site>/Shared Documents/<folders> (often with ?id=… or RootFolder=…)
  const idParam = u.searchParams.get("id") || u.searchParams.get("RootFolder");
  const pathPart = decodeURIComponent(idParam || u.pathname);
  const m = pathPart.match(/\/(?:Shared Documents|Documents)\/(.+?)\/?$/i);
  if (m) return { path: normaliseFolder(m[1]), url: raw.split("?")[0] };

  // Sharing link — only Graph can say what it points at.
  if (/\/:f:\/|\/:u:\//.test(u.pathname)) {
    if (!graphConfigured()) throw new Error("That's a sharing link; the app needs its Microsoft credentials to resolve it — paste the folder path instead.");
    const token = await accessToken();
    const encoded = "u!" + Buffer.from(raw).toString("base64url");
    const item = await graph(token, `/shares/${encoded}/driveItem?$select=id,name,webUrl,folder,parentReference`);
    if (!item.folder) throw new Error("That link points at a file, not a folder.");
    const parentPath = decodeURIComponent((item.parentReference?.path ?? "").split("root:")[1] ?? "");
    return { path: normaliseFolder(`${parentPath}/${item.name}`), url: item.webUrl };
  }
  throw new Error("Couldn't read a folder from that link. Paste the folder path (e.g. ONGIA Board/ONGIA Training/2027/2027 Winnipeg) or its SharePoint URL.");
}

/**
 * Create the event's folder by ONGIA's convention — year, then "year City" —
 * inside the training library, creating the year folder if it is new.
 * Returns the library-relative path and its web URL.
 */
export async function ensureEventFolder(folderPath) {
  if (!graphConfigured()) throw new Error("Microsoft credentials are not set on this site.");
  const path = normaliseFolder(folderPath);
  if (!path) throw new Error("No folder path given.");
  const token = await accessToken();
  const drive = await driveId(token);
  const segments = path.split("/");
  let current = "";
  let item = null;
  for (const seg of segments) {
    const parent = current;
    current = current ? `${current}/${seg}` : seg;
    try {
      item = await graph(token, `/drives/${drive}/root:/${encodePath(current)}?$select=id,name,webUrl`);
    } catch (e) {
      if (e.status !== 404) throw e;
      if (!parent) throw new Error(`"${seg}" does not exist at the top of the library; the app only creates folders inside an existing top-level folder.`);
      // The year folder may already hold this event under a different word order.
      // Use it rather than making a near-duplicate beside it.
      const twin = await siblingFolderLike(token, drive, parent, seg);
      if (twin) { item = twin; current = `${parent}/${twin.name}`; continue; }
      item = await ensureChildFolder(token, drive, parent, seg);
    }
  }
  // `current` is the path as it really is in the library, which can differ from the
  // one asked for when an existing folder was reused.
  return { path: current, url: item.webUrl, created: true };
}

/**
 * A child folder of parentPath made of the same words as `name`, in any order
 * and any case — "Toronto 2026" for "2026 Toronto". Returns null if there is none.
 */
async function siblingFolderLike(token, drive, parentPath, name) {
  const key = (s) => String(s).toLowerCase().split(/[\s_-]+/).filter(Boolean).sort().join(" ");
  const want = key(name);
  if (!want) return null;
  try {
    const page = await graph(token, `/drives/${drive}/root:/${encodePath(parentPath)}:/children?$select=id,name,webUrl,folder&$top=200`);
    return (page.value ?? []).find((it) => it.folder && key(it.name) === want) ?? null;
  } catch {
    return null; // listing is a convenience; fall through to creating the folder
  }
}

async function ensureChildFolder(token, drive, parentPath, name) {
  try {
    return await graph(token, `/drives/${drive}/root:/${encodePath(parentPath)}:/children`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
    });
  } catch (e) {
    if (e.code === "nameAlreadyExists") {
      return graph(token, `/drives/${drive}/root:/${encodePath(`${parentPath}/${name}`)}`);
    }
    throw e;
  }
}

async function upload(token, drive, path, bytes, contentType) {
  const buf = Buffer.from(bytes);
  if (buf.length <= 4 * 1024 * 1024) {
    return graph(token, `/drives/${drive}/root:/${encodePath(path)}:/content?@microsoft.graph.conflictBehavior=replace`, {
      method: "PUT",
      headers: { "content-type": contentType },
      body: buf,
    });
  }
  // Larger files (a full-resolution headshot) go through an upload session.
  const session = await graph(token, `/drives/${drive}/root:/${encodePath(path)}:/createUploadSession`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }),
  });
  const chunk = 5 * 1024 * 1024;
  let item = null;
  for (let start = 0; start < buf.length; start += chunk) {
    const end = Math.min(start + chunk, buf.length);
    const res = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: { "content-length": String(end - start), "content-range": `bytes ${start}-${end - 1}/${buf.length}` },
      body: buf.subarray(start, end),
    });
    if (!res.ok && res.status !== 202) throw new Error(`Upload chunk failed (${res.status})`);
    if (res.status === 200 || res.status === 201) item = await res.json();
  }
  return item;
}

/**
 * File one presenter's final documents. Returns what the dashboard needs:
 * { folderUrl, files: [{name, url}] } or { skipped, reason }. Throws on a
 * real failure (bad folder, missing grant) so the caller can record it.
 */
/** Signed agreements are kept together, one folder per presenter and year. */
export const AGREEMENTS_FOLDER = "Presenter Agreements";

export async function fileAgreement({ event, presenter, pdf, headshot }) {
  if (!graphConfigured()) return { skipped: true, reason: "Microsoft credentials are not set on this site." };
  const eventFolder = normaliseFolder(event.sharePointFolder);
  if (!eventFolder) return { skipped: true, reason: "No SharePoint folder is set on this event." };

  const token = await accessToken();
  const drive = await driveId(token);

  // The event folder is theirs; we only confirm it exists.
  try {
    await graph(token, `/drives/${drive}/root:/${encodePath(eventFolder)}?$select=id,webUrl`);
  } catch (e) {
    if (e.status === 404) throw new Error(`The event folder "${eventFolder}" does not exist in the library. Create it first, or fix the path on the event.`);
    throw e;
  }

  // <event folder>/Presenter Agreements/<First Last> <year>/<Last>_Presenter Agreement.pdf
  const year = String(event.dayOne ?? "").slice(0, 4);
  const personFolder = safeFileName(`${presenter.first} ${presenter.last}${year ? ` ${year}` : ""}`);
  await ensureChildFolder(token, drive, eventFolder, AGREEMENTS_FOLDER);
  const folder = await ensureChildFolder(token, drive, `${eventFolder}/${AGREEMENTS_FOLDER}`, personFolder);
  const base = `${eventFolder}/${AGREEMENTS_FOLDER}/${personFolder}`;
  const last = safeFileName(presenter.last, "Presenter");

  const files = [];
  const pdfItem = await upload(token, drive, `${base}/${last}_Presenter Agreement.pdf`, pdf, "application/pdf");
  files.push({ name: pdfItem.name, url: pdfItem.webUrl });

  if (headshot?.bytes?.byteLength) {
    const ext = headshot.type === "image/png" ? "png" : "jpg";
    const shot = await upload(token, drive, `${base}/${last}_Headshot.${ext}`, headshot.bytes, headshot.type);
    files.push({ name: shot.name, url: shot.webUrl });
  }

  return { folderUrl: folder.webUrl, files, filedAt: new Date().toISOString() };
}

/**
 * Prove the sign-in and (optionally) an event folder before anyone approves
 * anything. Distinguishes "the app has no grant on the site" from "the folder
 * path is wrong", which need different people to fix them.
 */
export async function checkFolder(folderPath) {
  const token = await accessToken();
  const roles = tokenRoles(token);
  if (!roles.length) {
    throw new Error("Signed in, but the token carries no application permissions. In Entra → the app → API permissions, Sites.Selected must show a green tick under \"Grant admin consent for ONGIA\".");
  }
  let drive;
  try {
    drive = await driveId(token);
  } catch (e) {
    if (e.status === 403 || e.status === 401) throw new Error(`Signed in with ${roles.join(", ")}, but the site refused the app (${e.message}). The Sites.Selected grant on ${SITE_URL} may still be propagating.`);
    throw e;
  }
  const result = { site: SITE_URL, driveId: drive, roles };
  const folder = normaliseFolder(folderPath);
  if (folder) {
    try {
      const item = await graph(token, `/drives/${drive}/root:/${encodePath(folder)}?$select=id,name,webUrl,folder`);
      result.folder = { path: folder, url: item.webUrl, items: item.folder?.childCount ?? 0 };
    } catch (e) {
      if (e.status === 404) throw new Error(`Signed in and the library is reachable, but "${folder}" does not exist in it.`);
      throw e;
    }
  }
  return result;
}
