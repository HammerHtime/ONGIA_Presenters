import { graphConfigured, graphAccessToken, graphGet, driveIdFor, normaliseFolder } from "./graph.mjs";

/**
 * Who has actually sent their slides?
 *
 * Presenters upload through a SharePoint "Request files" link, and SharePoint
 * prefixes each upload with the name the uploader typed ("Jordan Testerson_
 * deck.pptx"). So the app can look inside the request folder and match files
 * to presenters by name — no login for the presenter, no extra step for the
 * coordinator. Anything it can't place is listed as unmatched so a person can.
 */
export async function scanMaterials(event, presenters) {
  if (!event.materialsUploadUrl) return { skipped: true, reason: "No materials link on this event." };
  if (!graphConfigured()) return { skipped: true, reason: "Microsoft credentials are not set." };

  const token = await graphAccessToken();
  const folder = await findRequestFolder(event, token);
  if (!folder) return { skipped: true, reason: `Couldn't find which folder the materials link belongs to. It should be the event folder, its parent, or a folder inside either. Checked: ${(event.materialsFolderSearch?.tried ?? []).join("; ") || "nothing reachable"}.` };

  const files = [];
  let next = `/drives/${folder.driveId}/items/${folder.id}/children?$select=id,name,size,lastModifiedDateTime,webUrl,file,folder&$top=200`;
  while (next) {
    const page = await graphGet(token, next);
    for (const it of page.value ?? []) if (it.file) files.push({ id: it.id, name: it.name, size: it.size, at: it.lastModifiedDateTime, url: it.webUrl });
    next = page["@odata.nextLink"] ? page["@odata.nextLink"].replace("https://graph.microsoft.com/v1.0", "") : null;
  }

  const byPresenter = {};
  const unmatched = [];
  for (const f of files) {
    const who = matchPresenter(f.name, presenters);
    if (who) (byPresenter[who.id] ??= []).push(f);
    else unmatched.push(f);
  }
  for (const list of Object.values(byPresenter)) list.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));

  return {
    folder: { name: folder.name, url: folder.webUrl, path: folder.path },
    total: files.length,
    byPresenter,
    unmatched,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * A Request-files link deliberately can't be resolved to its folder (it grants
 * no reading), so work backwards: the event folder, the folders inside it and
 * its siblings are checked for a sharing link that matches. The answer is
 * cached on the event so later scans are a single call.
 */
async function findRequestFolder(event, token) {
  const target = linkKey(event.materialsUploadUrl);
  if (event.materialsFolder?.id && event.materialsFolder.link === target) return event.materialsFolder;
  const drive = await driveIdFor(token);
  const base = normaliseFolder(event.sharePointFolder);
  if (!base) return null;

  const candidates = [];
  const eventFolder = await graphGet(token, `/drives/${drive}/root:/${enc(base)}?$select=id,name,webUrl,parentReference`).catch(() => null);
  if (eventFolder) {
    candidates.push({ ...eventFolder, path: base });
    const kids = await graphGet(token, `/drives/${drive}/items/${eventFolder.id}/children?$select=id,name,webUrl,folder&$top=200`).catch(() => ({ value: [] }));
    for (const k of kids.value ?? []) if (k.folder) candidates.push({ ...k, path: `${base}/${k.name}` });
    const parentPath = base.includes("/") ? base.slice(0, base.lastIndexOf("/")) : "";
    if (parentPath) {
      const parent = await graphGet(token, `/drives/${drive}/root:/${enc(parentPath)}?$select=id,name,webUrl`).catch(() => null);
      if (parent) candidates.push({ ...parent, path: parentPath });
      const sibs = await graphGet(token, `/drives/${drive}/root:/${enc(parentPath)}:/children?$select=id,name,webUrl,folder&$top=200`).catch(() => ({ value: [] }));
      for (const k of sibs.value ?? []) if (k.folder && k.id !== eventFolder.id) candidates.push({ ...k, path: `${parentPath}/${k.name}` });
    }
  }
  const tried = [];
  for (const c of candidates) {
    let perms;
    try { perms = await graphGet(token, `/drives/${drive}/items/${c.id}/permissions?$select=id,link`); }
    catch (e) { tried.push(`${c.path}: ${e.code ?? e.status}`); continue; }
    const links = (perms.value ?? []).filter((p) => p.link?.webUrl);
    tried.push(`${c.path}: ${links.length} link${links.length === 1 ? "" : "s"}`);
    if (links.some((p) => linkKey(p.link.webUrl) === target)) {
      event.materialsFolder = { id: c.id, driveId: drive, name: c.name, webUrl: c.webUrl, path: c.path, link: target };
      return event.materialsFolder;
    }
  }
  event.materialsFolderSearch = { at: new Date().toISOString(), tried };
  return null;
}

// Sharing links compare on their path; the ?e= tail varies between copies.
const linkKey = (u) => { try { const x = new URL(u); return `${x.hostname}${x.pathname}`.toLowerCase(); } catch { return String(u); } };
const enc = (p) => p.split("/").map(encodeURIComponent).join("/");

const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * "Jordan Testerson_deck.pptx" → Jordan. A bare surname counts only when it is
 * unambiguous and at least three letters, so "Lee" doesn't grab every file.
 */
export function matchPresenter(fileName, presenters) {
  const n = fold(fileName);
  const full = presenters.filter((p) => n.startsWith(fold(`${p.first} ${p.last}`)) || n.startsWith(fold(`${p.last} ${p.first}`)));
  if (full.length === 1) return full[0];
  if (full.length > 1) return null;
  const byLast = presenters.filter((p) => fold(p.last).length >= 3 && new RegExp(`(^| )${fold(p.last)}( |$)`).test(n));
  return byLast.length === 1 ? byLast[0] : null;
}

/** What the dashboard shows for one presenter, combining the scan with manual flags. */
export function materialsStatus(presenter, scan) {
  const files = scan?.byPresenter?.[presenter.id] ?? [];
  const m = presenter.materials ?? {};
  const latest = files[0]?.at ?? null;
  return {
    files: files.length,
    latest,
    draft: m.draftAt ?? (latest ? latest : null),
    final: m.finalAt ?? null,
    draftManual: Boolean(m.draftAt),
    finalManual: Boolean(m.finalAt),
  };
}
