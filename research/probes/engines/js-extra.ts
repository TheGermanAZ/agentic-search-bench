// Extra probes for the JavaScript engines, beyond SPEC.md: memory outside the JS heap, oversized values crossing to the
// host, call floods, prototype patching, syntax errors, a promise that never settles.
// Usage: research/probes/mem-lock.sh pnpm exec tsx research/probes/engines/js-extra.ts --engine=<name> [--only=X1,X2]
// Writes research/probes/engines/out/<engine>/X*.txt. Same stand-in corpus as run.ts (read waits 200 ms).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getEngine } from "../../../src/engines";
import type { Corpus } from "../../../src/search";

const flag = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const name = flag("engine") ?? "quickjs-asyncify";
const only = (flag("only") ?? "").split(",").filter(Boolean);
const engine = await getEngine(name);
const OUT = join(import.meta.dirname, "out", name);
mkdirSync(OUT, { recursive: true });

let hostCalls = 0;
let maxArgChars = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const corpus = {
  read: async (id: unknown) => {
    hostCalls++;
    maxArgChars = Math.max(maxArgChars, String(id).length);
    await sleep(200);
    return { id: Number(id), value: Number(id) * 2 };
  },
  count: () => (hostCalls++, 7),
  search: () => [],
  people: () => [],
  messages: () => [],
  grep: () => ({ totalFiles: 0, hits: [] }),
} as unknown as Corpus;

const PROBES: Record<string, string> = {
  X1: "const a = []; while (true) a.push(new Uint8Array(64 * 1024 * 1024).fill(1)); ",
  X2: "const m = new WebAssembly.Memory({ initial: 1, maximum: 65536 }); let n = 0; while (true) { m.grow(1024); new Uint8Array(m.buffer).fill(1, n * 65536 * 1024); n++; if (n % 8 === 0) console.log(n * 64, 'MB'); }",
  X3: 'return "x".repeat(3e8)',
  X4: 'try { await corpus.read("y".repeat(2e8)) } catch (e) { console.log("caught: " + e.message) }',
  X5: "for (let i = 0; i < 20000; i++) corpus.count({}); console.log('fired')",
  X6: "const t = Date.now(); const rs = await Promise.all(Array.from({ length: 100 }, (_, i) => corpus.read(i))); console.log(rs.length, Date.now() - t, 'ms')",
  X7: 'String.prototype.slice = function () { return String(this) }; Array.prototype.join = function () { return "z".repeat(5e6) }; console.log("y".repeat(1e6)); console.log("after")',
  X8: "const x = 1;\nconst = 5;",
  X9: "await new Promise(() => {}); console.log('never')",
};

const peakRss = () => Math.round(process.memoryUsage().rss / 2 ** 20);
for (const [id, code] of Object.entries(PROBES)) {
  if (only.length && !only.includes(id)) continue;
  hostCalls = 0;
  maxArgChars = 0;
  let peak = peakRss();
  const sampler = setInterval(() => (peak = Math.max(peak, peakRss())), 100);
  const t = performance.now();
  let out: string;
  try {
    out = await engine.run(code, corpus);
  } catch (e) {
    out = `HOST THREW: ${(e as Error).message}`;
  }
  clearInterval(sampler);
  const ms = Math.round(performance.now() - t);
  // Let fire-and-forget calls drain so the count is final.
  await sleep(500);
  const tail = `wall_ms=${ms} host_calls=${hostCalls} max_arg_chars=${maxArgChars} out_chars=${out.length} peak_host_rss_mb=${peak}`;
  writeFileSync(join(OUT, `${id}.txt`), `${code}\n--- output\n${out.slice(0, 4000)}\n---\n${tail}\n`);
  console.log(`${id} ${tail} :: ${out.slice(0, 160).replace(/\n/g, " | ")}`);
}
await engine.close?.();
process.exit(0);
