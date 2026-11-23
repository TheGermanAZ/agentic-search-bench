// Probe config for ToolHive vMCP code mode (Starlark execute_tool_script), driven through vMCP's own /mcp endpoint
// with anonymous incoming auth, the path an external MCP client such as a coding agent uses.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.VMCP_PORT ?? "42140";
export const countFile = `${here}/out/lookup-count.log`;
const vmcpPid = () => readFileSync(`${here}/run/vmcp.pid`, "utf8").trim();

export async function connect() {
  const client = new Client({ name: "probe-driver", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));
  return { client, tool: "execute_tool_script", argName: "script" };
}

// Host RSS of the vMCP process (the gateway that runs scripts in-process), in MB.
export async function rss() {
  return Math.round(Number(execFileSync("ps", ["-o", "rss=", "-p", vmcpPid()]).toString().trim()) / 1024);
}
// Only the PID this harness started (run/vmcp.pid).
export async function kill() { execFileSync("kill", ["-9", vmcpPid()]); }

export const probes = {
  P1: [`r = probe_lookup(id=21)\nv = r["text"].split('"value":')[1].rstrip("}")\nprint(v)\nreturn {"raw": r, "value": v}`, `r = probe_lookup(id=21)\nprint(r["value"])\nreturn r["value"]`, `r = call_tool("probe_lookup", id=21)\nreturn r`, `return call_tool("lookup", id=21)`],
  P2: [`print("A" * 200000)\nreturn "RETURNED"`, `return "B" * 2000000`],
  P3: [`r = urllib.request.urlopen("https://example.com")\nreturn r`, `load("net", "http")\nreturn http.get("https://example.com")`],
  P4: [`return open("/etc/hosts").read()`],
  P5: [`return os.environ.get("PROBE_SECRET")`, `return [dir(probe_lookup), dir(call_tool), dir(parallel), type(parallel)]`],
  P6: [`while True:\n    pass`, `for i in range(1000000000000):\n    pass`,
       `s = "x" * 100000000\nfor i in range(2700):\n    s.count("xy")\nreturn "done"`],
  P6h: [`for i in range(1000000000000):\n    pass`, `s = "x" * 300000000\nfor i in range(1000):\n    s.count("xy")\nreturn "done"`],
  P7: [`a = []\nwhile True:\n    a.append("x" * 1000000)`, `a = []\nfor i in range(1000000000000):\n    a.append("x" * 1000000)`],
  P8: [`kept = 7\nreturn "set"`, `return kept`],
  P9: [`t = [lambda i=i: probe_lookup(id=i) for i in [1, 2, 3, 4, 5]]\nrs = parallel(t)\nreturn [r["text"] for r in rs]`,
       `rs = [probe_lookup(id=i) for i in [1, 2, 3, 4, 5]]\nreturn [r["text"] for r in rs]`,
       `t = [lambda i=i: probe_lookup(id=i) for i in range(1, 21)]\nrs = parallel(t)\nreturn len(rs)`,
       `t = [lambda i=i: probe_lookup(id=i) for i in [1, 2, 3, 4, 5]]\nrs = parallel(t)\nreturn [r["value"] for r in rs]`,
       `rs = [probe_lookup(id=i) for i in [1, 2, 3, 4, 5]]\nreturn [r["value"] for r in rs]`],
  P10: [`fail("probe-boom")`, `x = 1\ny = 2\nfail("probe-boom")`, `x = 1\ny = {}\nz = y["missing"]`, `return probe_lookup(id="not-a-number")`],
  CAL: [`return json.decode("{}")`, `n = 0\nfor i in range(9000):\n    n += 1\nreturn n`, `n = 0\nfor i in range(20000):\n    n += 1\nreturn n`, `n = 0\nfor i in range(40000):\n    n += 1\nreturn n`,
        `a = []\nfor i in range(10000):\n    a.append("x")\nreturn len(a)`, `a = []\nfor i in range(20000):\n    a.append("x")\nreturn len(a)`, `a = []\nfor i in range(30000):\n    a.append("x")\nreturn len(a)`],
  P11: `return 1 + 1`,
  P12: [
    `return ().__class__`,
    `return __import__("os").system("echo PWNED")`,
    `return [type(probe_lookup), str(probe_lookup), type(call_tool), str(parallel)]`,
    `def f():\n    return f()\nreturn f()`,
  ],
};

// After a harness kill (4 GB RSS cap), restart only this harness's lookup server and vMCP.
export async function reset() {
  execFileSync(`${here}/start.sh`, [process.env.VMCP_VARIANT ?? "default"], { stdio: "inherit" });
}
