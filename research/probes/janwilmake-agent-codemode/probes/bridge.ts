// What the agent's script would hold: a session to the `lookup` MCP server, opened with the package's
// exported StdioMcpClient. (mcp.lookup.lookup() would also work, but its name resolution reads the macOS Keychain.)
import { fileURLToPath } from "node:url";
import { StdioMcpClient, resultText } from "../../../impls/janwilmake-agent-codemode/repo/dist/index.js";
const server = fileURLToPath(new URL("../lookup-server.mjs", import.meta.url));
export const client = new StdioMcpClient("node", [server]);
export async function lookup(args: { id: number }): Promise<{ id: number; value: number }> {
  return JSON.parse(resultText(await client.callTool("lookup", args)) ?? "null");
}
