#!/usr/bin/env bash
# Reruns every probe for fastmcp-codemode (default config, then hardened), then writes research/probes/results/fastmcp-codemode.json.
# Each probe runs in its own child process; P7 runs hold research/probes/mem-lock.sh.
set -u
cd "$(dirname "$0")"

PY=../../impls/fastmcp-codemode/.venv/bin/python
python3 probe_core.py run "$PY" default P1 P2 P3 P4 P5 P6 P8 P9 P10 P11 P12 Pcap
../mem-lock.sh python3 probe_core.py run "$PY" default P7
python3 probe_core.py run "$PY" hardened P3 P4 P5 P6 P9 P12
../mem-lock.sh python3 probe_core.py run "$PY" hardened P7
python3 probe_core.py collect
