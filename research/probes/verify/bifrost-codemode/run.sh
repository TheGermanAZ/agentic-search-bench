#!/usr/bin/env bash
# Usage: run.sh <default|hardened> <test...>. Each test restarts the gateway container in the adapter's make();
# memory-heavy tests hold mem-lock.sh. Removes the container at the end.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
config=$1; shift
for t in "$@"; do
  pre=""
  case $t in R8a|R8b|R9b|R9c) pre="$HERE/../../mem-lock.sh";; esac
  $pre node "$HERE/../_js/rwatch.mjs" "$HERE/out/$config-$t.json" node "$HERE/../_js/rcore.mjs" "$HERE/adapter.mjs" "$config" "$t"
done
docker rm -f bifrost-codemode-verify >/dev/null 2>&1 || true
