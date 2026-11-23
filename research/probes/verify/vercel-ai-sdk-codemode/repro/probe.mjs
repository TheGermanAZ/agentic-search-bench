// Runs one SPEC probe against @ai-sdk/code-mode 1.0.136 through the same path an agent uses:
// experimental_createCodeModeTool(tools, options) builds the AI SDK tool, and the probe calls its
// execute({js}, {toolCallId, messages}) exactly as generateText would after a model tool call.
// Usage (normally through watch.mjs): node probe.mjs <P1..P12|P2b|...> [--hardened]
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const NM = fileURLToPath(new URL('../../../../impls/vercel-ai-sdk-codemode/pkg/node_modules/', import.meta.url));

process.env.PROBE_SECRET = 's3cr3t';
globalThis.__HOST_CANARY = 'host-canary-123';

const { experimental_createCodeModeTool } = await import(pathToFileURL(NM + '@ai-sdk/code-mode/dist/index.js').href);
const { tool, jsonSchema } = await import(pathToFileURL(NM + 'ai/dist/index.js').href);

const MiB = 1024 * 1024;
// Public option executionPolicy (packages/code-mode/src/types.ts:162-196). Values are the strictest budget the
// underlying run docs publish (run content/docs/advanced/limits.mdx createRunner example), mapped to code-mode names.
const HARDENED_POLICY = {
  timeoutMs: 15_000,
  cpuTimeoutMs: 5_000,
  memoryLimitBytes: 32 * MiB,
  maxStackSizeBytes: 1024 * 1024,
  maxSourceBytes: 128 * 1024,
  maxResultBytes: 512 * 1024,
  maxConsoleOutputBytes: 32 * 1024,
  maxToolInputBytes: 256 * 1024,
  maxToolOutputBytes: MiB,
  maxBridgeRequests: 100,
  maxInFlightBridgeRequests: 8,
};

let hostCalls = 0;
const lookup = tool({
  description: 'Look up a value by id. Waits 200 ms and returns { id, value: id * 2 }.',
  inputSchema: jsonSchema({ type: 'object', properties: { id: { type: 'number' } }, required: ['id'], additionalProperties: false }),
  outputSchema: jsonSchema({ type: 'object', properties: { id: { type: 'number' }, value: { type: 'number' } }, required: ['id', 'value'] }),
  execute: async ({ id }) => {
    hostCalls += 1;
    await new Promise((r) => setTimeout(r, 200));
    return { id, value: id * 2 };
  },
});
const failing = tool({
  description: 'Always throws a host-side error that carries a secret-looking message.',
  inputSchema: jsonSchema({ type: 'object', properties: {}, additionalProperties: false }),
  execute: async () => {
    throw new Error('host-tool-boom internal detail db=postgres://user:pw@host');
  },
});

const [probeId, flag] = process.argv.slice(2);
const hardened = flag === '--hardened';
const codeMode = experimental_createCodeModeTool({ lookup, failing }, hardened ? { executionPolicy: HARDENED_POLICY } : {});
let callNo = 0;
const exec = (js) => codeMode.execute({ js }, { toolCallId: `probe-${++callNo}`, messages: [] });

const probes = {
  P1: ['const r = await tools.lookup({id: 21}); console.log(r.value); return r.value;'],
  P2: ['console.log("A".repeat(200000)); "RETURNED"'],
  P2b: ['console.log("A".repeat(200000)); return "RETURNED";'],
  P2c: ['console.log("A".repeat(1000)); return "RETURNED";'],
  P2d: ['return "A".repeat(200000);'],
  P2e: ['return "A".repeat(2000000);'],
  P3: ['const r = await fetch("https://example.com"); return r.status;'],
  P4: ['return require("fs").readFileSync("/etc/hosts","utf8");'],
  P4b: ['const fs = await import("fs"); return fs.readFileSync("/etc/hosts","utf8");'],
  P4c: ['return await Deno.readTextFile("/etc/hosts");'],
  P5: ['return process.env.PROBE_SECRET;'],
  P5b: ['return typeof process + "|" + Object.getOwnPropertyNames(globalThis).join(",");'],
  P6: ['while (true) {}'],
  P7: ['const a = []; while (true) a.push("x".repeat(1e6));'],
  P8: ['globalThis.kept = 7; return "set";', 'return typeof kept === "undefined" ? "gone" : kept;'],
  P9: ['const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => tools.lookup({id:i}))); const dt = Date.now()-t; console.log(dt); return dt;'],
  P9b: ['const r = await Promise.all(Array.from({length: 40}, (_, i) => tools.lookup({id: i}))); return r.length;'],
  P10: ['throw new Error("probe-boom")'],
  P10b: ['const x = 1;\nconst y = 2;\nfunction inner() { throw new Error("probe-boom"); }\ninner();'],
  P10c: ['return await tools.failing({});'],
  P10d: ['return await tools.lookup({id: "not-a-number"});'],
  P11: ['return 1+1;'],
  P12: ['return String(this.constructor.constructor("return process")());'],
  P12b: ['return String((function(){return this})().process);'],
  P12c: ['return String(tools.lookup.constructor("return process")());'],
  P12d: ['return typeof globalThis.__HOST_CANARY + "|" + typeof Function + "|" + typeof eval;'],
  P12e: ['return String(Object.getPrototypeOf(async function(){}).constructor("return process")());'],
};

function describeError(e) {
  return { name: e?.name, code: e?.code, message: e?.message, details: e?.details, stack: e?.stack, string: String(e) };
}

async function once(source) {
  hostCalls = 0;
  const t0 = performance.now();
  try {
    const v = await exec(source);
    const value = typeof v === 'string' && v.length > 5000 ? { stringLength: v.length, head: v.slice(0, 40) } : v;
    return { ok: true, value, wallMs: performance.now() - t0, hostCalls };
  } catch (e) {
    return { ok: false, error: describeError(e), wallMs: performance.now() - t0, hostCalls };
  }
}

const record = { impl: 'vercel-ai-sdk-codemode', probe: probeId, config: hardened ? { executionPolicy: HARDENED_POLICY } : 'defaults (no executionPolicy)', node: process.version };
const sources = probes[probeId];
if (!sources) throw new Error(`unknown probe ${probeId}`);
record.source = sources;
if (probeId === 'P1') record.toolDescriptionSeenByModel = codeMode.description;

if (probeId === 'P11') {
  const tFirst = performance.now();
  const first = await once(sources[0]);
  record.firstExecutionMs = performance.now() - tFirst;
  const times = [];
  for (let i = 0; i < 20; i++) times.push((await once(sources[0])).wallMs);
  const sorted = [...times].sort((a, b) => a - b);
  record.first = first;
  record.timesMs = times.map((t) => +t.toFixed(2));
  record.medianMs = +((sorted[9] + sorted[10]) / 2).toFixed(2);
  record.p90Ms = +sorted[17].toFixed(2);
  record.summary = { median: record.medianMs, p90: record.p90Ms, first: +record.firstExecutionMs.toFixed(1) };
} else if (probeId === 'P6' || probeId === 'P7') {
  const sibling = 'const r = await tools.lookup({id: 21}); return r.value;';
  const tMain = performance.now();
  const main = once(sources[0]);
  await new Promise((r) => setTimeout(r, 100));
  const siblingStartMs = Math.round(performance.now() - tMain);
  const concurrent = await once(sibling);
  const siblingEndMs = Math.round(performance.now() - tMain);
  const last = await main;
  record.siblingTiming = { siblingStartMs, siblingEndMs, note: 'ms since the main program started; a start far above 100 means the host event loop was blocked' };
  const after = await once(sibling);
  record.runs = [last];
  record.concurrentSiblingRun = concurrent;
  record.afterRun = after;
  record.summary = { siblingStartMs, siblingEndMs, error: last.ok ? null : `${last.error.name}: ${last.error.code ?? ''} ${last.error.message}`.slice(0, 300), ms: Math.round(last.wallMs), sibling: concurrent.ok ? concurrent.value : 'failed', after: after.ok ? after.value : 'failed' };
} else {
  record.runs = [];
  for (const s of sources) record.runs.push(await once(s));
  const last = record.runs.at(-1);
  record.summary = last.ok ? { value: last.value, ms: Math.round(last.wallMs), hostCalls: last.hostCalls } : { error: `${last.error.name}: ${last.error.code ?? ''} ${last.error.message}`.slice(0, 300), ms: Math.round(last.wallMs), hostCalls: last.hostCalls };
}
record.hostRssAfterMB = +(process.memoryUsage().rss / MiB).toFixed(1);
writeFileSync(process.env.PROBE_RECORD ?? `${HERE}out/${probeId}${hardened ? '-hardened' : ''}.json`, JSON.stringify(record, null, 2));
process.exit(0);
