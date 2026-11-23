#!/usr/bin/env bash
# Starts my-cool-proxy 1.6.2 (npm) with HOME and XDG dirs pointed at ./home so nothing touches the real home. Arg 1: config file.
set -eu
P=$(cd "$(dirname "$0")" && pwd)
CFG=${1:-$P/config.json}
# A script stuck in a Lua loop blocks the event loop, so SIGTERM is never handled; fall back to SIGKILL.
if [ -f "$P/out/proxy.pid" ] && kill "$(cat "$P/out/proxy.pid")" 2>/dev/null; then sleep 2; kill -9 "$(cat "$P/out/proxy.pid")" 2>/dev/null || true; fi
HOME=$P/home XDG_CONFIG_HOME=$P/home/.config XDG_DATA_HOME=$P/home/.local/share XDG_STATE_HOME=$P/home/.local/state XDG_CACHE_HOME=$P/home/.cache \
  CONFIG_PATH=$CFG PROBE_SECRET=s3cr3t nohup node "$P/../../impls/my-cool-proxy/npm/node_modules/@karashiiro/my-cool-proxy/bin/my-cool-proxy.mjs" > "$P/out/proxy.log" 2>&1 &
echo $! > "$P/out/proxy.pid"
for i in $(seq 1 60); do curl -s --max-time 2 -o /dev/null "http://127.0.0.1:41420/mcp" && exit 0; sleep 0.5; done
tail -30 "$P/out/proxy.log"; exit 1
