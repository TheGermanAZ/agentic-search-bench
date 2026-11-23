// Usage: ../mem-lock.sh node p7-runner.mjs <default|hardened>
// Runs the P7 probe in a child process, samples the child tree's RSS every 100 ms,
// and kills that child (only) at 4 GB RSS or 120 s.
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2] ?? "default";
const LIMIT_KB = 4 * 1024 * 1024;

function treeRssKb(root) {
  let pids = [root];
  for (let i = 0; i < pids.length; i++) {
    try {
      const kids = execFileSync("pgrep", ["-P", String(pids[i])]).toString().trim().split("\n").filter(Boolean).map(Number);
      pids.push(...kids);
    } catch {}
  }
  let total = 0;
  for (const p of pids) {
    try { total += Number(execFileSync("ps", ["-o", "rss=", "-p", String(p)]).toString().trim()) || 0; } catch {}
  }
  return total;
}

const started = Date.now();
const child = spawn(process.execPath, [join(here, "run-probes.mjs"), mode, "P7"], {
  env: { ...process.env, PROBE_SECRET: "s3cr3t" },
  stdio: ["ignore", "pipe", "pipe"],
});
let out = "";
child.stdout.on("data", (d) => (out += d));
child.stderr.on("data", (d) => (out += d));
let peakKb = 0;
let killedFor = null;
const timer = setInterval(() => {
  const kb = treeRssKb(child.pid);
  peakKb = Math.max(peakKb, kb);
  if (kb > LIMIT_KB) killedFor = "4GB";
  else if (Date.now() - started > 120_000) killedFor = "120s";
  if (killedFor) child.kill("SIGKILL");
}, 100);
child.on("exit", (code, signal) => {
  clearInterval(timer);
  const summary = { mode, childExit: code, signal, killedByHarness: killedFor, wallMs: Date.now() - started, peakTreeRssMb: Math.round(peakKb / 1024) };
  const tag = (mode === "hardened" ? "hardened-" : "") + "P7";
  writeFileSync(join(here, "out", tag + "-rss.txt"), JSON.stringify(summary, null, 2) + "\n");
  writeFileSync(join(here, "out", tag + "-child-output.txt"), out);
  console.log(out.slice(-4000));
  console.log(JSON.stringify(summary));
});
