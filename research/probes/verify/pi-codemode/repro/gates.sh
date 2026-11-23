#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"
for c in default hardened; do pre=$([ $c = default ] || echo "$c-"); for p in P3 P4 P5 P9 P12 P6; do python3 -I watch.py out/${pre}$p.txt node probe.mjs $c $p; done; ../../../mem-lock.sh python3 -I watch.py out/${pre}P7.txt node probe.mjs $c P7; done
