#!/usr/bin/env bash
# Reruns every probe for agno-codemode (default, then hardened), then writes research/probes/results/agno-codemode.json.
# WARNING: CodeMode is not a sandbox. These probes read /etc/hosts, the env, reach example.com, write and delete
# out/agno-write-probe.txt, and run `echo` through os.system and `!`.
set -u
cd "$(dirname "$0")"
export AGNO_TELEMETRY=false
PY=../../impls/agno-codemode/.venv/bin/python
python3 probe_core.py run "$PY" default P1 P2 P3 P4 P5 P6 P8 P9 P10 P11 P12 Pcap Pwrite Pshell
../mem-lock.sh python3 probe_core.py run "$PY" default P7
python3 probe_core.py run "$PY" hardened P3 P4 P5 P6 P9 P12 Pshell
../mem-lock.sh python3 probe_core.py run "$PY" hardened P7
"$PY" swallow_check.py > out/swallow_check_hardened_restart.txt 2>&1   # uses the hardened config
python3 probe_core.py collect
# Slow side check (about 5 minutes): "$PY" p6_default_check.py > out/p6_default_check.txt 2>&1
