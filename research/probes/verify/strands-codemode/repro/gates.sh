#!/usr/bin/env bash
# Gate probes only (P3 P4 P5 P6 P7 P9 P12), default then hardened. Unchanged copy of the worker's probe_core.py,
# adapter.py, meta.json (research/probes/strands-codemode/); `collect` (writes results/) is never called.
# P7 under mem-lock, wrapped in rwatch.mjs for a tree RSS + phys_footprint record.
set -u
cd "$(dirname "$0")"
export OTEL_SDK_DISABLED=true
PY=../../../../impls/strands-codemode/.venv/bin/python
python3 probe_core.py run "$PY" default P3 P4 P5 P6 P9 P12
../../../mem-lock.sh node ../../_js/rwatch.mjs out/P7.watch.json python3 probe_core.py run "$PY" default P7
python3 probe_core.py run "$PY" hardened P3 P4 P5 P6 P9 P12
../../../mem-lock.sh node ../../_js/rwatch.mjs out/hardened-P7.watch.json python3 probe_core.py run "$PY" hardened P7
