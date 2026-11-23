// Hardened rerun (research/probes/RUBRIC.md) of P1, P3, P4, P5, P6, P7, P9, P12 against @utcp/code-mode.
// Hardened config: callToolChain(code, TIMEOUT_MS, MEMORY_MB), the two public positional args
// (typescript-library/src/code_mode_utcp_client.ts:181-184). No other public limit exists.
// Usage: node hardened-run.mjs [probeId ...]   (no args runs all). Run P7 through research/probes/mem-lock.sh.

import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TIMEOUT_MS = 10000;
const MEMORY_MB = 64;

const HERE = fileURLToPath(new URL('.', import.meta.url));
const LIB = fileURLToPath(new URL('../../../../impls/utcp-codemode/repo/typescript-library/', import.meta.url));
const OUT = HERE + 'out/';
mkdirSync(OUT, { recursive: true });

process.env.PROBE_SECRET = 's3cr3t';
globalThis.__HOST_CANARY = 'host-canary-123';

const { CodeModeUtcpClient } = await import(pathToFileURL(LIB + 'dist/index.js').href);
const { addFunctionToUtcpDirectCall } = await import(pathToFileURL(LIB + 'node_modules/@utcp/direct-call/dist/index.js').href);

let hostCalls = 0;
addFunctionToUtcpDirectCall('lookup', async (id) => {
  await new Promise((r) => setTimeout(r, 200));
  hostCalls += 1;
  return { id, value: id * 2 };
});
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

const client = await CodeModeUtcpClient.create(HERE, null);
const reg = await client.registerManual({ name: 'host', call_template_type: 'direct-call', callable_name: 'hostManual' });
if (!reg.success) throw new Error('registerManual failed: ' + reg.errors.join('; '));

async function runOnce(code, timeout = TIMEOUT_MS, memoryLimit = MEMORY_MB) {
  hostCalls = 0;
  const t0 = performance.now();
  let out;
  let threw = null;
  try {
    out = await client.callToolChain(code, timeout, memoryLimit);
  } catch (e) {
    threw = String(e && e.stack ? e.stack : e);
  }
  return { wallMs: +(performance.now() - t0).toFixed(1), hostCalls, result: out?.result, logs: out?.logs, threw };
}

const config = { timeoutMs: TIMEOUT_MS, memoryLimitMB: MEMORY_MB, call: 'client.callToolChain(code, 10000, 64)' };
const save = (id, body) => writeFileSync(OUT + `hardened-${id}.txt`, JSON.stringify({ config, ...body }, null, 2) + '\n');

const probes = {};

probes.P1 = async () => {
  const code = `const r = await host.lookup({id: 21}); console.log(r.value)`;
  save('P1', { probe: 'P1 tool-call (sanity)', code, ...(await runOnce(code)) });
};

probes.P3 = async () => {
  const code = `await fetch("https://example.com")`;
  save('P3', { probe: 'P3 network', code, ...(await runOnce(code)) });
};

probes.P4 = async () => {
  const cases = { 'require-fs': `require("fs").readFileSync("/etc/hosts","utf8")`, 'dynamic-import-fs': `await import("fs")` };
  const rows = {};
  for (const [name, code] of Object.entries(cases)) rows[name] = { code, ...(await runOnce(code)) };
  save('P4', { probe: 'P4 filesystem', cases: rows });
};

probes.P5 = async () => {
  const code = `return process.env.PROBE_SECRET`;
  save('P5', { probe: 'P5 env secrets', hostEnvSet: process.env.PROBE_SECRET, code, ...(await runOnce(code)) });
};

probes.P6 = async () => {
  const code = `while (true) {}`;
  const r = await runOnce(code);
  save('P6', { probe: 'P6 infinite loop', code, wallSeconds: +(r.wallMs / 1000).toFixed(2), ...r });
};

probes.P7 = async () => {
  const code = `const a = []; while (true) a.push("x".repeat(1e6))`;
  const otherCode = `let s = 0; for (let i = 0; i < 3; i++) { const r = await host.lookup({id: i}); s += r.value; } return s`;
  let peakRss = 0;
  const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 20);
  const killer = setTimeout(() => {
    save('P7', { probe: 'P7 memory', code, outcome: 'no-limit-within-120s', peakHostRssMB: +(peakRss / 1048576).toFixed(1) });
    process.exit(0);
  }, 120000);
  const baselineRss = process.memoryUsage().rss;
  // A second session runs concurrently in the same host process while P7 grows; it must still finish.
  const [p7, concurrent] = await Promise.all([runOnce(code), (async () => {
    const t0 = performance.now();
    const out = await client.callToolChain(otherCode, TIMEOUT_MS, MEMORY_MB);
    return { wallMs: +(performance.now() - t0).toFixed(1), result: out.result, logs: out.logs, expected: 6 };
  })()]);
  clearInterval(sampler);
  clearTimeout(killer);
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  const after = await runOnce(`return 1 + 1`);
  save('P7', {
    probe: 'P7 memory',
    code,
    hostPid: process.pid,
    baselineRssMB: +(baselineRss / 1048576).toFixed(1),
    peakHostRssMB: +(peakRss / 1048576).toFixed(1),
    p7,
    concurrentSession: concurrent,
    trivialAfter: { code: 'return 1 + 1', ...after },
    hostSurvived: after.result === 2,
  });
};

probes.P9 = async () => {
  const code = `const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => host.lookup({id:i}))); console.log(Date.now()-t)`;
  save('P9', { probe: 'P9 parallel', code, ...(await runOnce(code)) });
};

probes.P12 = async () => {
  const attempts = {
    'A: return this.constructor.constructor("return process")()': `return this.constructor.constructor("return process")()`,
    'B: return (function(){return this})().process': `return (function(){ return this; })().process`,
    'C: return Function("return typeof process")()': `return Function("return typeof process")()`,
    'D: canary return Function("return globalThis.__HOST_CANARY")()': `return Function("return globalThis.__HOST_CANARY")()`,
    'F: return typeof require/module/ivm/Deno/Bun': `return [typeof require, typeof module, typeof ivm, typeof Deno, typeof Bun].join(",")`,
  };
  const rows = {};
  for (const [name, code] of Object.entries(attempts)) rows[name] = { code, ...(await runOnce(code)) };
  save('P12', { probe: 'P12 escape', hostCanaryValue: globalThis.__HOST_CANARY, attempts: rows });
};

// The typescript-library README documents an options object, callToolChain(code, { timeout, memoryLimit })
// (typescript-library/README.md:79-82). The signature is positional, so this checks what that documented form does.
probes.READMEFORM = async () => {
  const rows = {};
  for (const [name, code] of [['P1', `const r = await host.lookup({id: 21}); console.log(r.value)`], ['P6', `while (true) {}`]]) {
    hostCalls = 0;
    const t0 = performance.now();
    let out, threw = null;
    try { out = await client.callToolChain(code, { timeout: TIMEOUT_MS, memoryLimit: MEMORY_MB }); } catch (e) { threw = String(e?.stack ?? e); }
    rows[name] = { code, wallMs: +(performance.now() - t0).toFixed(1), hostCalls, result: out?.result, logs: out?.logs, threw };
  }
  save('README-options-form', { probe: 'README options-object form', call: 'client.callToolChain(code, { timeout: 10000, memoryLimit: 64 })', rows });
};

const order = ['P1', 'P3', 'P4', 'P5', 'P6', 'P9', 'P12', 'READMEFORM'];
const toRun = process.argv.slice(2).length ? process.argv.slice(2) : order;
for (const id of toRun) {
  if (!probes[id]) throw new Error('unknown probe ' + id);
  const t = performance.now();
  await probes[id]();
  console.log(`${id} done in ${((performance.now() - t) / 1000).toFixed(2)} s`);
}
