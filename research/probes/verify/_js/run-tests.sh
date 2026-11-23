#!/usr/bin/env bash
# Usage: run-tests.sh <impl> <config> <runtime node|bun> <test...>
# Memory-heavy tests (R8b R8c R9b R9c A1real A5) go through mem-lock.sh.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
impl=$1; config=$2; rt=$3; shift 3
for t in "$@"; do
  pre=""
  case $t in R8c|R9b|R9c|A1real|A5) pre="$HERE/../../mem-lock.sh";; esac
  $pre node "$HERE/rwatch.mjs" "$HERE/../$impl/out/$config-$t.json" $rt "$HERE/rcore.mjs" "$HERE/../$impl/adapter.mjs" "$config" "$t"
done
