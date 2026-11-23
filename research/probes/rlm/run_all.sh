#!/usr/bin/env bash
# Runs every rlm probe in its own process. Writes out/<P>.txt, out/<P>.json and out/<P>.log (full stdout, including
# host-side output from os.system in P12).
set -u
cd "$(dirname "$0")"
PY="../../impls/rlm/.venv/bin/python"
export PROBE_SECRET=s3cr3t   # P5: a known host secret the sandbox should not see
# This Mac's default OpenSSL CA path is missing, so urllib cannot verify example.com (P3). Point it at certifi's bundle.
export SSL_CERT_FILE="$("$PY" -c 'import certifi; print(certifi.where())')"
rm -f out/*.json out/*.txt out/*.log   # a crashed probe must not leave the previous result behind
for p in P1 P2 P3 P4 P5 P6 P7 P8 P9 P9b P10 P11 P12 CTX; do
  "$PY" harness.py "$p" > "out/$p.log" 2>&1 || echo "{\"probe\": \"$p\", \"outcome\": \"error\", \"detail\": \"harness exited $?\"}"
  tail -1 "out/$p.log" 2>/dev/null | grep -q '"probe"' || echo "{\"probe\": \"$p\", \"outcome\": \"error\", \"detail\": \"no summary line; see out/$p.log\"}"
done
