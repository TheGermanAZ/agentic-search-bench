#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"
node run-probes.mjs P3 P4 P5 P9 P12 P6
../../../mem-lock.sh node run-probes.mjs P7
node hardened-run.mjs P3 P4 P5 P9 P12 P6
../../../mem-lock.sh node hardened-run.mjs P7
