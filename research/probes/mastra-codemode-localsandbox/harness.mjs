// Runs ONE probe against Mastra Code Mode (createCodeMode from @mastra/core/tools) in this process.
// Usage: node [--no-node-snapshot] harness.mjs <backend> <probe> <default|hardened>
// backend: localsandbox | isolated-vm | quickjs. Prints the record as JSON on the last stdout line.
// run-probes.mjs spawns this once per probe so a hung or crashed probe cannot take the others down.
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const [backend, probe, mode = 'default'] = process.argv.slice(2);
const IMPL = new URL(`../../impls/mastra-codemode-${backend}/`, import.meta.url).pathname;
const req = createRequire(IMPL + 'package.json');
const load = (spec) => import(pathToFileURL(req.resolve(spec)).href);

globalThis.__HOST_CANARY = 'host-canary-123';
const t0 = performance.now();
const { createCodeMode, createTool } = await load('@mastra/core/tools');
const { z } = await load('zod');

let hostCalls = 0;
const lookup = createTool({
  id: 'lookup',
  description: 'Look up a value by id. Waits 200 ms and returns { id, value: id * 2 }.',
  inputSchema: z.object({ id: z.number() }),
  outputSchema: z.object({ id: z.number(), value: z.number() }),
  execute: async (input) => {
    await new Promise((r) => setTimeout(r, 200));
    hostCalls += 1;
    return { id: input.id, value: input.id * 2 };
  },
});

const hardened = mode === 'hardened';
const HARDENED_TIMEOUT_MS = 5000;
const HARDENED_MEMORY_MB = 32;
let config;
let transport;
if (backend === 'localsandbox') {
  const { LocalSandbox } = await load('@mastra/core/workspace');
  const sandbox = hardened
    ? new LocalSandbox({ isolation: 'seatbelt', nativeSandbox: { allowNetwork: false, readOnly: true } })
    : new LocalSandbox();
  config = { tools: { lookup }, sandbox, ...(hardened ? { timeout: HARDENED_TIMEOUT_MS } : {}) };
} else if (backend === 'isolated-vm') {
  const { IsolatedVmCodeModeTransport } = await load('@mastra/isolated-vm');
  transport = new IsolatedVmCodeModeTransport(hardened ? { memoryLimitMb: HARDENED_MEMORY_MB } : {});
  config = { tools: { lookup }, ...(hardened ? { timeout: HARDENED_TIMEOUT_MS } : {}) };
} else if (backend === 'quickjs') {
  const { QuickJsCodeModeTransport } = await load('@mastra/quickjs');
  transport = new QuickJsCodeModeTransport(hardened ? { memoryLimitMb: HARDENED_MEMORY_MB } : {});
  config = { tools: { lookup }, ...(hardened ? { timeout: HARDENED_TIMEOUT_MS } : {}) };
} else {
  throw new Error('unknown backend ' + backend);
}
const { tool, instructions } = createCodeMode(config, transport);
const setupMs = performance.now() - t0;

async function run(code) {
  hostCalls = 0;
  const s = performance.now();
  let out;
  let threw = null;
  try {
    out = await tool.execute({ code }, {});
  } catch (e) {
    threw = String(e && e.stack ? e.stack : e);
  }
  return { code, wallMs: +(performance.now() - s).toFixed(1), hostCalls, out: clip(out), threw };
}

function clip(out) {
  if (!out || !Array.isArray(out.logs)) return out;
  return {
    ...out,
    logs: out.logs.map((l) => (l.length > 300 ? { length: l.length, head: l.slice(0, 80), tail: l.slice(-80) } : l)),
  };
}

const probes = {
  async P1() {
    return run(`const r = await external_lookup({id: 21}); console.log(r.value)`);
  },
  async P2() {
    return {
      literalSpecForm: await run(`console.log("A".repeat(200000)); "RETURNED"`),
      returnForm: await run(`console.log("A".repeat(200000)); return "RETURNED"`),
    };
  },
  async P3() {
    return run(`const r = await fetch("https://example.com"); return { status: r.status, bytes: (await r.text()).length }`);
  },
  async P4() {
    return {
      require: await run(`return require("fs").readFileSync("/etc/hosts","utf8").slice(0, 60)`),
      dynamicImport: await run(`const fs = await import("fs"); return fs.readFileSync("/etc/hosts","utf8").slice(0, 60)`),
      getBuiltinModule: await run(`return process.getBuiltinModule("fs").readFileSync("/etc/hosts","utf8").slice(0, 60)`),
      denoReadTextFile: await run(`return await Deno.readTextFile("/etc/hosts")`),
    };
  },
  async P5() {
    return {
      hostEnvHasSecret: process.env.PROBE_SECRET,
      spec: await run(`return process.env.PROBE_SECRET`),
      envKeys: await run(`return Object.keys(process.env)`),
    };
  },
  async P6() {
    return run(`while (true) {}`);
  },
  async P6x() {
    // Extra: does a runaway guest loop stall the host event loop (and so every other session in it)?
    let ticks = 0;
    const iv = setInterval(() => (ticks += 1), 100);
    const r = await run(`while (true) {}`);
    clearInterval(iv);
    return { ...r, hostTimerTicksEvery100ms: ticks, expectedTicksIfNotBlocked: Math.floor(r.wallMs / 100) };
  },
  async P7() {
    const mb = () => +(process.memoryUsage().rss / 1048576).toFixed(1);
    const rssBeforeMB = mb();
    const probe = await run(`const a = []; while (true) a.push("x".repeat(1e6))`);
    const rssAfterMB = mb();
    // Same process, after the memory probe: does the host still execute code and tool calls?
    const afterwards = await run(`const r = await external_lookup({id: 21}); return r.value`);
    const second = await run(`const a = []; while (true) a.push("x".repeat(1e6))`);
    await new Promise((r) => setTimeout(r, 1500));
    return { rssBeforeMB, probe, rssAfterMB, survivalCheck: afterwards, secondProbe: second, rssAfterSecondMB: mb() };
  },
  async P8() {
    return {
      first: await run(`globalThis.kept = 7; return "set"`),
      second: await run(`console.log(typeof kept === "undefined" ? "gone" : kept)`),
    };
  },
  async P9() {
    return run(`const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => external_lookup({id:i}))); console.log(Date.now()-t)`);
  },
  async P10() {
    return {
      spec: await run(`throw new Error("probe-boom")`),
      multiLine: await run(`const x = 1;\nconst y = 2;\nthrow new Error("probe-boom-line3");`),
      undefinedRef: await run(`const x = 1;\nnotDefinedAnywhere();`),
    };
  },
  async P11() {
    const first = await run(`return 1+1`);
    const times = [];
    for (let i = 0; i < 20; i++) times.push((await run(`return 1+1`)).wallMs);
    const sorted = [...times].sort((a, b) => a - b);
    return {
      oneTimeSetupMs: +setupMs.toFixed(1),
      oneTimeSetupCovers: 'import @mastra/core/tools + transport, createTool, createCodeMode',
      firstExecutionMs: first.wallMs,
      firstResult: first.out,
      medianMs: sorted[10],
      p90Ms: sorted[17],
      samples: times,
    };
  },
  async P12() {
    const attempts = {
      A_functionCtor: `return String(this.constructor.constructor("return process")())`,
      B_sloppyThis: `return String((function(){ return this })().process)`,
      C_canary: `return String(Function("return globalThis.__HOST_CANARY")())`,
      D_typeofs: `return [typeof process, typeof require, typeof Deno, typeof Bun, typeof fetch, typeof setTimeout].join(",")`,
      E_exec: `const p = Function("return process")(); return p.getBuiltinModule("child_process").execSync("echo PWNED; id -un").toString()`,
      F_globals: `return Object.getOwnPropertyNames(globalThis).filter(n => /process|ivm|require|host|external/i.test(n)).join(",")`,
      G_externalCtor: `return String(external_lookup.constructor("return typeof process")())`,
    };
    const rows = {};
    for (const [k, code] of Object.entries(attempts)) rows[k] = await run(code);
    return rows;
  },
};

if (probe === 'instructions') {
  console.log(JSON.stringify({ instructions }));
  process.exit(0);
}
console.log('@@start ' + process.memoryUsage().rss);
const record = await probes[probe]();
console.log(JSON.stringify({ backend, probe, mode, setupMs: +setupMs.toFixed(1), record }));
process.exit(0);
