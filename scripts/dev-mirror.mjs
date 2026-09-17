// Dev mirror: serves the LOCAL public/ files and proxies /api/* to production, so a
// headless browser can drive a page you just edited against real live data.
//   node scripts/dev-mirror.mjs   then open http://127.0.0.1:8900/admin.html
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const SITE = "https://ongia-presenter-agreements.netlify.app";
const LOCAL = new URL("../public", import.meta.url).pathname;
const TYPES = { html: "text/html", css: "text/css", js: "text/javascript", svg: "image/svg+xml",
                png: "image/png", jpg: "image/jpeg", ico: "image/x-icon", json: "application/json" };
createServer(async (req, res) => {
  const path = req.url.split("?")[0];
  if (!path.startsWith("/api/")) {
    try {
      const buf = await readFile(LOCAL + (path === "/" ? "/index.html" : path));
      res.writeHead(200, { "content-type": TYPES[path.split(".").pop()] || "application/octet-stream" });
      return res.end(buf);
    } catch { /* not checked in — fall through to the live site */ }
  }
  const headers = {};
  for (const h of ["x-admin-key", "content-type", "accept"]) if (req.headers[h]) headers[h] = req.headers[h];
  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks = []; for await (const c of req) chunks.push(c); body = Buffer.concat(chunks);
  }
  try {
    const up = await fetch(SITE + req.url, { method: req.method, headers, body });
    const buf = Buffer.from(await up.arrayBuffer());
    res.writeHead(up.status, { "content-type": up.headers.get("content-type") || "application/octet-stream" });
    res.end(buf);
  } catch (err) { res.writeHead(502); res.end(String(err)); }
}).listen(8900, "127.0.0.1", () => console.log("local pages + live api on 8900"));
