// Shared by the JavaScript engines that wrap the model's program in an async function (vercel-run, quickjs-ng,
// isolated-vm): top-level await works, `return x` prints x, and guest stack frames are mapped back to the model's lines.
import type { Corpus } from "../search";
import { callCorpus } from "./host";

/** Corpus calls one execution may have running on the host at once; more wait in line. */
export const IN_FLIGHT = 16;
/** Corpus calls one execution may make in total; later calls fail in the guest. */
export const MAX_CALLS = 10_000;

/**
 * callCorpus with per-execution caps enforced on the host, so a program that fires thousands of calls without awaiting
 * them queues here (bounded by MAX_CALLS) instead of running them all at once.
 */
export function corpusGate(corpus: Corpus): (name: string, argsJson: string) => Promise<string> {
  let running = 0;
  let total = 0;
  const waiting: (() => void)[] = [];
  return async (name, argsJson) => {
    if (++total > MAX_CALLS) return JSON.stringify({ __error: `more than ${MAX_CALLS} corpus calls in one execution` });
    if (running >= IN_FLIGHT) await new Promise<void>((r) => waiting.push(r));
    running++;
    try {
      return await callCorpus(corpus, name, argsJson);
    } finally {
      running--;
      waiting.shift()?.();
    }
  };
}

/**
 * Rewrites "(file:L:C)" frames to "(line L-offset:C)" and drops frames outside the model's program (the wrapper,
 * engine setup code). `offset` is the number of wrapper lines before the model's first line.
 */
export function mapStack(text: string, file: string, offset: number, userLines: number): string {
  const frame = new RegExp(`${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:(\\d+):(\\d+)`);
  return text
    .split("\n")
    .flatMap((line) => {
      if (!/^\s+at /.test(line)) return [line];
      const m = frame.exec(line);
      if (!m) return [];
      const n = Number(m[1]) - offset;
      return n >= 1 && n <= userLines ? [line.replace(frame, `line ${n}:${m[2]}`)] : [];
    })
    .join("\n")
    .trim();
}
