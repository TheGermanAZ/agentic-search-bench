// Usage: deno run -A run-probes.ts <default|hardened> [probe ids...]
// Starts Open-PTC's own server (src/server.ts --ws), registers `lookup` as a WebSocket local tool,
// and sends each probe as an `execute_code` message, the path its AI SDK and LangGraph examples use.
const ROOT = new URL("../../", import.meta.url).pathname;
const REPO = `${ROOT}impls/open-ptc/repo`;
const DENO_DIR = `${ROOT}impls/open-ptc/deno-dir`;
const RPC_PORT = 41302;
const WS_PORT = 41303;
const mode = Deno.args[0] ?? "default";
const HARDENED_TIMEOUT_MS = "5000";
const OUT = `${ROOT}probes/open-ptc/out/${mode === "hardened" ? "hardened-" : ""}`;
const wanted = new Set(Deno.args.slice(1));
const want = (id: string) => wanted.size === 0 || wanted.has(id);

const env: Record<string, string> = {
  DENO_DIR,
  RPC_SERVER_PORT: String(RPC_PORT),
  RPC_SERVER_URL: `http://localhost:${RPC_PORT}`,
  WS_SERVER_PORT: String(WS_PORT),
  PROBE_SECRET: "s3cr3t",
};
if (mode === "hardened") env.CODE_EXECUTION_TIMEOUT_MS = HARDENED_TIMEOUT_MS;

const t0 = performance.now();
const server = new Deno.Command("deno", {
  args: ["run", "--allow-all", "--no-lock", "src/server.ts", "--ws"],
  cwd: REPO,
  env,
  stdout: "piped",
  stderr: "piped",
}).spawn();
let serverLog = "";
const pump = async (s: ReadableStream<Uint8Array>) => {
  for await (const c of s.pipeThrough(new TextDecoderStream())) serverLog += c;
};
pump(server.stdout);
pump(server.stderr);
while (!serverLog.includes("[OK] WebSocket Server")) {
  if (performance.now() - t0 > 60000) throw new Error("server did not start:\n" + serverLog);
  await new Promise((r) => setTimeout(r, 50));
}

let hostCalls = 0;
type Result = { success: boolean; output?: string; error?: string };

class Client {
  ws!: WebSocket;
  pending = new Map<string, (r: Result) => void>();
  connId = "";
  async open(registerLookup: boolean) {
    const before = serverLog.length;
    this.ws = new WebSocket(`ws://localhost:${WS_PORT}`);
    await new Promise((r, j) => { this.ws.onopen = r; this.ws.onerror = j; });
    this.ws.onmessage = (e) => this.onMessage(JSON.parse(e.data));
    while (!/Connection opened: (ws_\d+_\d+)/.test(serverLog.slice(before))) await new Promise((r) => setTimeout(r, 10));
    this.connId = serverLog.slice(before).match(/Connection opened: (ws_\d+_\d+)/)![1];
    if (registerLookup) {
      const ok = new Promise((r) => (this.onSuccess = r));
      this.ws.send(JSON.stringify({
        type: "register_tools",
        tools: [{
          name: "lookup",
          description: "Wait 200 ms, return { id, value: id * 2 }",
          inputSchema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
        }],
      }));
      await ok;
    }
  }
  onSuccess: (v: unknown) => void = () => {};
  onMessage(m: any) {
    if (m.type === "success") this.onSuccess(m);
    else if (m.type === "tool_call") {
      hostCalls++;
      const { id } = m.args as { id: number };
      setTimeout(() => this.ws.send(JSON.stringify({ type: "tool_result", callId: m.callId, result: { id, value: id * 2 } })), 200);
    } else if (m.type === "execution_result") this.pending.get(m.executionId)?.(m);
  }
  exec(code: string): Promise<Result> {
    const executionId = crypto.randomUUID();
    return new Promise((r) => {
      this.pending.set(executionId, r);
      this.ws.send(JSON.stringify({ type: "execute_code", executionId, code }));
    });
  }
}

const client = new Client();
await client.open(true);
const setupMs = performance.now() - t0;

async function run(code: string) {
  hostCalls = 0;
  const s = performance.now();
  const r = await client.exec(code);
  return { ...r, ms: Math.round(performance.now() - s), hostCalls };
}

function save(id: string, code: string, r: unknown, extra = "") {
  Deno.writeTextFileSync(`${OUT}${id}.txt`, `mode: ${mode}\ncode:\n${code}\n\nresult:\n${JSON.stringify(r, null, 2)}\n${extra}`);
  console.log(id, JSON.stringify(r).slice(0, 300));
}

async function probe(id: string, code: string) {
  if (!want(id)) return;
  save(id, code, await run(code));
}

function treeRss(root: number): { total: number; pids: number[] } {
  const ps = new TextDecoder().decode(new Deno.Command("ps", { args: ["-A", "-o", "pid=,ppid=,rss="] }).outputSync().stdout);
  const rows = ps.trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number));
  const kids = new Map<number, number[]>();
  for (const [pid, ppid] of rows) kids.set(ppid, [...(kids.get(ppid) ?? []), pid]);
  const rss = new Map(rows.map(([pid, , r]) => [pid, r]));
  const pids: number[] = [];
  const walk = (p: number) => { pids.push(p); for (const k of kids.get(p) ?? []) walk(k); };
  walk(root);
  return { total: pids.reduce((a, p) => a + (rss.get(p) ?? 0), 0) * 1024, pids };
}

await probe("P1", `const r = await main.lookup({id: 21}); console.log(r.value)`);

if (want("P2")) {
  const code = `console.log("A".repeat(200000)); "RETURNED"`;
  const r = await run(code);
  const aCount = (r.output ?? "").split("").filter((c) => c === "A").length;
  save("P2", code, { success: r.success, ms: r.ms, outputLength: r.output?.length, aCount, containsRETURNED: (r.output ?? "").includes("RETURNED"), tail: r.output?.slice(-120) });
}

await probe("P3", `const r = await fetch("https://example.com"); console.log(r.status)`);
await probe("P3b", `const m = await import("https://example.com/probe.js"); console.log(Object.keys(m))`);
await probe("P4", `console.log(require("fs").readFileSync("/etc/hosts","utf8"))`);
await probe("P4b", `const fs = await import("node:fs"); console.log(fs.readFileSync("/etc/hosts","utf8"))`);
await probe("P4c", `console.log(await Deno.readTextFile("/etc/hosts"))`);
await probe("P5", `console.log(process.env.PROBE_SECRET)`);
await probe("P5b", `console.log(Deno.env.get("PROBE_SECRET"))`);
await probe("P5c", `console.log(JSON.stringify(Deno.env.toObject()))`);

if (want("P6")) {
  const code = `while (true) {}`;
  const r = await Promise.race([run(code), new Promise((res) => setTimeout(() => res({ harness: "no-limit-within-120s" }), 120000))]);
  save("P6", code, r);
}

if (want("P7")) {
  const code = `const a = []; while (true) a.push("x".repeat(1e6))`;
  let peak = 0, killed = "";
  const baseline = treeRss(server.pid).total;
  const start = performance.now();
  const sampler = setInterval(() => {
    const { total, pids } = treeRss(server.pid);
    peak = Math.max(peak, total);
    if (!killed && (total > 4 * 1024 ** 3 || performance.now() - start > 120000)) {
      killed = `harness killed sandbox child at ${Math.round(total / 1e6)} MB tree RSS, ${Math.round(performance.now() - start)} ms`;
      for (const p of pids.slice(1)) try { Deno.kill(p, "SIGKILL"); } catch { /* already gone */ }
    }
  }, 100);
  const r = await run(code);
  clearInterval(sampler);
  const after = await run(`console.log("alive")`);
  save("P7", code, { ...r, output: r.output?.slice(0, 3000) }, `\nbaseline tree RSS bytes: ${baseline}\npeak tree RSS bytes: ${peak}\n${killed}\nnext execution after P7: ${JSON.stringify(after)}\n`);
}

if (want("P8")) {
  const c1 = `globalThis.kept = 7`;
  const c2 = `console.log(typeof kept === "undefined" ? "gone" : kept)`;
  const r1 = await run(c1);
  const r2 = await run(c2);
  save("P8", `${c1}\n---\n${c2}`, { first: r1, second: r2 });
}

await probe("P9", `const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => main.lookup({id:i}))); console.log(Date.now()-t)`);
await probe("P10", `throw new Error("probe-boom")`);
await probe("P10b", `const x = 1;\nconst y = 2;\nthrow new Error("probe-boom line 3")`);

if (want("P11")) {
  const times: number[] = [];
  for (let i = 0; i < 20; i++) times.push((await run(`1+1`)).ms);
  const s = [...times].sort((a, b) => a - b);
  save("P11", "1+1 (x20)", { times, median: (s[9] + s[10]) / 2, p90: s[17], setupMs: Math.round(setupMs) });
}

await probe("P12a", `console.log(String(this.constructor.constructor("return process")()))`);
await probe("P12b", `console.log(String((function(){return this})().process))`);
await probe("P12c", `const p = globalThis.process; console.log(typeof p, p && p.pid, p && p.env.PROBE_SECRET)`);
await probe("P12d", `const o = new Deno.Command("echo", {args:["PWNED"]}).outputSync(); console.log(new TextDecoder().decode(o.stdout))`);
await probe("P12e", `const cp = await import("node:child_process"); console.log(String(cp.execSync("echo PWNED")))`);

if (want("X1")) {
  // A second connection's sandbox calls the first connection's local tool by its global reference name.
  const other = new Client();
  await other.open(false);
  const code = `const r = await callTool("main_${client.connId}.lookup", {id: 50}); console.log("cross-connection result", JSON.stringify(r))`;
  hostCalls = 0;
  const r = await other.exec(code);
  save("X1", code, { ...r, hostCallsOnConnectionA: hostCalls, connA: client.connId, connB: other.connId });
  other.ws.close();
}

if (want("X2")) {
  // Sandbox code talks to the RPC server directly instead of through the generated proxy object.
  const code = `const res = await fetch("http://localhost:${RPC_PORT}", {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({jsonrpc:"2.0", id:1, method:"callTool", params:{toolRef:"nope.nope", args:{}}})}); console.log(res.status, await res.text())`;
  save("X2", code, await run(code));
}

Deno.writeTextFileSync(`${OUT}server-log.txt`, serverLog.slice(0, 20000));
client.ws.close();
server.kill("SIGTERM");
await server.status;
Deno.exit(0);
