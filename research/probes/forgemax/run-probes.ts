// Usage: deno run -A --no-config --node-modules-dir=none run-probes.ts <default|hardened> [probe ids...]
// Spawns the released `forgemax serve` binary over stdio (the MCP transport agents use) with
// forge.<mode>.toml, whose only downstream server is ./lookup-server.ts, and calls its `execute` tool.
import { Client } from "npm:@modelcontextprotocol/sdk@1.20.2/client/index.js";
import { StdioClientTransport } from "npm:@modelcontextprotocol/sdk@1.20.2/client/stdio.js";

const HERE = new URL(".", import.meta.url).pathname;
const BIN = new URL("../../impls/forgemax/bin/forgemax", import.meta.url).pathname;
const mode = Deno.args[0] ?? "default";
const OUT = `${HERE}out/${mode === "default" ? "" : mode + "-"}`;
const CALLS = `${HERE}out/calls.log`;
const wanted = new Set(Deno.args.slice(1));
const want = (id: string) => wanted.size === 0 || wanted.has(id);
const callCount = () => { try { return Deno.readTextFileSync(CALLS).trim().split("\n").filter(Boolean).length; } catch { return 0; } };

const t0 = performance.now();
const transport = new StdioClientTransport({
  command: BIN,
  args: ["serve"],
  env: { FORGE_CONFIG: `${HERE}forge.${mode}.toml`, PROBE_SECRET: "s3cr3t", RUST_LOG: "warn", PATH: "/usr/bin:/bin" },
  stderr: "pipe",
});
let serverLog = "";
const client = new Client({ name: "probe-harness", version: "1.0.0" });
await client.connect(transport);
(async () => { for await (const c of (transport.stderr as unknown as ReadableStream<Uint8Array>).pipeThrough(new TextDecoderStream())) serverLog += c; })().catch(() => {});
const setupMs = Math.round(performance.now() - t0);
const serverPid = transport.pid!;

if (want("TOOLS")) {
  const tools = await client.listTools();
  const instr = client.getInstructions();
  Deno.writeTextFileSync(`${OUT}TOOLS.txt`, JSON.stringify(tools, null, 2) + `\n\nserver instructions (${instr?.length} chars):\n${instr}\n`);
}

async function run(code: string, tool = "execute") {
  const before = callCount();
  const s = performance.now();
  let r: unknown;
  try {
    r = await client.callTool({ name: tool, arguments: { code } }, undefined, { timeout: 130000 });
  } catch (e) {
    r = { clientError: String(e) };
  }
  return { response: r, ms: Math.round(performance.now() - s), hostCalls: callCount() - before };
}

function save(id: string, code: string, r: unknown, extra = "") {
  Deno.writeTextFileSync(`${OUT}${id}.txt`, `mode: ${mode}\ncode:\n${code}\n\nresult:\n${JSON.stringify(r, null, 2)}\n${extra}`);
  console.log(id, JSON.stringify(r).slice(0, 400));
}
async function probe(id: string, code: string, tool = "execute") { if (want(id)) save(id, code, await run(code, tool)); }

function tree(root: number) {
  const ps = new TextDecoder().decode(new Deno.Command("ps", { args: ["-A", "-o", "pid=,ppid=,rss=,comm="] }).outputSync().stdout);
  const rows = ps.trim().split("\n").map((l) => l.trim().split(/\s+/));
  const kids = new Map<number, number[]>();
  for (const [pid, ppid] of rows) kids.set(+ppid, [...(kids.get(+ppid) ?? []), +pid]);
  const rss = new Map(rows.map(([pid, , r]) => [+pid, +r * 1024]));
  const comm = new Map(rows.map(([pid, , , c]) => [+pid, c]));
  const pids: number[] = [];
  const walk = (p: number) => { pids.push(p); for (const k of kids.get(p) ?? []) walk(k); };
  walk(root);
  return { total: pids.reduce((a, p) => a + (rss.get(p) ?? 0), 0), pids, rss, comm };
}

await probe("P1", `async () => { const r = await forge.callTool("host", "lookup", {id: 21}); return r.value; }`);
await probe("P1b", `async () => { const r = await forge.callTool("host", "lookup", {id: 21}); return r; }`);
await probe("P1c", `async () => { return typeof console; }`);
await probe("P2", `async () => { console.log("A".repeat(200000)); return "RETURNED"; }`);
await probe("P2b", `async () => { forge.log("A".repeat(200000)); return "RETURNED"; }`);
if (want("P2c")) {
  const code = `async () => { return "A".repeat(200000); }`;
  const r = await run(code);
  const text = JSON.stringify(r.response);
  save("P2c", code, { ms: r.ms, responseChars: text.length, aCount: (text.match(/A/g) ?? []).length, head: text.slice(0, 300) });
}
await probe("P2d", `async () => { return "A".repeat(2000000); }`);
await probe("P3", `async () => { const r = await fetch("https://example.com"); return r.status; }`);
await probe("P3b", `async () => { return typeof fetch; }`);
await probe("P4", `async () => { return require("fs").readFileSync("/etc/hosts", "utf8"); }`);
await probe("P4b", `async () => { const fs = await import("fs"); return fs.readFileSync("/etc/hosts", "utf8"); }`);
await probe("P4c", `async () => { return await Deno.readTextFile("/etc/hosts"); }`);
await probe("P4d", `async () => { return [typeof require, typeof globalThis.Deno, typeof globalThis.process]; }`);
await probe("P5", `async () => { return process.env.PROBE_SECRET; }`);
await probe("P5b", `async () => { const p = globalThis["pro" + "cess"]; return p ? p["e" + "nv"].PROBE_SECRET : "no process"; }`);

if (want("P6")) save("P6", `async () => { while (true) {} }`, await run(`async () => { while (true) {} }`));

if (want("P7")) {
  const code = `async () => { const a = []; while (true) a.push("x".repeat(1e6)); }`;
  let peak = 0, killed = "";
  const baseline = tree(serverPid).total;
  const start = performance.now();
  const sampler = setInterval(() => {
    const { total, pids, rss } = tree(serverPid);
    peak = Math.max(peak, total);
    if (!killed && (total > 4 * 1024 ** 3 || performance.now() - start > 120000)) {
      const biggest = pids.slice(1).sort((a, b) => (rss.get(b) ?? 0) - (rss.get(a) ?? 0))[0];
      killed = `harness killed ${biggest} at ${Math.round(total / 1e6)} MB tree RSS`;
      try { Deno.kill(biggest, "SIGKILL"); } catch { /* gone */ }
    }
  }, 50);
  const r = await run(code);
  clearInterval(sampler);
  const after = await run(`async () => "alive"`);
  save("P7", code, r, `\nbaseline tree RSS bytes: ${baseline}\npeak tree RSS bytes: ${peak}\n${killed}\nnext execution after P7: ${JSON.stringify(after)}\n`);
}

if (want("P8")) {
  const r1 = await run(`async () => { globalThis.kept = 7; return "set"; }`);
  const r2 = await run(`async () => { return typeof kept === "undefined" ? "gone" : kept; }`);
  save("P8", `async () => { globalThis.kept = 7; return "set"; }\n---\nasync () => { return typeof kept === "undefined" ? "gone" : kept; }`, { first: r1, second: r2 });
}
if (want("P8b")) {
  const r1 = await run(`async () => { return await forge.stash.put("kept", 7); }`);
  const r2 = await run(`async () => { return await forge.stash.get("kept"); }`);
  save("P8b", `forge.stash.put("kept", 7)\n---\nforge.stash.get("kept")`, { first: r1, second: r2 });
}

await probe("P9", `async () => { const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => forge.callTool("host", "lookup", {id: i}))); return Date.now() - t; }`);
await probe("P9b", `async () => { const t = Date.now(); const r = await forge.parallel([1,2,3,4,5].map(i => () => forge.callTool("host", "lookup", {id: i}))); return { ms: Date.now() - t, errors: r.errors }; }`);
await probe("P9c", `async () => { const t = Date.now(); const out = await Promise.all(Array.from({length: 60}, (_, i) => forge.callTool("host", "lookup", {id: i}).then(() => "ok", e => String(e)))); return { ms: Date.now() - t, ok: out.filter(x => x === "ok").length, firstError: out.find(x => x !== "ok") }; }`);
await probe("P10", `async () => { throw new Error("probe-boom"); }`);
await probe("P10b", `async () => {\n  const x = 1;\n  throw new Error("probe-boom line 3 /Users/someone/secret.txt https://internal.example.com/x");\n}`);

if (want("P11")) {
  const times: number[] = [];
  for (let i = 0; i < 20; i++) times.push((await run(`async () => 1 + 1`)).ms);
  const s = [...times].sort((a, b) => a - b);
  save("P11", "async () => 1 + 1 (x20)", { times, median: (s[9] + s[10]) / 2, p90: s[17], setupMs });
}

await probe("P12a", `async () => { return String(this.constructor.constructor("return process")()); }`);
await probe("P12b", `async () => { return String((function(){ return this })().process); }`);
await probe("P12c", `async () => { const f = (function(){}).constructor; return String(f); }`);
await probe("P12d", `async () => { const g = (function(){ return this })(); return Object.getOwnPropertyNames(g).join(","); }`);
await probe("P12e", `async () => { const k = "con" + "structor"; const F = Object.getPrototypeOf(async function(){})[k]; return typeof F; }`);

// The worker's stdout is also its IPC channel to the parent, so console.log bytes are parsed as IPC frames.
// A frame is a 4-byte big-endian length plus JSON; padding the JSON to 99 chars makes the length 100 ("\0\0\0d"),
// and console.log's trailing newline becomes the 100th byte (JSON allows trailing whitespace).
const frame = (obj: string) => `"\\0\\0\\0d" + (${obj}).padEnd(99, " ")`;
await probe("X1", `async () => { for (let i = 0; i < 3; i++) console.log(${frame(`JSON.stringify({type: "ToolCallRequest", request_id: 900000 + i, server: "host", tool: "lookup", args: {id: 7}})`)}); return "guest made no forge.callTool calls"; }`);
await probe("X2", `async () => { console.log(${frame(`JSON.stringify({type: "ExecutionComplete", result: {Ok: "FORGED BY GUEST STDOUT"}})`)}); while (true) {} }`);
if (want("X2b")) {
  // After a forged ExecutionComplete, is the worker that is still spinning in while(true) killed?
  const code = `async () => { console.log(${frame(`JSON.stringify({type: "ExecutionComplete", result: {Ok: "FORGED"}})`)}); while (true) {} }`;
  const r = await run(code);
  const snaps: string[] = [];
  for (const wait of [500, 3000, 7000]) {
    await new Promise((res) => setTimeout(res, wait - (snaps.length ? [500, 3000, 7000][snaps.length - 1] : 0)));
    const ps = new TextDecoder().decode(new Deno.Command("ps", { args: ["-A", "-o", "pid=,ppid=,%cpu=,etime=,comm="] }).outputSync().stdout);
    const kids = tree(serverPid).pids;
    snaps.push(`t+${wait}ms: ` + ps.split("\n").filter((l) => kids.includes(+l.trim().split(/\s+/)[0]) && l.includes("worker")).join(" | "));
  }
  save("X2b", code, r, "\n" + snaps.join("\n") + "\n");
}
await probe("X3", `async () => { console.log("hello from console.log"); return "after log"; }`);
await probe("S1", `async () => { return manifest.servers.map(s => ({ name: s.name, categories: Object.keys(s.categories) })); }`, "search");

Deno.writeTextFileSync(`${OUT}server-log.txt`, serverLog.slice(-30000));
const spawned = tree(serverPid).pids;
await client.close();
for (const p of spawned) try { Deno.kill(p, "SIGTERM"); } catch { /* exited */ }
Deno.exit(0);
