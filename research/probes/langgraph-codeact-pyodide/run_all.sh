#!/usr/bin/env bash
# Reruns every probe for langgraph-codeact-pyodide (default config, then hardened), then writes research/probes/results/langgraph-codeact-pyodide.json.
# Each probe runs in its own child process; P7 runs hold research/probes/mem-lock.sh.
set -u
cd "$(dirname "$0")"

PY=../../impls/langgraph-codeact/.venv-lock/bin/python
python3 probe_core.py run "$PY" default P1 P1s P2 P3 P3b P3c P4 P5 P5b P6 P8 P9 P9s P10 P11 P12 P12d P12e P12f
../mem-lock.sh python3 probe_core.py run "$PY" default P7
python3 probe_core.py run "$PY" hardened P3 P3b P4 P5 P5b P6 P9 P9s P12 P12e P12f
../mem-lock.sh python3 probe_core.py run "$PY" hardened P7
python3 probe_core.py collect
