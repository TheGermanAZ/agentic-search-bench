// isolated-vm 7: a fresh V8 isolate per execution with a 512 MB heap limit. Isolates run on isolated-vm's own thread
// pool (async API only), so a busy guest never blocks the host event loop; the host polls the isolate's CPU time and
// disposes it at the CPU limit or the wall clock.
//
// The guest never holds a host object. It gets two plain functions (ivm.Callback, arguments always copied):
// __start(id, name, argsJson) begins a corpus call and __log(text, dropped) prints. When a call finishes, the host
// calls back into a guest-side resolver it took a Reference to before the model's code ran. A Reference handed to the
// guest would expose .get()/.apply() on host objects, which a program that patches prototypes could walk to the host.
import ivm from "isolated-vm";
import { corpusApi, jsGuide } from "../sandbox";
import type { Corpus } from "../search";
import { CORPUS_NAMES, LIMITS, OutputBuffer, cleanError, slot, wallClockMessage } from "./host";
import { corpusGate, mapStack } from "./js-wrap";
import type { Engine } from "./types";

const FILE = "program.js";
/** The model's code is evaluated as `__run(async () => {\n<code>\n})`, so its line N is line N + 1. */
const WRAP_LINES = 1;
const CPU_POLL_MS = 20;
const MAX_ARGS_CHARS = 1024 * 1024;
const MAX_ERROR_CHARS = 4000;

// Runs before the model's code, so every intrinsic it captures is the original. Anything the model patches later
// (String.prototype.slice, JSON, Promise.prototype.then) only changes its own view, never what crosses to the host.
const PRELUDE = `(() => {
  const g = globalThis;
  const start = g.__start, log = g.__log;
  delete g.__start; delete g.__log;
  // WebAssembly.Memory is allocated outside the V8 heap and does not count toward the isolate's memoryLimit.
  delete g.WebAssembly;
  const apply = Reflect.apply, slice = String.prototype.slice, stringify = JSON.stringify, parse = JSON.parse;
  const Str = String, Err = Error, P = Promise, then = Promise.prototype.then, freeze = Object.freeze, define = Object.defineProperty;
  const waiting = new Map(), mapGet = Map.prototype.get, mapSet = Map.prototype.set, mapDelete = Map.prototype.delete;
  const CAP = ${LIMITS.maxOutput};
  let sent = 0, dropped = 0, reported = 0, next = 0;
  const show = (v) => {
    if (typeof v === "string") return v;
    try { const s = apply(stringify, undefined, [v]); if (typeof s === "string") return s; } catch {}
    try { return Str(v); } catch { return "[unprintable]"; }
  };
  const emit = (...a) => {
    let line = "";
    for (let i = 0; i < a.length; i++) line += (i ? " " : "") + show(a[i]);
    line += "\\n";
    const room = CAP - sent;
    const part = room > 0 ? apply(slice, line, [0, room]) : "";
    sent += part.length;
    dropped += line.length - part.length;
    // Report the first overflow at once, so the truncation marker survives a program that is then stopped.
    if (part.length || (dropped && !reported)) { log(part, dropped - reported); reported = dropped; }
  };
  const flush = () => { if (dropped > reported) { log("", dropped - reported); reported = dropped; } };
  const fmt = (e) => {
    try {
      const m = e instanceof Err && typeof e.stack === "string" ? e.stack : "Uncaught " + show(e);
      return apply(slice, Str(m), [0, ${MAX_ERROR_CHARS}]);
    } catch { return "Uncaught exception"; }
  };
  g.__resolve = (id, json) => { const r = apply(mapGet, waiting, [id]); if (r) { apply(mapDelete, waiting, [id]); r(json); } };
  const call = (name, args) => new P((res, rej) => {
    let s;
    try { s = apply(stringify, undefined, [args]); } catch (e) { rej(e); return; }
    if (typeof s !== "string" || s.length > ${MAX_ARGS_CHARS}) { rej(new Err("corpus call arguments are too large")); return; }
    const id = next++;
    apply(mapSet, waiting, [id, (json) => {
      let r;
      try { r = apply(parse, undefined, [json]); } catch (e) { rej(e); return; }
      if (r !== null && typeof r === "object" && typeof r.__error === "string") rej(new Err(r.__error)); else res(r);
    }]);
    start(id, name, s);
  });
  const corpus = {};
  for (const name of ${JSON.stringify(CORPUS_NAMES)}) corpus[name] = (...a) => call(name, a);
  g.corpus = freeze(corpus);
  g.console = freeze({ log: emit, info: emit, warn: emit, error: emit, debug: emit });
  // Resolves to undefined, or to the error text (already capped) when the program throws.
  define(g, "__run", { value: (fn) => {
    let p;
    try { p = fn(); } catch (e) { flush(); return fmt(e); }
    return apply(then, p, [(v) => { if (v !== undefined) emit(v); flush(); return undefined; }, (e) => { flush(); return fmt(e); }]);
  } });
})();`;

type Stop = "cpu" | "wall" | undefined;

async function run(code: string, corpus: Corpus): Promise<string> {
  const release = await slot();
  const out = new OutputBuffer();
  const gate = corpusGate(corpus);
  const userLines = code.split("\n").length;
  let stop: Stop;
  let catastrophe: string | undefined;
  const isolate = new ivm.Isolate({
    memoryLimit: LIMITS.memoryBytes / (1024 * 1024),
    // V8 lost control of this isolate. Recorded and reported; the isolate is disposed below.
    onCatastrophicError: (m) => {
      catastrophe = m;
      console.error(`isolated-vm catastrophic error: ${m}`);
    },
  });
  const kill = (why: Exclude<Stop, undefined>) => {
    stop ??= why;
    if (!isolate.isDisposed) isolate.dispose();
  };
  const cpuNs = BigInt(LIMITS.cpuMs) * 1_000_000n;
  const poll = setInterval(() => {
    if (!isolate.isDisposed && isolate.cpuTime > cpuNs) kill("cpu");
  }, CPU_POLL_MS);
  const wall = setTimeout(() => kill("wall"), LIMITS.wallMs);
  let resolver: ivm.Reference<(id: number, json: string) => void> | undefined;
  try {
    const context = await isolate.createContext();
    await context.global.set(
      "__start",
      new ivm.Callback(
        (id: unknown, name: unknown, argsJson: unknown) => {
          void gate(String(name), String(argsJson)).then((json) => {
            if (!isolate.isDisposed) resolver?.apply(undefined, [Number(id), json], { arguments: { copy: true } }).catch(() => {});
          });
        },
        { sync: true },
      ),
    );
    // Synchronous, so a guest printing in a loop waits for the host instead of queueing messages without bound.
    await context.global.set(
      "__log",
      new ivm.Callback(
        (text: unknown, dropped: unknown) => {
          if (typeof text === "string") out.push(text);
          if (typeof dropped === "number" && dropped > 0) out.noteDropped(dropped);
        },
        { sync: true },
      ),
    );
    await (await isolate.compileScript(PRELUDE, { filename: "prelude.js" })).run(context);
    resolver = await context.global.get("__resolve", { reference: true });
    await context.global.delete("__resolve");

    let script: ivm.Script;
    try {
      script = await isolate.compileScript(`__run(async () => {\n${code}\n})`, { filename: FILE });
    } catch (e) {
      // A syntax error: "SyntaxError: ... [program.js:L:C]".
      const msg = String((e as Error).message).replace(/\[program\.js:(\d+):(\d+)\]/, (_, l, c) => `[line ${Number(l) - WRAP_LINES}:${c}]`);
      return out.finish(`ERROR: ${(e as Error).name ?? "SyntaxError"}: ${msg}`.replace(/^ERROR: (\w+): \1: /, "ERROR: $1: "));
    }
    const error: unknown = await script.run(context, { promise: true });
    return out.finish(typeof error === "string" ? `ERROR: ${mapStack(error, FILE, WRAP_LINES, userLines)}` : "");
  } catch (e) {
    if (stop === "wall") return out.finish(wallClockMessage());
    if (stop === "cpu") return out.finish(`ERROR: stopped at the ${LIMITS.cpuMs / 1000} s CPU limit. Do less per execution.`);
    const msg = String((e as Error)?.message ?? e);
    if (/memory limit/i.test(msg)) return out.finish(`ERROR: the sandbox stopped this program: it used more than the ${LIMITS.memoryBytes / 2 ** 20} MB memory limit`);
    if (catastrophe) return out.finish(`ERROR: the sandbox stopped this program (engine fault): ${cleanError(catastrophe)}`);
    return out.finish(`ERROR: the sandbox stopped this program (engine fault): ${cleanError(e)}`);
  } finally {
    clearInterval(poll);
    clearTimeout(wall);
    resolver?.release();
    if (!isolate.isDisposed) isolate.dispose();
    release();
  }
}

export const engine: Engine = {
  name: "isolated-vm",
  language: "javascript",
  description: "isolated-vm 7.0.2 (a fresh V8 isolate per execution on isolated-vm's thread pool, 512 MB heap); async bridge, parallel corpus calls",
  apiDoc: corpusApi(true),
  guide: jsGuide(true),
  run,
};
