import { requireInternal } from "./lib/http.mjs";
import { putMeta } from "./lib/store.mjs";
import { expenseDrive } from "./lib/graph.mjs";
import { expenseFolder } from "./lib/expensefile.mjs";

/**
 * Every file in the board's expense folders, old and new, listed for renaming (Andrew 16 Nov 2026: "rename all of them.
 * Also, name the receipts … to correspond to which claim and last name and merchant"). Walks the folders and keeps the
 * list in the desk's store (meta "expense-scan"); GET /api/expense-rename?scan=1 reads it. Changes nothing.
 *
 *   POST /api/expense-scan-background   (with the desk's key)
 */
export const ROOTS = () => [expenseFolder(), expenseFolder().replace(/Treasurer \(2025-2026\) \(New\)/, "Treasurer (Old - 2021-2024)")];

export default async (req) => {
  if (requireInternal(req)) return new Response("Not authorized.", { status: 401 });
  const started = new Date().toISOString();
  await putMeta("expense-scan", { started, done: false, files: [] });
  const files = [], errors = [];
  try {
    const g = await expenseDrive();
    if (!g) throw new Error("Microsoft isn't set up on this site.");
    const queue = [...ROOTS()];
    while (queue.length) {
      const folder = queue.shift();
      let kids = null;
      try { kids = await g.children(folder); } catch (e) { errors.push(`${folder}: ${e.message}`); continue; }
      for (const k of kids ?? []) {
        if (k.folder) queue.push(`${folder}/${k.name}`);
        else files.push({ id: k.id, path: `${folder}/${k.name}`, name: k.name });
      }
    }
  } catch (e) { errors.push(e.message); }
  await putMeta("expense-scan", { started, finished: new Date().toISOString(), done: true, roots: ROOTS(), files, errors });
  return new Response(null, { status: 202 });
};
