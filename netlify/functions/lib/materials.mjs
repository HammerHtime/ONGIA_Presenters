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
  if (!folder) return { skipped: true, reason: `The materials folder "${event.materialsFolderPath || event.sharePointFolder}" wasn't found in the library. Uploads are read from the event folder unless a separate materials folder is set on the event.` };

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
 * Where uploads land. SharePoint's "Request files" puts them straight into the
 * folder the link was made on — for ONGIA that is the event folder itself —
 * so that is the default, with an optional override for events that keep a
 * separate drop folder. The app's identity can list folders but not their
 * sharing links, so it cannot work this out from the link; it is told.
 */
async function findRequestFolder(event, token) {
  const path = normaliseFolder(event.materialsFolderPath || event.sharePointFolder);
  if (!path) return null;
  const drive = await driveIdFor(token);
  const item = await graphGet(token, `/drives/${drive}/root:/${enc(path)}?$select=id,name,webUrl,folder`).catch(() => null);
  if (!item?.folder) return null;
  return { id: item.id, driveId: drive, name: item.name, webUrl: item.webUrl, path };
}

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
