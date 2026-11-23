// Stdio MCP server with one tool, `lookup`: waits 200 ms, returns { id, value: id * 2 }.
// Each call appends one line to $LOOKUP_COUNT_FILE so the harness can count host calls.
import { appendFileSync } from "node:fs";
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) handle(JSON.parse(line));
  }
});
const send = (o) => process.stdout.write(JSON.stringify(o) + "\n");
function handle(msg) {
  if (msg.method === "initialize")
    return send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "lookup", version: "0.0.1" } } });
  if (msg.method === "tools/list")
    return send({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "lookup", description: "Wait 200 ms, return { id, value: id * 2 }", inputSchema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] } }] } });
  if (msg.method === "tools/call") {
    if (process.env.LOOKUP_COUNT_FILE) appendFileSync(process.env.LOOKUP_COUNT_FILE, `call ${Date.now()}\n`);
    const id = msg.params?.arguments?.id;
    setTimeout(() => send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify({ id, value: id * 2 }) }] } }), 200);
    return;
  }
  if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
}
