// Vercel Run (npm `run` 2.1.13): QuickJS compiled to WASM in a pooled worker thread, a fresh QuickJS context per run,
// async host functions, so `await Promise.all([...])` overlaps corpus calls.
// Run's own console writes to the host process's stdout and never reaches the caller, and its global is non-writable,
// so the prelude shadows `console` with a lexical binding that keeps the first LIMITS.maxOutput characters inside the
// guest and returns them with the result.
import { RunError, createRunner, setMaxWorkers, type HostFunctionGroup } from "run";
import { corpusApi, jsGuide } from "../sandbox";
import type { Corpus } from "../search";
import { CORPUS_NAMES, LIMITS, OutputBuffer, callCorpus, cleanError, slot, wallClockMessage } from "./host";
import { mapStack } from "./js-wrap";
import type { Engine } from "./types";

/** Corpus calls one program may have waiting at once. The prelude queues beyond this; Run fails the run past its own cap. */
const GUEST_IN_FLIGHT = 16;

// Run admits workers by free memory unless a cap is set, and throws RunConcurrencyError instead of queueing.
// slot() already queues at LIMITS.maxConcurrent, so Run gets exactly that many.
setMaxWorkers(LIMITS.maxConcurrent);

const runner = createRunner({
  limits: {
    timeoutMs: LIMITS.wallMs,
    cpuTimeoutMs: LIMITS.cpuMs,
    memoryLimitBytes: LIMITS.memoryBytes,
    maxInFlightBridgeRequests: GUEST_IN_FLIGHT * 2,
    maxBridgeRequests: 10_000,
    maxHostFunctionOutputBytes: 16 * 1024 * 1024,
    // The guest returns {text, dropped, value|error}; the text is already capped in the guest, this caps a guest that lies.
    maxResultBytes: 256 * 1024,
    // Run's native console writes to the server's stdout. The prelude replaces it; this keeps any leak to one byte.
    maxConsoleOutputBytes: 1,
  },
});

// One line, so the model's line N is line N + WRAP_LINES of Run's run.js (Run adds two lines of its own).
const WRAP_LINES = 3;
const prelude = `const __b = globalThis.__corpus; try { delete globalThis.__corpus; } catch {} \
const __o = { text: "", dropped: 0 }; \
const __show = (v) => { if (typeof v === "string") return v; try { const s = JSON.stringify(v); return s === undefined ? String(v) : s; } catch { return String(v); } }; \
const __emit = (...a) => { const line = a.map(__show).join(" ") + "\\n"; const room = ${LIMITS.maxOutput} - __o.text.length; if (line.length > room) __o.dropped += line.length - Math.max(room, 0); if (room > 0) __o.text += line.slice(0, room); }; \
const console = Object.freeze({ log: __emit, info: __emit, warn: __emit, error: __emit, debug: __emit }); \
let __busy = 0; const __wait = []; \
const __call = async (name, args) => { if (__busy >= ${GUEST_IN_FLIGHT}) await new Promise((r) => __wait.push(r)); __busy++; \
  try { const r = JSON.parse(await __b[name](JSON.stringify(args))); if (r && r.__error) throw new Error(r.__error); return r; } \
  finally { __busy--; const next = __wait.shift(); if (next) next(); } }; \
const corpus = Object.freeze({ ${CORPUS_NAMES.map((n) => `${n}: (...a) => __call(${JSON.stringify(n)}, a)`).join(", ")} }); globalThis.corpus = corpus; \
try { const __v = await (async () => {
`;
const epilogue = `
})(); const __s = __v === undefined ? undefined : __show(__v); return { text: __o.text, dropped: __o.dropped + (__s === undefined ? 0 : Math.max(0, __s.length - ${LIMITS.maxOutput})), value: __s === undefined ? undefined : __s.slice(0, ${LIMITS.maxOutput}) }; }
catch (e) { let m; try { m = e instanceof Error ? (String(e) + "\\n" + (e.stack ?? "")).trim() : "Uncaught " + __show(e); } catch { m = "Uncaught exception"; } return { text: __o.text, dropped: __o.dropped, error: m.slice(0, 2000) }; }`;

type GuestResult = { text?: unknown; dropped?: unknown; value?: unknown; error?: unknown };

function describeRunError(e: unknown, userLines: number): string {
  if (!RunError.isInstance(e)) return `ERROR: the sandbox stopped this program (engine fault): ${cleanError(e)}`;
  switch (e.code) {
    case "RUN_TIMEOUT":
    case "RUN_ABORTED":
      return wallClockMessage();
    case "RUN_CPU_TIMEOUT":
      return `ERROR: stopped at the ${LIMITS.cpuMs / 1000} s CPU limit. Do less per execution.`;
    case "RUN_USER_SOURCE_ERROR":
      // Uncaught before the prelude's try: a syntax error or an uncatchable guest failure such as out of memory.
      return `ERROR: ${mapStack(String(e.stack ?? `${e.name}: ${e.message}`), "run.js", WRAP_LINES, userLines).slice(0, 2000)}`;
    case "RUN_DETACHED_BRIDGE_REQUEST":
      return "ERROR: the program ended while corpus calls were still running. Await every corpus call (use Promise.all for several).";
    default:
      return `ERROR: the sandbox stopped this program (${e.code}): ${cleanError(e)}`;
  }
}

async function run(code: string, corpus: Corpus): Promise<string> {
  const release = await slot();
  const out = new OutputBuffer();
  const userLines = code.split("\n").length;
  // Host wall clock: aborting makes Run fail the run and destroy its worker; the race also covers a wedged worker.
  const abort = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const wall = new Promise<"wall">((r) => (timer = setTimeout(() => (abort.abort(), r("wall")), LIMITS.wallMs)));
  const hostFunctions: Record<string, HostFunctionGroup> = {
    __corpus: Object.fromEntries(CORPUS_NAMES.map((n) => [n, (argsJson: string) => callCorpus(corpus, n, String(argsJson))])),
  };
  const running = runner.run({ source: prelude + code + epilogue, hostFunctions, abortSignal: abort.signal });
  try {
    const result = await Promise.race([running, wall]);
    if (result === "wall") {
      // Hold the slot until Run has let go of its invocation (it counts against setMaxWorkers), at most 5 s more.
      await Promise.race([running.catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
      return out.finish(wallClockMessage());
    }
    if (result.status !== "completed") return out.finish("ERROR: the sandbox stopped this program (interrupted)");
    const g = (result.value ?? {}) as GuestResult;
    out.push(typeof g.text === "string" ? g.text : "");
    if (typeof g.dropped === "number" && g.dropped > 0) out.noteDropped(g.dropped);
    if (typeof g.error === "string") return out.finish(`ERROR: ${mapStack(g.error, "run.js", WRAP_LINES, userLines)}`);
    return out.finish(typeof g.value === "string" ? g.value : "");
  } catch (e) {
    return out.finish(describeRunError(e, userLines));
  } finally {
    clearTimeout(timer);
    release();
  }
}

export const engine: Engine = {
  name: "vercel-run",
  language: "javascript",
  description: "Vercel Run 2.1.13 (QuickJS WASM, fresh context per run in a pooled Node worker thread); async bridge, parallel corpus calls",
  apiDoc: corpusApi(true),
  guide: jsGuide(true),
  run,
};
