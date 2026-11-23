#!/usr/bin/env bash
# Reruns every probe for llamaindex-codeact (default config, then hardened), then writes research/probes/results/llamaindex-codeact.json.
# Each probe runs in its own child process; P7 runs hold research/probes/mem-lock.sh.
set -u
cd "$(dirname "$0")"

PY=../../impls/llamaindex-codeact/.venv/bin/python
python3 probe_core.py run "$PY" default P1 P2 P3 P4 P5 P6 P8 P8b P9 P9b P10 P10b P11 P12
../mem-lock.sh python3 probe_core.py run "$PY" default P7
python3 probe_core.py collect
