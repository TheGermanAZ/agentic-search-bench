#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"
PY=../../../../impls/fastmcp-codemode/.venv/bin/python
python3 probe_core.py run "$PY" default P3 P4 P5 P6 P9 P12
../../../mem-lock.sh python3 probe_core.py run "$PY" default P7
python3 probe_core.py run "$PY" hardened P3 P4 P5 P6 P9 P12
../../../mem-lock.sh python3 probe_core.py run "$PY" hardened P7
