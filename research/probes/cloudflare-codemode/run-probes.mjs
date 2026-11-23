import { spawn, execSync } from "node:child_process";
import { writeFileSync, mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, "out");
const BASE = "http://127.0.0.1:8799";
const LIMIT_MS = 120_000;
const RSS_KILL_KB = 4 * 1024 * 1024;
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const save = (name, data) =>
  writeFileSync(join(OUT, name), typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n");

function descendants(root) {
  const rows = execSync("ps -A -o pid=,ppid=", { encoding: "utf8" }).trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number));
  const out = [];
  const queue = [root];
  while (queue.length) {
    const p = queue.shift();
    for (const [pid, ppid] of rows) if (ppid === p) { out.push(pid); queue.push(pid); }
  }
  return out;
}

let devRoot = null;
function workerdPids() {
  if (!devRoot) return [];
  const own = new Set(descendants(devRoot).map(String));
  try {
    return execSync("pgrep -f 'workerd serve'", { encoding: "utf8" }).trim().split("\n").filter((pid) => own.has(pid));
  } catch {
    return [];
  }
}

function workerdRssKb() {
  const pids = workerdPids();
  if (!pids.length) return 0;
  try {
    return execSync(`ps -o rss= -p ${pids.join(",")}`, { encoding: "utf8" })
      .trim().split("\n").reduce((s, l) => s + Number(l.trim() || 0), 0);
  } catch {
    return 0;
  }
}

async function startDev(label) {
  const log = openSync(join(OUT, `wrangler-${label}.log`), "w");
  const t0 = performance.now();
  const proc = spawn(join(DIR, "node_modules/.bin/wrangler"), ["dev", "--var", "PROBE_SECRET:s3cr3t"], {
    cwd: DIR,
    detached: true,
    env: { ...process.env, PROBE_SECRET: "s3cr3t", WRANGLER_SEND_METRICS: "false" },
    stdio: ["ignore", log, log]
  });
  devRoot = proc.pid;
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/noop`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return { proc, readyMs: Math.round(performance.now() - t0) };
    } catch {}
    await sleep(250);
  }
  throw new Error("wrangler dev did not become ready");
}

async function stopDev(dev) {
  const pids = workerdPids();
  try { process.kill(-dev.proc.pid, "SIGKILL"); } catch {}
  for (const pid of pids) { try { process.kill(Number(pid), "SIGKILL"); } catch {} }
  devRoot = null;
  await sleep(1000);
}

async function run(code, mode = "tool", timeoutMs = LIMIT_MS, { watchRss = false } = {}) {
  const t0 = performance.now();
  let peakRssKb = 0;
  let killedForRss = false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("harness-timeout")), timeoutMs);
  const watcher = watchRss
    ? setInterval(() => {
        const rss = workerdRssKb();
        peakRssKb = Math.max(peakRssKb, rss);
        if (rss > RSS_KILL_KB) { killedForRss = true; ctrl.abort(new Error("rss-over-4GB")); }
      }, 250)
    : null;
  try {
    const r = await fetch(`${BASE}/run`, { method: "POST", body: JSON.stringify({ code, mode }), signal: ctrl.signal });
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { code, mode, httpStatus: r.status, wallMs: Math.round(performance.now() - t0), peakRssKb: watchRss ? peakRssKb : undefined, body };
  } catch (err) {
    return { code, mode, wallMs: Math.round(performance.now() - t0), harnessError: String(err?.cause?.message ?? err?.message ?? err), killedForRss, peakRssKb: watchRss ? peakRssKb : undefined };
  } finally {
    clearTimeout(timer);
    if (watcher) clearInterval(watcher);
  }
}

const both = async (code) => ({ tool: await run(code, "tool"), raw: await run(code, "raw") });
const alive = async () => {
  try { return (await fetch(`${BASE}/noop`, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; }
};

const probes = {
  async P1() {
    return both("const r = await codemode.lookup({id: 21}); console.log(r.value)");
  },
  async P2() {
    const res = await both('console.log("A".repeat(200000)); "RETURNED"');
    const out = res.tool.body?.res?.output ?? {};
    const raw = res.raw.body?.res ?? {};
    res.summary = {
      toolOutputKeys: Object.keys(out),
      toolResult: out.result,
      toolLogCharsBack: (out.logs ?? []).join("\n").length,
      rawResult: raw.result,
      rawLogCharsBack: (raw.logs ?? []).join("\n").length,
      toolOutputJsonChars: JSON.stringify(out).length
    };
    return res;
  },
  async P3() {
    return both('const r = await fetch("https://example.com"); return r.status');
  },
  async P4() {
    return {
      require: await both('return require("fs").readFileSync("/etc/hosts","utf8")'),
      importNodeFs: await both('const fs = await import("node:fs"); return fs.readFileSync("/etc/hosts","utf8")'),
      importFs: await both('const fs = await import("fs"); return fs.readFileSync("/etc/hosts","utf8")'),
      deno: await both('return await Deno.readTextFile("/etc/hosts")')
    };
  },
  async P5() {
    const hostEnv = await (await fetch(`${BASE}/host-env`)).json();
    return {
      hostWorkerEnv: hostEnv,
      processEnv: await both("return process.env.PROBE_SECRET"),
      processEnvKeys: await both("return Object.keys(process.env)"),
      globalEnv: await both("return typeof env === 'undefined' ? 'no global env' : env")
    };
  },
  async P6b_asyncHang() {
    return { note: "supplementary: async hang to exercise the 60 s Promise.race timeout", tool: await run("await new Promise(() => {})", "tool", 90_000) };
  },
  async P6() {
    const res = await run("while (true) {}", "tool", LIMIT_MS);
    res.serverAliveAfter = await alive();
    return res;
  },
  async P7() {
    const res = await run('const a = []; while (true) a.push("x".repeat(1e6))', "tool", LIMIT_MS, { watchRss: true });
    res.serverAliveAfter = await alive();
    return res;
  },
  async P8() {
    const ex1 = await run("globalThis.kept = 7", "tool");
    const ex2 = await run('console.log(typeof kept === "undefined" ? "gone" : kept)', "tool");
    return { ex1, ex2 };
  },
  async P9() {
    return both("const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => codemode.lookup({id:i}))); console.log(Date.now()-t)");
  },
  async P10() {
    return both('throw new Error("probe-boom")');
  },
  async P11() {
    const inHost = await (await fetch(`${BASE}/bench?n=20`)).json();
    const client = [];
    const noop = [];
    for (let i = 0; i < 20; i++) {
      let t0 = performance.now();
      await fetch(`${BASE}/noop`).then((r) => r.text());
      noop.push(performance.now() - t0);
      t0 = performance.now();
      await fetch(`${BASE}/run`, { method: "POST", body: JSON.stringify({ code: "1+1", mode: "tool" }) }).then((r) => r.text());
      client.push(performance.now() - t0);
    }
    const stats = (xs) => {
      const s = [...xs].sort((a, b) => a - b);
      return { median: +s[Math.floor(s.length / 2)].toFixed(1), p90: +s[Math.floor(s.length * 0.9)].toFixed(1), min: +s[0].toFixed(1), max: +s[s.length - 1].toFixed(1) };
    };
    return {
      inHostWorker_ms: { raw: inHost.times, ...stats(inHost.times) },
      clientRoundTrip_ms: { ...stats(client) },
      clientNoopRoundTrip_ms: { ...stats(noop) }
    };
  },
  async P12x_thisContext() {
    return {
      note: "supplementary: what `this` and the harness locals expose to model code",
      thisShape: await both("return { ctor: this.constructor.name, envKeys: Object.keys(this.env ?? {}), ctxType: typeof this.ctx, ctxKeys: this.ctx ? Object.keys(Object.getPrototypeOf(this.ctx) ?? {}) : null }"),
      dispatcherDirect: await both('return JSON.parse(await __dispatchers.codemode.call("lookup", JSON.stringify([{ id: 4 }])))')
    };
  },
  async P12() {
    const report = "return p === undefined ? 'undefined' : { type: typeof p, version: p.version, pid: p.pid, platform: p.platform, cwd: (()=>{try{return p.cwd()}catch(e){return 'cwd threw: '+e.message}})(), envKeys: Object.keys(p.env ?? {}) }";
    return {
      functionConstructor: await both(`const p = this.constructor.constructor("return process")(); ${report}`),
      sloppyThis: await both(`const p = (function(){return this})().process; ${report}`),
      ambientProcess: await both(`const p = globalThis.process; ${report}`)
    };
  }
};

const requested = process.argv.slice(2);
const order = requested.length ? requested : ["P1", "P2", "P3", "P4", "P5", "P8", "P9", "P10", "P11", "P12", "P6b_asyncHang", "P6", "P7"];
const isolated = new Set(["P6", "P7"]);

let dev = null;
for (const id of order) {
  if (isolated.has(id) && dev) { await stopDev(dev); dev = null; }
  if (!dev) {
    dev = await startDev(isolated.has(id) ? id : "main");
    save("setup.json", { wranglerDevReadyMs: dev.readyMs, note: "time from spawning `wrangler dev` until /noop answered" });
    if (!requested.length || requested.includes("P1")) {
      const desc = await (await fetch(`${BASE}/description`)).text();
      save("tool-description.txt", desc);
    }
  }
  console.log(`running ${id}`);
  const result = await probes[id]();
  save(`${id}.json`, result);
  console.log(JSON.stringify(result).slice(0, 600));
  if (isolated.has(id)) { await stopDev(dev); dev = null; }
}
if (dev) await stopDev(dev);
