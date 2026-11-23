#!/usr/bin/env bash
# Starts the package's ready-made Worker under local `wrangler dev` (no account, no login) on 127.0.0.1:41010,
# runs the probes through createCloudflareIsolateDriver, and stops only the wrangler process it started.
# P6 and P7 each get a fresh wrangler session so a wedged workerd cannot affect later probes.
set -u
cd "$(dirname "$0")"
WR=../../impls/tanstack-ai-codemode-cloudflare/pkg/node_modules/.bin/wrangler
WPID=""
start() {
  PROBE_SECRET=s3cr3t WRANGLER_SEND_METRICS=false "$WR" dev --var PROBE_SECRET:s3cr3t > "out/wrangler-$1.log" 2>&1 &
  WPID=$!
  for i in $(seq 1 120); do
    if curl -s -o /dev/null -X OPTIONS http://127.0.0.1:41010/; then break; fi
    sleep 0.5
  done
  WORKERD=$(pgrep -P "$WPID" -f workerd | head -1); [ -z "$WORKERD" ] && WORKERD=$(pgrep -f "workerd.*41010" | head -1)
  echo "wrangler pid $WPID workerd pid ${WORKERD:-?} ready after ${i} polls" | tee -a out/run-all.log
}
stop() { [ -n "$WPID" ] && kill "$WPID" 2>/dev/null; wait "$WPID" 2>/dev/null; WPID=""; sleep 1; }
trap stop EXIT
probe() { WATCH_EXTRA_PID="${WORKERD:-}" node watch.mjs "$@" | tee -a out/run-all.log; }

DEFAULT="P1 P1b P2 P2b P2c P2d P2e P3 P4 P4b P4c P5 P5b P8 P9 P9b P9c P10 P10b P10c P10d P11 P12 P12b P12c P12d P12e P12f P12g"
HARD="P3 P4 P4b P5 P9 P12 P12b P12c P12e P12g"
start main
for p in ${ONLY:-$DEFAULT}; do probe "$p" node probe.mjs "$p"; done
for p in ${ONLY_HARD:-$HARD}; do probe "hardened-$p" node probe.mjs "$p" --hardened; done
stop
[ -n "${ONLY:-}" ] && exit 0
start P6; probe P6 node probe.mjs P6; stop
start hardened-P6; probe hardened-P6 node probe.mjs P6 --hardened; stop
start P7; ../mem-lock.sh env WATCH_EXTRA_PID="${WORKERD:-}" node watch.mjs P7 node probe.mjs P7 | tee -a out/run-all.log; stop
start hardened-P7; ../mem-lock.sh env WATCH_EXTRA_PID="${WORKERD:-}" node watch.mjs hardened-P7 node probe.mjs P7 --hardened | tee -a out/run-all.log; stop
