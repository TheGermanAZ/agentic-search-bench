#!/usr/bin/env bash
# Runs every SPEC/RUBRIC probe for one OpenClaw Code Mode executor.
# Usage: run.sh node|quickjs   (outputs to ../openclaw-codemode-<impl>/out)
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
E="${1:-node}"
if [ "$E" = node ]; then O="$here/out"; else O="$here/../openclaw-codemode-quickjs-wasi/out"; fi
. "$here/env.sh"
cd "$here"
ENGINE=$E OUT=$O node probe.mjs P1 P2 P3 P4 P5 P6 P8 P9 P10 P11 P12
../mem-lock.sh env ENGINE=$E OUT=$O node probe.mjs P7
WARM_HOST=1 ENGINE=$E OUT=$O node probe.mjs P1 P11
HARDENED=1 ENGINE=$E OUT=$O node probe.mjs P3 P4 P5 P6 P9 P12
../mem-lock.sh env HARDENED=1 ENGINE=$E OUT=$O node probe.mjs P7
