#!/usr/bin/env bash
# Runs every smolagents-local probe in its own process. Writes out/<P>.txt and out/<P>.json.
set -u
cd "$(dirname "$0")"
PY="../../impls/smolagents-local/.venv/bin/python"
export PROBE_SECRET=s3cr3t   # P5: a known host secret the sandbox should not see
rm -f out/*.json out/*.txt   # a crashed probe must not leave the previous result behind
for p in P1 P2 P3 P4 P4b P5 P6 P6b P7 P8 P9 P9b P10 P11 P12; do
  "$PY" harness.py "$p" || echo "{\"probe\": \"$p\", \"outcome\": \"error\", \"detail\": \"harness exited $?\"}"
done
