#!/usr/bin/env bash
# Runs every probe against npm `run` 2.1.13: default config (run()), then hardened (createRunner({limits})).
# P7 runs under the machine-wide memory lock. Each probe writes out/<label>.txt and out/<label>.json.
set -u
cd "$(dirname "$0")"
DEFAULT="P1 P2 P2b P2c P2d P2e P3 P4 P4b P4c P5 P5b P8 P9 P9b P10 P10b P10c P10d P11 P12 P12b P12c P12d P12e P6"
HARD="P3 P4 P4b P5 P6 P9 P12 P12b P12c P12e"
for p in $DEFAULT; do node watch.mjs "$p" node probe.mjs "$p"; done
../mem-lock.sh node watch.mjs P7 node probe.mjs P7
for p in $HARD; do node watch.mjs "hardened-$p" node probe.mjs "$p" --hardened; done
../mem-lock.sh node watch.mjs hardened-P7 node probe.mjs P7 --hardened
