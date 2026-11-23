// MCP server exposing the SPEC host tool `lookup({id})`: waits 200 ms, returns {id, value: id*2}.
// Every call appends one line to $LOOKUP_COUNT_FILE so the driver can count host calls.
// Usage: node lookup-server.mjs stdio | node lookup-server.mjs http <port>
import { appendFileSync } from "node:fs";
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const countFile = process.env.LOOKUP_COUNT_FILE;
if (!countFile) throw new Error("LOOKUP_COUNT_FILE is required");

function makeServer() {
  const server = new McpServer({ name: "probe", version: "1.0.0" });
  server.registerTool(
    "lookup",
    {
      description: "Look up a record by id. Returns {id, value}.",
      inputSchema: { id: z.number().describe("record id") },
    },
    async ({ id }) => {
      appendFileSync(countFile, `${Date.now()} ${id}\n`);
      await new Promise((r) => setTimeout(r, 200));
      return { content: [{ type: "text", text: JSON.stringify({ id, value: id * 2 }) }] };
    },
  );
  return server;
}

const [mode, port] = process.argv.slice(2);
if (mode === "stdio") {
  await makeServer().connect(new StdioServerTransport());
} else if (mode === "http") {
  http
    .createServer(async (req, res) => {
      if (!req.url.startsWith("/mcp")) { res.writeHead(404).end(); return; }
      let body = "";
      for await (const chunk of req) body += chunk;
      const server = makeServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
    })
    .listen(Number(port), "0.0.0.0", () => console.error(`lookup-server listening on ${port}`));
} else {
  throw new Error("mode must be stdio or http");
}
