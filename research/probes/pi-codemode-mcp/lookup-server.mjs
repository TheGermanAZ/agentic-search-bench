// Stdio MCP server exposing the SPEC host tool `lookup`. Host-side call count goes to LOOKUP_COUNT_FILE.
import { appendFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "probe-host", version: "1.0.0" });
server.tool("lookup", "Returns { id, value: id * 2 } after 200 ms", { id: z.number() }, async ({ id }) => {
	if (process.env.LOOKUP_COUNT_FILE) appendFileSync(process.env.LOOKUP_COUNT_FILE, `${Date.now()} ${id}\n`);
	await new Promise((r) => setTimeout(r, 200));
	return { content: [{ type: "text", text: JSON.stringify({ id, value: id * 2 }) }], structuredContent: { id, value: id * 2 } };
});
await server.connect(new StdioServerTransport());
