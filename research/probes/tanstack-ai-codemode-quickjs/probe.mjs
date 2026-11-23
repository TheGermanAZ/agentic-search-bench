// Runs one SPEC probe against TanStack AI Code Mode (@tanstack/ai-code-mode 1.1.2) with one isolate driver,
// through the agent path: createCodeModeTool({driver, tools, ...}) builds the execute_typescript server tool,
// and the probe calls its execute({typescriptCode}) the way chat() does after a model tool call.
// The same file runs in every tanstack-ai-codemode-<driver> folder; DRIVER below picks the driver.
// Usage (normally through watch.mjs): node probe.mjs <P1..P12|P2b|...> [--hardened]   (bun for quickjs-bun)
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DRIVER = 'quickjs';
const HERE = fileURLToPath(new URL('.', import.meta.url));
const NM = fileURLToPath(new URL(`../../impls/tanstack-ai-codemode-${DRIVER}/pkg/node_modules/`, import.meta.url));
const load = (p) => import(pathToFileURL(NM + p).href);

process.env.PROBE_SECRET = 's3cr3t';
globalThis.__HOST_CANARY = 'host-canary-123';

const { createCodeModeTool } = await load('@tanstack/ai-code-mode/dist/esm/index.js');
const { toolDefinition } = await load('@tanstack/ai/dist/esm/index.js');
const { z } = await load('zod/index.js');
const drivers = {
  node: async () => (await load('@tanstack/ai-isolate-node/dist/esm/index.js')).createNodeIsolateDriver(),
  quickjs: async () => (await load('@tanstack/ai-isolate-quickjs/dist/esm/index.js')).createQuickJSIsolateDriver(),
  'quickjs-bun': async (hardened) =>
    (await load('@tanstack/ai-isolate-quickjs-bun/dist/esm/index.js')).createQuickJSBunIsolateDriver(hardened ? { maxToolCalls: 100 } : {}),
};

// Public createCodeModeTool options `timeout` (ms) and `memoryLimit` (MB): docs/code-mode/code-mode.md:179-180,
// packages/ai-code-mode/src/create-code-mode-tool.ts:96-97. The QuickJS Bun driver also exposes maxToolCalls.
const HARDENED = { timeout: 5_000, memoryLimit: 32 };

let hostCalls = 0;
const lookup = toolDefinition({
  name: 'lookup',
  description: 'Look up a value by id. Waits 200 ms and returns { id, value: id * 2 }.',
  inputSchema: z.object({ id: z.number() }),
  outputSchema: z.object({ id: z.number(), value: z.number() }),
}).server(async ({ id }) => {
  hostCalls += 1;
  await new Promise((r) => setTimeout(r, 200));
  return { id, value: id * 2 };
});
const failing = toolDefinition({
  name: 'failing',
  description: 'Always throws a host-side error that carries a secret-looking message.',
  inputSchema: z.object({}),
}).server(async () => {
  throw new Error('host-tool-boom internal detail db=postgres://user:pw@host');
});

const [probeId, flag] = process.argv.slice(2);
const hardened = flag === '--hardened';
const setupStart = performance.now();
const driver = await drivers[DRIVER](hardened);
const codeTool = createCodeModeTool({ driver, tools: [lookup, failing], ...(hardened ? HARDENED : {}) });
const setupMs = performance.now() - setupStart;
const exec = (typescriptCode) => codeTool.execute({ typescriptCode });

const probes = {
  P1: ['const r = await external_lookup({id: 21}); console.log(r.value); return r.value;'],
  P2: ['console.log("A".repeat(200000)); "RETURNED"'],
  P2b: ['console.log("A".repeat(200000)); return "RETURNED";'],
  P2c: ['for (let i = 0; i < 20; i++) console.log("A".repeat(200000)); return "RETURNED";'],
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
  P9: ['const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => external_lookup({id:i}))); const dt = Date.now()-t; console.log(dt); return dt;'],
  P9b: ['const r = await Promise.all(Array.from({length: 40}, (_, i) => external_lookup({id: i}))); return r.length;'],
  P10: ['throw new Error("probe-boom")'],
  P10b: ['const x = 1;\nconst y = 2;\nfunction inner() { throw new Error("probe-boom"); }\ninner();'],
  P10c: ['return await external_failing({});'],
  P10d: ['return await external_lookup({id: "not-a-number"});'],
  P11: ['return 1+1;'],
  P12: ['return String(this.constructor.constructor("return process")());'],
  P12b: ['return String((function(){return this})().process);'],
  P12c: ['return String(external_lookup.constructor("return process")());'],
  P12d: ['return typeof globalThis.__HOST_CANARY + "|" + typeof Function + "|" + typeof eval;'],
  P12e: ['return String(Object.getPrototypeOf(async function(){}).constructor("return process")());'],
  P12f: ['const names = Object.getOwnPropertyNames(globalThis).filter(n => n.startsWith("__")); const out = {}; for (const n of names) { const v = globalThis[n]; out[n] = typeof v + ":" + (v && Object.getOwnPropertyNames(Object.getPrototypeOf(v) || {}).join("/")); } return out;'],
  P12g: ['const ref = globalThis.__external_lookup_ref ?? globalThis.__external_lookup_impl; let d; try { d = String(ref.deref && ref.deref()); } catch (e) { d = "deref threw: " + e.message; } let c; try { c = String(ref.constructor.constructor("return process")()); } catch (e) { c = "ctor threw: " + e.message; } return { deref: d, ctor: c };'],
  P7b: ['const a = []; try { while (true) a.push("x".repeat(1e6)); } catch (e) { return { pushed: a.length, err: String(e) }; }'],
  P7c: ['const a = []; try { while (true) a.push(new Array(1e5).fill(1)); } catch (e) { return { pushed: a.length, err: String(e) }; }'],
  P7d: ['let s = "x"; try { while (true) s = s + s; } catch (e) { return { len: s.length, err: String(e) }; }'],
};

function clip(v) {
  if (typeof v === 'string' && v.length > 5000) return { stringLength: v.length, head: v.slice(0, 40), tail: v.slice(-60) };
  return v;
}
function summarizeResult(r) {
  const logs = r?.logs ?? [];
  return {
    success: r?.success,
    result: clip(r?.result),
    error: r?.error ? { ...r.error, stack: r.error.stack } : undefined,
    logCount: logs.length,
    logChars: logs.reduce((n, l) => n + l.length, 0),
    logs: logs.map(clip),
  };
}

async function once(source) {
  hostCalls = 0;
  const t0 = performance.now();
  try {
    const r = await exec(source);
    return { returned: summarizeResult(r), wallMs: performance.now() - t0, hostCalls };
  } catch (e) {
    return { threw: { name: e?.name, message: e?.message, stack: e?.stack }, wallMs: performance.now() - t0, hostCalls };
  }
}
const brief = (o) =>
  o.threw
    ? `THREW ${o.threw.name}: ${o.threw.message}`.slice(0, 300)
    : o.returned.success
      ? { result: o.returned.result, logCount: o.returned.logCount, logChars: o.returned.logChars }
      : `${o.returned.error?.name}: ${o.returned.error?.message}`.slice(0, 300);

const record = { impl: `tanstack-ai-codemode-${DRIVER}`, probe: probeId, config: hardened ? { createCodeModeTool: HARDENED, ...(DRIVER === 'quickjs-bun' ? { driver: { maxToolCalls: 100 } } : {}) } : 'defaults', runtime: typeof Bun !== 'undefined' ? `bun ${Bun.version}` : `node ${process.version}`, setupMs };
const sources = probes[probeId];
if (!sources) throw new Error(`unknown probe ${probeId}`);
record.source = sources;
if (probeId === 'P1') record.toolDescriptionSeenByModel = codeTool.description;

if (probeId === 'P11') {
  const first = await once(sources[0]);
  const times = [];
  for (let i = 0; i < 20; i++) times.push((await once(sources[0])).wallMs);
  const sorted = [...times].sort((a, b) => a - b);
  record.first = first;
  record.timesMs = times.map((t) => +t.toFixed(2));
  record.medianMs = +((sorted[9] + sorted[10]) / 2).toFixed(2);
  record.p90Ms = +sorted[17].toFixed(2);
  record.summary = { median: record.medianMs, p90: record.p90Ms, first: +first.wallMs.toFixed(1), driverSetup: +setupMs.toFixed(1), firstResult: brief(first) };
} else if (probeId === 'P6' || probeId === 'P7') {
  const sibling = 'const r = await external_lookup({id: 21}); return r.value;';
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
  record.summary = { siblingStartMs, siblingEndMs, main: brief(last), ms: Math.round(last.wallMs), sibling: brief(concurrent), siblingMs: Math.round(concurrent.wallMs), after: brief(after) };
} else {
  record.runs = [];
  for (const s of sources) record.runs.push(await once(s));
  const last = record.runs.at(-1);
  record.summary = { out: brief(last), ms: Math.round(last.wallMs), hostCalls: last.hostCalls };
}
record.hostRssAfterMB = +(process.memoryUsage().rss / (1024 * 1024)).toFixed(1);
writeFileSync(process.env.PROBE_RECORD ?? `${HERE}out/${probeId}${hardened ? '-hardened' : ''}.json`, JSON.stringify(record, null, 2));
process.exit(0);
