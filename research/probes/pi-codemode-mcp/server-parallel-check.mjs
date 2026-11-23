// Control for P9: calls the lookup server directly with the MCP SDK client, 5 calls in parallel.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const client = new Client({ name: "control", version: "1" });
await client.connect(new StdioClientTransport({ command: "node", args: [new URL("./lookup-server.mjs", import.meta.url).pathname] }));
const t = Date.now();
await Promise.all([1, 2, 3, 4, 5].map((id) => client.callTool({ name: "lookup", arguments: { id } })));
console.log(JSON.stringify({ control: "direct MCP SDK client, Promise.all of 5 lookups", elapsedMs: Date.now() - t }));
await client.close();
