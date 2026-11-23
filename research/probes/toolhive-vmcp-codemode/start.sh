#!/usr/bin/env bash
# Usage: ./start.sh <default|hardened> -- starts the lookup MCP server (42141) and thv vmcp serve (42140), writes PIDs to run/.
set -eu
cd "$(dirname "$0")"
V="$1"; mkdir -p run out home
THV=../../impls/toolhive-vmcp-codemode/release/bin/thv
for f in run/*.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null || true; rm -f "$f"; done
sleep 1
LOOKUP_COUNT_FILE=$PWD/out/lookup-count.log nohup node lib/lookup-server.mjs http 42141 > run/lookup.log 2>&1 & echo $! > run/lookup.pid
for i in $(seq 1 40); do grep -q listening run/lookup.log 2>/dev/null && break; sleep 0.25; done
# Isolated HOME/XDG so no global ToolHive config is read or written; update checks and usage metrics off (no outbound traffic).
env -i PATH=/usr/bin:/bin HOME=$PWD/home XDG_CONFIG_HOME=$PWD/home/.config XDG_DATA_HOME=$PWD/home/.local/share XDG_STATE_HOME=$PWD/home/.local/state XDG_CACHE_HOME=$PWD/home/.cache \
  TOOLHIVE_SKIP_UPDATE_CHECK=true TOOLHIVE_USAGE_METRICS_ENABLED=false PROBE_SECRET=s3cr3t \
  nohup "$THV" vmcp serve --config "vmcp-$V.yaml" --host 127.0.0.1 --port 42140 > "run/vmcp-$V.log" 2>&1 & echo $! > run/vmcp.pid
for i in $(seq 1 60); do curl -sf http://127.0.0.1:42140/health >/dev/null && { echo "vmcp up ($V) pid $(cat run/vmcp.pid)"; exit 0; }; sleep 0.5; done
echo "vmcp did not come up"; tail -30 "run/vmcp-$V.log"; exit 1
