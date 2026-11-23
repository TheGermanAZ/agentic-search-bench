# Mastra Code Mode probe harness (all backends)

This folder holds the shared harness for `mastra-codemode-localsandbox`, `mastra-codemode-isolated-vm`
and `mastra-codemode-quickjs`. It drives `createCodeMode(...).tool.execute({ code }, {})` from
`@mastra/core/tools`, the same tool object an Agent receives. Each backend has its own npm install in
`research/impls/mastra-codemode-<backend>/` (`@mastra/core` 1.85.0, plus `@mastra/isolated-vm` 0.1.4 or
`@mastra/quickjs` 0.1.5). Source was read from a sparse clone at commit
`aa82a4a7858c637f654be24391ff306dcb568c00` in `research/impls/mastra-codemode-localsandbox/repo`.

## Rerun

```bash
cd research/probes/mastra-codemode-localsandbox
for b in localsandbox isolated-vm quickjs; do node run-probes.mjs $b default && node run-probes.mjs $b hardened && node run-probes.mjs $b hardened P6x; done
python3 build-results.py   # rewrites research/probes/results/mastra-codemode-*.json
```

Installs, if `node_modules` is missing: `cd research/impls/mastra-codemode-<backend> && npm install --ignore-scripts`
with the versions above. isolated-vm 6.2.0 ships a darwin-arm64 prebuild, so no compile step was needed.

## Files

- `harness.mjs` runs one probe in-process and prints a JSON record. The host tool `lookup` is a Mastra
  `createTool`, called from code as `external_lookup`.
- `run-probes.mjs` runs one child per probe through `supervise.mjs`, which samples the RSS of the child's
  process tree, kills it at 4 GB or 120 s, and routes P7 through `../mem-lock.sh`.
- Hardened config: `timeout: 5000`; `memoryLimitMb: 32` for QuickJS and isolated-vm;
  `LocalSandbox({ isolation: 'seatbelt', nativeSandbox: { allowNetwork: false, readOnly: true } })`.
- `P6x` is an extra probe: it counts host timer ticks during a runaway loop, to see whether the
  backend blocks the host event loop.
- `build-results.py` holds hand-written outcome words. Check them against `out/` after a rerun.
