// Verifies the sandbox memory cap: one bomb per process run (argv[2] picks it), RSS measured by /usr/bin/time.
import { runCode } from "../../../../../src/sandbox";
const fake = {} as any;
const bombs: Record<string, string> = {
  strings: `const a = []; while (true) a.push("x".repeat(1e6))`,
  objects: `const a = []; while (true) a.push({k: Math.random()})`,
  big: `const s = "x".repeat(2 ** 29); console.log(s.length)`,
  ok: `const a = []; for (let i = 0; i < 300; i++) a.push("x".repeat(1e6) + i); console.log(a.length)`,
};
const which = process.argv[2]!;
const t0 = Date.now();
const out = await runCode(bombs[which]!, fake);
console.log(which, `${((Date.now() - t0) / 1000).toFixed(1)}s`, out.slice(0, 160).replace(/\n/g, " "));
// The host and a fresh execution must survive, including concurrent ones.
const after = await Promise.all([1, 2, 3].map((i) => runCode(`console.log(${i} + 1)`, fake)));
console.log("after:", after.join(","));
const ts: number[] = [];
for (let i = 0; i < 20; i++) { const t = performance.now(); await runCode("1+1", fake); ts.push(performance.now() - t); }
ts.sort((a, b) => a - b);
console.log(`startup median ${ts[10]!.toFixed(1)} ms p90 ${ts[18]!.toFixed(1)} ms`);
