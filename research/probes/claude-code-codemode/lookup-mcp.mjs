// Minimal stdio MCP server exposing one tool, lookup({id}) -> {id, value: id*2} after 200 ms.
// Each call is appended to $LOOKUP_LOG with start and end times, so the host-side call count and overlap are visible.
import { appendFileSync } from "node:fs"
import { createInterface } from "node:readline"

const log = process.env.LOOKUP_LOG
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n")
const tool = {
  name: "lookup",
  description: "Look up a value by id. Returns {id, value}.",
  inputSchema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
}

createInterface({ input: process.stdin }).on("line", async (line) => {
  if (!line.trim()) return
  const msg = JSON.parse(line)
  if (msg.method === "initialize")
    return send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "lookup", version: "1.0.0" } } })
  if (msg.method === "tools/list") return send({ jsonrpc: "2.0", id: msg.id, result: { tools: [tool] } })
  if (msg.method === "tools/call") {
    const id = Number(msg.params?.arguments?.id)
    const start = Date.now()
    await new Promise((r) => setTimeout(r, 200))
    if (log) appendFileSync(log, JSON.stringify({ id, start, end: Date.now() }) + "\n")
    const out = { id, value: id * 2 }
    return send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out } })
  }
  if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, result: {} })
})
