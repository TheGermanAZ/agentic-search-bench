// SPEC host tool as a stdio MCP server: lookup({id}) waits 200 ms and returns {id, value: id*2}.
// Each call appends a line to the file named by LOOKUP_COUNT_FILE (argv[0]) so the harness can count host calls.
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.20.2/server/mcp.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@1.20.2/server/stdio.js";
import { z } from "npm:zod@3.25.76";

const countFile = Deno.args[0];
const server = new McpServer({ name: "host", version: "1.0.0" });
server.registerTool(
  "lookup",
  {
    description: "Wait 200 ms, then return { id, value: id * 2 }",
    inputSchema: { id: z.number() },
    outputSchema: { id: z.number(), value: z.number() },
  },
  async ({ id }) => {
    await new Promise((r) => setTimeout(r, 200));
    if (countFile) await Deno.writeTextFile(countFile, `${Date.now()} ${id}\n`, { append: true });
    const out = { id, value: id * 2 };
    return { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out };
  },
);
await server.connect(new StdioServerTransport());
