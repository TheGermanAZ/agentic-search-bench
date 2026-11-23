// Usage: deno run -A run-probes.ts [probe ids...]
// Starts `lootbox server` from the clone (port 41310, root and data dir under ./work) and sends each
// probe over the same WebSocket message `lootbox exec` sends: { script, id } -> { id, result | error }.
const ROOT = new URL("../../", import.meta.url).pathname;
const REPO = `${ROOT}impls/lootbox/repo`;
const WORK = `${ROOT}probes/lootbox/work`;
const OUT = `${ROOT}probes/lootbox/out/`;
const PORT = 41310;
const wanted = new Set(Deno.args);
const want = (id: string) => wanted.size === 0 || wanted.has(id);
const CALLS = `${WORK}/calls.log`;
const callCount = () => { try { return Deno.readTextFileSync(CALLS).trim().split("\n").filter(Boolean).length; } catch { return 0; } };

const t0 = performance.now();
const server = new Deno.Command("deno", {
  args: ["run", "--allow-all", "--no-lock", `${REPO}/src/lootbox-cli.ts`, "server"],
  cwd: WORK,
  env: { DENO_DIR: `${ROOT}impls/lootbox/deno-dir`, PROBE_SECRET: "s3cr3t" },
  stdout: "piped",
  stderr: "piped",
}).spawn();
let serverLog = "";
const pump = async (s: ReadableStream<Uint8Array>) => { for await (const c of s.pipeThrough(new TextDecoderStream())) serverLog += c; };
pump(server.stdout);
pump(server.stderr);
for (;;) {
  try { if ((await fetch(`http://localhost:${PORT}/health`)).ok) break; } catch { /* not up yet */ }
  if (performance.now() - t0 > 90000) throw new Error("server did not start:\n" + serverLog);
  await new Promise((r) => setTimeout(r, 100));
}
// Tool workers start asynchronously; wait until the host namespace is listed.
for (;;) {
  const ns = await (await fetch(`http://localhost:${PORT}/namespaces`)).text();
  if (ns.includes("host")) break;
  await new Promise((r) => setTimeout(r, 100));
}
const setupMs = Math.round(performance.now() - t0);

function exec(script: string, waitMs = 130000): Promise<Record<string, unknown>> {
  const id = crypto.randomUUID();
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  return new Promise((resolve) => {
    const timer = setTimeout(() => { ws.close(); resolve({ harness: `no response within ${waitMs} ms` }); }, waitMs);
    ws.onopen = () => ws.send(JSON.stringify({ script, id }));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === id) { clearTimeout(timer); ws.close(); resolve(m); }
    };
    ws.onerror = () => { clearTimeout(timer); resolve({ harness: "ws error" }); };
  });
}

async function run(code: string) {
  const before = callCount();
  const s = performance.now();
  const r = await exec(code);
  return { ...r, ms: Math.round(performance.now() - s), hostCalls: callCount() - before };
}

function save(id: string, code: string, r: unknown, extra = "") {
  Deno.writeTextFileSync(`${OUT}${id}.txt`, `code:\n${code}\n\nresult:\n${JSON.stringify(r, null, 2)}\n${extra}`);
  console.log(id, JSON.stringify(r).slice(0, 300));
}
async function probe(id: string, code: string) { if (want(id)) save(id, code, await run(code)); }

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

await probe("P1", `const r = await tools.host.lookup({id: 21}); console.log(r.value)`);

if (want("P2")) {
  const code = `console.log("A".repeat(200000)); "RETURNED"`;
  const r = await run(code);
  const text = String(r.result ?? r.error ?? "");
  save("P2", code, { keys: Object.keys(r), ms: r.ms, resultLength: text.length, aCount: (text.match(/A/g) ?? []).length, containsRETURNED: text.includes("RETURNED"), tail: text.slice(-80) });
}

await probe("P3", `const r = await fetch("https://example.com"); console.log(r.status, (await r.text()).length)`);
await probe("P4", `console.log(require("fs").readFileSync("/etc/hosts","utf8"))`);
await probe("P4b", `const fs = await import("node:fs"); console.log(fs.readFileSync("/etc/hosts","utf8"))`);
await probe("P4c", `console.log(await Deno.readTextFile("/etc/hosts"))`);
await probe("P5", `console.log(process.env.PROBE_SECRET)`);
await probe("P5b", `console.log(Deno.env.get("PROBE_SECRET"))`);

if (want("P6")) save("P6", `while (true) {}`, await run(`while (true) {}`));

if (want("P7")) {
  const code = `const a = []; while (true) a.push("x".repeat(1e6))`;
  let peak = 0, killed = "";
  const baseline = tree(server.pid).total;
  const start = performance.now();
  const sampler = setInterval(() => {
    const { total, pids, rss } = tree(server.pid);
    peak = Math.max(peak, total);
    if (!killed && (total > 4 * 1024 ** 3 || performance.now() - start > 120000)) {
      const biggest = pids.slice(1).sort((a, b) => (rss.get(b) ?? 0) - (rss.get(a) ?? 0))[0];
      killed = `harness killed the largest child ${biggest} at ${Math.round(total / 1e6)} MB tree RSS, ${Math.round(performance.now() - start)} ms`;
      try { Deno.kill(biggest, "SIGKILL"); } catch { /* gone */ }
    }
  }, 100);
  const r = await run(code);
  clearInterval(sampler);
  const after = await run(`console.log("alive")`);
  save("P7", code, r, `\nbaseline tree RSS bytes: ${baseline}\npeak tree RSS bytes: ${peak}\n${killed}\nnext execution after P7: ${JSON.stringify(after)}\n`);
}

if (want("P8")) {
  const r1 = await run(`globalThis.kept = 7`);
  const r2 = await run(`console.log(typeof kept === "undefined" ? "gone" : kept)`);
  save("P8", `globalThis.kept = 7\n---\nconsole.log(typeof kept === "undefined" ? "gone" : kept)`, { first: r1, second: r2 });
}

if (want("P8b")) {
  const r1 = await run(`(globalThis as any).kept = 7`);
  const r2 = await run(`// @ts-ignore\nconsole.log(typeof kept === "undefined" ? "gone" : kept)`);
  save("P8b", `(globalThis as any).kept = 7\n---\n// @ts-ignore\nconsole.log(typeof kept === "undefined" ? "gone" : kept)`, { first: r1, second: r2 });
}
await probe("P12e", `// @ts-ignore\nconsole.log(String(this.constructor.constructor("return process")()))`);
await probe("P12f", `// @ts-ignore\nconsole.log(String((function(){return this})().process))`);
await probe("P12g", `const p = (globalThis as any).process; console.log(typeof p, p.pid, p.env.PROBE_SECRET)`);
await probe("P9", `const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => tools.host.lookup({id:i}))); console.log(Date.now()-t)`);
await probe("P10", `throw new Error("probe-boom")`);
await probe("P10b", `const x = 1;\nconst y = 2;\nthrow new Error("probe-boom line 3")`);

if (want("P11")) {
  const times: number[] = [];
  for (let i = 0; i < 20; i++) times.push((await run(`1+1`)).ms);
  const s = [...times].sort((a, b) => a - b);
  save("P11", "1+1 (x20)", { times, median: (s[9] + s[10]) / 2, p90: s[17], setupMs });
}

await probe("P12a", `console.log(String(this.constructor.constructor("return process")()))`);
await probe("P12b", `console.log(String((function(){return this})().process))`);
await probe("P12c", `const o = new Deno.Command("echo", {args:["PWNED"]}).outputSync(); console.log(new TextDecoder().decode(o.stdout))`);
await probe("P12d", `const cp = await import("node:child_process"); console.log(String(cp.execSync("echo PWNED")))`);
// Network is open, so sandbox code can reach the lootbox server itself and other local services.
await probe("X1", `const r = await fetch("http://localhost:${PORT}/client.ts"); console.log(r.status, (await r.text()).length)`);
await probe("X2", `const ws = new WebSocket("ws://localhost:${PORT}/ws"); await new Promise(r => ws.onopen = r); ws.send(JSON.stringify({script: "console.log('nested run')", id: "n1"})); const m = await new Promise(r => ws.onmessage = e => { const d = JSON.parse(e.data); if (d.id === "n1") r(d) }); console.log(JSON.stringify(m)); ws.close()`);

await probe("X3", `console.log("printed-before-throw"); throw new Error("probe-boom")`);
Deno.writeTextFileSync(`${OUT}server-log.txt`, serverLog.slice(-30000));
const spawned = tree(server.pid).pids.slice(1);
server.kill("SIGTERM");
await server.status;
for (const p of spawned) try { Deno.kill(p, "SIGTERM"); } catch { /* exited */ }
Deno.exit(0);
