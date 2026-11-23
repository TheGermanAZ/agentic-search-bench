// Usage: node run-probes.mjs [P1 P2 ...]   (run P7 alone through ../mem-lock.sh)
// Each probe is a .ts file run in a fresh `tsx` process, the runner the project's README and example use.
// Kills only the child it started: at 120 s, or at 4 GB tree RSS.
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tsx = join(here, "../../impls/janwilmake-agent-codemode/repo/node_modules/tsx/dist/cli.mjs");
const probesDir = join(here, "probes");
const outDir = join(here, "out");
const only = new Set(process.argv.slice(2));

// tsx runs the script in a grandchild node process, so limits and kills apply to the whole tree we started.
function treePids(root) {
  const pids = [root];
  for (let i = 0; i < pids.length; i++) {
    try { pids.push(...execFileSync("pgrep", ["-P", String(pids[i])]).toString().trim().split("\n").filter(Boolean).map(Number)); } catch {}
  }
  return pids;
}

function treeRssKb(root) {
  const pids = treePids(root);
  let kb = 0;
  for (const p of pids) { try { kb += Number(execFileSync("ps", ["-o", "rss=", "-p", String(p)]).toString().trim()) || 0; } catch {} }
  return kb;
}

function runTs(file, { sampleRss = false } = {}) {
  const countFile = join(outDir, `.calls-${file}.log`);
  rmSync(countFile, { force: true });
  return new Promise((resolve) => {
    const start = performance.now();
    const child = spawn(process.execPath, [tsx, join(probesDir, file)], {
      cwd: probesDir,
      env: { ...process.env, PROBE_SECRET: "s3cr3t", LOOKUP_COUNT_FILE: countFile },
    });
    let stdout = "", stderr = "", peakKb = 0, killedFor = null;
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setInterval(() => {
      if (sampleRss) {
        const kb = treeRssKb(child.pid);
        peakKb = Math.max(peakKb, kb);
        if (kb > 4 * 1024 * 1024) killedFor = "4GB";
      }
      if (performance.now() - start > 120_000) killedFor = "120s";
      if (killedFor) for (const pid of [...treePids(child.pid)].reverse()) { try { process.kill(pid, "SIGKILL"); } catch {} }
    }, sampleRss ? 100 : 500);
    child.on("exit", (code, signal) => {
      clearInterval(timer);
      const hostCalls = existsSync(countFile) ? readFileSync(countFile, "utf8").trim().split("\n").filter(Boolean).length : 0;
      rmSync(countFile, { force: true });
      resolve({ file, exitCode: code, signal, killedByHarness: killedFor, wallMs: Math.round(performance.now() - start), hostCalls, ...(sampleRss ? { peakTreeRssMb: Math.round(peakKb / 1024) } : {}), stdoutChars: stdout.length, stdout, stderr });
    });
  });
}

function save(name, obj) {
  const clip = (s) => (s.length > 4000 ? s.slice(0, 200) + `\n...[harness clipped ${s.length} chars for this file; full length in stdoutChars]...\n` + s.slice(-300) : s);
  const norm = (r) => ({ ...r, stdout: clip(r.stdout), stderr: clip(r.stderr) });
  const text = JSON.stringify(Array.isArray(obj) ? obj.map(norm) : obj.file ? norm(obj) : obj, null, 2);
  writeFileSync(join(outDir, name + ".txt"), text + "\n");
  console.log(`--- ${name}\n${text.slice(0, 2500)}`);
}

const probes = {
  P1: async () => save("P1", await runTs("P1.ts")),
  P2: async () => {
    const r = await runTs("P2.ts");
    save("P2", { ...r, aChars: (r.stdout.match(/A/g) || []).length, containsRETURNED: r.stdout.includes("RETURNED") });
  },
  P3: async () => save("P3", await runTs("P3.ts")),
  P4: async () => save("P4", await runTs("P4.ts")),
  P5: async () => save("P5", await runTs("P5.ts")),
  P6: async () => save("P6", await runTs("P6.ts")),
  P7: async () => save("P7", await runTs("P7.ts", { sampleRss: true })),
  P8: async () => save("P8", [await runTs("P8a.ts"), await runTs("P8b.ts")]),
  P9: async () => save("P9", await runTs("P9.ts")),
  P10: async () => save("P10", await runTs("P10.ts")),
  P11: async () => {
    const times = [];
    for (let i = 0; i < 20; i++) times.push((await runTs("P11.ts")).wallMs);
    const s = [...times].sort((a, b) => a - b);
    save("P11", { note: "each run is a fresh tsx process; there is no separate setup step", timesMs: times, medianMs: s[10], p90Ms: s[18] });
  },
  P12: async () => save("P12", [await runTs("P12a.ts"), await runTs("P12b.ts")]),
};

for (const [name, fn] of Object.entries(probes)) {
  if (only.size ? !only.has(name) : name === "P7") continue;
  await fn();
}
