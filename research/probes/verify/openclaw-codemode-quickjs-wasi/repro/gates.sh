#!/usr/bin/env bash
# Gate probes only (P3 P4 P5 P6 P7 P9 P12), default then hardened, QuickJS executor. Copy of
# research/probes/openclaw-codemode-node-vm/{probe.mjs,env.sh} with only the dist path adjusted; P7 under mem-lock.
set -u
cd "$(dirname "$0")"
. ./env.sh
O="$PWD/out"
ENGINE=quickjs OUT=$O node probe.mjs P3 P4 P5 P6 P9 P12
../../../mem-lock.sh env ENGINE=quickjs OUT=$O node probe.mjs P7
HARDENED=1 ENGINE=quickjs OUT=$O node probe.mjs P3 P4 P5 P6 P9 P12
../../../mem-lock.sh env HARDENED=1 ENGINE=quickjs OUT=$O node probe.mjs P7
