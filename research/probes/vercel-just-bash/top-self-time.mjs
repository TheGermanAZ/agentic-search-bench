// Prints the functions with the most self time in a .cpuprofile file.
// Usage: node top-self-time.mjs <file.cpuprofile> [count]
import { readFileSync } from "node:fs";

const profile = JSON.parse(readFileSync(process.argv[2], "utf8"));
const count = Number(process.argv[3] ?? 15);
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const samples = profile.samples;
const deltas = profile.timeDeltas;
const self = new Map();
let total = 0;
for (let i = 0; i < samples.length; i += 1) {
  const dt = deltas[i] ?? 0;
  total += dt;
  const node = byId.get(samples[i]);
  const frame = node.callFrame;
  const key = `${frame.functionName || "(anonymous)"} ${frame.url.split("/").slice(-2).join("/")}:${frame.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + dt);
}
const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, count);
for (const [key, us] of rows) console.log(`${((us / total) * 100).toFixed(1).padStart(5)}%  ${key}`);
