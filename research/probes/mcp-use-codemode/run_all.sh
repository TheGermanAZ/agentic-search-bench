#!/usr/bin/env bash
# Runs every probe in its own process, default then hardened. Writes out/<P>.txt and out/<P>.json.
set -u
cd "$(dirname "$0")"
PY="../../impls/mcp-use-codemode/.venv/bin/python"
export PROBE_SECRET=s3cr3t
export MCP_USE_ANONYMIZED_TELEMETRY=false
# uv Python does not trust the macOS keychain; without a CA bundle P3 fails on TLS verification, not on the sandbox
export SSL_CERT_FILE="$("$PY" -c "import certifi; print(certifi.where())")"
rm -f out/P*.json out/P*.txt out/hardened-* out/lookup-count.txt
for p in P1 P2 P3 P4 P5 P6 P8 P9 P10 P11 P12 PX; do "$PY" core.py "$p"; done
../mem-lock.sh "$PY" core.py P7
for p in P3 P4 P5 P6 P9 P12; do "$PY" core.py --hardened "$p"; done
../mem-lock.sh "$PY" core.py --hardened P7
