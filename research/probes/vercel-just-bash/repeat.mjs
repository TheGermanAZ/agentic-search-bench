// Repeats one probe worker in separate processes and writes out/<probe>-repeats.json with every run.
// Usage: node repeat.mjs <P6|P7|P11|...> [runs]   (default 5)
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [probe, countArg] = process.argv.slice(2);
const runs = Number(countArg ?? 5);
const rows = [];
for (let k = 1; k <= runs; k += 1) {
  const started = performance.now();
  const raw = execFileSync(process.execPath, [join(here, "probe.mjs"), probe], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, PROBE_SECRET: "s3cr3t" },
  });
  const wallMs = Math.round(performance.now() - started);
  const parsed = JSON.parse(raw.trim().split("\n").pop());
  if (probe === "P11") {
    rows.push({ run: k, wallMs, setupMs: parsed.setupMs, sameInstance: parsed.sameInstance, freshInstance: parsed.freshInstance });
  } else {
    const r = parsed.runs[0];
    rows.push({ run: k, wallMs, execMs: r.ms, exitCode: r.exitCode, stderr: r.stderr.trim(), peakRssKb: parsed.peakRssKb });
  }
}
const summary = { probe, runs, rows };
writeFileSync(join(here, "out", `${probe}-repeats.json`), `${JSON.stringify(summary, null, 2)}\n`);
for (const row of rows) console.log(JSON.stringify(row));
