import { requireAdmin } from "./lib/http.mjs";
import { getMeta, putMeta, listClaimIds, getClaim } from "./lib/store.mjs";
import { expenseDrive } from "./lib/graph.mjs";
import { expenseFolder } from "./lib/expensefile.mjs";
import { readFileFacts, newName, uniqueInFolder, READABLE } from "./lib/handrename.mjs";

/**
 * The board's hand-filed expense files for 2025 and 2026, given names that say whose, which claim and (for a receipt)
 * the merchant (Andrew 16 Nov 2026). Two steps, each on the server:
 *
 *   POST /api/expense-hand-background?mode=plan    Claude reads each file and the new names are worked out; nothing is
 *                                                  renamed. Kept in the desk's store ("expense-hand"), read with
 *                                                  GET /api/expense-rename?hand=1. Picks up where it left off.
 *   POST /api/expense-hand-background?mode=apply   rename them as planned
 *
 * Files the Briefing Room filed are left to it (they're on their claims' records); so are the 2022 files kept in the
 * 2025 folder, and anything Claude couldn't place.
 */
const BUDGET = 13 * 60 * 1000, KEY = "expense-hand", MAX_HOPS = 6;

export default async (req) => {
  if (requireAdmin(req)) return new Response("Not authorized.", { status: 401 });
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") === "apply" ? "apply" : "plan";
  const hop = Number(url.searchParams.get("hop") || 0);
  const deadline = Date.now() + BUDGET;
  const state = (await getMeta(KEY)) ?? { items: {} };
  state.items ??= {};
  const g = await expenseDrive();
  if (!g) { await putMeta(KEY, { ...state, error: "Microsoft isn't set up on this site." }); return new Response(null, { status: 202 }); }

  if (mode === "plan") {
    const scan = (await getMeta("expense-scan")) ?? { files: [] };
    const base = expenseFolder();
    // The Briefing Room's own files, by id: they keep the names it gives them.
    const desk = new Set();
    for (const id of await listClaimIds()) {
      const f = (await getClaim(id))?.filed;
      if (!f) continue;
      for (const x of [f.xlsx, f.pdf, ...Object.values(f.receipts ?? {})]) if (x?.id) desk.add(x.id);
    }
    const inScope = scan.files.filter((f) => (f.path.startsWith(`${base}/2025/`) || f.path.startsWith(`${base}/2026/`)) && !f.path.startsWith(`${base}/2025/2022/`) && !desk.has(f.id));
    state.total = inScope.length; state.started ??= new Date().toISOString(); state.mode = "plan";
    const todo = inScope.filter((f) => !state.items[f.id]?.facts && !state.items[f.id]?.error);
    const work = async (f) => {
      const ext = (f.name.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? "").toLowerCase();
      const type = READABLE[ext] ?? "";
      try {
        const bytes = type ? await g.download(f.id).catch(() => null) : null;
        const facts = await readFileFacts(f, bytes, bytes ? type : "");
        state.items[f.id] = { id: f.id, path: f.path, from: f.name, facts, seen: !!bytes };
      } catch (e) { state.items[f.id] = { id: f.id, path: f.path, from: f.name, error: String(e.message).slice(0, 200) }; }
    };
    for (let i = 0; i < todo.length && Date.now() < deadline; i += 4) {
      await Promise.all(todo.slice(i, i + 4).map(work));
      if (i % 40 === 0) await putMeta(KEY, state);
    }
    // The names, folder by folder, so two files never end up with the same one.
    const byFolder = new Map();
    for (const it of Object.values(state.items)) {
      const folder = it.path.split("/").slice(0, -1).join("/");
      it.to = it.facts ? newName(it.facts, it.from) : null;
      if (it.to === it.from) it.to = null;
      byFolder.set(folder, [...(byFolder.get(folder) ?? []), it]);
    }
    for (const [folder, items] of byFolder) {
      const others = scan.files.filter((f) => f.path.startsWith(`${folder}/`) && !f.path.slice(folder.length + 1).includes("/") && !state.items[f.id]).map((f) => f.name);
      uniqueInFolder(items, [...others, ...items.map((x) => x.from)]);
    }
    const left = inScope.filter((f) => !state.items[f.id]).length;
    state.done = left === 0; state.left = left; state.at = new Date().toISOString();
    await putMeta(KEY, state);
    if (left && hop < MAX_HOPS) await fetch(`${url.origin}/api/expense-hand-background?mode=plan&hop=${hop + 1}`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "" } }).catch(() => {});
    return new Response(null, { status: 202 });
  }

  // Apply: rename each as planned, once.
  state.mode = "apply";
  for (const it of Object.values(state.items)) {
    if (Date.now() > deadline) break;
    if (!it.to || it.renamed || it.renameError) continue;
    try { await g.rename(it.id, it.to); it.renamed = new Date().toISOString(); }
    catch (e) {
      if (e.status === 409) { const alt = it.to.replace(/(\.[A-Za-z0-9]+)?$/, (x) => ` (2)${x}`); try { await g.rename(it.id, alt); it.to = alt; it.renamed = new Date().toISOString(); continue; } catch {} }
      it.renameError = String(e.message).slice(0, 200);
    }
  }
  const left = Object.values(state.items).filter((x) => x.to && !x.renamed && !x.renameError).length;
  state.applied = left === 0; state.at = new Date().toISOString();
  await putMeta(KEY, state);
  if (left && hop < MAX_HOPS) await fetch(`${url.origin}/api/expense-hand-background?mode=apply&hop=${hop + 1}`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY ?? "" } }).catch(() => {});
  return new Response(null, { status: 202 });
};
