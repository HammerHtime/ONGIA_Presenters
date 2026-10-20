// A stand-in for api.anthropic.com for the receipts screen tests. POST /__set {reply, delay} chooses the next answer.
import http from "node:http";
let reply = null, delay = 0, count = 0;
http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", async () => {
    if (req.url === "/__set") { ({ reply, delay = 0 } = JSON.parse(b)); res.end("ok"); return; }
    if (req.url === "/__count") { res.end(String(count)); return; }
    count++;
    await new Promise((r) => setTimeout(r, delay));
    if (reply?.error) { res.writeHead(reply.error, { "content-type": "application/json" }); return res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "bad key" } })); }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "text", text: JSON.stringify(reply) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
  });
}).listen(8799, "127.0.0.1");
