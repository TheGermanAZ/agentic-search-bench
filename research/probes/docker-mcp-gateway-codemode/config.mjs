// Probe config for Docker MCP Gateway code-mode (goja). The gateway wraps scripts in a plain
// (non-async) IIFE, so the SPEC's literal `await` forms are run first, then an adapted form.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const here = dirname(fileURLToPath(import.meta.url));
const NAME = process.env.GW_NAME ?? "docker-mcp-gateway-codemode-gw";
const PORT = process.env.GW_PORT ?? "41400";
export const countFile = `${here}/out/lookup-count.log`;

export async function connect() {
  const client = new Client({ name: "probe-driver", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`), {
    requestInit: { headers: { Authorization: "Bearer probetoken" } },
  }));
  const name = `p${Date.now()}`;
  const created = await client.callTool({ name: "code-mode", arguments: { servers: ["probe"], name } });
  const text = created.content.map((c) => c.text).join("");
  if (!text.startsWith("Successfully created")) throw new Error(`code-mode create failed: ${text}`);
  return { client, tool: `code-mode-${name}`, argName: "script" };
}

// console.* in goja writes to the gateway's own stdout (pkg/codemode/console.go). docker logs
// with stderr dropped returns only that stdout, which is where gateway logs do not go.
export async function sideOutput(since) {
  const out = execFileSync("docker", ["logs", "--since", since.toISOString(), NAME], { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 28 }).toString();
  return { gatewayStdoutChars: out.length, head: out.slice(0, 120) };
}

export async function rss() {
  const s = execFileSync("docker", ["exec", NAME, "grep", "VmRSS", "/proc/1/status"]).toString();
  return Math.round(Number(s.match(/(\d+)/)[1]) / 1024);
}

export async function kill() {
  execFileSync("docker", ["kill", NAME]);
}

export async function reset() {
  if (process.env.NO_RESET) return;
  execFileSync(`${here}/start-gateway.sh`, process.env.GW_ARGS ? process.env.GW_ARGS.split(" ") : ["--static"], { stdio: "ignore" });
}

export const probes = {
  P1: [
    `const r = await lookup({id: 21}); console.log(r.value)`,
    `const r = JSON.parse(lookup({id: 21})); console.log(r.value); return String(r.value)`,
  ],
  P2: [
    `console.log("A".repeat(200000)); "RETURNED"`,
    `console.log("A".repeat(200000)); return "RETURNED"`,
  ],
  P3: [`await fetch("https://example.com")`, `return String(fetch("https://example.com"))`],
  P4: [
    `return require("fs").readFileSync("/etc/hosts","utf8")`,
    `return String(import("fs"))`,
    `return typeof Deno === "undefined" ? "Deno undefined" : String(Deno.readTextFileSync("/etc/hosts"))`,
  ],
  P5: [`return process.env.PROBE_SECRET`],
  P6: [`while (true) {}`],
  P7: [`const a = []; while (true) a.push("x".repeat(1e6))`],
  P8: [`globalThis.kept = 7; return "set"`, `return typeof kept === "undefined" ? "gone" : String(kept)`],
  P9: [
    `const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => lookup({id:i}))); console.log(Date.now()-t)`,
    `const t = Date.now(); const rs = Promise.all([1,2,3,4,5].map(i => lookup({id:i}))); return String(Date.now()-t)`,
  ],
  P10: [`throw new Error("probe-boom")`, `const x = 1;\nconst y = 2;\nthrow new Error("probe-boom")`],
  P11: `return 1+1`,
  P12: [
    `return String(this.constructor.constructor("return process")())`,
    `return String((function(){return this})().process)`,
    `return Object.getOwnPropertyNames(globalThis).filter(k => !/^[A-Z]/.test(k)).join(",")`,
  ],
};
