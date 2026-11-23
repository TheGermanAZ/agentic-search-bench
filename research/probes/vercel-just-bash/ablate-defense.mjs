// Explain-the-number check for P11: per-exec cost with defenseInDepth on (default) versus off.
// Alternates the two sides five times each, 2000 execs per block, and prints the per-side medians.
// Usage: node ablate-defense.mjs
import { Bash } from "just-bash";

const blocks = { on: [], off: [] };
async function block(defenseInDepth) {
  const bash = new Bash({ defenseInDepth });
  for (let i = 0; i < 200; i += 1) await bash.exec("echo 2");
  const start = performance.now();
  for (let i = 0; i < 2000; i += 1) {
    const result = await bash.exec("echo 2");
    if (result.stdout !== "2\n") throw new Error(`unexpected output with defenseInDepth=${defenseInDepth}`);
  }
  return (performance.now() - start) / 2000;
}
for (let round = 1; round <= 5; round += 1) {
  blocks.on.push(await block(true));
  blocks.off.push(await block(false));
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log(JSON.stringify({
  onMsPerExecMedian: Number(median(blocks.on).toFixed(4)),
  offMsPerExecMedian: Number(median(blocks.off).toFixed(4)),
  onRuns: blocks.on.map((x) => Number(x.toFixed(4))),
  offRuns: blocks.off.map((x) => Number(x.toFixed(4))),
}, null, 2));
