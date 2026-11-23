// Runs P1-P12 (or the named probes) for one CodeMode Unified runtime, one supervised child per probe.
// Usage: node run-probes.mjs <bun|quickjs|deno|isolated-vm|e2b> <default|hardened> [P1 P2 ...]
import { supervise } from '../mastra-codemode-localsandbox/supervise.mjs';

const [runtime, mode = 'default', ...only] = process.argv.slice(2);
const ALL = mode === 'hardened' ? ['P3', 'P4', 'P5', 'P6', 'P7', 'P9', 'P12'] : Array.from({ length: 12 }, (_, i) => `P${i + 1}`);
const probes = only.length ? only : ALL;
const DRIVER = new URL('./driver.mjs', import.meta.url).pathname;
const OUT = new URL(`../codemode-unified-${runtime}/out/`, import.meta.url).pathname;

for (const p of probes) {
  const outFile = OUT + (mode === 'hardened' ? 'hardened-' : '') + p + '.txt';
  const { facts } = await supervise({
    cmd: process.execPath,
    args: [DRIVER, runtime, p, mode],
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    outFile,
    memLock: p === 'P7',
  });
  console.log(runtime, mode, p, 'exit', facts.exitCode, facts.signal ?? '', facts.killedByHarness ?? '', `${facts.totalWallMs} ms`, `peak ${facts.peakTreeRssMB} MB`);
}
