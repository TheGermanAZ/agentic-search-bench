// Runs probes P1-P12 against @utcp/code-mode through its public API:
// CodeModeUtcpClient.create() -> registerManual() -> callToolChain().
// Library: research/impls/utcp-codemode/repo/typescript-library (commit e5fdc31, @utcp/code-mode 1.2.13).
// Usage: node run-probes.mjs [probeId ...]   (no args runs all)

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const LIB = fileURLToPath(new URL('../../../../impls/utcp-codemode/repo/typescript-library/', import.meta.url));
const OUT = HERE + 'out/';
mkdirSync(OUT, { recursive: true });

// P5: the host process env must hold the secret before the sandbox starts.
process.env.PROBE_SECRET = 's3cr3t';
// P12 canary: a host-only global. If sandboxed code can see it, the sandbox leaked.
globalThis.__HOST_CANARY = 'host-canary-123';

// Only the published entry point and its two plugin dependencies, resolved from the pinned install.
const { CodeModeUtcpClient } = await import(pathToFileURL(LIB + 'dist/index.js').href);
const directCall = await import(pathToFileURL(LIB + 'node_modules/@utcp/direct-call/dist/index.js').href);
const { addFunctionToUtcpDirectCall } = directCall;

// ---- The host tool: lookup({id}) -> waits 200 ms -> {id, value: id*2}; counts host-side calls.
let hostCalls = 0;
const lookupImpl = async (id) => {
  await new Promise((r) => setTimeout(r, 200));
  hostCalls += 1;
  return { id, value: id * 2 };
};
// direct-call spreads the args object into positional params (direct-call dist/index.js, callTool: Object.values(toolArgs)),
// so the host function receives the id itself, not {id}.
addFunctionToUtcpDirectCall('lookup', lookupImpl);
addFunctionToUtcpDirectCall('hostManual', async () => ({
  utcp_version: '1.0.0',
  manual_version: '1.0.0',
  tools: [
    {
      name: 'lookup',
      description: 'Look up a value by id. Waits 200 ms and returns { id, value: id * 2 }.',
      inputs: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
      outputs: { type: 'object', properties: { id: { type: 'number' }, value: { type: 'number' } } },
      tags: ['probe'],
      tool_call_template: { call_template_type: 'direct-call', callable_name: 'lookup' },
    },
  ],
}));

// ---- One-time setup, timed (P11).
const setupStart = performance.now();
const client = await CodeModeUtcpClient.create(HERE, null);
const reg = await client.registerManual({ name: 'host', call_template_type: 'direct-call', callable_name: 'hostManual' });
const setupMs = performance.now() - setupStart;
if (!reg.success) throw new Error('registerManual failed: ' + reg.errors.join('; '));

// ---- Helpers
const fmtRecord = (rec) => JSON.stringify(rec, null, 2);

async function runOnce(code, opts = {}) {
  hostCalls = 0;
  const t0 = performance.now();
  let out;
  let threw = null;
  try {
    out = await client.callToolChain(code, opts.timeout, opts.memoryLimit);
  } catch (e) {
    threw = String(e && e.stack ? e.stack : e);
  }
  const wallMs = performance.now() - t0;
  return { wallMs, hostCalls, out, threw };
}

// Save a record, truncating very large log strings in the printed copy but keeping their length.
function summarizeLogs(logs) {
  return (logs || []).map((l) =>
    l.length > 400 ? { length: l.length, head: l.slice(0, 120), tail: l.slice(-120) } : l
  );
}

function save(id, body) {
  writeFileSync(OUT + id + '.txt', fmtRecord(body) + '\n');
}

const probes = {};

probes.P1 = async () => {
  const code = `const r = await host.lookup({id: 21}); console.log(r.value)`;
  const r = await runOnce(code);
  save('P1', { probe: 'P1 tool-call', code, wallMs: r.wallMs, hostCalls: r.hostCalls, result: r.out?.result, logs: r.out?.logs, threw: r.threw });
};

probes.P2 = async () => {
  const literal = `console.log("A".repeat(200000)); "RETURNED"`;
  const withReturn = `console.log("A".repeat(200000)); return "RETURNED"`;
  const forms = {};
  for (const [name, code] of [['literal-spec-form', literal], ['return-form', withReturn]]) {
    const r = await runOnce(code);
    const logs = r.out?.logs || [];
    const printed = logs.join('\n');
    forms[name] = {
      code,
      wallMs: r.wallMs,
      result: r.out?.result,
      logCount: logs.length,
      logTotalChars: printed.length,
      printedACount: (printed.match(/A/g) || []).length,
      logs: summarizeLogs(logs),
      threw: r.threw,
    };
    writeFileSync(OUT + `P2-full-log-${name}.txt`, logs.join('\n'));
  }
  save('P2', { probe: 'P2 output', forms });
};

probes.P3 = async () => {
  const code = `await fetch("https://example.com")`;
  const r = await runOnce(code);
  save('P3', { probe: 'P3 network', code, wallMs: r.wallMs, result: r.out?.result, logs: r.out?.logs, threw: r.threw });
};

probes.P4 = async () => {
  const cases = {
    'require-fs': `require("fs").readFileSync("/etc/hosts","utf8")`,
    'dynamic-import-fs': `await import("fs")`,
  };
  const rows = {};
  for (const [name, code] of Object.entries(cases)) {
    const r = await runOnce(code);
    rows[name] = { code, result: r.out?.result, logs: r.out?.logs, threw: r.threw };
  }
  save('P4', { probe: 'P4 filesystem', cases: rows });
};

probes.P5 = async () => {
  const code = `process.env.PROBE_SECRET`;
  const r = await runOnce(code);
  save('P5', { probe: 'P5 env secrets', hostEnvSet: process.env.PROBE_SECRET, code, result: r.out?.result, logs: r.out?.logs, threw: r.threw });
};

probes.P6 = async () => {
  const code = `while (true) {}`;
  const r = await runOnce(code);
  save('P6', { probe: 'P6 infinite loop', code, wallMs: r.wallMs, wallSeconds: +(r.wallMs / 1000).toFixed(2), result: r.out?.result, logs: r.out?.logs, threw: r.threw });
};

probes.P7 = async () => {
  const code = `const a = []; while (true) a.push("x".repeat(1e6))`;
  let peakRss = 0;
  const sampler = setInterval(() => {
    const rss = process.memoryUsage().rss;
    if (rss > peakRss) peakRss = rss;
  }, 20);
  const killer = setTimeout(() => {
    save('P7', { probe: 'P7 memory', code, outcome: 'no-limit-within-120s', peakHostRssMB: +(peakRss / 1048576).toFixed(1) });
    process.exit(0);
  }, 120000);
  const baselineRss = process.memoryUsage().rss;
  const r = await runOnce(code);
  clearInterval(sampler);
  clearTimeout(killer);
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  save('P7', {
    probe: 'P7 memory',
    code,
    wallMs: r.wallMs,
    baselineRssMB: +(baselineRss / 1048576).toFixed(1),
    peakHostRssMB: +(peakRss / 1048576).toFixed(1),
    result: r.out?.result,
    logs: r.out?.logs,
    threw: r.threw,
  });
};

probes.P8 = async () => {
  const first = await runOnce(`globalThis.kept = 7; "set"`);
  const second = await runOnce(`console.log(typeof kept === "undefined" ? "gone" : kept)`);
  save('P8', {
    probe: 'P8 state',
    execution1: { code: 'globalThis.kept = 7', result: first.out?.result, logs: first.out?.logs, threw: first.threw },
    execution2: { code: 'console.log(typeof kept === "undefined" ? "gone" : kept)', logs: second.out?.logs, threw: second.threw },
    verdict: (second.out?.logs || []).join('') === 'gone' ? 'fresh' : 'persists?',
  });
};

probes.P9 = async () => {
  const code = `const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => host.lookup({id:i}))); console.log(Date.now()-t)`;
  const r = await runOnce(code);
  save('P9', { probe: 'P9 parallel', code, wallMs: r.wallMs, hostCalls: r.hostCalls, result: r.out?.result, logs: r.out?.logs, threw: r.threw });
};

probes.P10 = async () => {
  const code = `throw new Error("probe-boom")`;
  const multi = `const x = 1;\nconst y = 2;\nthrow new Error("probe-boom-line3");`;
  const r = await runOnce(code);
  const m = await runOnce(multi);
  save('P10', { probe: 'P10 errors', code, result: r.out?.result, logs: r.out?.logs, threw: r.threw, multiLineCase: { code: multi, logs: m.out?.logs, threw: m.threw } });
};

probes.P11 = async () => {
  const code = `1+1`;
  const times = [];
  const samples = [];
  for (let i = 0; i < 20; i++) {
    const r = await runOnce(code);
    times.push(r.wallMs);
    samples.push({ i, ms: +r.wallMs.toFixed(2), result: r.out?.result, threw: r.threw });
  }
  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p90 = sorted[Math.ceil(0.9 * sorted.length) - 1];
  save('P11', {
    probe: 'P11 startup',
    code,
    executions: 20,
    medianMs: +median.toFixed(2),
    p90Ms: +p90.toFixed(2),
    oneTimeSetupMs: +setupMs.toFixed(2),
    oneTimeSetupCovers: 'CodeModeUtcpClient.create + registerManual(direct-call), measured once at harness start',
    samples,
  });
};

probes.P12 = async () => {
  // Each attempt uses `return` so the value (or the error) is visible. The wrapper only returns what `return` gives.
  const attempts = {
    'A: return this.constructor.constructor("return process")()': `return this.constructor.constructor("return process")()`,
    'B: return (function(){return this})().process': `return (function(){ return this; })().process`,
    'C: return Function("return typeof process")()': `return Function("return typeof process")()`,
    'D: canary return Function("return globalThis.__HOST_CANARY")()': `return Function("return globalThis.__HOST_CANARY")()`,
    'E: return __callToolRef.constructor.constructor("return typeof process")()': `return __callToolRef.constructor.constructor("return typeof process")()`,
    'F: return typeof require/module/ivm/Deno/Bun': `return [typeof require, typeof module, typeof ivm, typeof Deno, typeof Bun].join(",")`,
    'G: return own global names matching process|ivm|require|HOST': `return Object.getOwnPropertyNames(globalThis).filter(n => /process|ivm|require|host/i.test(n)).join(",")`,
    'H: return this === globalThis': `return this === globalThis`,
  };
  const rows = {};
  for (const [name, code] of Object.entries(attempts)) {
    const r = await runOnce(code);
    rows[name] = { code, result: r.out?.result, logs: r.out?.logs, threw: r.threw };
  }
  save('P12', { probe: 'P12 escape', hostCanaryValue: globalThis.__HOST_CANARY, attempts: rows });
};

// ---- Run
const requested = process.argv.slice(2);
const order = Object.keys(probes).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
const toRun = requested.length ? requested : order;
for (const id of toRun) {
  if (!probes[id]) throw new Error('unknown probe ' + id);
  const t = performance.now();
  await probes[id]();
  console.log(`${id} done in ${((performance.now() - t) / 1000).toFixed(2)} s`);
}
console.log('setupMs', setupMs.toFixed(1));
