#!/usr/bin/env bash
# Reruns every probe for hermes-execute-code (default local backend, then hardened Docker backend), then writes
# research/probes/results/hermes-execute-code.json.
# WARNING: the local backend is not isolated: probes read /etc/hosts, reach example.com, write and delete
# out/hermes-write-probe.txt, and run echo through os.system. The hardened run needs Docker and the
# nousresearch/hermes-sandbox:desktop image (docker pull it first, ~1.15 GB compressed).
set -u
cd "$(dirname "$0")"
PY="$(cd ../../impls/hermes-execute-code && pwd)/.venv/bin/python"
python3 probe_core.py run "$PY" default P1 P1t P2 P3 P4 P5 P5scrub P6 P8 P9 P9t P9threads P10 P11 P12 Pcap Pwrite Ptoolcap
../mem-lock.sh python3 probe_core.py run "$PY" default P7
for p in P1 P3 P4 P5 P5scrub P6 P9 P12 Pwrite P10; do
  python3 probe_core.py run "$PY" hardened "$p"; ./docker_cleanup.sh > "out/hardened-docker-state-$p.txt"
done
for p in P7 P7next; do
  ../mem-lock.sh python3 probe_core.py run "$PY" hardened "$p"; ./docker_cleanup.sh > "out/hardened-docker-state-$p.txt"
done
python3 probe_core.py collect
# Slow side check (about 5 minutes): "$PY" p6_default_check.py > out/p6_default_check.txt 2>&1
