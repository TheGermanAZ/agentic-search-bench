// Hardened driver: runs each hardened probe in its own Node process with the SPEC stop rules (120 s, 4 GB RSS)
// and writes out/hardened-<probe>.json. Usage: node hardened-run.mjs [probe ...].
// Run P7 and P7js through research/probes/mem-lock.sh.
import { execFileSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ALL = ["P1", "P1js", "P3", "P3js", "P4", "P4js", "P5", "P5js", "P6", "P6js", "P9", "P9js", "P12", "P12js"];

const rssKb = (pid) => {
  try {
    return Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim()) || 0;
  } catch {
    return 0;
  }
};

const shrink = (s) => (typeof s === "string" && s.length > 1000 ? { chars: s.length, head: s.slice(0, 300), tail: s.slice(-300) } : s);
const shrinkRun = (r) => r && { ...r, stdout: shrink(r.stdout), stderr: shrink(r.stderr) };

function runWorker(id) {
  return new Promise((resolve) => {
    const started = performance.now();
    const child = spawn(process.execPath, [join(here, "hardened-probe.mjs"), id], {
      env: { ...process.env, PROBE_SECRET: "s3cr3t" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.error(`${id}: worker pid ${child.pid}`);
    let stdout = "";
    let stderr = "";
    let peak = 0;
    let killed = null;
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const sampler = setInterval(() => {
      const rss = rssKb(child.pid);
      peak = Math.max(peak, rss);
      if (rss > 4 * 1024 * 1024 && !killed) {
        killed = "rss-4GB";
        child.kill("SIGKILL");
      }
    }, 100);
    const timer = setTimeout(() => {
      killed ??= "time-120s";
      child.kill("SIGKILL");
    }, 120_000);
    child.on("close", (code, signal) => {
      clearInterval(sampler);
      clearTimeout(timer);
      let parsed = null;
      try {
        parsed = JSON.parse(stdout.trim().split("\n").pop());
      } catch {}
      resolve({ id, workerPid: child.pid, exitCode: code, signal, killed, wallMs: Math.round(performance.now() - started), peakRssKbSampled: peak, stderr: stderr.slice(0, 2000), parsed });
    });
  });
}

for (const id of process.argv.slice(2).length ? process.argv.slice(2) : ALL) {
  const res = await runWorker(id);
  if (res.parsed) {
    for (const key of ["concurrentSession", "sameInstanceAfter", "freshInstanceAfter"]) res.parsed[key] = shrinkRun(res.parsed[key]);
    res.parsed.runs = res.parsed.runs?.map(shrinkRun);
  }
  writeFileSync(join(here, "out", `hardened-${id}.json`), `${JSON.stringify(res, null, 2)}\n`);
  const first = res.parsed?.runs?.[0];
  console.log(`${id}\tkilled=${res.killed} wall=${res.wallMs}ms exit=${first?.exitCode} ms=${first?.ms} stderr=${JSON.stringify(first?.stderr ?? res.stderr).slice(0, 160)}`);
}
