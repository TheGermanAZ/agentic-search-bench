// Extra checks for the py-* engines that the shared harness (run.ts) does not cover:
//   WALL   a program that spends its time awaiting slow corpus calls (Monty's duration limit does not count that time)
//          is stopped by the host wall clock; the sidecar confirms the cancel without being killed; Monty workers gone.
//   CRASH  the sidecar is SIGKILLed mid-execution: the in-flight execution gets an error, the Node host survives,
//          its Monty workers are gone, and the next execution respawns the sidecar.
//   MASK   (py-fastmcp) what the masked "Error calling tool 'execute'" hid, from FastMCP's server log on stderr.
//   CONC   12 executions at once (above LIMITS.maxConcurrent = 8) all finish; the slot cap queues the rest.
// Usage: pnpm exec tsx research/probes/engines/py-extra.ts --engine=py-monty [--only=WALL,CRASH,CONC]
// Writes research/probes/engines/out/<engine>/extra.txt.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getEngine } from "../../../src/engines";
import { LIMITS } from "../../../src/engines/host";
import type { PySidecar } from "../../../src/engines/py-sidecar";
import type { Corpus } from "../../../src/search";

const flag = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const name = flag("engine") ?? "py-monty";
const only = (flag("only") ?? "WALL,CRASH,CONC,MASK").split(",");
const engine = await getEngine(name);
const sidecar = ((await import(`../../../src/engines/${name}.ts`)) as { _sidecar: PySidecar })._sidecar;
const OUT = join(import.meta.dirname, "out", name);
mkdirSync(OUT, { recursive: true });
const file = join(OUT, "extra.txt");
writeFileSync(file, `engine ${name}, LIMITS.wallMs=${LIMITS.wallMs} maxConcurrent=${LIMITS.maxConcurrent}\n`);
const log = (s: string) => {
  console.log(s);
  appendFileSync(file, `${s}\n`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let readDelay = 200;
const corpus = {
  read: async (id: unknown) => {
    await sleep(readDelay);
    return { id: Number(id), value: Number(id) * 2 };
  },
} as unknown as Corpus;

/** Monty worker processes (the `monty` binary) whose ancestry includes this Node process. */
function montyWorkers(): string[] {
  const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,comm="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((l) => l.trim().split(/\s+/, 3) as [string, string, string]);
  const parent = new Map(rows.map(([p, pp]) => [p, pp]));
  const mine = (pid: string) => {
    for (let p = pid, i = 0; p && p !== "1" && i < 50; p = parent.get(p) ?? "", i++) if (p === String(process.pid)) return true;
    return false;
  };
  const all = rows.filter(([, , c]) => c.endsWith("monty"));
  return all.map(([p, pp]) => `${p}${mine(p) ? "" : ` (orphan, ppid ${pp})`}`);
}

const P1 = name === "py-fastmcp" ? 'r = await call_tool("read", {"id": "21"})\nreturn r["result"]["value"]' : name === "py-pydantic-ai" ? 'r = await read(id="21")\nprint(r["value"] if r else None)' : 'r = await read(21)\nprint(r["value"])';
const SLOW =
  name === "py-fastmcp"
    ? 'for i in range(4):\n    await call_tool("read", {"id": str(i)})\nreturn "finished"'
    : name === "py-pydantic-ai"
      ? 'for i in range(4):\n    await read(id=str(i))\nprint("finished")'
      : 'for i in range(4):\n    await read(i)\nprint("finished")';
const LOOP = "while True:\n    pass";

await engine.run(P1, corpus); // start the sidecar
log(`sidecar up: versions ${JSON.stringify(sidecar.versions)} pid ${sidecar.pid}; monty workers ${montyWorkers().join(" ") || "none"}`);

if (only.includes("WALL")) {
  readDelay = 20_000; // 4 serial calls = 80 s of awaiting the host, past the 65 s wall clock
  const t = performance.now();
  const out = await engine.run(SLOW, corpus);
  log(`WALL: returned after ${Math.round(performance.now() - t)} ms: ${JSON.stringify(out.slice(0, 160))}`);
  await sleep(1500);
  readDelay = 200;
  const t2 = performance.now();
  const next = await engine.run(P1, corpus);
  log(`WALL: sidecar spawns ${sidecar.spawns} (1 = cancel confirmed, no forced kill); next run ${JSON.stringify(next)} in ${Math.round(performance.now() - t2)} ms; monty workers now ${montyWorkers().join(" ") || "none"}`);
}

if (only.includes("CRASH")) {
  const before = sidecar.spawns;
  const victim = sidecar.pid!;
  const t = performance.now();
  const running = engine.run(LOOP, corpus);
  await sleep(1000);
  log(`CRASH: during loop, monty workers ${montyWorkers().join(" ")}; killing sidecar python pid ${victim}`);
  process.kill(victim, "SIGKILL");
  const out = await running;
  log(`CRASH: in-flight run returned after ${Math.round(performance.now() - t)} ms: ${JSON.stringify(out)}`);
  await sleep(1000);
  log(`CRASH: monty workers after the kill: ${montyWorkers().join(" ") || "none"}`);
  const t2 = performance.now();
  const next = await engine.run(P1, corpus);
  log(`CRASH: next run ${JSON.stringify(next)} in ${Math.round(performance.now() - t2)} ms (includes respawn); spawns ${before} -> ${sidecar.spawns}, new pid ${sidecar.pid}`);
}

if (only.includes("CONC")) {
  const t = performance.now();
  const outs = await Promise.all(Array.from({ length: 12 }, () => engine.run(P1, corpus)));
  log(`CONC: 12 concurrent runs in ${Math.round(performance.now() - t)} ms (8 slots, 200 ms each: about 400 ms expected); outputs ${JSON.stringify([...new Set(outs)])}`);
}

if (only.includes("MASK") && name === "py-fastmcp") {
  for (const [label, code] of [
    ["P10", 'raise ValueError("probe-boom")'],
    ["P7", 'a = []\nwhile True:\n    a.append("x" * 10**6 + str(len(a)))'],
    ["P6", "while True:\n    pass"],
  ] as const) {
    sidecar.stderrTail = "";
    const out = await engine.run(code, corpus);
    const cause = sidecar.stderrTail.split("\n").filter((l) => /Error|Timeout/.test(l) && !/Traceback|Error calling tool/.test(l)).at(-1)?.trim();
    log(`MASK ${label}: model saw ${JSON.stringify(out)}; server log says ${JSON.stringify(cause)}`);
  }
}

await engine.close?.();
await sleep(500);
log(`closed: monty workers left ${montyWorkers().join(" ") || "none"}`);
process.exit(0);
