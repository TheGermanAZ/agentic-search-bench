// Probe suite (research/probes/SPEC.md) against this repo's own sandbox, src/sandbox.ts.
// The corpus API has no `lookup`, so `corpus.read(id)` stands in for it: same 200 ms delay, same return shape.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCode } from "../../../src/sandbox";
import type { Corpus } from "../../../src/search";

process.env.PROBE_SECRET = "s3cr3t";
// runCode() follows the default engine; this harness measures the original QuickJS asyncify sandbox.
process.env.CODEMODE_ENGINE ??= "quickjs-asyncify";
const OUT = join(import.meta.dirname, "out");
let hostCalls = 0;
const fake = { read: async (id: unknown) => { hostCalls++; await new Promise((r) => setTimeout(r, 200)); const n = Number(id); return { id: n, value: n * 2 }; } } as unknown as Corpus;

async function probe(id: string, code: string) {
  hostCalls = 0;
  const t = performance.now();
  let out: string;
  try { out = await runCode(code, fake); } catch (e) { out = `HOST THREW: ${(e as Error).message}`; }
  const ms = Math.round(performance.now() - t);
  writeFileSync(join(OUT, `${id}.txt`), `${out}\n---\nwall_ms=${ms} host_calls=${hostCalls}\n`);
  console.log(`${id} ${ms}ms calls=${hostCalls} :: ${out.slice(0, 160).replace(/\n/g, " | ")}`);
  return { out, ms };
}

await probe("P1", `const r = corpus.read(21); console.log(r.value)`);
await probe("P2", `console.log("A".repeat(200000)); "RETURNED"`);
await probe("P3", `fetch("https://example.com")`);
await probe("P4", `require("fs").readFileSync("/etc/hosts","utf8")`);
await probe("P4b", `import("fs").then(m => console.log("imported"), e => console.log("import refused: " + e.message))`);
await probe("P4c", `console.log("still alive after import attempt")`);
await probe("P5", `typeof process === "undefined" ? "no process" : process.env.PROBE_SECRET`);
await probe("P6", `while (true) {}`);
await probe("P9c", `const rs = []; for (let i = 0; i < 3; i++) rs.push(corpus.read(i)); console.log(JSON.stringify(rs))`);
await probe("P7", `const a = []; while (true) a.push("x".repeat(1e6))`);
await probe("P8a", `globalThis.kept = 7`);
await probe("P8b", `console.log(typeof kept === "undefined" ? "gone" : kept)`);
await probe("P9", `const t = Date.now(); const rs = [1,2,3,4,5].map(i => corpus.read(i)); console.log(Date.now()-t, rs.length)`);
await probe("P10", `throw new Error("probe-boom")`);
await probe("P12a", `this.constructor.constructor("return typeof process")()`);
await probe("P12b", `(function(){return typeof this.process})()`);
{
  hostCalls = 0;
  const t = performance.now();
  const outs = await Promise.all([1, 2, 3, 4, 5].map((i) => runCode(`console.log(corpus.read(${i}).value)`, fake).catch((e) => `HOST THREW: ${e.message}`)));
  const line = `concurrent x5 ${Math.round(performance.now() - t)}ms calls=${hostCalls} :: ${outs.join(",")}`;
  writeFileSync(join(OUT, "P13-concurrency.txt"), `${line}\n`);
  console.log(`P13 ${line}`);
}
const times: number[] = [];
for (let i = 0; i < 20; i++) { const t = performance.now(); await runCode("1+1", fake); times.push(performance.now() - t); }
times.sort((a, b) => a - b);
console.log(`P11 median ${times[10].toFixed(2)}ms p90 ${times[18].toFixed(2)}ms`);
writeFileSync(join(OUT, "P11.txt"), times.map((x) => x.toFixed(2)).join("\n"));
process.exit(0);
