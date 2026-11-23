// Usage: PROBE_SECRET=s3cr3t node run-probes.mjs <default|hardened> [P1 P2 ...]
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as t from "../../impls/shift-labs-codemode/core/node_modules/typebox/build/index.mjs";
import { Codemode } from "../../impls/shift-labs-codemode/core/dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "out");
mkdirSync(outDir, { recursive: true });

const mode = process.argv[2] ?? "default";
const only = new Set(process.argv.slice(3));
const prefix = mode === "hardened" ? "hardened-" : "";

if (process.env.PROBE_SECRET !== "s3cr3t") throw new Error("run with PROBE_SECRET=s3cr3t");

let hostCalls = 0;
function hostPlugin(rl) {
  rl.setName("host");
  rl.setVersion("1.0.0");
  rl.registerAction("lookup", {
    access: "read",
    description: "Wait 200 ms, then return { id, value: id * 2 }.",
    inputSchema: t.Object({ id: t.Number() }, { additionalProperties: false }),
    execute: async ({ id }) => {
      hostCalls++;
      await new Promise((r) => setTimeout(r, 200));
      return { id, value: id * 2 };
    },
  });
}

// Hardened: the tightest values of the documented public options (docs/sdk.md "Instance lifecycle").
// The engine floors memory at 8 MB, but a worker cannot start below 12 MB (out/hardened-min-memory.txt), so 16 MB.
// outputLimit minimum is 3 lines / 1,024 bytes.
const HARDENED = {
  timeoutMs: 5_000,
  memoryLimitBytes: 16 * 1024 * 1024,
  maxRunsPerWorker: 1,
  outputLimit: { lines: 3, bytes: 1024 },
  outputDir: join(outDir, "outbox"),
};
const opts = mode === "hardened" ? HARDENED : { outputDir: join(outDir, "outbox") };

const t0 = performance.now();
const cm = Codemode.create({ plugins: [hostPlugin], ...opts });
const createMs = performance.now() - t0;

function save(name, obj) {
  const text = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  writeFileSync(join(outDir, prefix + name + ".txt"), text + "\n");
  console.log(`--- ${prefix}${name}\n${text.length > 3000 ? text.slice(0, 3000) + "\n...[harness display cut]" : text}`);
}

async function run(code, extra) {
  const before = hostCalls;
  const s = performance.now();
  const r = await cm.execute(code, extra);
  const ms = Math.round((performance.now() - s) * 100) / 100;
  return { code, ms, hostCalls: hostCalls - before, ...r };
}

const probes = {
  async P1() {
    save("P1", await run(`const r = await host.lookup({id: 21}); console.log(r.value)`));
  },
  async P2() {
    const literal = await run(`console.log("A".repeat(200000)); "RETURNED"`);
    const ret = await run(`console.log("A".repeat(200000)); return "RETURNED"`);
    const summarize = (r) => ({
      code: r.code,
      result: r.result,
      truncated: r.truncated,
      fullResultPath: r.fullResultPath,
      error: r.error,
      logsCount: r.logs.length,
      logChars: r.logs.reduce((n, l) => n + l.length, 0),
      aCharsInLogs: r.logs.join("").split("A").length - 1,
      logsTail: r.logs.map((l) => (l.length > 300 ? l.slice(0, 80) + " ...<" + l.length + " chars>... " + l.slice(-200) : l)),
    });
    save("P2", { literal: summarize(literal), returnForm: summarize(ret) });
  },
  async P3() {
    const a = await run(`const r = await fetch("https://example.com"); return r.status`);
    const b = await run(`const r = await globalThis.fetch("https://example.com"); return r.status`);
    save("P3", { literalFetch: a, globalThisFetch: b });
  },
  async P4() {
    const a = await run(`return require("fs").readFileSync("/etc/hosts","utf8")`);
    const b = await run(`const fs = await import("fs"); return fs.readFileSync("/etc/hosts","utf8").slice(0,80)`);
    save("P4", { requireFs: a, dynamicImport: b });
  },
  async P5() {
    const a = await run(`return process.env.PROBE_SECRET`);
    const b = await run(`return Object.keys(process.env).length`);
    // The worker shares the host's PID, so `ps eww` on it prints the host's environment. Only a boolean leaves the run.
    const c = await run(`const o = require("node:child_process").execSync("ps eww -o command= -p " + process.pid).toString(); return { sawProbeSecret: /PROBE_SECRET=s3cr3t/.test(o) }`);
    save("P5", { processEnv: a, envKeyCount: b, hostEnvViaPs: c, hostHasSecret: process.env.PROBE_SECRET === "s3cr3t" });
  },
  async P6() {
    const r = await run(`while (true) {}`, mode === "hardened" ? undefined : undefined);
    const after = await run(`return 1+1`);
    save("P6", { loop: r, hostAliveAfter: after.result === 2 });
  },
  async P7() {
    const r = await run(`const a = []; while (true) a.push("x".repeat(1e6))`);
    const r2 = process.env.P7_LITERAL_ONLY ? "skipped" : await run(`const a = []; while (true) a.push(Math.random().toString(36).repeat(3e4))`);
    const after = await run(`return 1+1`);
    save("P7", { repeatedString: r, distinctStrings: r2, hostAliveAfter: after.result === 2, hostRssMbAtEnd: Math.round(process.memoryUsage().rss / 1048576) });
  },
  async P8() {
    const a = await run(`globalThis.kept = 7`);
    const b = await run(`console.log(typeof kept === "undefined" ? "gone" : kept)`);
    const c = await run(`var keptVar = 9; process.keptOnProcess = 11`);
    const d = await run(`console.log(typeof keptVar, process.keptOnProcess)`);
    save("P8", { exec1: a, exec2: b, viaProcessObject: [c, d] });
  },
  async P9() {
    save("P9", await run(`const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => host.lookup({id:i}))); console.log(Date.now()-t)`));
  },
  async P10() {
    const a = await run(`throw new Error("probe-boom")`);
    const b = await run(`const x = 1;\nconst y = 2;\nthrow new Error("probe-boom")`);
    save("P10", { oneLine: a, threeLines: b });
  },
  async P11() {
    const c0 = performance.now();
    const cmP11 = Codemode.create({ plugins: [hostPlugin], ...opts });
    const c1 = performance.now();
    await cmP11.execute(`return 1+1`);
    const firstExecMs = Math.round((performance.now() - c1) * 100) / 100;
    const times = [];
    for (let i = 0; i < 20; i++) {
      const st = performance.now();
      await cmP11.execute(`return 1+1`);
      times.push(Math.round((performance.now() - st) * 100) / 100);
    }
    cmP11.dispose();
    const s = [...times].sort((x, y) => x - y);
    const cmFresh = Codemode.create({ plugins: [hostPlugin], maxRunsPerWorker: 1 });
    const fresh = [];
    for (let i = 0; i < 20; i++) {
      const st = performance.now();
      await cmFresh.execute(`return 1+1`);
      fresh.push(Math.round((performance.now() - st) * 100) / 100);
    }
    cmFresh.dispose();
    const f = [...fresh].sort((x, y) => x - y);
    save("P11", {
      createMs: Math.round((c1 - c0) * 100) / 100,
      firstExecuteMs_spawnsPooledWorker: firstExecMs,
      note: "first execute() of the instance spawns the pooled worker; later runs reuse it",
      pooledTimesMs: times,
      pooledMedian: s[10],
      pooledP90: s[18],
      maxRunsPerWorker1TimesMs: fresh,
      maxRunsPerWorker1Median: f[10],
      maxRunsPerWorker1P90: f[18],
    });
  },
  async P12() {
    const a = await run(`return this.constructor.constructor("return process")()`);
    const b = await run(`return (function(){return this})().process`);
    const c = await run(`return typeof process + " pid=" + process.pid + " hostPid=" + ${process.pid} + " versions.node=" + process.versions.node`);
    const d = await run(`return require("node:child_process").execSync("echo PWNED").toString()`);
    const e = await run(`return Function("return typeof process")()`);
    save("P12", { thisConstructor: a, sloppyThis: b, processGlobal: c, childProcessEcho: d, functionCtor: e });
  },
};

for (const [name, fn] of Object.entries(probes)) {
  if (only.size && !only.has(name)) continue;
  try {
    await fn();
  } catch (err) {
    save(name, { harnessError: String(err?.stack ?? err) });
  }
}
cm.dispose();
