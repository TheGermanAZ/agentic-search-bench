#!/usr/bin/env bash
# Runs every CodeAct probe in its own process. Needs ../../impls/codeact/.venv (ipython, certifi).
set -u
cd "$(dirname "$0")"
PY="../../impls/codeact/.venv/bin/python"
export PROBE_SECRET=s3cr3t   # P5: a known host secret the sandbox should not see
# This Mac's default OpenSSL CA path is missing, so urllib cannot verify example.com (P3). Point it at certifi's bundle.
export SSL_CERT_FILE="$("$PY" -c 'import certifi; print(certifi.where())')"
rm -f out/*.json out/*.txt out/*.log
for p in P1 P2 P3 P4 P5 P6 P7 P8 P9 P9b P10 P11 P12; do
  "$PY" harness.py "$p" > "out/$p.log" 2>&1 || echo "{\"probe\": \"$p\", \"outcome\": \"error\", \"detail\": \"harness exited $?\"}"
done
