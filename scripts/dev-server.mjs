/**
 * Local stand-in for Netlify: serves public/ and runs the functions in
 * netlify/functions/ against an in-memory Blobs store. No email or SharePoint
 * unless the real environment variables are set — sends are recorded as skipped.
 *
 *   node scripts/dev-server.mjs [port]      admin key: "testkey"
 */
import { register } from "node:module";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./mock-hooks.mjs", import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2] || process.env.PORT || 8788);
process.env.ADMIN_KEY ||= "testkey";
process.env.APP_URL ||= `http://localhost:${PORT}`;

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
const fns = new Map();
async function fn(name) {
  if (!/^[a-z-]+$/.test(name)) return null;
  if (!fns.has(name)) {
    try { fns.set(name, (await import(path.join(ROOT, "netlify/functions", `${name}.mjs`))).default); }
    catch (e) { if (e.code === "ERR_MODULE_NOT_FOUND") return null; throw e; }
  }
  return fns.get(name);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname.startsWith("/api/")) {
      const handler = await fn(url.pathname.slice(5).split("/")[0]);
      if (!handler) { res.writeHead(404); return res.end("no such function"); }
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : null;
      const request = new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body, duplex: "half" });
      const out = await handler(request);
      res.writeHead(out.status, Object.fromEntries(out.headers));
      return res.end(Buffer.from(await out.arrayBuffer()));
    }
    let file = url.pathname === "/" ? "/index.html" : url.pathname.startsWith("/a/") ? "/agreement.html" : url.pathname;
    const full = path.join(ROOT, "public", path.normalize(file));
    if (!full.startsWith(path.join(ROOT, "public"))) { res.writeHead(403); return res.end(); }
    try { await stat(full); } catch { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(full)] ?? "application/octet-stream" });
    res.end(await readFile(full));
  } catch (e) {
    console.error(e);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
}).listen(PORT, () => console.log(`ONGIA desk (local, mock store) → http://localhost:${PORT}/admin.html  key: ${process.env.ADMIN_KEY}`));
