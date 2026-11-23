# Executor hardened run

A private server from the same local build, on `127.0.0.1:41840`, with a fresh data dir and
`EXECUTOR_MCP_TIMEOUT_MS=10000`, `EXECUTOR_MCP_MAX_TOOL_CALLS=10` (the only two public program limits).

```sh
export HARDENED_DIR=$(mktemp -d)   # fresh data dir and keys
./hardened-start-server.sh && node hardened-run.mjs DEPLOY
node hardened-run.mjs P1 LIMIT_calls P3 P4 P5 P9 P12 P6
../mem-lock.sh node hardened-run.mjs P7
../mem-lock.sh node hardened-run.mjs CRASH_recursion
kill -TERM -"$(cat "$HARDENED_DIR/server.pid")"   # the server runs in its own process group
```

Output lands in `out/hardened-*.txt`.
