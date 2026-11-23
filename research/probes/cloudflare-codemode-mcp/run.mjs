import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, "out");
const CLONE = join(DIR, "../../impls/cloudflare-codemode-mcp/mcp");
const LIMIT_MS = 120_000;
const RSS_KILL_KB = 4 * 1024 * 1024;
mkdirSync(OUT, { recursive: true });

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

function workerdRssKb(root) {
  try {
    const own = new Set(descendants(root).map(String));
    const pids = execSync("pgrep -f workerd", { encoding: "utf8" }).trim().split("\n").filter((pid) => own.has(pid));
    if (!pids.length) return 0;
    return execSync(`ps -o rss= -p ${pids.join(",")}`, { encoding: "utf8" }).trim().split("\n").reduce((s, l) => s + Number(l.trim() || 0), 0);
  } catch {
    return 0;
  }
}

function runVitest(testFile, { watch = false } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const proc = spawn(join(CLONE, "node_modules/.bin/vitest"), ["run", testFile, "--silent=false", "--reporter=verbose"], {
      cwd: CLONE,
      detached: true,
      env: { ...process.env, PROBE_SECRET: "s3cr3t", CI: "1" }
    });
    let log = "";
    proc.stdout.on("data", (d) => (log += d));
    proc.stderr.on("data", (d) => (log += d));
    let peakRssKb = 0;
    let killedFor = null;
    const kill = (why) => {
      if (killedFor) return;
      killedFor = why;
      const pids = descendants(proc.pid);
      try { process.kill(-proc.pid, "SIGKILL"); } catch {}
      for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch {} }
    };
    const timer = watch ? setTimeout(() => kill(`harness-timeout-${LIMIT_MS + 15_000}ms`), LIMIT_MS + 15_000) : null;
    const watcher = watch
      ? setInterval(() => {
          const rss = workerdRssKb(proc.pid);
          peakRssKb = Math.max(peakRssKb, rss);
          if (rss > RSS_KILL_KB) kill("rss-over-4GB");
        }, 250)
      : null;
    proc.on("close", () => {
      clearTimeout(timer);
      clearInterval(watcher);
      const results = {};
      for (const line of log.split("\n")) {
        const i = line.indexOf("PROBE_RESULT ");
        if (i >= 0) {
          const { id, data } = JSON.parse(line.slice(i + "PROBE_RESULT ".length));
          results[id] = data;
        }
      }
      resolve({ results, log, wallMs: Date.now() - t0, peakRssKb, killedFor });
    });
  });
}

const mode = process.argv[2] ?? "all";

if (mode === "all" || mode === "fast") {
  const dest = join(CLONE, "tests/zz-probe.test.ts");
  writeFileSync(dest, readFileSync(join(DIR, "probes.test.ts")));
  const { results, log } = await runVitest("tests/zz-probe.test.ts");
  rmSync(dest);
  writeFileSync(join(OUT, "vitest-fast.log"), log);
  for (const [id, data] of Object.entries(results)) writeFileSync(join(OUT, `${id}.json`), JSON.stringify(data, null, 2) + "\n");
  console.log("fast probes:", Object.keys(results).join(" "));
}

if (mode === "all" || mode === "hang") {
  for (const probe of ["P6", "P7"]) {
    for (const tool of ["execute", "search"]) {
      if (process.argv[3] && process.argv[3] !== `${probe}_${tool}`) continue;
      const dest = join(CLONE, "tests/zz-hang.test.ts");
      writeFileSync(dest, readFileSync(join(DIR, `hang-${probe}.test.ts`), "utf8").replaceAll("__TOOL__", tool));
      const r = await runVitest("tests/zz-hang.test.ts", { watch: true });
      rmSync(dest, { force: true });
      const id = `${probe}_${tool}`;
      writeFileSync(join(OUT, `vitest-${id}.log`), r.log);
      writeFileSync(join(OUT, `${id}.json`), JSON.stringify({ wallMs: r.wallMs, peakRssKb: r.peakRssKb, killedFor: r.killedFor, result: r.results[id] ?? null }, null, 2) + "\n");
      console.log(id, { wallMs: r.wallMs, peakRssKb: r.peakRssKb, killedFor: r.killedFor, got: Boolean(r.results[id]) });
    }
  }
}
