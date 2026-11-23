# utcp-codemode probe harness

Runs P1 to P12 from `research/probes/SPEC.md` against `@utcp/code-mode` through its public API
(`CodeModeUtcpClient.create`, `registerManual` with the `direct-call` plugin, `callToolChain`).

Pinned: commit `e5fdc319bfae1ceec57e7bce37048337635ffb51` (npm `@utcp/code-mode` 1.2.13), `@utcp/sdk` 1.1.0,
`@utcp/direct-call` 1.1.0, `isolated-vm` 6.0.2. The library lives at
`research/impls/utcp-codemode/repo/typescript-library`.

## Rerun

```bash
LIB=~/p/agentic-search-bench/research/impls/utcp-codemode/repo/typescript-library
cd "$LIB" && npm ci --ignore-scripts && npm run build
# isolated-vm is a native addon and needs one build step after --ignore-scripts. Build it against the
# local Node headers so nothing is downloaded (NODE_PREFIX is the folder that contains include/node):
cd "$LIB/node_modules/isolated-vm" && node "$(dirname "$(readlink -f "$(which node)")")/../lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js" rebuild --release -j max --nodedir="$(dirname "$(dirname "$(readlink -f "$(which node)")")")"
# Probes and results:
cd ~/p/agentic-search-bench/research/probes/utcp-codemode && node run-probes.mjs && python3 build-results.py
```

`run-probes.mjs` writes one file per probe to `out/` (`out/P1.txt` through `out/P12.txt`, plus
`out/P2-full-log-*.txt`). P6 takes about 30 s and P7 about 1 s. The run needs no network and no keys.

`build-results.py` assembles `research/probes/results/utcp-codemode.json`. Its outcome words and detail
strings were written by hand from the reviewed `out/` files, so check them against the new output
after any rerun.

## Harness notes

- The host tool is `lookup`, registered as a `direct-call` function in a manual named `host`.
  Sandbox code calls it as `host.lookup(...)`, because the SDK prefixes tool names with the manual name.
- P5 sets `PROBE_SECRET` on the host before the sandbox starts. P12 sets a host-only canary global.
- P7 samples host RSS every 20 ms. P11 is a single run of 20 executions, so repeat it when you need a spread.
- Machine load changes the timings a lot. A run during heavy load gave a P11 median of 2.6 ms, against
  0.73 to 0.97 ms when quieter. Check `uptime` before trusting a timing.
