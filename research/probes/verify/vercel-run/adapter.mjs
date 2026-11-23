// vercel-run adapter: run() (shared default runner) or createRunner({limits}) for the hardened budget.
import { pathToFileURL, fileURLToPath } from 'node:url';
const PKG = fileURLToPath(new URL('../../../impls/vercel-run/pkg/node_modules/run/', import.meta.url));
const { run, createRunner } = await import(pathToFileURL(PKG + 'dist/index.js').href);
const MiB = 1024 * 1024;
export const HARDENED_LIMITS = { timeoutMs: 15_000, cpuTimeoutMs: 5_000, memoryLimitBytes: 32 * MiB, maxStackSizeBytes: MiB, maxSourceBytes: 128 * 1024, maxResultBytes: 512 * 1024, maxConsoleOutputBytes: 32 * 1024, maxHostFunctionArgumentsBytes: 256 * 1024, maxHostFunctionOutputBytes: MiB, maxBridgeRequests: 100, maxInFlightBridgeRequests: 8, maxContinuationBytes: 8 * MiB };
export default async (config, host) => {
  const hostFunctions = { host: { lookup: async ({ id }) => host.lookup(id), failing: async () => host.failing(), rich: async () => host.rich() } };
  const runner = config === 'hardened' ? createRunner({ limits: HARDENED_LIMITS }) : null;
  return {
    name: 'vercel-run', T: 'host.lookup', F: 'host.failing', R: 'host.rich', ret: true,
    notes: config === 'hardened' ? 'createRunner({limits: HARDENED_LIMITS}) shared' : 'run() (module default runner, shared)',
    exec: (source) => (runner ? runner.run({ source, hostFunctions }) : run({ source, hostFunctions })),
    close: async () => runner?.close?.(),
  };
};
