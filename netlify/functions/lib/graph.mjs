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
const GRAPH = "https://graph.microsoft.com/v1.0";

export function graphConfigured() {
  return Boolean(process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);
}

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

async function graph(token, path, init = {}) {
  const res = await fetch(`${GRAPH}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (res.status === 204) return {};
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`${json.error?.code ?? res.status}: ${json.error?.message ?? "Graph request failed"}`);
    err.code = json.error?.code;
    err.status = res.status;
    throw err;
  }
  return json;
}

/** The default document library ("Shared Documents") of the configured site. */
async function driveId(token) {
  if (process.env.MS_DRIVE_ID) return process.env.MS_DRIVE_ID;
  const u = new URL(SITE_URL);
  const site = await graph(token, `/sites/${u.hostname}:${u.pathname}`);
  const drive = await graph(token, `/sites/${site.id}/drive?$select=id`);
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

  const personFolder = safeFileName(`${presenter.first} ${presenter.last}`);
  const folder = await ensureChildFolder(token, drive, eventFolder, personFolder);
  const base = `${eventFolder}/${personFolder}`;
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
