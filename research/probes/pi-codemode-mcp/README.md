# pi-codemode-mcp probe harness

Runs P1 to P12 from `research/probes/SPEC.md` (plus RUBRIC's hardened run, and P3b/P6b variants) against
mitsuhiko/pi-codemode-mcp `0ad55d6a8d6eeb44a255903bd10f22eacd72539d` (`research/impls/pi-codemode-mcp/repo`).
It is a Pi extension, so `probe.mjs` loads `src/index.ts` with jiti the way Pi's extension loader does, passes a
minimal ExtensionAPI, fires `session_start`, and calls the registered `call_mcp` tool. The SPEC's `lookup` tool is
`lookup-server.mjs`, a stdio MCP server registered through `mcp.json` (`--mcp-config`). `HOME` points at `home/` so the
extension never reads the user's `~/.pi` config or OAuth tokens. No LLM, no network except P3b's example.com fetch.

## Rerun

```bash
cd ~/p/agentic-search-bench/research/impls/pi-codemode-mcp/repo && npm ci --ignore-scripts && cd ~/p/agentic-search-bench/research/probes/pi-codemode-mcp && npm install --ignore-scripts && sed -i '' "s|\"args\": \[.*\]|\"args\": [\"$PWD/lookup-server.mjs\"]|" mcp.json
export HOME=$PWD/home; for c in default hardened; do pre=$([ $c = default ] || echo "$c-"); for p in P1 P2 P3 P3b P4 P5 P6 P6b P8 P9 P10 P11 P12; do python3 -I watch.py out/${pre}$p.txt node probe.mjs $c $p; done; ../mem-lock.sh python3 -I watch.py out/${pre}P7.txt node probe.mjs $c P7; done; python3 -I build-results.py
```

Configs: `default` (no options, 30 s timeout) and `hardened` (`timeoutMs: 1000`, the only limit the tool exposes).
`watch.py` samples the process-tree RSS and kills at 4 GB or 120 s. P6b (`await null; while (true) {}`) always runs to
the 120 s kill because it blocks the host event loop. `server-parallel-check.mjs` is the P9 control: the same lookup
server called directly from an MCP SDK client. `build-results.py` writes `research/probes/results/pi-codemode-mcp.json`;
its details were written by hand from `out/`, so recheck them after a rerun.
