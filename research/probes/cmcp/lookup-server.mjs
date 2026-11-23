// Dependency-free stdio MCP server exposing the SPEC's `lookup` tool.
// Usage: node lookup-server.mjs <calls-log-path>
// Appends one line per tools/call to the log, so the harness can count host calls.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const log = process.argv[2];
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const tool = {
  name: "lookup",
  description: "Look up a value by numeric id. Returns { id, value: id * 2 } after 200 ms.",
  inputSchema: { type: "object", properties: { id: { type: "number", description: "numeric id" } }, required: ["id"] },
};

createInterface({ input: process.stdin }).on("line", async (line) => {
  if (!line.trim()) return;
  const req = JSON.parse(line);
  if (req.id === undefined) return;
  switch (req.method) {
    case "initialize":
      return send({ jsonrpc: "2.0", id: req.id, result: { protocolVersion: req.params?.protocolVersion ?? "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "lookup", version: "1.0.0" } } });
    case "tools/list":
      return send({ jsonrpc: "2.0", id: req.id, result: { tools: [tool] } });
    case "ping":
      return send({ jsonrpc: "2.0", id: req.id, result: {} });
    case "tools/call": {
      const id = Number(req.params?.arguments?.id);
      const t0 = Date.now();
      if (log) appendFileSync(log, JSON.stringify({ start: t0, id }) + "\n");
      await new Promise((r) => setTimeout(r, 200));
      return send({ jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text: JSON.stringify({ id, value: id * 2 }) }] } });
    }
    default:
      return send({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "method not found: " + req.method } });
  }
});
