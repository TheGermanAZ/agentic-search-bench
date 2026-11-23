#!/usr/bin/env bash
# Gate probes only (P3 P4 P5 P6 P7 P9 P12 + sub-variants), default then hardened. P7 under the memory lock.
set -u
cd "$(dirname "$0")"
D="P3 P4 P4b P5 P5b P9 P12 P12b P12c P12d P12e P6"
H="P3 P4 P4b P5 P9 P12 P12b P12c P12e P6"
for p in $D; do node watch.mjs "$p" node probe.mjs "$p"; done
../../../mem-lock.sh node watch.mjs P7 node probe.mjs P7
for p in $H; do node watch.mjs "hardened-$p" node probe.mjs "$p" --hardened; done
../../../mem-lock.sh node watch.mjs hardened-P7 node probe.mjs P7 --hardened
