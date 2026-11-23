#!/usr/bin/env bash
# Usage: run-tests.sh <impl> <config> <test...>  (memory-heavy tests go through mem-lock.sh)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
impl=$1; config=$2; shift 2
PY="$HERE/../../../impls/$impl/.venv/bin/python"
for t in "$@"; do
  pre=""
  case $t in R8c|R9b|R9c) pre="$HERE/../../mem-lock.sh";; esac
  $pre node "$HERE/../_js/rwatch.mjs" "$HERE/../$impl/out/$config-$t.json" "$PY" "$HERE/rcore.py" "$HERE/../$impl/adapter.py" "$config" "$t"
done
