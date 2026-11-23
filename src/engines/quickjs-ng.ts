// quickjs-ng (quickjs-emscripten 0.32 sync build, quickjs-ng 0.12.1) in a fresh worker thread per execution, with an
// async bridge: corpus functions return QuickJS promises, so `await Promise.all([...])` overlaps corpus calls.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { corpusApi, jsGuide } from "../sandbox";
import type { Corpus } from "../search";
import { CORPUS_NAMES, LIMITS, OutputBuffer, cleanError, slot, wallClockMessage } from "./host";
import { corpusGate, mapStack } from "./js-wrap";
import type { FromWorker, ToWorker } from "./quickjs-ng-worker";
import type { Engine } from "./types";

/** The worker evaluates `(async () => {\n<code>\n})()` as this file, so the model's line N is line N + 1. */
const FILE = "program.js";
const WRAP_LINES = 1;

// Compiled once per process and handed to each worker; every execution still gets its own instance and memory.
let compiled: WebAssembly.Module | undefined;
const wasmModule = () => (compiled ??= new WebAssembly.Module(readFileSync(createRequire(import.meta.url).resolve("@jitl/quickjs-ng-wasmfile-release-sync/wasm"))));

async function run(code: string, corpus: Corpus): Promise<string> {
  const release = await slot();
  const worker = new Worker(new URL("./quickjs-ng-worker.ts", import.meta.url));
  const out = new OutputBuffer();
  const call = corpusGate(corpus);
  const userLines = code.split("\n").length;
  let finished = false;
  const text = await new Promise<string>((resolve) => {
    const finish = (tail: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(out.finish(tail));
    };
    // Host wall clock: the worker is terminated below whatever the guest is doing.
    const timer = setTimeout(() => finish(wallClockMessage()), LIMITS.wallMs);
    worker.on("message", async (m: FromWorker) => {
      if (m.type === "log") out.push(m.text);
      else if (m.type === "call") {
        const json = await call(m.name, m.args);
        if (!finished) worker.postMessage({ type: "result", id: m.id, json } satisfies ToWorker);
      } else if (m.type === "done") {
        out.noteDropped(m.dropped);
        finish(m.error ? `ERROR: ${mapStack(m.error, FILE, WRAP_LINES, userLines)}` : (m.value ?? ""));
      }
    });
    worker.on("error", (e) => finish(`ERROR: the sandbox stopped this program (engine fault): ${cleanError(e.message)}`));
    worker.on("exit", (code) => finish(`ERROR: the sandbox stopped this program (worker exited with code ${code})`));
    worker.postMessage({ type: "run", code, file: FILE, names: CORPUS_NAMES, wasm: wasmModule(), memoryBytes: LIMITS.memoryBytes, cpuMs: LIMITS.cpuMs, maxOutput: LIMITS.maxOutput } satisfies ToWorker);
  });
  await worker.terminate();
  release();
  return text;
}

export const engine: Engine = {
  name: "quickjs-ng",
  language: "javascript",
  description: "quickjs-ng 0.12.1 (quickjs-emscripten 0.32 sync build) in a fresh Node worker thread per execution; async bridge, parallel corpus calls",
  apiDoc: corpusApi(true),
  guide: jsGuide(true),
  run,
};
