// A stand-in for GitHub's git data API, holding one repository in memory: refs, commits, trees and blobs, with the
// fast-forward check GitHub makes on a branch update. As a fetch for server tests, or over HTTP for screen tests:
//   node tests/fake-github.mjs <port> <token> <seed.json>
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

export function fakeGitHub(token) {
  const sha = (s) => createHash("sha1").update(s).digest("hex");
  const gitSha = (buf) => createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest("hex");
  const G = { blobs: new Map(), trees: new Map(), commits: new Map(), ref: null, calls: [] };
  function seed(files) {
    const tree = new Map();
    for (const [path, text] of Object.entries(files)) { const b = Buffer.from(text); const s = gitSha(b); G.blobs.set(s, b); tree.set(path, s); }
    const t = sha("tree" + Math.random()); G.trees.set(t, tree);
    const c = sha("commit" + Math.random()); G.commits.set(c, { tree: t, parents: [], message: "seed" });
    G.ref = c;
  }
  const filesAt = (commit = G.ref) => G.trees.get(G.commits.get(commit).tree);
  const read = (path, commit = G.ref) => { const s = filesAt(commit).get(path); return s ? G.blobs.get(s) : null; };
  const fakeFetch = async (url, init = {}) => {
    const u = new URL(url); const path = u.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, ""); const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    G.calls.push(`${method} ${path}`);
    if (init.headers?.authorization !== `Bearer ${token}`) return new Response("{}", { status: 401 });
    const out = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
    if (method === "GET" && path === "/git/ref/heads/main") return out({ object: { sha: G.ref } });
    let m;
    if (method === "GET" && (m = path.match(/^\/git\/commits\/(\w+)$/))) return out({ tree: { sha: G.commits.get(m[1]).tree } });
    if (method === "GET" && (m = path.match(/^\/git\/trees\/(\w+)$/))) return out({ tree: [...G.trees.get(m[1])].map(([p, s]) => ({ path: p, type: "blob", sha: s })) });
    if (method === "GET" && (m = path.match(/^\/git\/blobs\/(\w+)$/))) return out({ content: G.blobs.get(m[1]).toString("base64"), encoding: "base64" });
    if (method === "POST" && path === "/git/blobs") { const b = Buffer.from(body.content, "base64"); const s = gitSha(b); G.blobs.set(s, b); return out({ sha: s }, 201); }
    if (method === "POST" && path === "/git/trees") {
      const t = new Map(G.trees.get(body.base_tree));
      for (const e of body.tree) e.sha === null ? t.delete(e.path) : t.set(e.path, e.sha);
      const s = sha("tree" + [...t].join()); G.trees.set(s, t); return out({ sha: s }, 201);
    }
    if (method === "POST" && path === "/git/commits") { const s = sha("commit" + body.tree + body.parents.join() + Math.random()); G.commits.set(s, { tree: body.tree, parents: body.parents, message: body.message }); return out({ sha: s }, 201); }
    if (method === "PATCH" && path === "/git/refs/heads/main") {
      if (G.moveUnderneath) { G.moveUnderneath = false; return out({ message: "Update is not a fast forward" }, 422); }
      if (!G.commits.get(body.sha).parents.includes(G.ref)) return out({ message: "Update is not a fast forward" }, 422);
      G.ref = body.sha; return out({ object: { sha: body.sha } });
    }
    return out({ message: "not in the stand-in: " + method + " " + path }, 404);
  };
  /** What `git revert` of the head commit does to the files: the parent's tree on top of a new commit. */
  function revertHead() {
    const head = G.commits.get(G.ref); const parent = G.commits.get(head.parents[0]);
    const s = sha("revert" + Math.random()); G.commits.set(s, { tree: parent.tree, parents: [G.ref], message: "Revert" }); G.ref = s;
  }
  return { G, seed, read, filesAt, revertHead, fetch: fakeFetch };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const [port, token, seedFile] = process.argv.slice(2);
  const gh = fakeGitHub(token);
  gh.seed(JSON.parse(readFileSync(seedFile, "utf8")));
  createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    if (req.url === "/__state") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ head: gh.G.ref, message: gh.G.commits.get(gh.G.ref).message, files: Object.fromEntries([...gh.filesAt()].map(([p]) => [p, p.endsWith(".json") ? gh.read(p).toString() : gh.read(p).length])) })); }
    const r = await gh.fetch(`https://api.github.com${req.url}`, { method: req.method, headers: { authorization: req.headers.authorization }, body: chunks.length ? Buffer.concat(chunks).toString() : undefined });
    res.writeHead(r.status, { "content-type": "application/json" }); res.end(await r.text());
  }).listen(Number(port), "127.0.0.1");
}
