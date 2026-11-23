#!/usr/bin/env bash
# Gate probes for hermes-execute-code. Copy of the worker's probe_core.py/adapter.py/meta.json/docker_cleanup.sh;
# only the impl path depth and a container-name prefix changed. `collect` is never called.
# Default (local backend): P3 P4 P5 P9 P12 only (cheap; they decide G1). P6 (300 s default) and P7 (no limit,
# 3.3 GB) are not rerun on the shared machine. Hardened (Docker): all seven, P7 under mem-lock.
set -u
cd "$(dirname "$0")"
PY="$(cd ../../../../impls/hermes-execute-code && pwd)/.venv/bin/python"
python3 probe_core.py run "$PY" default P3 P4 P5 P9 P12
for p in P3 P4 P5 P6 P9 P12; do
  python3 probe_core.py run "$PY" hardened "$p"; ./docker_cleanup.sh > "out/hardened-docker-state-$p.txt"
done
../../../mem-lock.sh python3 probe_core.py run "$PY" hardened P7; ./docker_cleanup.sh > out/hardened-docker-state-P7.txt
