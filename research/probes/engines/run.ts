// SPEC probes (research/probes/SPEC.md) plus neighbor tests against any engine in src/engines.
// Usage: pnpm exec tsx research/probes/engines/run.ts --engine=<name> [--only=P1,P6,...]
// Writes research/probes/engines/out/<engine>/<probe>.txt and out/<engine>/summary.json.
// The corpus is a stand-in: read(id) plays the SPEC's `lookup` (waits 200 ms, returns {id, value: id*2}),
// search() throws an error carrying a fake database URL, so error scrubbing shows up in the output.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getEngine } from "../../../src/engines";
import type { Corpus } from "../../../src/search";

const flag = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const name = flag("engine") ?? "quickjs-asyncify";
const only = (flag("only") ?? "").split(",").filter(Boolean);
process.env.PROBE_SECRET = "s3cr3t";
const engine = await getEngine(name);
const OUT = join(import.meta.dirname, "out", name);
mkdirSync(OUT, { recursive: true });

// Probe code per language, with optional per-engine overrides in forms/<engine>.json (same keys).
const forms: Record<string, string> = {
  ...(JSON.parse(readFileSync(join(import.meta.dirname, "forms", `${engine.language}.json`), "utf8")) as Record<string, string>),
  ...(() => {
    try {
      return JSON.parse(readFileSync(join(import.meta.dirname, "forms", `${name}.json`), "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  })(),
};

let hostCalls = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const corpus = {
  read: async (id: unknown) => {
    hostCalls++;
    await sleep(200);
    const n = Number(id);
    return { id: n, value: n * 2 };
  },
  search: () => {
    throw new Error("host-tool-boom internal detail db=postgres://user:pw@host/case_db");
  },
  count: () => 7,
  people: () => [],
  messages: () => [],
  grep: () => ({ totalFiles: 0, hits: [] }),
} as unknown as Corpus;

// Peak memory of this process and all its descendants (Python engines run in child processes).
function treeRssMb(): number {
  try {
    const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss="], { encoding: "utf8" })
      .trim()
      .split("\n")
      .map((l) => l.trim().split(/\s+/).map(Number) as [number, number, number]);
    const kids = new Map<number, number[]>();
    for (const [pid, ppid] of rows) kids.set(ppid, [...(kids.get(ppid) ?? []), pid]);
    const rss = new Map(rows.map(([pid, , r]) => [pid, r]));
    let total = 0;
    const stack = [process.pid];
    while (stack.length) {
      const p = stack.pop()!;
      total += rss.get(p) ?? 0;
      stack.push(...(kids.get(p) ?? []));
    }
    return Math.round(total / 1024);
  } catch {
    return -1;
  }
}

type Rec = { id: string; ms: number; hostCalls: number; peakTreeMb: number; out: string };
const results: Rec[] = [];
async function probe(id: string, code = forms[id]): Promise<Rec> {
  if (!code) throw new Error(`no probe form ${id} for ${name}`);
  hostCalls = 0;
  let peak = treeRssMb();
  const sampler = setInterval(() => (peak = Math.max(peak, treeRssMb())), 200);
  const t = performance.now();
  let out: string;
  try {
    out = await engine.run(code, corpus);
  } catch (e) {
    out = `HOST THREW: ${(e as Error).message}`;
  }
  const ms = Math.round(performance.now() - t);
  clearInterval(sampler);
  peak = Math.max(peak, treeRssMb());
  const rec = { id, ms, hostCalls, peakTreeMb: peak, out };
  writeFileSync(join(OUT, `${id}.txt`), `${code}\n--- output\n${out}\n---\nwall_ms=${ms} host_calls=${hostCalls} peak_tree_rss_mb=${peak}\n`);
  console.log(`${id} ${ms}ms calls=${hostCalls} peak=${peak}MB :: ${out.slice(0, 140).replace(/\n/g, " | ")}`);
  results.push(rec);
  return rec;
}

// A neighbor: a normal request started 150 ms after an aggressor, timed. On a shared server it should stay ~250 ms.
async function neighbor(id: string, aggressorKey: string) {
  const t0 = performance.now();
  const aggressor = engine.run(forms[aggressorKey]!, corpus);
  await sleep(150);
  const t = performance.now();
  const nb = await engine.run(forms.P1!, corpus);
  const nbMs = Math.round(performance.now() - t);
  const ag = await aggressor;
  const rec = { id, ms: nbMs, hostCalls: 0, peakTreeMb: treeRssMb(), out: `neighbor printed ${JSON.stringify(nb.slice(0, 40))} in ${nbMs} ms; aggressor ${aggressorKey} ended after ${Math.round(performance.now() - t0)} ms with ${JSON.stringify(ag.slice(0, 80))}` };
  writeFileSync(join(OUT, `${id}.txt`), `${rec.out}\n`);
  console.log(`${id} :: ${rec.out}`);
  results.push(rec);
}

const want = (id: string) => only.length === 0 || only.includes(id);
const order = ["P1", "P2", "P3", "P4", "P5", "P8a", "P8b", "P9", "P10", "P12a", "P12b", "P12c", "E1", "P6", "P7"];
for (const id of order) if (want(id) && forms[id]) await probe(id);
if (want("P11")) {
  const ts: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t = performance.now();
    await engine.run(forms.P11!, corpus);
    ts.push(performance.now() - t);
  }
  ts.sort((a, b) => a - b);
  const line = `P11 median ${ts[10]!.toFixed(1)} ms p90 ${ts[18]!.toFixed(1)} ms over 20 executions`;
  writeFileSync(join(OUT, "P11.txt"), `${line}\n`);
  console.log(line);
  results.push({ id: "P11", ms: Number(ts[10]!.toFixed(1)), hostCalls: 0, peakTreeMb: -1, out: line });
}
if (want("N1")) await neighbor("N1", "P6");
if (want("N2")) await neighbor("N2", "P7");
if (want("N3") && forms.FLOOD) await neighbor("N3", "FLOOD");
writeFileSync(join(OUT, "summary.json"), `${JSON.stringify({ engine: name, description: engine.description, results }, null, 2)}\n`);
await engine.close?.();
process.exit(0);
