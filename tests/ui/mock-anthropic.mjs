// A stand-in for api.anthropic.com for the receipts screen tests. POST /__set {reply, delay} chooses the next answer.
// For the Newsroom: { reply: { tools: { <tool name>: input } } } answers a request by calling the tool it asks for,
// and GET /feed.xml serves a small Atom feed (POST /__feed sets it).
import http from "node:http";
let reply = null, delay = 0, count = 0, feed = "<feed></feed>";
http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", async () => {
    if (req.url === "/__set") { ({ reply, delay = 0 } = JSON.parse(b)); res.end("ok"); return; }
    if (req.url === "/__count") { res.end(String(count)); return; }
    if (req.url === "/__feed") { feed = b; res.end("ok"); return; }
    if (req.url === "/feed.xml") { res.writeHead(200, { "content-type": "application/atom+xml" }); res.end(feed); return; }
    count++;
    await new Promise((r) => setTimeout(r, delay));
    if (reply?.error) { res.writeHead(reply.error, { "content-type": "application/json" }); return res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "bad key" } })); }
    res.writeHead(200, { "content-type": "application/json" });
    const asked = reply?.tools ? JSON.parse(b || "{}").tools?.at(-1)?.name : null;
    if (asked && reply.tools[asked]) return res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "tool_use", id: "t", name: asked, input: reply.tools[asked] }], stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 100 } }));
    res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "text", text: JSON.stringify(reply) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
  });
}).listen(8799, "127.0.0.1");
