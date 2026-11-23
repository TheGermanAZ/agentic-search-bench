// Same probes over the gateway's default stdio transport, to see where goja's console output lands.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
export { probes, countFile } from "./config.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, "../../impls/docker-mcp-gateway-codemode/bin");

export async function connect() {
  const transport = new StdioClientTransport({
    command: "docker",
    args: ["run", "-i", "--rm", "--name", "docker-mcp-gateway-codemode-stdio", "-e", "DOCKER_MCP_IN_CONTAINER=1", "-e", "HOME=/home/probe",
      "-e", "DOCKER_MCP_ALLOW_INSECURE_REMOTE_URLS=1", "-v", `${bin}:/gw:ro`, "-v", `${here}/home:/home/probe`, "node:22-slim",
      "/gw/docker-mcp", "gateway", "run", "--catalog", "/home/probe/.docker/mcp/catalogs/probe.yaml", "--enable-all-servers", "--static",
      "--secrets", "/home/probe/empty.env"],
    stderr: "ignore",
  });
  const client = new Client({ name: "probe-driver-stdio", version: "1.0.0" });
  client.onerror = (e) => console.error("client onerror:", String(e).slice(0, 200));
  await client.connect(transport);
  const name = `p${Date.now()}`;
  const created = await client.callTool({ name: "code-mode", arguments: { servers: ["probe"], name } });
  if (!created.content[0].text.startsWith("Successfully created")) throw new Error(created.content[0].text);
  return { client, tool: `code-mode-${name}`, argName: "script" };
}
