#!/usr/bin/env bash
# Reruns every probe for datalayer-codemode-docker (default config, then hardened), then writes research/probes/results/datalayer-codemode-docker.json.
# Each probe runs in its own child process; P7 runs hold research/probes/mem-lock.sh.
set -u
cd "$(dirname "$0")"
export PROBE_DOCKER_PREFIX=datalayer-codemode-docker-  # containers are named with this prefix and removed after each probe
PY=../../impls/datalayer-codemode-eval/.venv/bin/python
python3 probe_core.py run "$PY" default P1 P2 P3 P4 P5 P6 P8 P9 P10 P11 P12
../mem-lock.sh python3 probe_core.py run "$PY" default P7
python3 probe_core.py run "$PY" hardened P1 P2 P3 P4 P5 P6 P9 P12
../mem-lock.sh python3 probe_core.py run "$PY" hardened P7
python3 probe_core.py collect
