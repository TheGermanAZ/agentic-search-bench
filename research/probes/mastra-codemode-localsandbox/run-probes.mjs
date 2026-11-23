// Runs P1-P12 (or the named probes) for one Mastra Code Mode backend, one child process per probe.
// Usage: node run-probes.mjs <localsandbox|isolated-vm|quickjs> <default|hardened> [P1 P2 ...]
import { supervise } from './supervise.mjs';

const [backend, mode = 'default', ...only] = process.argv.slice(2);
const ALL = mode === 'hardened' ? ['P3', 'P4', 'P5', 'P6', 'P7', 'P9', 'P12'] : Array.from({ length: 12 }, (_, i) => `P${i + 1}`);
const probes = only.length ? only : ALL;
const HARNESS = new URL('./harness.mjs', import.meta.url).pathname;
const OUT = new URL(`../mastra-codemode-${backend}/out/`, import.meta.url).pathname;
const nodeFlags = backend === 'isolated-vm' ? ['--no-node-snapshot'] : [];

for (const p of probes) {
  const outFile = OUT + (mode === 'hardened' ? 'hardened-' : '') + p + '.txt';
  const { facts } = await supervise({
    cmd: process.execPath,
    args: [...nodeFlags, HARNESS, backend, p, mode],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PROBE_SECRET: 's3cr3t' },
    outFile,
    memLock: p === 'P7',
  });
  console.log(backend, mode, p, 'exit', facts.exitCode, facts.signal ?? '', facts.killedByHarness ?? '', `${facts.totalWallMs} ms`, `peak ${facts.peakTreeRssMB} MB`);
}
