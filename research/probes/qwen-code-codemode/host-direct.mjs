// Direct timing of the code-mode host alone (no CLI, no scheduler): spawns the bundled codeModeHost.js the way
// executeCodeMode does (host-client.ts: spawn node <bundle>/codeModeHost.js with a PATH/TMPDIR-only env) and sends one
// framed `execute` message (protocol.ts). Used for P11's per-execution cost and to watch the host's RSS in P7.
// Usage: node host-direct.mjs p11            -> 20 fresh executions of `1 + 1`
//        node host-direct.mjs once "<source>" -> one execution, prints result and peak child RSS
import { spawn, execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const HOST = join(here, "../../impls/qwen-code-codemode/npm/node_modules/@qwen-code/qwen-code/codeModeHost.js");

function frame(msg) {
  const body = Buffer.from(JSON.stringify(msg));
  const f = Buffer.allocUnsafe(body.length + 4);
  f.writeUInt32BE(body.length, 0);
  body.copy(f, 4);
  return f;
}

function runOnce(source, { watchRss = false } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(process.execPath, [HOST], { stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR } });
    let buf = Buffer.alloc(0), msg, peak = 0;
    const sampler = watchRss ? setInterval(() => {
      try { peak = Math.max(peak, Number(execFileSync("ps", ["-o", "rss=", "-p", String(child.pid)]).toString().trim()) / 1024); } catch {}
    }, 50) : null;
    child.stdout.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length >= 4 && buf.length >= buf.readUInt32BE(0) + 4) {
        msg = JSON.parse(buf.subarray(4, buf.readUInt32BE(0) + 4).toString());
        child.stdin.end();
      }
    });
    child.on("close", () => {
      if (sampler) clearInterval(sampler);
      resolve({ ms: Math.round((performance.now() - t0) * 100) / 100, peakRssMB: watchRss ? Math.round(peak) : undefined, msg });
    });
    child.stdin.write(frame({ type: "execute", source, tools: [], timeoutMs: 30000, maxOutputChars: 100000 }));
  });
}

const [mode, src] = process.argv.slice(2);
if (mode === "p11") {
  const all = [];
  for (let i = 0; i < 20; i++) all.push((await runOnce("1 + 1")).ms);
  const s = [...all].sort((a, b) => a - b);
  console.log(JSON.stringify({ what: "spawn codeModeHost + QuickJS WASM init + eval 1+1 + teardown, 20 runs", medianMs: (s[9] + s[10]) / 2, p90Ms: s[17], firstMs: all[0], all }));
} else {
  const r = await runOnce(src, { watchRss: true });
  console.log(JSON.stringify({ ...r, msg: r.msg && { ...r.msg, output: r.msg.output?.slice(0, 300) } }));
}
