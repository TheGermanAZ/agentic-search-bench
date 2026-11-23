import { spawnSync } from "node:child_process";
// Micro-timings of the corpus operations behind each strategy. Run on a quiet machine:
// bun run src/timings.ts
import { cpus, loadavg } from "node:os";
import { FILES_DIR } from "./corpus";
import { Corpus } from "./search";

const REPS = 5;
const c = new Corpus();
await c.search("warmup", { k: 5 });
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
async function time(label: string, f: () => unknown) {
  const xs: number[] = [];
  for (let i = 0; i < REPS; i++) {
    const t = performance.now();
    await f();
    xs.push(performance.now() - t);
  }
  console.log(`${label.padEnd(40)} median ${median(xs).toFixed(0).padStart(6)} ms   runs ${xs.map((x) => x.toFixed(0)).join(", ")}`);
}
console.log(`${cpus().length} cores, ${cpus()[0]?.model}, load average ${loadavg().map((x) => x.toFixed(1)).join(" ")}, ${REPS} runs each`);
await time("ripgrep, whole corpus, literal", () => spawnSync("rg", ["--no-ignore", "-i", "-l", "-e", "Raptor", FILES_DIR], { maxBuffer: 1 << 30 }));
await time("ripgrep, whole corpus, phone pattern", () => spawnSync("rg", ["--no-ignore", "-i", "-l", "-e", "703[-. ]227[-. ]8777", FILES_DIR], { maxBuffer: 1 << 30 }));
await time("count() with sender and date filter", () => c.count({ from: "vince.kaminski", after: "2001-04-01", before: "2001-05-01" }));
await time("messages() with recipient filter", () => c.messages({ to: "richard.sanders", after: "2001-05-29", before: "2001-06-05", limit: 5000 }));
await time("hybrid search, no filter", () => c.search("utility asked the ISO to cut the power price cap", { k: 10 }));
await time("hybrid search, sender filter", () => c.search("Allegheny promised to sign the ISDA", { k: 10, from: "shackleton" }));
process.exit(0);
