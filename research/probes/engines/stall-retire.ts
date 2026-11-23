// Stall investigation (PY-ENGINES.md): an execution whose cancel is never confirmed must not fail another execution on
// the same sidecar. Usage: pnpm exec tsx research/probes/engines/stall-retire.ts py-pydantic-ai|py-monty
import { LIMITS } from "../../../src/engines/host";
import type { Corpus } from "../../../src/search";
const name = process.argv[2] ?? "py-pydantic-ai";
const mod = (await import(`../../../src/engines/${name}.ts`)) as { engine: any; _sidecar: any };
const { engine, _sidecar: sc } = mod;
const T0 = Date.now();
const log = (s: string) => console.log(`+${((Date.now() - T0) / 1000).toFixed(1)}s ${s}`);
const corpus = { count: async () => { await new Promise((r) => setTimeout(r, 8000)); return 42; } } as unknown as Corpus;
await engine.run("print(1)", corpus);
const pid1 = sc.pid;
// Drop the cancel for the first execution, as if its task ignored cancellation.
const send = sc.send.bind(sc);
sc.send = (proc: unknown, msg: { t: string }) => (msg.t === "cancel" ? log("cancel dropped") : send(proc, msg));
const L = LIMITS as { wallMs: number };
L.wallMs = 2000;
const a = engine.run("x = 0\nwhile True:\n    x += 1", corpus).then((o: string) => log(`A -> ${o.slice(0, 70)}`));
await new Promise((r) => setTimeout(r, 300));
L.wallMs = 65000;
const b = engine.run(name === "py-monty" ? "print(await count())" : "print(await count(filter={}))", corpus).then((o: string) => log(`B -> ${o.slice(0, 90)}`));
await new Promise((r) => setTimeout(r, 5800));
log(`after grace: spawns=${sc.spawns} old pid ${pid1} alive=${alive(pid1)}`);
const c = engine.run("print(6 * 7 + 1)", corpus).then((o: string) => log(`C -> ${o.slice(0, 70)} (new pid ${sc.pid})`));
await Promise.all([a, b, c]);
await new Promise((r) => setTimeout(r, 500));
log(`end: spawns=${sc.spawns} old pid ${pid1} alive=${alive(pid1)}`);
await engine.close();
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
