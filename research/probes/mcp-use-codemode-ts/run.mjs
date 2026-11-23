// Runs probe.mjs once per probe in a child process, watching its RSS and wall time.
// Kills a child at 4 GB RSS or 120 s (SPEC), then writes out/<P>.txt and out/<P>.json.
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [pid, ...rest] = process.argv.slice(2);
const hardened = rest.includes("--hardened");
const name = (hardened ? "hardened-" : "") + pid;
const t0 = Date.now();
const child = spawn(process.execPath, [path.join(HERE, "probe.mjs"), pid, ...rest], { env: { ...process.env, PROBE_SECRET: "s3cr3t", MCP_USE_ANONYMIZED_TELEMETRY: "false" } });
let stdout = "", stderr = "", peak = 0, killedBy = null;
child.stdout.on("data", d => (stdout += d));
child.stderr.on("data", d => (stderr += d));
const rssOf = p => { try { return parseInt(execFileSync("ps", ["-o", "rss=", "-p", String(p)]).toString().trim(), 10) * 1024; } catch { return 0; } };
const timer = setInterval(() => {
  const rss = rssOf(child.pid); peak = Math.max(peak, rss);
  if (rss >= 4 * 2 ** 30) { killedBy = `harness: ${(rss / 2 ** 30).toFixed(2)} GB RSS after ${((Date.now() - t0) / 1000).toFixed(1)} s`; child.kill("SIGKILL"); }
  else if (Date.now() - t0 >= 120000) { killedBy = "harness: still running after 120 s"; child.kill("SIGKILL"); }
}, 100);
child.on("exit", (code, signal) => {
  clearInterval(timer);
  const wall = ((Date.now() - t0) / 1000).toFixed(1);
  let summary, raw = "";
  const line = stdout.trim().split("\n").filter(l => l.startsWith("{")).pop();
  if (line) { const d = JSON.parse(line); summary = d.summary; raw = d.raw; }
  else if (killedBy) summary = { probe: pid, config: hardened ? "hardened" : "default", outcome: "no-limit-within-120s", detail: `${killedBy}; the probe process (host) never returned`, display: killedBy.includes("GB") ? `no-limit-within-120s (${(peak / 2 ** 30).toFixed(1)} GB)` : "no-limit-within-120s" };
  else summary = { probe: pid, config: hardened ? "hardened" : "default", outcome: "error", detail: `host process died: exit ${code} signal ${signal}; stderr tail: ${stderr.slice(-600)}`, display: "host crash" };
  summary.peak_child_rss_mb = Math.round(peak / 2 ** 20);
  summary.wall_s = +wall;
  writeFileSync(path.join(HERE, "out", `${name}.txt`), `probe ${name}\n${raw}\nchild exit=${code} signal=${signal} killedBy=${killedBy} wall=${wall}s peakRSS=${Math.round(peak / 2 ** 20)}MB\nstderr tail:\n${stderr.slice(-3000)}\n`);
  writeFileSync(path.join(HERE, "out", `${name}.json`), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary).slice(0, 400));
});
