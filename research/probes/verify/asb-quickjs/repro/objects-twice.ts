// Is the host-RSS overshoot of the `objects` bomb (1.68 GB against a 512 MB WASM cap) paid once per process
// (JIT tier-up of the shared compiled module) or once per execution? Runs it 3x sequentially, then 3x concurrently,
// printing process RSS after each. Output: out/objects-twice.txt (run with /usr/bin/time -l under mem-lock).
import { runCode } from "../../../../../src/sandbox";
const fake = {} as any;
const bomb = `const a = []; while (true) a.push({k: Math.random()})`;
const mb = () => Math.round(process.memoryUsage().rss / 2 ** 20);
for (let i = 0; i < 3; i++) {
  const t = Date.now();
  const out = await runCode(bomb, fake);
  console.log(`seq${i} ${Date.now() - t}ms rss=${mb()}MB :: ${out.slice(0, 60).replace(/\n/g, " ")}`);
}
const t = Date.now();
const outs = await Promise.all([0, 1, 2].map(() => runCode(bomb, fake)));
console.log(`concurrent x3 ${Date.now() - t}ms rss=${mb()}MB :: ${outs.map((o) => o.slice(0, 30)).join(" | ")}`);
