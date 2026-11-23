# CodeMode Unified probe harness (all runtimes)

This folder holds the shared harness for `codemode-unified-{bun,deno,quickjs,isolated-vm,e2b}`. It drives
the MCP stdio server `dist/mcp-server.js` from https://github.com/danieliser/codemode-unified at
`6e4daa3e7ae17bf0764adeb5c72ba922c58b4d93`, cloned into `research/impls/codemode-unified-bun/repo`. It calls
the `execute_code` tool with a `runtime` argument. The host tool `lookup` is a small stdio MCP server
(`lookup-server.mjs`) named in the config that `MCP_CONFIG_PATH` points to, with
`CODEMODE_ENABLE_MCP_INTEGRATION=true`.

## Rerun

```bash
cd research/impls/codemode-unified-bun/repo && npm ci --ignore-scripts && npm run build
cd ../../../probes/codemode-unified-bun
for r in bun deno quickjs; do node run-probes.mjs $r default && node run-probes.mjs $r hardened; done
node run-probes.mjs isolated-vm default && node run-probes.mjs e2b default
node run-probes.mjs bun default P13_twoPass P14_credentials P15_discovery && node run-probes.mjs deno default P13_twoPass
node envlog-check.mjs && python3 build-results.py   # rewrites research/probes/results/codemode-unified-*.json
```

## Notes

- `home/` holds symlinks `.deno/bin/deno` and `.bun/bin/bun`. The runtimes only look at
  `$HOME/.deno/bin/deno` and `$HOME/.bun/bin/bun`, so the driver points the server's HOME here.
- The quickjs runtime gets its own probe table in `driver.mjs`, in the script form it accepts. Most items
  use a new server each (`fresh`), because a reused context rejects every later program.
- QuickJS P6 hangs the server, so each P6 run takes the full 120 s harness kill.
- The extras are P13 (two-pass replay: dependent calls and doubled side effects), P14 (code reads the
  MCP config through env) and P15 (the declarations resource). `envlog-check.mjs` captures the startup
  stdout.
- `supervise.mjs` is shared from `../mastra-codemode-localsandbox/`. It does the RSS sampling, the 4 GB and
  120 s kill, and routes P7 through the mem-lock.
- Hardened config: `timeout: 5000` on `execute_code`. That is the only limit the MCP entry point exposes.
