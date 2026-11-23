#!/usr/bin/env bash
# Runs every probe in its own Node process, default then hardened. Writes out/<P>.txt and out/<P>.json.
set -u
cd "$(dirname "$0")"
rm -f out/P*.json out/P*.txt out/hardened-* out/lookup-count.txt
for p in P1 P2 P3 P4 P5 P6 P6b P8 P9 P10 P11 P12 PX; do node run.mjs "$p"; done
../mem-lock.sh node run.mjs P7
for p in P3 P4 P5 P6 P6b P9 P12; do node run.mjs "$p" --hardened; done
../mem-lock.sh node run.mjs P7 --hardened
