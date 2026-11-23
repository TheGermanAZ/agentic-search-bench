# voidmcp probe harness

Runs SPEC P1-P12 (plus the RUBRIC hardened run) against VoidMCP's `execute_code` tool over MCP stdio, with no LLM.
Binary: v0.0.10 darwin-arm64 release in `research/impls/voidmcp/bin/voidmcp` (same tree as pinned commit 22e37f1).

```bash
cd ~/p/agentic-search-bench/research/probes/voidmcp
# one-time: fetch the binary and register the lookup server (flags must come before the positionals)
gh release download v0.0.10 -R voidmind-io/voidmcp -p voidmcp-darwin-arm64.tar.gz -D ../../impls/voidmcp/dl && tar xzf ../../impls/voidmcp/dl/voidmcp-darwin-arm64.tar.gz -C ../../impls/voidmcp/bin
HOME=$PWD/state ../../impls/voidmcp/bin/voidmcp add --db $PWD/state/voidmcp.db lookup "$(node -p 'require("fs").realpathSync(process.execPath)') $PWD/lookup-server.mjs $PWD/state/calls.log"
# probes (P6 takes 120 s per config; P7 goes through the shared memory lock)
node run-probes.mjs --only setup,P1,P2,P3,P4,P5,P6,P8,P9,P10,P11,P12 && node run-probes.mjs --hardened --only P3,P4,P5,P6,P9,P9cap,P12
../mem-lock.sh sh -c 'node run-probes.mjs --only P7; node run-probes.mjs --hardened --only P7; node memcheck.mjs; node memcheck.mjs --memory 8'
python3 build-results.py
```

- `lookup-server.mjs` is a dependency-free stdio MCP server; it appends a line to `state/calls.log` per call, which is how host calls are counted.
- `mcp-client.mjs` is a minimal newline-delimited JSON-RPC client. `run-probes.mjs` writes `out/<probe>.txt` (`out/hardened-*.txt` with `--hardened`).
- `memcheck.mjs` runs small bounded allocations to show the `--memory` limit only refuses single large allocations.
- P6 and P7 kill the voidmcp process they started (by PID, via the child handle). Leftover `$TMPDIR/voidmcp-sandbox-*` dirs from killed runs can be deleted afterwards.
- `build-results.py` holds hand-written outcomes; recheck them against `out/` after a rerun. Timings swing with machine load (load average 32-40 during these runs).
