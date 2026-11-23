#!/usr/bin/env bash
# Reruns every probe for strands-codemode (default, then hardened), then writes research/probes/results/strands-codemode.json.
set -u
cd "$(dirname "$0")"
export OTEL_SDK_DISABLED=true
PY=../../impls/strands-codemode/.venv/bin/python
python3 probe_core.py run "$PY" default P1 P2 P3 P4 P5 P6 P8 P9 P10 P11 P12 Pcap P9wide Precur Pclock
../mem-lock.sh python3 probe_core.py run "$PY" default P7
python3 probe_core.py run "$PY" hardened P3 P4 P5 P6 P9 P12
../mem-lock.sh python3 probe_core.py run "$PY" hardened P7
python3 probe_core.py collect
