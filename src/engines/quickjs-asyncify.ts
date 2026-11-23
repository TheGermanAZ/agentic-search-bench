// Baseline engine: QuickJS (quickjs-emscripten asyncify build) in a fresh worker thread per execution.
// Corpus calls suspend the guest (asyncify), so calls inside one program run one at a time.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { jsGuide, corpusApi } from "../sandbox";
import type { Corpus } from "../search";
import { CORPUS_NAMES, LIMITS, OutputBuffer, callCorpus, cleanError, slot, wallClockMessage } from "./host";
import type { FromWorker, ToWorker } from "./quickjs-asyncify-worker";
import type { Engine } from "./types";

// Compiled once per process and handed to each worker; every execution still gets its own instance and memory.
let compiled: WebAssembly.Module | undefined;
const wasmModule = () => (compiled ??= new WebAssembly.Module(readFileSync(createRequire(import.meta.url).resolve("@jitl/quickjs-wasmfile-release-asyncify/wasm"))));

async function run(code: string, corpus: Corpus): Promise<string> {
  const release = await slot();
  const worker = new Worker(new URL("./quickjs-asyncify-worker.ts", import.meta.url));
  const out = new OutputBuffer();
  let finished = false;
  const text = await new Promise<string>((resolve) => {
    const finish = (tail: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(out.finish(tail));
    };
    const timer = setTimeout(() => finish(wallClockMessage()), LIMITS.wallMs);
    worker.on("message", async (m: FromWorker) => {
      if (m.type === "log") out.push(m.text);
      else if (m.type === "call") {
        const json = await callCorpus(corpus, m.name, m.args);
        if (!finished) worker.postMessage({ type: "result", id: m.id, json } satisfies ToWorker);
      } else if (m.type === "done") {
        out.noteDropped(m.dropped);
        finish(m.error ? `ERROR: ${m.error}` : (m.value ?? ""));
      }
    });
    worker.on("error", (e) => finish(`ERROR: the sandbox stopped this program (engine fault): ${cleanError(e.message)}`));
    worker.on("exit", (code) => finish(`ERROR: the sandbox stopped this program (worker exited with code ${code})`));
    worker.postMessage({ type: "run", code, names: CORPUS_NAMES, wasm: wasmModule(), memoryBytes: LIMITS.memoryBytes, cpuMs: LIMITS.cpuMs, maxOutput: LIMITS.maxOutput } satisfies ToWorker);
  });
  await worker.terminate();
  release();
  return text;
}

export const engine: Engine = {
  name: "quickjs-asyncify",
  language: "javascript",
  description: "QuickJS (quickjs-emscripten 0.32 asyncify) in a fresh Node worker thread per execution; synchronous bridge",
  apiDoc: corpusApi(false),
  guide: jsGuide(false),
  run,
};
