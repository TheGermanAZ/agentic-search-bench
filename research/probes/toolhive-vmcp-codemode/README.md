# toolhive-vmcp-codemode probe harness

ToolHive Virtual MCP (`thv vmcp serve`, release v0.67.1 darwin/arm64 binary, sha256-verified) with `codeMode.enabled`, one static
streamable-http backend (`lib/lookup-server.mjs`, the SPEC `lookup` tool on 127.0.0.1:42141, aggregated as `probe_lookup`),
anonymous incoming auth, vMCP on 127.0.0.1:42140. The driver (`lib/mcp-probe.mjs`, copied from docker-mcp-gateway-codemode) connects an MCP
client to vMCP's `/mcp` and calls `execute_tool_script` with `{script}`. `start.sh` runs `thv` with an isolated HOME/XDG under `home/`,
`TOOLHIVE_SKIP_UPDATE_CHECK=true` and `TOOLHIVE_USAGE_METRICS_ENABLED=false`, and `PROBE_SECRET=s3cr3t` in its environment.

Binary: `research/impls/toolhive-vmcp-codemode/release/bin/thv` (from `toolhive_0.67.1_darwin_arm64.tar.gz`); source clone in `research/impls/toolhive-vmcp-codemode/src` (tag v0.67.1, 2d33d6b).

```sh
cd research/probes/toolhive-vmcp-codemode && npm install && ./start.sh default && node lib/mcp-probe.mjs config.mjs out "" P1 P2 P3 P4 P5 P6 P8 P9 P10 P11 P12 \
  && node lib/mcp-probe.mjs config-p6c.mjs out "" P6c && VMCP_VARIANT=default ../mem-lock.sh node lib/mcp-probe.mjs config.mjs out "" P7 \
  && VMCP_VARIANT=default ../mem-lock.sh node lib/mcp-probe.mjs config-p7b.mjs out/p7b "" P7 && ../mem-lock.sh node lib/concurrent.mjs out/P7-concurrent.txt
./start.sh hardened && VMCP_VARIANT=hardened node lib/mcp-probe.mjs config.mjs out hardened- P1 P3 P4 P5 P6 P6h P9 P12 && VMCP_VARIANT=hardened ../mem-lock.sh node lib/mcp-probe.mjs config-p6d.mjs out hardened- P6d \
  && VMCP_VARIANT=hardened ../mem-lock.sh node lib/mcp-probe.mjs config.mjs out hardened- P7 && VMCP_VARIANT=hardened ../mem-lock.sh node lib/mcp-probe.mjs config-p7b.mjs out/p7b hardened- P7 \
  && ../mem-lock.sh node lib/concurrent.mjs out/hardened-P7-concurrent.txt; kill $(cat run/vmcp.pid) $(cat run/lookup.pid)
python3 tools/write-results.py   # writes research/probes/results/toolhive-vmcp-codemode.json
```

Notes: `while` is disabled in this Starlark dialect, so P6/P7 also run a `for i in range(10**12)` equivalent. `config-p6c.mjs` / `config-p6d.mjs`
hold builtin-heavy CPU variants (P6c ~73 s, P6d > 120 s); `config-p7b.mjs` holds low-step allocation variants (`out/p7b/`).
`CAL.txt`/`CAL2.txt` are calibration runs (steps per loop iteration, ms per `count()`); `config-cal2.mjs` produced CAL2.
After a 120 s cap or a 4 GB RSS kill, the driver's `reset()` restarts only this harness's PIDs (`run/*.pid`).
