#!/usr/bin/env bash
# Start mcp-gway (HTTP transport) with an isolated HOME and PROBE_SECRET set.
# Usage: ./start-gw.sh <port> [hardened]   -> prints the gateway PID; logs to out/gw-<port>.log
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
PORT="$1"; MODE="${2:-default}"
export HOME="$HERE/home" XDG_CONFIG_HOME="$HERE/home/.config" XDG_DATA_HOME="$HERE/home/.local/share"
export MCP_GWAY_ALLOW_LOCAL_COMMANDS=node MCP_GWAY_LOG_TO_FILE=0 PROBE_SECRET=s3cr3t
if [ "$MODE" = hardened ]; then
  # Strictest documented knobs: docs/code-mode.md "Execution Budgets" and "Result Budget".
  export MCP_GWAY_EXEC_TIMEOUT=1 MCP_GWAY_MAX_RESULT_BYTES=1024
fi
"$HERE/../../impls/mcp-gway-codemode/.venv/bin/mcp-gway" serve --transport http --host 127.0.0.1 --port "$PORT" \
  --registry-dir "$HERE/home/.config/mcp-gway/servers" >"$HERE/out/gw-$PORT.log" 2>&1 &
echo $!
