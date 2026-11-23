#!/usr/bin/env bash
# Usage: run.sh <probe> [prefix] [extra docker args...]   e.g. run.sh P1 ; run.sh P6 hardened -- --mode wasm
# Runs one probe in a fresh container from the symbolica-agentica-sandbox:probe image; output -> out/<prefix><probe>.txt
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
probe="$1"; prefix="${2:-}"; shift; shift || true
pyargs=(); dargs=()
if [ "${1:-}" = "--" ]; then shift; pyargs=("$@"); fi
[ -n "$prefix" ] && prefix="$prefix-"
name="symbolica-agentica-${prefix}${probe}-$$"
mkdir -p "$HERE/out"
start=$(date +%s)
docker run --rm --name "$name" --memory 8g \
  -e PROBE_SECRET=s3cr3t -e PYTHONPATH=/opt/agentica-server/src ${EXTRA_ENV:-} \
  -v "$HERE:/probe:ro" -w /opt/agentica-server/src \
  symbolica-agentica-sandbox:probe \
  timeout -s KILL 170 /opt/agentica-server/.venv/bin/python -u /probe/probe.py "$probe" ${pyargs[@]+"${pyargs[@]}"} \
  > "$HERE/out/${prefix}${probe}.txt" 2>&1
rc=$?
echo "[harness] exit=$rc wall=$(( $(date +%s) - start ))s container=$name" >> "$HERE/out/${prefix}${probe}.txt"
docker rm -f "$name" >/dev/null 2>&1 || true
