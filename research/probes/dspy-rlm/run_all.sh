#!/usr/bin/env bash
# Reruns every probe for dspy-rlm (default only: hardened is null), then writes research/probes/results/dspy-rlm.json.
# Needs Deno 2.x on PATH. Caches go to research/impls/dspy-rlm/{cache,deno-cache} (set in adapter.py).
set -u
cd "$(dirname "$0")"
PY=../../impls/dspy-rlm/.venv/bin/python
python3 probe_core.py run "$PY" default P1 P2 P2both Pcap P3 P3try P4 P5 P6 P8 P8within P9 P10 P11 P12 P12js P12jsTry
../mem-lock.sh python3 probe_core.py run "$PY" default P7 P7next
"$PY" p11_breakdown.py > out/p11_breakdown.txt
python3 probe_core.py collect
