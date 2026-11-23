// Robustness checks beyond SPEC.md, run against one implementation through a small adapter.
// Usage: node|bun rcore.mjs <adapter.mjs> <config> <testId>
// Prints one JSON record to stdout. rwatch.mjs wraps this with RSS sampling and the 4 GB / 120 s kill.
//
// The adapter default-exports async (config, host) => ({ T, F, R, ret, exec(code), close() }):
//   T, F, R  guest expressions for the lookup, failing and rich tools
//   ret      true if the guest returns a value with `return`, false if only console output comes back
//   exec     runs one program on the SHARED instance (what a server would hold) and resolves to the raw result
import { pathToFileURL } from 'node:url';

const [adapterPath, config, testId] = process.argv.slice(2);
process.env.PROBE_SECRET = 's3cr3t';
globalThis.__HOST_CANARY = 'host-canary-123';

const T0 = performance.now();
const now = () => Math.round(performance.now() - T0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const events = [];
process.on('unhandledRejection', (e) => events.push(`${now()}ms unhandledRejection: ${String(e?.stack ?? e).slice(0, 400)}`));
process.on('uncaughtException', (e) => events.push(`${now()}ms uncaughtException: ${String(e?.stack ?? e).slice(0, 400)}`));

// Host event-loop lag: how long the host's own loop was frozen (a shared server cannot answer anyone while frozen).
let lastTick = performance.now();
let maxLag = 0;
setInterval(() => {
  const t = performance.now();
  maxLag = Math.max(maxLag, t - lastTick - 20);
  lastTick = t;
}, 20).unref();

const state = { started: 0, done: 0 };
const host = {
  lookup: async (id) => {
    state.started++;
    await sleep(200);
    state.done++;
    return { id, value: id * 2 };
  },
  failing: async () => {
    throw new Error('host-tool-boom internal detail db=postgres://user:pw@host');
  },
  rich: async () => ({ fn: () => `HOST-FN-CALLED:${typeof process}`, d: new Date(0), m: new Map([[1, 2]]), s: 'plain' }),
};

const { default: makeAdapter } = await import(pathToFileURL(adapterPath).href);
const a = await makeAdapter(config, host);
const out = (expr) => (a.ret ? `return (${expr});` : `console.log(JSON.stringify(${expr}));`);
const esc = (expr) => `(()=>{try{return String(${expr})}catch(x){return "threw "+(x&&x.message)}})()`;

function clip(v) {
  const seen = new WeakSet();
  let chars = 0;
  const s = JSON.stringify(
    v,
    (k, x) => {
      if (typeof x === 'string') {
        chars += x.length;
        return x.length > 600 ? `${x.slice(0, 300)}…[${x.length} chars]…${x.slice(-200)}` : x;
      }
      if (typeof x === 'bigint') return String(x);
      if (typeof x === 'function') return `[function ${x.name}]`;
      if (x && typeof x === 'object') {
        if (seen.has(x)) return '[circular]';
        seen.add(x);
      }
      return x;
    },
  );
  return { value: s === undefined ? undefined : JSON.parse(s), stringChars: chars };
}

async function timed(code, label) {
  const start = now();
  const before = { ...state };
  try {
    const r = await a.exec(code);
    return { label, startMs: start, ms: now() - start, ok: true, result: clip(r), callsStarted: state.started - before.started };
  } catch (e) {
    return { label, startMs: start, ms: now() - start, ok: false, threw: String(e?.stack ?? e).slice(0, 1500), callsStarted: state.started - before.started };
  }
}

// Each test resolves within CAP_MS even if the implementation never returns, so the record still gets written.
const CAP_MS = 110_000;
const capped = (p, label) => Promise.race([p, sleep(CAP_MS).then(() => ({ label, ok: false, threw: `NO-RETURN within ${CAP_MS} ms` }))]);

const LOOP = 'while (true) {}';
const BOMB = 'const a = []; while (true) a.push("x".repeat(1e6));';
const FLOOD = 'while (true) console.log("x".repeat(1e6));';
const REGEX = 'const t = Date.now(); const m = /^(a+)+$/.test("a".repeat(40) + "b");';
// An adapter for a non-JS guest (Starlark, Python) can supply its own neighbor request as a.normalCode.
const normal = () => a.normalCode ?? `const r = await ${a.T}({id: 21}); ${out('r.value')}`;

async function neighbor(aggressor, n = 1) {
  if (aggressor == null) return { notApplicable: true };
  const aggressors = Array.from({ length: n }, (_, i) => capped(timed(aggressor, `aggressor${i}`), `aggressor${i}`));
  await sleep(150);
  const b = await capped(timed(normal(), 'B(+150ms)'), 'B');
  await sleep(Math.max(0, 1000 - now()));
  const c = await capped(timed(normal(), 'C(+1s)'), 'C');
  const done = await Promise.all(aggressors);
  const after = await capped(timed(normal(), 'after'), 'after');
  return { aggressors: done, b, c, after };
}

const tests = {
  // State left on shared prototypes/globals: sequential, then while another execution is in flight.
  R1: async () => {
    const A = await timed(`Object.prototype.polluted = "A"; Array.prototype.leak = "A"; globalThis.leftover = "A-secret"; JSON.stringify = function () { return "hijacked"; }; Math.random = () => 4; ${out('"set"')}`, 'A');
    const B = await timed(out('[typeof ({}).polluted, typeof [].leak, typeof globalThis.leftover, JSON.stringify({a: 1}), Math.random() === 4]'), 'B');
    return { A, B };
  },
  R1c: async () => {
    const pA = timed(`Object.prototype.pollutedC = "A"; globalThis.leftC = "A-secret"; await ${a.T}({id: 1}); await ${a.T}({id: 2}); ${out('"A done"')}`, 'A');
    await sleep(100);
    const B = await timed(out('[typeof ({}).pollutedC, typeof globalThis.leftC]'), 'B(concurrent)');
    return { A: await pA, B };
  },
  // Host objects reachable through tool results, the tool function, and errors.
  R2a: async () => timed(`const r = await ${a.T}({id: 1}); ${out(`[Object.getPrototypeOf(r) === Object.prototype, ${esc('r.constructor.constructor("return typeof process")()')}, ${esc(`${a.T}.constructor("return typeof process")()`)}, ${esc('Object.getOwnPropertyNames(globalThis).join(",")')}]`)}`),
  R2b: async () => timed(`let o; try { await ${a.F}(); o = "no throw"; } catch (e) { o = { type: typeof e, name: e && e.name, msg: String(e && e.message !== undefined ? e.message : e), stack: String(e && e.stack || "").slice(0, 800), own: Object.getOwnPropertyNames(Object(e)), esc: ${esc('e.constructor.constructor("return typeof process")()')} }; } ${out('o')}`),
  R2c: async () => timed(`const r = await ${a.R}(); ${out(`{ keys: Object.keys(r || {}), fn: typeof (r && r.fn), call: ${esc('r.fn()')}, d: typeof (r && r.d), ds: String(r && r.d), m: typeof (r && r.m), ms: ${esc('JSON.stringify(r.m)')} }`)}`),
  // Deep recursion, then a deep structure handed back to the host.
  R3: async () => {
    const A = await timed(`function f(n) { return f(n + 1) + 1; } let o; try { f(0); o = "no throw"; } catch (e) { o = String(e); } ${out('o')}`, 'recursion');
    const deep = await timed(`const root = []; let x = root; for (let i = 0; i < 100000; i++) { x[0] = []; x = x[0]; } ${out('root')}`, 'deep-return');
    const after = await timed(out('"alive"'), 'after');
    return { A, deep, after };
  },
  R4: async () => timed(`${REGEX} ${out('[m, Date.now() - t]')}`),
  // Many tool calls; are any still running on the host after the program has been answered?
  R5: async () => {
    const r = await capped(timed(`const rs = await Promise.all(Array.from({length: 2000}, (_, i) => ${a.T}({id: i}))); ${out('rs.length')}`), 'R5');
    const atReturn = { ...state };
    await sleep(3000);
    return { r, atReturn, after3s: { ...state } };
  },
  R6: async () => capped(timed(`await ${a.T}({id: 1}); ${LOOP}`), 'R6'),
  R7a: async () => capped(timed(`await new Promise(() => {}); ${out('"resolved?"')}`), 'R7a'),
  R7b: async () => {
    const r = await capped(timed(`for (let i = 0; i < 5; i++) ${a.T}({id: i}); ${LOOP}`), 'R7b');
    const atReturn = { ...state };
    await sleep(1500);
    const after = await timed(normal(), 'after');
    return { r, atReturn, after1500ms: { ...state }, after };
  },
  R8a: async () => timed(`console.log("x".repeat(20 * 1024 * 1024)); ${out('"done"')}`),
  R8b: async () => timed(out('"y".repeat(20 * 1024 * 1024)')),
  R8c: async () => capped(timed(FLOOD), 'R8c'),
  R9a: async () => neighbor(LOOP),
  R9b: async () => neighbor(BOMB),
  R9c: async () => neighbor(FLOOD),
  R9d: async () => neighbor(REGEX),
  R9e: async () => neighbor(LOOP, 8),
  // extraTests may also override a default test id (non-JS guests pass their own code to the same shapes).
  ...(a.extraTests ? a.extraTests({ timed, capped, out, esc, state, sleep, now, neighbor }) : {}),
};

const record = { impl: a.name, config, test: testId, notes: a.notes };
try {
  record.data = await tests[testId]();
} catch (e) {
  record.harnessError = String(e?.stack ?? e);
}
record.hostAfter = {
  objectProtoPolluted: ({}).polluted ?? ({}).pollutedC ?? null,
  arrayProtoLeak: [].leak ?? null,
  jsonStringifyIntact: JSON.stringify({ a: 1 }) === '{"a":1}',
};
if (a.stats) { try { record.adapterStats = await a.stats(); } catch (e) { record.adapterStats = { error: String(e) }; } }
record.hostMaxEventLoopLagMs = Math.round(maxLag);
record.hostEvents = events;
record.totalMs = now();
const recText = JSON.stringify(record);
if (process.env.RECORD_FILE) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.RECORD_FILE, recText);
}
console.log('@@RECORD@@' + (process.env.RECORD_FILE ? '"in RECORD_FILE"' : recText));
try {
  await Promise.race([a.close?.(), sleep(2000)]);
} catch {}
process.exit(0);
