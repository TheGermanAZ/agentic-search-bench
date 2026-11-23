# janwilmake-agent-codemode probe harness

agent-codemode ships no runner and no sandbox: the coding agent writes a `.ts` script and runs it in the
user's shell with `tsx` (README.md:173). So each probe is a `.ts` file in `probes/`, run as a fresh `tsx`
process with `PROBE_SECRET=s3cr3t`. `lookup` is a local stdio MCP server (`lookup-server.mjs`) reached
through the package's exported `StdioMcpClient` (`probes/bridge.ts`). The `mcp.<server>` proxy was not
used because resolving any name reads the macOS Keychain item `Claude Code-credentials`.

Pinned: commit `1d8b8735b9d085eeeca762edba8cda967b40df17` (0.1.1), tsx 4.23.12, Node 24.22.1.

## Rerun

```bash
cd ~/p/agentic-search-bench/research/impls/janwilmake-agent-codemode/repo && npm ci --ignore-scripts && npx tsc
cd ~/p/agentic-search-bench/research/probes/janwilmake-agent-codemode && node run-probes.mjs && ../mem-lock.sh node run-probes.mjs P7 && python3 -I build-results.py
```

P6 takes 120 s (no limit). P7 is killed by the harness at 4 GB tree RSS. The harness kills the whole
process tree it started, because tsx runs the script in a grandchild process. `build-results.py` holds
hand-written detail strings from the reviewed `out/` files; recheck them after a rerun.
