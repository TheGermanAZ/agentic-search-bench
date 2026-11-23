#!/usr/bin/env bash
# Runs every probe in its own process, default then hardened. Writes out/<P>.txt and out/<P>.json.
# Needs the hyperlight-sandbox 0.10.0 venv; see README.md.
set -u
cd "$(dirname "$0")"
PY="../../impls/ms-agent-framework-hyperlight/.venv-hl010/bin/python"
export PROBE_SECRET=s3cr3t
rm -f out/P*.json out/P*.txt out/hardened-*
for p in P1 P2 P3 P4 P5 P6 P8 P9 P10 P11 P12 PX; do "$PY" core.py "$p"; done
../mem-lock.sh "$PY" core.py P7
for p in P3 P4 P5 P6 P9 P12; do "$PY" core.py --hardened "$p"; done
../mem-lock.sh "$PY" core.py --hardened P7
