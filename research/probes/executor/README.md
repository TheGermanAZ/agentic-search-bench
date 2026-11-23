# Executor probes

Runs P1 to P12 from `../SPEC.md` against Executor's local server, built from the
clone in `research/impls/executor/src` (commit `c381941128ad29263baa6906d3b082ad9327ce56`).

One-time setup (from this folder):

```sh
(cd ../../impls/executor/src && bun install && bun run apps:build)
./start-server.sh && node deploy.mjs
```

Rerun:

```sh
./start-server.sh && node run.mjs P1 P2 P3 P4 P5 P8 P9 P10 P11 P12 LIMIT_calls LIMIT_source LIMIT_globals APPROVAL
./start-server.sh && node run.mjs P6          # 120 s
./start-server.sh && node run.mjs P6long      # 300 s, the documented 5 minute limit
./start-server.sh && node run.mjs CRASH_recursion   # crashes the server (heap OOM)
./start-server.sh && node run.mjs P7                # crashes the server (heap OOM)
```

Output lands in `out/`. `out/short-timeout/` came from a server started with
`EXECUTOR_MCP_TIMEOUT_MS=10000 ./start-server.sh` and
`PROBE_APPROVAL_WAIT_MS=15000 node run.mjs APPROVAL`.

Notes:

- `start-server.sh` runs the server on `127.0.0.1:4399` with `PROBE_SECRET=s3cr3t`,
  `EXECUTOR_DISABLE_ANALYTICS=1` and `DO_NOT_TRACK=1`, data in the clone's `.local/dev/`.
- `app/` is the deployed app: `lookup` (200 ms, `{id, value: id*2}`, never needs approval)
  and `gated` (always needs approval). Programs call `tools.probe.lookup({id})`.
- Host call counts come from Executor's own `execution.toolCalls` record.
- Two local edits to the clone, build only: `packages/apps/scripts/build.mjs` and
  `reference.mjs` pin TypeScript `typeRoots` to the clone, because `@types/bun` in the
  parent repo's `node_modules` broke the declaration build. `telemetry:build` needs Rust
  and was skipped; the server runs without its local collector.
