#!/bin/sh
# Starts a private Executor server for the hardened run: fresh data dir, port 41840, and the two
# public MCP budgets set tight (EXECUTOR_MCP_TIMEOUT_MS, EXECUTOR_MCP_MAX_TOOL_CALLS).
# The server runs in its own process group so it and its workerd child can be stopped together.
# Usage: HARDENED_DIR=/some/empty/dir ./hardened-start-server.sh
set -eu
SRC="$(cd "$(dirname "$0")/../../impls/executor/src" && pwd)"
DIR="${HARDENED_DIR:?set HARDENED_DIR to a fresh directory}"
PORT="${HARDENED_PORT:-41840}"
mkdir -p "$DIR"
if [ ! -f "$DIR/keys.env" ]; then
  printf 'EXECUTOR_API_KEY=%s\nEXECUTOR_ENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > "$DIR/keys.env"
  chmod 600 "$DIR/keys.env"
fi
set -a
. "$DIR/keys.env"
set +a
cd "$SRC"
PROBE_SECRET=s3cr3t EXECUTOR_DISABLE_ANALYTICS=1 DO_NOT_TRACK=1 EXECUTOR_NO_UPDATE_CHECK=1 \
  EXECUTOR_PORT="$PORT" EXECUTOR_DATA_DIR="$DIR/data" \
  EXECUTOR_MCP_TIMEOUT_MS="${HARDENED_TIMEOUT_MS:-10000}" EXECUTOR_MCP_MAX_TOOL_CALLS="${HARDENED_MAX_TOOL_CALLS:-10}" \
  perl -e 'setpgrp(0, 0); exec @ARGV' node --import ./scripts/local-dev.ts apps/local/server/src/main.ts >> "$DIR/server.log" 2>&1 &
echo $! > "$DIR/server.pid"
start=$(date +%s)
until [ "$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $EXECUTOR_API_KEY" "http://127.0.0.1:$PORT/v1/apps")" = 200 ]; do
  kill -0 "$(cat "$DIR/server.pid")" 2>/dev/null || { echo "server exited; see $DIR/server.log"; exit 1; }
  [ $(( $(date +%s) - start )) -gt 120 ] && { echo "server not ready after 120s"; exit 1; }
  sleep 0.5
done
echo "server pid $(cat "$DIR/server.pid") (own process group) ready on $PORT after $(( $(date +%s) - start ))s"
