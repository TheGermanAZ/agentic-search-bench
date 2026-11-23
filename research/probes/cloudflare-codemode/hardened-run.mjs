import { spawn, execSync } from "node:child_process";
import { writeFileSync, mkdirSync, openSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, "out");
const PORT = 41800;
const INSPECTOR_PORT = 41801;
const BASE = `http://127.0.0.1:${PORT}`;
const LIMIT_MS = 120_000;
const RSS_KILL_KB = 4 * 1024 * 1024;
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const save = (name, data) =>
  writeFileSync(join(OUT, name), typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n");
const logPid = (line) => appendFileSync(join(OUT, "hardened-pids.log"), `${new Date().toISOString()} ${line}\n`);

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
  const log = openSync(join(OUT, `hardened-wrangler-${label}.log`), "w");
  const t0 = performance.now();
  const proc = spawn(
    join(DIR, "node_modules/.bin/wrangler"),
    ["dev", "-c", "hardened-wrangler.jsonc", "--port", String(PORT), "--inspector-port", String(INSPECTOR_PORT), "--ip", "127.0.0.1", "--var", "PROBE_SECRET:s3cr3t"],
    {
      cwd: DIR,
      detached: true,
      env: { ...process.env, PROBE_SECRET: "s3cr3t", WRANGLER_SEND_METRICS: "false" },
      stdio: ["ignore", log, log]
    }
  );
  devRoot = proc.pid;
  logPid(`started wrangler dev pgid=${proc.pid} label=${label}`);
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/noop`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) {
        logPid(`label=${label} own workerd pids=${workerdPids().join(",")}`);
        return { proc, readyMs: Math.round(performance.now() - t0) };
      }
    } catch {}
    await sleep(250);
  }
  throw new Error("wrangler dev did not become ready");
}

async function stopDev(dev) {
  const pids = workerdPids();
  logPid(`killing pgid=${dev.proc.pid} and own workerd pids=${pids.join(",")}`);
  try { process.kill(-dev.proc.pid, "SIGKILL"); } catch {}
  for (const pid of pids) { try { process.kill(Number(pid), "SIGKILL"); } catch {} }
  devRoot = null;
  await sleep(1000);
}

async function run(code, { mode = "tool", path = "/run", timeoutMs = LIMIT_MS, watchRss = false, extra = {} } = {}) {
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
    const r = await fetch(`${BASE}${path}`, { method: "POST", body: JSON.stringify({ code, mode, ...extra }), signal: ctrl.signal });
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { code, mode, path, httpStatus: r.status, wallMs: Math.round(performance.now() - t0), peakRssKb: watchRss ? peakRssKb : undefined, body };
  } catch (err) {
    return { code, mode, path, wallMs: Math.round(performance.now() - t0), harnessError: String(err?.cause?.message ?? err?.message ?? err), killedForRss, peakRssKb: watchRss ? peakRssKb : undefined };
  } finally {
    clearTimeout(timer);
    if (watcher) clearInterval(watcher);
  }
}

const both = async (code) => ({ tool: await run(code), raw: await run(code, { mode: "raw" }) });
const alive = async () => {
  try { return (await fetch(`${BASE}/noop`, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; }
};

async function afterCheck() {
  const t0 = performance.now();
  let up = false;
  for (let i = 0; i < 20 && !up; i++) { up = await alive(); if (!up) await sleep(500); }
  const trivial = up ? await run("1+1", { timeoutMs: 15_000 }) : null;
  return { serverAliveAfter: up, recoveryWaitMs: Math.round(performance.now() - t0), trivialExecutionAfter: trivial };
}

const config = async () => (await fetch(`${BASE}/config`)).json();

const probes = {
  async P1() {
    return { config: await config(), ...(await both("const r = await codemode.lookup({id: 21}); console.log(r.value)")) };
  },
  async P3() {
    return { config: await config(), ...(await both('const r = await fetch("https://example.com"); return r.status')) };
  },
  async P4() {
    return {
      config: await config(),
      require: await both('return require("fs").readFileSync("/etc/hosts","utf8")'),
      importNodeFs: await both('const fs = await import("node:fs"); return fs.readFileSync("/etc/hosts","utf8")'),
      importFs: await both('const fs = await import("fs"); return fs.readFileSync("/etc/hosts","utf8")'),
      deno: await both('return await Deno.readTextFile("/etc/hosts")')
    };
  },
  async P5() {
    return {
      config: await config(),
      hostWorkerEnv: await (await fetch(`${BASE}/host-env`)).json(),
      processEnv: await both("return process.env.PROBE_SECRET"),
      processEnvKeys: await both("return Object.keys(process.env)"),
      globalEnv: await both("return typeof env === 'undefined' ? 'no global env' : env")
    };
  },
  async P6b_asyncHang() {
    return { note: "supplementary: async hang, shows the timeout option is honoured (not ignored)", config: await config(), tool: await run("await new Promise(() => {})", { timeoutMs: 60_000 }) };
  },
  async P6() {
    const cfg = await config();
    const res = await run("while (true) {}", { timeoutMs: LIMIT_MS });
    return { config: cfg, ...res, ...(await afterCheck()) };
  },
  async P6_loaderLimits() {
    const cfg = await config();
    const res = await run("while (true) {}", { path: "/run-loader-limits", timeoutMs: 30_000, extra: { cpuMs: 1000 } });
    return {
      note: "supplementary, NOT the hardened config: env.LOADER wrapped by this harness to add Worker Loader `limits: { cpuMs: 1000 }`, which codemode exposes no option for. Tests whether local workerd enforces that field at all. Harness cap 30 s.",
      config: cfg,
      ...res,
      ...(await afterCheck())
    };
  },
  async P7() {
    const cfg = await config();
    const bystander = run('await new Promise((r) => setTimeout(r, 5000)); return "bystander-ok"', { timeoutMs: LIMIT_MS });
    await sleep(500);
    const res = await run('const a = []; while (true) a.push("x".repeat(1e6))', { timeoutMs: LIMIT_MS, watchRss: true });
    return {
      config: cfg,
      ...res,
      bystanderStartedHalfSecondBefore: await bystander,
      ...(await afterCheck())
    };
  },
  async P9() {
    return { config: await config(), ...(await both("const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => codemode.lookup({id:i}))); console.log(Date.now()-t)")) };
  },
  async P12() {
    const report = "return p === undefined ? 'undefined' : { type: typeof p, version: p.version, pid: p.pid, platform: p.platform, cwd: (()=>{try{return p.cwd()}catch(e){return 'cwd threw: '+e.message}})(), envKeys: Object.keys(p.env ?? {}) }";
    return {
      config: await config(),
      functionConstructor: await both(`const p = this.constructor.constructor("return process")(); ${report}`),
      sloppyThis: await both(`const p = (function(){return this})().process; ${report}`),
      ambientProcess: await both(`const p = globalThis.process; ${report}`)
    };
  }
};

const requested = process.argv.slice(2);
const isolated = new Set(["P6", "P6_loaderLimits", "P7"]);
let dev = null;
try {
  for (const id of requested) {
    if (isolated.has(id) && dev) { await stopDev(dev); dev = null; }
    if (!dev) dev = await startDev(isolated.has(id) ? id : "main");
    console.log(`running ${id}`);
    const result = await probes[id]();
    save(`hardened-${id}.json`, result);
    console.log(JSON.stringify(result).slice(0, 800));
    if (isolated.has(id)) { await stopDev(dev); dev = null; }
  }
} finally {
  if (dev) await stopDev(dev);
}
