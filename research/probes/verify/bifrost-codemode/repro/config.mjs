// Probe config for Bifrost code mode (Starlark), driven through Bifrost's own MCP server endpoint (/mcp)
// with a local virtual key, the path an external MCP client such as a coding agent uses.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const here = dirname(fileURLToPath(import.meta.url));
const NAME = process.env.BF_NAME ?? "bifrost-codemode-verify-gates";
const PORT = process.env.BF_PORT ?? "42412";
export const countFile = `${here}/out/lookup-count.log`;

export async function connect() {
  const client = new Client({ name: "probe-driver", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`), {
    requestInit: { headers: { "x-bf-vk": "sk-bf-probe-local-only" } },
  }));
  return { client, tool: "executeToolCode", argName: "code" };
}

export async function rss() {
  const pid = execFileSync("docker", ["exec", NAME, "sh", "-c", "pgrep -f /app/main | head -1"]).toString().trim();
  const s = execFileSync("docker", ["exec", NAME, "grep", "VmRSS", `/proc/${pid}/status`]).toString();
  return Math.round(Number(s.match(/(\d+)/)[1]) / 1024);
}

export async function kill() {
  execFileSync("docker", ["kill", NAME]);
}

export const probes = {
  P1: [`r = probe.lookup(id=21)\nprint(r["value"])\nresult = r["value"]`],
  P2: [`print("A" * 200000)\nresult = "RETURNED"`, `print("A" * 60000)\nresult = "RETURNED"`],
  P3: [`r = urllib.request.urlopen("https://example.com")\nresult = r`, `load("net", "http")\nresult = http.get("https://example.com")`],
  P4: [`result = open("/etc/hosts").read()`],
  P5: [`result = os.environ.get("PROBE_SECRET")`, `result = [getattr(json, "environ", "no environ on json"), dir(json), dir(math)]`],
  P6: [`while True:\n    pass`],
  P7: [`a = []\nwhile True:\n    a.append("x" * 1000000)`],
  P8: [`kept = 7\nresult = "set"`, `result = kept`],
  P9: [`rs = [probe.lookup(id=i) for i in [1, 2, 3, 4, 5]]\nresult = [r["value"] for r in rs]`],
  P10: [`fail("probe-boom")`, `x = 1\ny = 2\nfail("probe-boom")`, `x = 1\ny = {}\nz = y["missing"]`],
  P11: `result = 1 + 1`,
  P12: [
    `result = ().__class__`,
    `result = __import__("os").system("echo PWNED")`,
    `result = [type(probe), dir(probe), type(probe.lookup), dir(probe.lookup)]`,
  ],
};
